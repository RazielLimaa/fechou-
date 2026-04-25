import { and, asc, inArray, isNull, lt } from "drizzle-orm";
import { db } from "../../db/index.js";
import { webhookEvents } from "../../db/schema.js";
import { logPaymentEvent } from "./mercadoPagoObservability.js";
import { processMercadoPagoWebhookEvent } from "./mercadoPagoSecure.js";

const queuedEventIds = new Set<string>();
let workerInterval: NodeJS.Timeout | null = null;
let missingWebhookEventsTableWarned = false;

function getMaxWebhookProcessingAttempts() {
  const parsed = Number(process.env.MERCADO_PAGO_WEBHOOK_MAX_PROCESSING_ATTEMPTS ?? 5);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5;
}

function isMissingWebhookEventsTableError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("webhook_events") && (message.includes("does not exist") || message.includes("não existe"));
}

async function processOne(eventId: string) {
  if (queuedEventIds.has(eventId)) {
    return;
  }

  queuedEventIds.add(eventId);

  try {
    await processMercadoPagoWebhookEvent(eventId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logPaymentEvent({
      level: "error",
      event: "mercadopago.webhook.worker_failed",
      outcome: "failed",
      eventKey: eventId,
      metadata: {
        message,
      },
    });
  } finally {
    queuedEventIds.delete(eventId);
  }
}

async function sweepQueuedWebhookEvents() {
  try {
    const maxAttempts = getMaxWebhookProcessingAttempts();
    const backlog = await db
      .select({
        id: webhookEvents.id,
      })
      .from(webhookEvents)
      .where(
        and(
          isNull(webhookEvents.processedAt),
          inArray(webhookEvents.status, ["queued", "failed", "received"]),
          lt(webhookEvents.processingAttempts, maxAttempts),
        ),
      )
      .orderBy(asc(webhookEvents.createdAt))
      .limit(20);

    for (const row of backlog) {
      void processOne(row.id);
    }
  } catch (error) {
    if (isMissingWebhookEventsTableError(error)) {
      if (!missingWebhookEventsTableWarned) {
        missingWebhookEventsTableWarned = true;
        logPaymentEvent({
          level: "warn",
          event: "mercadopago.webhook.worker_degraded",
          outcome: "missing_webhook_events_table",
          metadata: {
            hint: "Execute drizzle/0008_secure_mercado_pago_payments.sql para habilitar a fila persistente.",
          },
        });
      }
      return;
    }

    logPaymentEvent({
      level: "error",
      event: "mercadopago.webhook.sweep_failed",
      outcome: "failed",
      metadata: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

export function scheduleMercadoPagoWebhookEventProcessing(eventId: string) {
  setImmediate(() => {
    void processOne(eventId);
  });
}

export function startMercadoPagoWebhookWorker() {
  if (workerInterval) return;

  workerInterval = setInterval(() => {
    void sweepQueuedWebhookEvents();
  }, Number(process.env.MERCADO_PAGO_WEBHOOK_SWEEP_MS ?? 5_000));

  workerInterval.unref?.();
  void sweepQueuedWebhookEvents();
}

export function stopMercadoPagoWebhookWorker() {
  if (!workerInterval) return;
  clearInterval(workerInterval);
  workerInterval = null;
}
