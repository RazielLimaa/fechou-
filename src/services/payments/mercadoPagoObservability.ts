type PaymentLogLevel = "info" | "warn" | "error";

type MetricBucket = {
  count: number;
  sumMs: number;
  maxMs: number;
};

const counters = new Map<string, number>();
const latencies = new Map<string, MetricBucket>();

function maskSensitiveValue(value: unknown): unknown {
  if (typeof value !== "string") return value;

  const normalized = value.trim();
  if (!normalized) return normalized;

  if (
    normalized.startsWith("APP_USR-") ||
    normalized.startsWith("TEST-") ||
    normalized.startsWith("enc:") ||
    normalized.length > 40
  ) {
    return `${normalized.slice(0, 6)}***${normalized.slice(-4)}`;
  }

  return value;
}

function redactMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactMetadata);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes("token") ||
          lowerKey.includes("secret") ||
          lowerKey.includes("signature") ||
          lowerKey.includes("cvv") ||
          lowerKey.includes("pan")
        ) {
          return [key, "[redacted]"];
        }

        return [key, redactMetadata(maskSensitiveValue(nested))];
      }),
    );
  }

  return maskSensitiveValue(value);
}

export function incrementPaymentMetric(name: string, value = 1) {
  counters.set(name, Number(counters.get(name) ?? 0) + value);
}

export function observePaymentLatency(name: string, durationMs: number) {
  const current = latencies.get(name) ?? { count: 0, sumMs: 0, maxMs: 0 };
  current.count += 1;
  current.sumMs += durationMs;
  current.maxMs = Math.max(current.maxMs, durationMs);
  latencies.set(name, current);
}

export function getPaymentSecurityMetricsSnapshot() {
  return {
    counters: Object.fromEntries(counters.entries()),
    latencies: Object.fromEntries(
      Array.from(latencies.entries()).map(([name, bucket]) => [
        name,
        {
          count: bucket.count,
          avgMs: bucket.count > 0 ? Number((bucket.sumMs / bucket.count).toFixed(2)) : 0,
          maxMs: Number(bucket.maxMs.toFixed(2)),
        },
      ]),
    ),
  };
}

export function logPaymentEvent(input: {
  level?: PaymentLogLevel;
  event: string;
  outcome?: string;
  requestId?: string | null;
  correlationId?: string | null;
  orderId?: number | string | null;
  checkoutIntentId?: string | null;
  providerPaymentId?: string | null;
  idempotencyKey?: string | null;
  eventKey?: string | null;
  userId?: number | null;
  tenantId?: number | null;
  latencyMs?: number | null;
  ip?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const payload = {
    ts: new Date().toISOString(),
    event: input.event,
    outcome: input.outcome ?? null,
    requestId: input.requestId ?? null,
    correlationId: input.correlationId ?? null,
    orderId: input.orderId ?? null,
    checkoutIntentId: input.checkoutIntentId ?? null,
    providerPaymentId: input.providerPaymentId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    eventKey: input.eventKey ?? null,
    userId: input.userId ?? null,
    tenantId: input.tenantId ?? null,
    latencyMs: input.latencyMs ?? null,
    ip: input.ip ?? null,
    metadata: redactMetadata(input.metadata ?? {}),
  };

  const line = JSON.stringify(payload);
  const level = input.level ?? "info";
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}
