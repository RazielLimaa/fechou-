import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { authenticate, type AuthenticatedRequest } from "../middleware/auth.js";
import { storage } from "../storage.js";
import {
  createMercadoPagoPreference,
  fetchMercadoPagoPayment,
  verifyMercadoPagoWebhookSignature,
} from "../services/mercadoPago.js";
import { mpSubscriptionService, type MpPlanId } from "../services/Mercadopago subscriptions.service.js";
import { requirePlan } from "../middleware/requirePlan.js";

const router = Router();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const subscriptionCheckoutSchema = z.object({
  planId:   z.enum(["pro", "premium"]),
  backUrl:  z.string().url().optional(),
});

const confirmSubscriptionSchema = z.object({
  preapprovalId: z.string().trim().min(4),
});

const publicMercadoPagoCheckoutSchema = z.object({
  successUrl: z.string().url(),
  failureUrl: z.string().url(),
  pendingUrl: z.string().url(),
  payerEmail: z.string().email().max(180).optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hashSha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function planFromPreapprovalStatus(status: string, planId: MpPlanId): MpPlanId | "free" {
  return mpSubscriptionService.isActiveStatus(status) ? planId : "free";
}

// ─── PAGAMENTO DE PROPOSTA (one-time via MP — mantido) ────────────────────────

router.post("/public/:token/checkout", async (req, res) => {
  const parsed = publicMercadoPagoCheckoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados inválidos.", errors: parsed.error.flatten() });
  }

  const token = String(req.params.token ?? "").trim();
  if (token.length < 32) return res.status(400).json({ message: "Token inválido." });

  const tokenHash = hashSha256(token);
  const proposal = await storage.getProposalByShareTokenHash(tokenHash);

  if (!proposal || !proposal.shareTokenExpiresAt || proposal.shareTokenExpiresAt.getTime() < Date.now()) {
    return res.status(404).json({ message: "Link de contrato inválido ou expirado." });
  }

  if (!proposal.contractSignedAt || !proposal.paymentReleasedAt) {
    return res.status(409).json({ message: "Pagamento bloqueado até assinatura do contrato." });
  }

  if (proposal.status === "vendida") {
    return res.status(409).json({ message: "Proposta já paga." });
  }

  const idempotencyKey = req.header("X-Idempotency-Key")?.trim() ?? crypto.randomUUID();

  const webhookUrl = process.env.MERCADO_PAGO_WEBHOOK_URL;
  if (!webhookUrl) return res.status(500).json({ message: "Webhook do Mercado Pago não configurado." });

  const preference = await createMercadoPagoPreference({
    externalReference: `proposal:${proposal.id}:owner:${proposal.userId}:token:${tokenHash.slice(0, 20)}`,
    payerEmail:   parsed.data.payerEmail,
    notificationUrl: webhookUrl,
    successUrl:   parsed.data.successUrl,
    failureUrl:   parsed.data.failureUrl,
    pendingUrl:   parsed.data.pendingUrl,
    idempotencyKey,
    item: {
      id:          String(proposal.id),
      title:       `Contrato #${proposal.id} - ${proposal.title}`,
      description: proposal.description.slice(0, 250),
      quantity:    1,
      currency_id: "BRL",
      unit_price:  Number(proposal.value),
    },
  });

  await storage.createPaymentSession({
    userId:    proposal.userId,
    proposalId: proposal.id,
    mode:      "payment",
    stripeSessionId:          `mp_pref_${preference.id}`,
    mercadoPagoPreferenceId:  preference.id,
    amount:    Number(proposal.value).toFixed(2),
    currency:  "brl",
    metadata:  { kind: "proposal_payment_mercado_pago", tokenHash: tokenHash.slice(0, 20) },
  });

  return res.status(201).json({ checkoutUrl: preference.init_point, preferenceId: preference.id });
});

// ─── ASSINATURA DE PLANO via MP Preapproval ───────────────────────────────────

/**
 * POST /api/payments/subscriptions/checkout
 * body: { planId: "pro" | "premium", backUrl?: string }
 *
 * Retorna { checkoutUrl } — redirecione o usuário para lá.
 * Após assinar, o MP redireciona para backUrl e manda webhook.
 */
router.post("/subscriptions/checkout", authenticate, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsed = subscriptionCheckoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados inválidos.", errors: parsed.error.flatten() });
  }

  const user = await storage.findUserById(userId);
  if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

  try {
    const result = await mpSubscriptionService.createSubscription({
      userId,
      userEmail: user.email,
      userName:  user.name,
      planId:    parsed.data.planId as MpPlanId,
      backUrl:   parsed.data.backUrl,
    });

    // Persiste a sessão para rastreamento
    await storage.createPaymentSession({
      userId,
      mode:           "subscription",
      stripeSessionId: `mp_sub_${userId}_${Date.now()}`,
      amount:         "0.00",
      currency:       "brl",
      metadata: {
        kind:             "mp_subscription_checkout",
        planId:           parsed.data.planId,
        externalReference: result.externalReference,
      },
    });

    return res.status(201).json({
      checkoutUrl:    result.initPoint,
      preapprovalId:  result.preapprovalId,
      planId:         result.planId,
    });
  } catch (err: any) {
    console.error("[subscriptions/checkout]", err?.message);
    return res.status(500).json({ message: err?.message ?? "Erro ao criar assinatura." });
  }
});

/**
 * POST /api/payments/subscriptions/confirm
 * body: { preapprovalId? } ou { externalReference? }
 *
 * O MP pode retornar o preapproval_id na URL de retorno (?preapproval_id=XXX).
 * Se não retornar, buscamos pelo externalReference gravado na sessão de pagamento.
 */
router.post("/subscriptions/confirm", authenticate, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const { preapprovalId, externalReference } = req.body ?? {};

  try {
    let preapproval: any = null;

    // Tenta pelo ID direto primeiro
    if (preapprovalId && String(preapprovalId).trim().length >= 4) {
      const cleanId = String(preapprovalId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
      try {
        preapproval = await mpSubscriptionService.getPreapproval(cleanId);
      } catch {
        // ID inválido — tenta pelo externalReference abaixo
      }
    }

    // Fallback: busca pelo externalReference
    if (!preapproval && externalReference) {
      const cleanRef = String(externalReference).replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 200);
      preapproval = await mpSubscriptionService.findPreapprovalByReference(cleanRef);
    }

    // Último recurso: busca pelo externalReference da última sessão do usuário
    if (!preapproval) {
      const sub = await storage.getActiveSubscriptionByUser(userId);
      if (sub) {
        try {
          preapproval = await mpSubscriptionService.getPreapproval(sub.stripeSubscriptionId);
        } catch { /* ignora */ }
      }
    }

    if (!preapproval) {
      return res.status(404).json({ message: "Assinatura não encontrada. Aguarde alguns instantes e tente novamente." });
    }

    // Extrai planId do externalReference
    const info = mpSubscriptionService.parsePlanFromExternalReference(preapproval.external_reference ?? "");
    if (info && info.userId !== userId) {
      return res.status(403).json({ message: "Assinatura não pertence a este usuário." });
    }

    const planId = info?.planId ?? "pro";
    const isActive = mpSubscriptionService.isActiveStatus(preapproval.status);

    await storage.upsertUserSubscription({
      userId,
      stripeSubscriptionId: preapproval.id,
      stripeCustomerId:     String(preapproval.payer_id ?? userId),
      stripePriceId:        planId,
      status:               preapproval.status,
      currentPeriodEnd:     preapproval.next_payment_date ? new Date(preapproval.next_payment_date) : null,
      cancelAtPeriodEnd:    false,
    });

    return res.json({
      ok:     true,
      planId: isActive ? planId : "free",
      status: preapproval.status,
    });
  } catch (err: any) {
    console.error("[subscriptions/confirm]", err?.message);
    return res.status(500).json({ message: err?.message ?? "Erro ao confirmar assinatura." });
  }
});

/**
 * POST /api/payments/subscriptions/cancel
 * Cancela a assinatura ativa do usuário.
 */
router.post("/subscriptions/cancel", authenticate, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  try {
    const sub = await storage.getActiveSubscriptionByUser(userId);
    if (!sub) return res.status(404).json({ message: "Nenhuma assinatura ativa encontrada." });

    await mpSubscriptionService.cancelSubscription(sub.stripeSubscriptionId); // coluna reutilizada p/ preapprovalId

    await storage.upsertUserSubscription({
      userId,
      stripeSubscriptionId: sub.stripeSubscriptionId,
      stripeCustomerId:     sub.stripeCustomerId,
      stripePriceId:        sub.stripePriceId,
      status:               "cancelled",
      currentPeriodEnd:     sub.currentPeriodEnd ?? null,
      cancelAtPeriodEnd:    true,
    });

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[subscriptions/cancel]", err?.message);
    return res.status(500).json({ message: err?.message ?? "Erro ao cancelar assinatura." });
  }
});

/**
 * GET /api/payments/me
 * Retorna o plano atual do usuário.
 */
router.get("/me", authenticate, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const [payments, subscription] = await Promise.all([
    storage.getRecentPaymentsByUser(userId),
    storage.getActiveSubscriptionByUser(userId),
  ]);

  // stripePriceId agora guarda "pro" | "premium" | priceId antigo
  const planId: MpPlanId | "free" = subscription && mpSubscriptionService.isActiveStatus(subscription.status)
    ? (subscription.stripePriceId === "premium" ? "premium" : "pro")
    : "free";

  return res.json({
    payments,
    subscription,
    plan: {
      planId,
      status:       subscription?.status ?? null,
      isSubscribed: planId !== "free",
    },
  });
});

// ─── WEBHOOK DO MERCADO PAGO ──────────────────────────────────────────────────

router.post("/webhook", async (req, res) => {
  const xSignature  = req.header("x-signature");
  const xRequestId  = req.header("x-request-id");
  const dataId =
    typeof req.query["data.id"] === "string" ? req.query["data.id"] :
    typeof req.query.id         === "string" ? req.query.id : undefined;

  // ── Valida assinatura ──────────────────────────────────────────────────────
  const isValid = mpSubscriptionService.validateWebhookSignature({
    xSignature,
    xRequestId,
    dataId,
  });

  if (!isValid) return res.status(401).json({ message: "Webhook inválido." });

  const topic = req.query.topic ?? req.query.type;

  try {
    // ── Webhook de ASSINATURA (preapproval) ───────────────────────────────────
    if (topic === "preapproval" && dataId) {
      const preapproval = await mpSubscriptionService.getPreapproval(dataId);
      const info = mpSubscriptionService.parsePlanFromExternalReference(preapproval.external_reference ?? "");

      if (info) {
        await storage.upsertUserSubscription({
          userId:               info.userId,
          stripeSubscriptionId: preapproval.id,
          stripeCustomerId:     String(preapproval.payer_id ?? info.userId),
          stripePriceId:        info.planId,
          status:               preapproval.status,
          currentPeriodEnd:     preapproval.next_payment_date
            ? new Date(preapproval.next_payment_date)
            : null,
          cancelAtPeriodEnd: preapproval.status === "cancelled",
        });
      }

      return res.status(200).json({ received: true, topic: "preapproval" });
    }

    // ── Webhook de PAGAMENTO (proposta one-time) ──────────────────────────────
    if ((topic === "payment" || topic === "merchant_order") && dataId) {
      const payment = await fetchMercadoPagoPayment(dataId);
      const externalReference = payment.external_reference ?? "";
      const match = externalReference.match(/^proposal:(\d+):owner:(\d+):token:([a-f0-9]{1,64})$/i);

      if (!match) return res.status(200).json({ received: true, ignored: true });

      const proposalId  = Number(match[1]);
      const ownerId     = Number(match[2]);
      const tokenPrefix = match[3];

      const proposal = await storage.getProposalById(ownerId, proposalId);
      if (!proposal || !proposal.shareTokenHash?.startsWith(tokenPrefix)) {
        return res.status(400).json({ message: "Referência de pagamento inválida." });
      }

      if (payment.status === "approved") {
        await storage.updateProposalStatus(ownerId, proposalId, "vendida");
      }

      const relatedSession = await storage.findLatestPendingPaymentSessionForProposal(proposalId, ownerId);
      if (relatedSession) {
        const paymentStatus =
          payment.status === "approved"  ? "paid"    :
          payment.status === "rejected"  ? "failed"  :
          payment.status === "cancelled" ? "failed"  : "pending";
        await storage.markMercadoPagoPayment(relatedSession.id, String(payment.id), paymentStatus);
      }

      return res.status(200).json({ received: true, topic: "payment" });
    }

    return res.status(200).json({ received: true, ignored: true });
  } catch (err: any) {
    console.error("[webhook]", err?.message);
    return res.status(500).json({ message: "Falha ao processar webhook." });
  }
});

export default router;