import crypto from 'crypto';
import { storage } from '../storage.js';

const mpApiBaseUrl = process.env.MP_API_BASE_URL ?? 'https://api.mercadopago.com';
const mpAuthBaseUrl = process.env.MP_AUTH_BASE_URL ?? 'https://auth.mercadopago.com.br';

const clientId = process.env.MP_CLIENT_ID;
const clientSecret = process.env.MP_CLIENT_SECRET;
const appUrl = process.env.APP_URL;
const frontendUrl = process.env.FRONTEND_URL;
const redirectUri = process.env.MP_REDIRECT_URI ?? (appUrl ? `${appUrl}/api/mercadopago/callback` : undefined);
const tokensEncryptionKey = process.env.TOKENS_ENCRYPTION_KEY;
const webhookSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;

if (!clientId || !clientSecret || !redirectUri) {
  console.warn('Mercado Pago OAuth não totalmente configurado (MP_CLIENT_ID, MP_CLIENT_SECRET, MP_REDIRECT_URI).');
}

type OAuthTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id?: number;
};

type MercadoPagoUserResponse = {
  id: number;
  nickname?: string;
  email?: string;
};

function getEncryptionKeyBuffer() {
  if (!tokensEncryptionKey) return null;
  const key = Buffer.from(tokensEncryptionKey, 'base64');
  if (key.length !== 32) return null;
  return key;
}

export function encryptToken(plainText: string) {
  const key = getEncryptionKeyBuffer();
  if (!key) return plainText;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${Buffer.concat([iv, tag, encrypted]).toString('base64')}`;
}

export function decryptToken(cipherText: string) {
  if (!cipherText.startsWith('enc:')) return cipherText;

  const key = getEncryptionKeyBuffer();
  if (!key) {
    throw new Error('TOKENS_ENCRYPTION_KEY ausente para descriptografar token.');
  }

  const payload = Buffer.from(cipherText.replace('enc:', ''), 'base64');
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function assertConfig() {
  if (!clientId || !clientSecret || !redirectUri || !frontendUrl) {
    throw new Error('Mercado Pago OAuth não configurado corretamente.');
  }
}

export function buildOAuthAuthorizationUrl(state: string) {
  assertConfig();
  const params = new URLSearchParams({
    client_id: clientId!,
    response_type: 'code',
    redirect_uri: redirectUri!,
    state,
  });

  return `${mpAuthBaseUrl}/authorization?${params.toString()}`;
}

async function postOAuthToken(payload: Record<string, string>) {
  assertConfig();
  const response = await fetch(`${mpApiBaseUrl}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      ...payload,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Falha OAuth Mercado Pago: ${response.status} ${errorBody}`);
  }

  return response.json() as Promise<OAuthTokenResponse>;
}

export async function exchangeAuthorizationCodeForTokens(code: string) {
  return postOAuthToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri!,
  });
}

export async function refreshMercadoPagoTokens(refreshToken: string) {
  return postOAuthToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
}

export async function getValidFreelancerAccessToken(userId: number) {
  const account = await storage.getMercadoPagoAccountByUserId(userId);
  if (!account) {
    throw new Error('Conta Mercado Pago não conectada para este usuário.');
  }

  if (account.authMethod === 'api_key') {
    return decryptToken(account.accessToken);
  }

  const now = Date.now();
  const expiresAt = account.expiresAt.getTime();
  const needsRefresh = expiresAt - now < 5 * 60 * 1000;

  if (!needsRefresh) {
    return decryptToken(account.accessToken);
  }

  const refreshed = await refreshMercadoPagoTokens(decryptToken(account.refreshToken));
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);

  await storage.upsertMercadoPagoAccount({
    userId,
    mpUserId: refreshed.user_id ? String(refreshed.user_id) : account.mpUserId,
    accessToken: encryptToken(refreshed.access_token),
    refreshToken: encryptToken(refreshed.refresh_token),
    expiresAt: newExpiresAt,
  });

  return refreshed.access_token;
}

export async function verifyMercadoPagoApiKey(accessToken: string) {
  const response = await fetch(`${mpApiBaseUrl}/users/me`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Chave API Mercado Pago inválida: ${response.status} ${errorBody}`);
  }

  return response.json() as Promise<MercadoPagoUserResponse>;
}

export async function createCheckoutPreferenceWithFreelancerToken(input: {
  freelancerAccessToken: string;
  proposalId: number;
  title: string;
  amountCents: number;
  currency: 'BRL';
  notificationUrl: string;
  frontendPublicPath: string;
}) {
  const unitPrice = Number((input.amountCents / 100).toFixed(2));

  const response = await fetch(`${mpApiBaseUrl}/checkout/preferences`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.freelancerAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      items: [
        {
          title: input.title,
          quantity: 1,
          unit_price: unitPrice,
          currency_id: input.currency,
        },
      ],
      external_reference: `fechou:${input.proposalId}`,
      notification_url: input.notificationUrl,
      back_urls: {
        success: `${frontendUrl}${input.frontendPublicPath}?status=success`,
        failure: `${frontendUrl}${input.frontendPublicPath}?status=failure`,
        pending: `${frontendUrl}${input.frontendPublicPath}?status=pending`,
      },
      auto_return: 'approved',
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Falha ao criar preferência MP: ${response.status} ${errorBody}`);
  }

  return response.json() as Promise<{
    id: string;
    init_point: string;
    sandbox_init_point?: string;
    external_reference?: string;
  }>;
}

export async function fetchPaymentById(input: { accessToken: string; paymentId: string }) {
  const response = await fetch(`${mpApiBaseUrl}/v1/payments/${input.paymentId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Falha ao consultar pagamento MP: ${response.status} ${errorBody}`);
  }

  return response.json() as Promise<{
    id: number;
    status: string;
    transaction_amount: number;
    external_reference: string | null;
    order?: { id?: string | null };
  }>;
}

// Compatibilidade com chamadas antigas em payments.routes.ts
export async function createMercadoPagoPreference(input: {
  externalReference: string;
  payerEmail?: string;
  notificationUrl: string;
  successUrl: string;
  failureUrl: string;
  pendingUrl: string;
  idempotencyKey?: string;
  item: {
    id: string;
    title: string;
    description: string;
    quantity: number;
    currency_id: 'BRL';
    unit_price: number;
  };
}) {
  const accessToken = process.env.MP_PLATFORM_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('MP_PLATFORM_ACCESS_TOKEN não definido para checkout público legado.');
  }

  const response = await fetch(`${mpApiBaseUrl}/checkout/preferences`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(input.idempotencyKey ? { 'X-Idempotency-Key': input.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      external_reference: input.externalReference,
      payer: input.payerEmail ? { email: input.payerEmail } : undefined,
      notification_url: input.notificationUrl,
      back_urls: {
        success: input.successUrl,
        failure: input.failureUrl,
        pending: input.pendingUrl,
      },
      binary_mode: true,
      items: [input.item],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Falha ao criar preferência MP (legado): ${response.status} ${errorBody}`);
  }

  return response.json() as Promise<{
    id: string;
    init_point: string;
    sandbox_init_point?: string;
  }>;
}

export async function fetchMercadoPagoPayment(paymentId: string) {
  const accessToken = process.env.MP_PLATFORM_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('MP_PLATFORM_ACCESS_TOKEN não definido para webhook legado.');
  }

  const payment = await fetchPaymentById({ accessToken, paymentId });
  return {
    id: payment.id,
    status: payment.status,
    external_reference: payment.external_reference,
  };
}

export function verifyMercadoPagoWebhookSignature(input: {
  xSignature?: string;
  xRequestId?: string;
  dataId?: string;
}) {
  if (!webhookSecret) return true;
  if (!input.xSignature || !input.xRequestId || !input.dataId) return false;

  const chunks = input.xSignature.split(',').reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.trim().split('=');
    if (k && v) acc[k] = v;
    return acc;
  }, {});

  const ts = chunks.ts;
  const providedV1 = chunks.v1;
  if (!ts || !providedV1) return false;

  const manifest = `id:${input.dataId};request-id:${input.xRequestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', webhookSecret).update(manifest).digest('hex');

  const providedBuffer = Buffer.from(providedV1, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (providedBuffer.length !== expectedBuffer.length) return false;

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}
