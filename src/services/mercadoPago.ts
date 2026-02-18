import crypto from "crypto";

const baseUrl = process.env.MERCADO_PAGO_API_URL ?? "https://api.mercadopago.com";
const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
const webhookSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
const statementDescriptor = process.env.MERCADO_PAGO_STATEMENT_DESCRIPTOR ?? "FECHOU";

if (!accessToken) {
  console.warn("MERCADO_PAGO_ACCESS_TOKEN não definido. Endpoints Mercado Pago ficarão indisponíveis.");
}

export type PreferenceItem = {
  id: string;
  title: string;
  description?: string;
  quantity: number;          // deve ser inteiro >= 1
  currency_id?: string;      // default BRL
  unit_price: number;        // em REAIS, > 0, com até 2 casas
};

function getHeaders(idempotencyKey?: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
  };
}

/** Converte "9,90" -> 9.9 e garante number finito com 2 casas */
function toMoneyNumber(v: unknown): number {
  const n =
    typeof v === "string"
      ? Number(v.trim().replace(/\./g, "").replace(",", "."))
      : Number(v);

  if (!Number.isFinite(n)) throw new Error(`unit_price inválido (NaN/Infinity): ${String(v)}`);

  // arredonda pra 2 casas
  return Math.round(n * 100) / 100;
}

function toIntQty(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`quantity inválido (NaN/Infinity): ${String(v)}`);
  const i = Math.trunc(n);
  if (i < 1) throw new Error(`quantity inválido (<1): ${String(v)}`);
  return i;
}

function normalizeItem(input: PreferenceItem): Required<PreferenceItem> {
  const quantity = toIntQty(input.quantity);
  const unit_price = toMoneyNumber(input.unit_price);

  if (unit_price <= 0) throw new Error(`unit_price inválido (<=0): ${unit_price}`);

  const currency_id = (input.currency_id ?? "BRL").toUpperCase();
  if (currency_id !== "BRL") throw new Error(`currency_id inválido: ${currency_id} (use "BRL")`);

  const title = String(input.title ?? "").trim();
  if (!title) throw new Error("title do item é obrigatório");

  const id = String(input.id ?? "").trim();
  if (!id) throw new Error("id do item é obrigatório");

  const description = String(input.description ?? "").trim();

  return { id, title, description, quantity, currency_id, unit_price };
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
  if (!accessToken) throw new Error("Mercado Pago não configurado");

  const item = normalizeItem(input.item);

  const payload = {
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
    items: [item],
  };

  // Debug útil: confirma que total > 0 e que não existe null em unit_price
  console.log("MP preference payload:", {
    external_reference: payload.external_reference,
    item: payload.items[0],
    total: payload.items[0].quantity * payload.items[0].unit_price,
  });

  const response = await fetch(`${baseUrl}/checkout/preferences`, {
    method: "POST",
    headers: getHeaders(input.idempotencyKey),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    // log mais rico (sem vazar token)
    console.error("MP preference failed:", {
      status: response.status,
      body: errorBody,
      sentItem: item,
    });
    throw new Error(`Mercado Pago preference failed: ${response.status} ${errorBody}`);
  }

  return response.json() as Promise<{
    id: string;
    init_point: string;
    sandbox_init_point?: string;
  }>;
}

export async function fetchMercadoPagoPayment(paymentId: string) {
  if (!accessToken) throw new Error("Mercado Pago não configurado");

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
