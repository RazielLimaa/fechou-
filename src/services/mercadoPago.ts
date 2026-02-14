import crypto from "crypto";

const baseUrl = process.env.MERCADO_PAGO_API_URL ?? "https://api.mercadopago.com";
const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
const webhookSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
const statementDescriptor = process.env.MERCADO_PAGO_STATEMENT_DESCRIPTOR ?? "FECHOU";

if (!accessToken) {
  console.warn("MERCADO_PAGO_ACCESS_TOKEN não definido. Endpoints Mercado Pago ficarão indisponíveis.");
}

type PreferenceItem = {
  id: string;
  title: string;
  description: string;
  quantity: number;
  currency_id: string;
  unit_price: number;
};

function getHeaders(idempotencyKey?: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
  };
}

export async function createMercadoPagoPreference(input: {
  externalReference: string;
  payerEmail?: string;
  item: PreferenceItem;
  notificationUrl: string;
  successUrl: string;
  failureUrl: string;
  pendingUrl: string;
  idempotencyKey?: string;
}) {
  if (!accessToken) {
    throw new Error("Mercado Pago não configurado");
  }

  const response = await fetch(`${baseUrl}/checkout/preferences`, {
    method: "POST",
    headers: getHeaders(input.idempotencyKey),
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
      payment_methods: {
        installments: 12,
      },
      statement_descriptor: statementDescriptor.slice(0, 13),
      items: [input.item],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Mercado Pago preference failed: ${response.status} ${errorBody}`);
  }

  return response.json() as Promise<{
    id: string;
    init_point: string;
    sandbox_init_point?: string;
  }>;
}

export async function fetchMercadoPagoPayment(paymentId: string) {
  if (!accessToken) {
    throw new Error("Mercado Pago não configurado");
  }

  const response = await fetch(`${baseUrl}/v1/payments/${paymentId}`, {
    method: "GET",
    headers: getHeaders(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Mercado Pago payment fetch failed: ${response.status} ${errorBody}`);
  }

  return response.json() as Promise<{
    id: number;
    status: string;
    external_reference: string | null;
  }>;
}

export function verifyMercadoPagoWebhookSignature(input: {
  xSignature?: string;
  xRequestId?: string;
  dataId?: string;
}) {
  if (!webhookSecret) return false;
  if (!input.xSignature || !input.xRequestId || !input.dataId) return false;

  const chunks = input.xSignature.split(",").reduce<Record<string, string>>((acc, part) => {
    const [key, value] = part.trim().split("=");
    if (key && value) acc[key] = value;
    return acc;
  }, {});

  const ts = chunks.ts;
  const providedHash = chunks.v1;

  if (!ts || !providedHash) return false;

  const manifest = `id:${input.dataId};request-id:${input.xRequestId};ts:${ts};`;
  const expected = crypto.createHmac("sha256", webhookSecret).update(manifest).digest("hex");

  const providedBuffer = Buffer.from(providedHash, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}
