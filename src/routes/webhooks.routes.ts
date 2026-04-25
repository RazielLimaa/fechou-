import { Router } from "express";
import { webhookRateLimiter } from "../middleware/security.js";
import { distributedRateLimit } from "../middleware/distributed-security.js";
import { scheduleMercadoPagoWebhookEventProcessing } from "../services/payments/mercadoPagoWebhookQueue.js";
import { persistMercadoPagoWebhookEvent } from "../services/payments/mercadoPagoSecure.js";
import { verifyMercadoPagoWebhookSignatureDetailed } from "../services/payments/mercadoPagoSecurity.js";
import {
  incrementPaymentMetric,
  logPaymentEvent,
  observePaymentLatency,
} from "../services/payments/mercadoPagoObservability.js";

const router = Router();

router.use(webhookRateLimiter);
router.use(
  distributedRateLimit({
    scope: "webhook-mercadopago",
    limit: Number(process.env.RATE_LIMIT_WEBHOOK_MAX ?? 120),
    windowMs: Number(process.env.RATE_LIMIT_WEBHOOK_WINDOW_MS ?? 60_000),
  }),
);

router.post("/mercadopago", async (req, res) => {
  const startedAt = performance.now();
  const contentType = String(req.header("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return res.status(415).json({ message: "Webhook deve usar Content-Type application/json." });
  }

  let payloadJson: Record<string, unknown> = {};
  try {
    if (Buffer.isBuffer(req.body)) {
      const raw = req.body.toString("utf8").trim();
      payloadJson = raw ? JSON.parse(raw) : {};
    } else if (req.body && typeof req.body === "object") {
      payloadJson = req.body as Record<string, unknown>;
    }
  } catch {
    return res.status(400).json({ message: "Payload JSON invalido." });
  }

  const topic = String(req.query.topic ?? payloadJson.type ?? "").trim().toLowerCase();
  const dataId = String(
    req.query["data.id"] ??
      (payloadJson.data as Record<string, unknown> | undefined)?.id ??
      payloadJson.id ??
      "",
  ).trim();
  const requestId = String(req.header("x-request-id") ?? "").trim();

  const verification = verifyMercadoPagoWebhookSignatureDetailed({
    xSignature: req.header("x-signature"),
    xRequestId: requestId,
    dataId,
  });

  if (!verification.valid) {
    incrementPaymentMetric("mercadopago.webhook.signature_invalid");
    return res.status(401).json({
      message: verification.reason === "stale" ? "Webhook expirado." : "Assinatura do webhook Mercado Pago invalida.",
      code: verification.reason,
    });
  }

  if (!verification.dataId || !(topic.includes("payment") || topic === "merchant_order")) {
    observePaymentLatency("mercadopago.legacy_webhook_ack_ms", performance.now() - startedAt);
    return res.status(200).json({ received: true, ignored: true, requestId });
  }

  try {
    const persisted = await persistMercadoPagoWebhookEvent({
      topic: topic || "payment",
      action: String(payloadJson.action ?? "").trim().toLowerCase() || null,
      dataId: verification.dataId,
      requestId: requestId || null,
      ts: verification.ts ?? String(Date.now()),
      signatureValid: true,
      payloadJson,
      headersJson: {
        requestId,
        xSignature: req.header("x-signature") ?? null,
        route: req.originalUrl,
      },
    });

    if (persisted.created && persisted.event) {
      scheduleMercadoPagoWebhookEventProcessing(persisted.event.id);
    }

    observePaymentLatency("mercadopago.legacy_webhook_ack_ms", performance.now() - startedAt);
    logPaymentEvent({
      event: "mercadopago.legacy_webhook.ack",
      outcome: persisted.created ? "queued" : "duplicate",
      requestId: requestId || String((req as any).requestId ?? ""),
      eventKey: persisted.event?.eventKey ?? null,
      latencyMs: performance.now() - startedAt,
      ip: req.ip,
      metadata: {
        topic,
        dataId: verification.dataId,
      },
    });

    return res.status(persisted.created ? 201 : 200).json({
      received: true,
      queued: persisted.created,
      requestId,
      eventKey: persisted.event?.eventKey ?? null,
    });
  } catch (error) {
    logPaymentEvent({
      level: "error",
      event: "mercadopago.legacy_webhook.ack_failed",
      outcome: "failed",
      requestId: requestId || String((req as any).requestId ?? ""),
      ip: req.ip,
      metadata: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return res.status(500).json({ message: "Falha ao receber webhook." });
  }
});

export default router;
