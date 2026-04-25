import crypto from "node:crypto";

const DEFAULT_WEBHOOK_MAX_SKEW_MS = Number(
  process.env.MERCADO_PAGO_WEBHOOK_MAX_SKEW_MS ?? 5 * 60 * 1000,
);

export type MercadoPagoSignatureParts = {
  ts: string;
  v1: string;
};

export type MercadoPagoWebhookVerificationResult = {
  valid: boolean;
  reason:
    | "missing_secret"
    | "missing_required_headers"
    | "missing_required_values"
    | "invalid_signature_format"
    | "invalid_hex"
    | "stale"
    | "signature_mismatch"
    | null;
  ts: string | null;
  providedV1: string | null;
  expectedV1: string | null;
  manifest: string | null;
  dataId: string | null;
  maxSkewMs: number;
};

function isSafeIdempotencyKey(value: string) {
  return /^[A-Za-z0-9:_-]{16,120}$/.test(value);
}

export function getMercadoPagoWebhookSecret() {
  const secret = String(
    process.env.MERCADO_PAGO_WEBHOOK_SECRET ??
      process.env.MP_WEBHOOK_SECRET ??
      "",
  ).trim();

  return secret || null;
}

export function parseMercadoPagoSignatureHeader(
  xSignature: string | undefined | null,
): MercadoPagoSignatureParts | null {
  const header = String(xSignature ?? "").trim();
  if (!header) return null;

  const parts = header.split(",").reduce<Record<string, string>>((acc, item) => {
    const [rawKey, rawValue] = item.trim().split("=", 2);
    const key = String(rawKey ?? "").trim().toLowerCase();
    const value = String(rawValue ?? "").trim().toLowerCase();
    if (key && value) {
      acc[key] = value;
    }
    return acc;
  }, {});

  if (!parts.ts || !parts.v1) return null;
  return {
    ts: parts.ts,
    v1: parts.v1,
  };
}

export function normalizeMercadoPagoDataId(dataId: string | undefined | null) {
  const normalized = String(dataId ?? "").trim().toLowerCase();
  return normalized || null;
}

export function buildMercadoPagoWebhookManifest(input: {
  dataId: string;
  xRequestId: string;
  ts: string;
}) {
  return `id:${input.dataId};request-id:${input.xRequestId};ts:${input.ts};`;
}

export function timingSafeEqualHex(leftHex: string, rightHex: string) {
  if (!/^[a-f0-9]+$/i.test(leftHex) || !/^[a-f0-9]+$/i.test(rightHex)) {
    return false;
  }

  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function verifyMercadoPagoWebhookSignatureDetailed(input: {
  xSignature?: string | null;
  xRequestId?: string | null;
  dataId?: string | null;
  nowMs?: number;
  maxSkewMs?: number;
}): MercadoPagoWebhookVerificationResult {
  const secret = getMercadoPagoWebhookSecret();
  if (!secret) {
    return {
      valid: false,
      reason: "missing_secret",
      ts: null,
      providedV1: null,
      expectedV1: null,
      manifest: null,
      dataId: null,
      maxSkewMs: Number(input.maxSkewMs ?? DEFAULT_WEBHOOK_MAX_SKEW_MS),
    };
  }

  const xRequestId = String(input.xRequestId ?? "").trim();
  const dataId = normalizeMercadoPagoDataId(input.dataId);
  if (!String(input.xSignature ?? "").trim() || !xRequestId) {
    return {
      valid: false,
      reason: "missing_required_headers",
      ts: null,
      providedV1: null,
      expectedV1: null,
      manifest: null,
      dataId,
      maxSkewMs: Number(input.maxSkewMs ?? DEFAULT_WEBHOOK_MAX_SKEW_MS),
    };
  }

  if (!dataId) {
    return {
      valid: false,
      reason: "missing_required_values",
      ts: null,
      providedV1: null,
      expectedV1: null,
      manifest: null,
      dataId: null,
      maxSkewMs: Number(input.maxSkewMs ?? DEFAULT_WEBHOOK_MAX_SKEW_MS),
    };
  }

  const parsed = parseMercadoPagoSignatureHeader(input.xSignature);
  if (!parsed) {
    return {
      valid: false,
      reason: "invalid_signature_format",
      ts: null,
      providedV1: null,
      expectedV1: null,
      manifest: null,
      dataId,
      maxSkewMs: Number(input.maxSkewMs ?? DEFAULT_WEBHOOK_MAX_SKEW_MS),
    };
  }

  if (!/^[a-f0-9]{64}$/i.test(parsed.v1)) {
    return {
      valid: false,
      reason: "invalid_hex",
      ts: parsed.ts,
      providedV1: parsed.v1,
      expectedV1: null,
      manifest: null,
      dataId,
      maxSkewMs: Number(input.maxSkewMs ?? DEFAULT_WEBHOOK_MAX_SKEW_MS),
    };
  }

  const nowMs = Number(input.nowMs ?? Date.now());
  const maxSkewMs = Number(input.maxSkewMs ?? DEFAULT_WEBHOOK_MAX_SKEW_MS);
  const timestampMs = Number(parsed.ts);

  if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > maxSkewMs) {
    return {
      valid: false,
      reason: "stale",
      ts: parsed.ts,
      providedV1: parsed.v1,
      expectedV1: null,
      manifest: null,
      dataId,
      maxSkewMs,
    };
  }

  const manifest = buildMercadoPagoWebhookManifest({
    dataId,
    xRequestId,
    ts: parsed.ts,
  });
  const expectedV1 = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  const valid = timingSafeEqualHex(parsed.v1, expectedV1);

  return {
    valid,
    reason: valid ? null : "signature_mismatch",
    ts: parsed.ts,
    providedV1: parsed.v1,
    expectedV1,
    manifest,
    dataId,
    maxSkewMs,
  };
}

export function verifyMercadoPagoWebhookSignature(input: {
  xSignature?: string | null;
  xRequestId?: string | null;
  dataId?: string | null;
  nowMs?: number;
  maxSkewMs?: number;
}) {
  return verifyMercadoPagoWebhookSignatureDetailed(input).valid;
}

export function generateSecureIdempotencyKey() {
  return crypto.randomUUID();
}

export function normalizeOrGenerateIdempotencyKey(raw: string | undefined | null) {
  const value = String(raw ?? "").trim();
  if (isSafeIdempotencyKey(value)) {
    return value;
  }
  return generateSecureIdempotencyKey();
}

function stableSortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSortJson);
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableSortJson(nested)]);

    return Object.fromEntries(entries);
  }

  return value;
}

export function hashIdempotencyRequestPayload(payload: unknown) {
  const stable = JSON.stringify(stableSortJson(payload));
  return crypto.createHash("sha256").update(stable).digest("hex");
}
