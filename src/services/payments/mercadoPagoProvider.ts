import { logPaymentEvent } from "./mercadoPagoObservability.js";

const MP_API_BASE_URL = process.env.MP_API_BASE_URL ?? "https://api.mercadopago.com";
const DEFAULT_TIMEOUT_MS = Number(process.env.MERCADO_PAGO_HTTP_TIMEOUT_MS ?? 8_000);
const DEFAULT_GET_RETRIES = Number(process.env.MERCADO_PAGO_GET_RETRIES ?? 2);

export type MercadoPagoCheckoutPreference = {
  id: string;
  init_point?: string | null;
  sandbox_init_point?: string | null;
  external_reference?: string | null;
};

export type MercadoPagoPaymentResource = {
  id: number;
  status: string;
  status_detail?: string | null;
  transaction_amount: number;
  currency_id?: string | null;
  external_reference: string | null;
  order?: { id?: string | number | null } | null;
};

export type MercadoPagoMerchantOrderResource = {
  id: number;
  status: string;
  external_reference: string | null;
  preference_id?: string | null;
  payments?: Array<{
    id?: number | null;
    status?: string | null;
    status_detail?: string | null;
    transaction_amount?: number | null;
    currency_id?: string | null;
  }>;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function buildHeaders(input: {
  accessToken: string;
  idempotencyKey?: string;
  requestId?: string;
}) {
  return {
    Authorization: `Bearer ${input.accessToken}`,
    "Content-Type": "application/json",
    ...(input.idempotencyKey ? { "X-Idempotency-Key": input.idempotencyKey } : {}),
    ...(input.requestId ? { "X-Request-Id": input.requestId } : {}),
  };
}

async function mercadoPagoFetchJson<T>(input: {
  path: string;
  method: "GET" | "POST";
  accessToken: string;
  body?: Record<string, unknown>;
  idempotencyKey?: string;
  requestId?: string;
  timeoutMs?: number;
  retries?: number;
}) {
  const timeoutMs = Number(input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const retries = input.method === "GET" ? Number(input.retries ?? DEFAULT_GET_RETRIES) : 0;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${MP_API_BASE_URL}${input.path}`, {
        method: input.method,
        headers: buildHeaders({
          accessToken: input.accessToken,
          idempotencyKey: input.idempotencyKey,
          requestId: input.requestId,
        }),
        body: input.body ? JSON.stringify(input.body) : undefined,
        redirect: "manual",
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        if (attempt < retries && isRetryableStatus(response.status)) {
          await sleep(200 * (attempt + 1));
          continue;
        }

        throw new Error(
          `Mercado Pago ${input.method} ${input.path} falhou com ${response.status}: ${errorBody}`,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < retries) {
        await sleep(200 * (attempt + 1));
        continue;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error(`Falha desconhecida ao chamar ${input.path} no Mercado Pago.`);
}

export function getMercadoPagoPlatformAccessToken() {
  const accessToken = String(
    process.env.MP_PLATFORM_ACCESS_TOKEN ?? process.env.MP_ACCESS_TOKEN ?? "",
  ).trim();

  if (!accessToken) {
    throw new Error("MP_PLATFORM_ACCESS_TOKEN ou MP_ACCESS_TOKEN não configurado.");
  }

  return accessToken;
}

export function isMercadoPagoTestAccessToken(accessToken: string) {
  return accessToken.trim().toUpperCase().startsWith("TEST-");
}

export function resolveMercadoPagoCheckoutUrl(
  preference: Pick<MercadoPagoCheckoutPreference, "init_point" | "sandbox_init_point">,
  accessToken?: string,
) {
  const token = String(
    accessToken ??
      process.env.MP_PLATFORM_ACCESS_TOKEN ??
      process.env.MP_ACCESS_TOKEN ??
      "",
  ).trim();

  if (token && isMercadoPagoTestAccessToken(token) && preference.sandbox_init_point) {
    return preference.sandbox_init_point;
  }

  return preference.init_point ?? preference.sandbox_init_point ?? null;
}

export async function createMercadoPagoCheckoutPreference(input: {
  accessToken: string;
  externalReference: string;
  payerEmail?: string;
  notificationUrl: string;
  successUrl: string;
  failureUrl: string;
  pendingUrl: string;
  title: string;
  description: string;
  amount: number;
  currencyId: "BRL";
  idempotencyKey: string;
  requestId?: string;
}) {
  return mercadoPagoFetchJson<MercadoPagoCheckoutPreference>({
    path: "/checkout/preferences",
    method: "POST",
    accessToken: input.accessToken,
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    body: {
      external_reference: input.externalReference,
      payer: input.payerEmail ? { email: input.payerEmail } : undefined,
      notification_url: input.notificationUrl,
      back_urls: {
        success: input.successUrl,
        failure: input.failureUrl,
        pending: input.pendingUrl,
      },
      binary_mode: true,
      items: [
        {
          id: input.externalReference,
          title: input.title,
          description: input.description,
          quantity: 1,
          currency_id: input.currencyId,
          unit_price: Number(input.amount.toFixed(2)),
        },
      ],
    },
  });
}

export async function fetchMercadoPagoPaymentById(input: {
  accessToken: string;
  paymentId: string;
  requestId?: string;
}) {
  return mercadoPagoFetchJson<MercadoPagoPaymentResource>({
    path: `/v1/payments/${encodeURIComponent(input.paymentId)}`,
    method: "GET",
    accessToken: input.accessToken,
    requestId: input.requestId,
  });
}

export async function fetchMercadoPagoMerchantOrderById(input: {
  accessToken: string;
  merchantOrderId: string;
  requestId?: string;
}) {
  return mercadoPagoFetchJson<MercadoPagoMerchantOrderResource>({
    path: `/merchant_orders/${encodeURIComponent(input.merchantOrderId)}`,
    method: "GET",
    accessToken: input.accessToken,
    requestId: input.requestId,
  });
}

export async function tryFetchMercadoPagoPaymentWithCandidates(input: {
  paymentId: string;
  accessTokens: string[];
  requestId?: string;
}) {
  let lastError: Error | null = null;

  for (const accessToken of input.accessTokens) {
    try {
      return await fetchMercadoPagoPaymentById({
        accessToken,
        paymentId: input.paymentId,
        requestId: input.requestId,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logPaymentEvent({
        level: "warn",
        event: "mercadopago.payment_lookup_failed",
        requestId: input.requestId ?? null,
        providerPaymentId: input.paymentId,
        metadata: {
          message: lastError.message,
        },
      });
    }
  }

  throw lastError ?? new Error(`Nao foi possivel consultar o pagamento ${input.paymentId}.`);
}
