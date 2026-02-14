import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { authenticate, type AuthenticatedRequest } from "../middleware/auth.js";
import { storage } from "../storage.js";
import {
  centsToDecimal,
  decimalToCents,
  defaultCurrency,
  stripe,
  stripeWebhookSecret,
} from "../services/stripe.js";
import { requirePlan } from "../middleware/requirePlan.js";


const router = Router();

type PlanId = "free" | "pro" | "premium";

router.post(
  "/some-premium-feature",
  authenticate,
  requirePlan("premium"),
  async (req, res) => {
    // ...
  }
);

const checkoutSchema = z.object({
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  clientEmail: z.string().email().max(180).optional(),
});

const subscriptionCheckoutSchema = z.object({
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

function getRequiredIdempotencyKey(headerValue: string | undefined) {
  if (!headerValue || headerValue.trim().length < 12) return null;
  return headerValue.trim();
}

/**
 * ✅ STATUS "ativo" para liberar features
 * Recomendo: active + trialing (você pode ajustar)
 */
function isActiveSubscriptionStatus(status: string | null | undefined) {
  return status === "active" || status === "trialing";
}

/**
 * ✅ priceId -> planId (fonte de verdade)
 */
function planFromPriceId(priceId: string | null | undefined): PlanId {
  if (!priceId) return "free";

  const proPriceId = process.env.STRIPE_MONTHLY_PLAN_PRICE_ID;
  const premiumPriceId = process.env.STRIPE_MONTHLY_PLAN2_PRICE_ID;

  if (premiumPriceId && priceId === premiumPriceId) return "premium";
  if (proPriceId && priceId === proPriceId) return "pro";
  return "free";
}

/**
 * ✅ planId do frontend -> Stripe PRICE ID no .env
 * IMPORTANTE: deve ser price_... (não prod_...)
 */
function getSubscriptionPriceIdByPlanId(planId: string) {
  const proPriceId = process.env.STRIPE_MONTHLY_PLAN_PRICE_ID;
  const premiumPriceId = process.env.STRIPE_MONTHLY_PLAN2_PRICE_ID;

  const map: Record<string, string | undefined> = {
    pro: proPriceId,
    premium: premiumPriceId,
  };

  return map[planId];
}

// ✅ Tipos para TS não reclamar
type SubscriptionCheckoutOk = {
  ok: true;
  session: { id: string; url: string | null };
};

type SubscriptionCheckoutErr = {
  ok: false;
  status: number;
  body: any;
};

type SubscriptionCheckoutResult = SubscriptionCheckoutOk | SubscriptionCheckoutErr;

async function createSubscriptionCheckoutSession(args: {
  userId: number;
  planId: string;
  idempotencyKey: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<SubscriptionCheckoutResult> {
  const { userId, planId, idempotencyKey, successUrl, cancelUrl } = args;

  const priceId = getSubscriptionPriceIdByPlanId(planId);
  if (!priceId) {
    return {
      ok: false,
      status: 400,
      body: { message: "Plano inválido ou não configurado.", details: { planId } },
    };
  }

  const user = await storage.findUserById(userId);
  if (!user) {
    return { ok: false, status: 404, body: { message: "Usuário não encontrado." } };
  }

  // garante customer
  const stripeCustomerId =
    user.stripeCustomerId ??
    (await stripe.customers.create({ email: user.email, name: user.name })).id;

  if (!user.stripeCustomerId) {
    await storage.setUserStripeCustomerId(user.id, stripeCustomerId);
  }

  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],

      // metadata no subscription é útil nos events customer.subscription.*
      subscription_data: {
        metadata: {
          kind: "platform_subscription",
          userId: String(user.id),
          planId,
          priceId,
        },
      },

      metadata: {
        kind: "platform_subscription",
        userId: String(user.id),
        planId,
        priceId,
      },

      success_url: successUrl,
      cancel_url: cancelUrl,
    },
    { idempotencyKey }
  );

  await storage.createPaymentSession({
    userId,
    mode: "subscription",
    stripeSessionId: session.id,
    stripeSubscriptionId: typeof session.subscription === "string" ? session.subscription : undefined,
    amount: "0.00",
    currency: defaultCurrency,
    metadata: {
      kind: "platform_subscription_checkout",
      planId,
      priceId,
    },
  });

  return { ok: true, session: { id: session.id, url: session.url } };
}

/**
 * Pagamento de proposta (mode=payment)
 */
router.post("/proposals/:id/checkout", authenticate, async (req: AuthenticatedRequest, res) => {
  const idempotencyKey = getRequiredIdempotencyKey(req.header("Idempotency-Key"));
  if (!idempotencyKey) {
    return res.status(400).json({ message: "Header Idempotency-Key é obrigatório." });
  }

  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const proposalId = Number(req.params.id);
  if (!Number.isInteger(proposalId) || proposalId <= 0) {
    return res.status(400).json({ message: "ID da proposta inválido." });
  }

  const parsedBody = checkoutSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ message: "Dados inválidos.", errors: parsedBody.error.flatten() });
  }

  const proposal = await storage.getProposalById(userId, proposalId);
  if (!proposal) return res.status(404).json({ message: "Proposta não encontrada." });
  if (proposal.status === "vendida") return res.status(409).json({ message: "Esta proposta já foi paga." });

  const proposalAmount = Number(proposal.value);
  const amountInCents = decimalToCents(proposalAmount);

  const checkoutSession = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      currency: defaultCurrency,
      client_reference_id: `proposal:${proposal.id}:owner:${userId}`,
      customer_email: parsedBody.data.clientEmail,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: defaultCurrency,
            unit_amount: amountInCents,
            product_data: {
              name: `Proposta #${proposal.id} - ${proposal.title}`,
              description: proposal.description.slice(0, 300),
            },
          },
        },
      ],
      payment_intent_data: {
        metadata: {
          kind: "proposal_payment",
          proposalId: String(proposal.id),
          userId: String(userId),
        },
      },
      metadata: {
        kind: "proposal_payment",
        proposalId: String(proposal.id),
        userId: String(userId),
      },
      success_url: parsedBody.data.successUrl,
      cancel_url: parsedBody.data.cancelUrl,
    },
    { idempotencyKey }
  );

  await storage.createPaymentSession({
    userId,
    proposalId,
    mode: "payment",
    stripeSessionId: checkoutSession.id,
    stripePaymentIntentId:
      typeof checkoutSession.payment_intent === "string" ? checkoutSession.payment_intent : undefined,
    amount: centsToDecimal(amountInCents),
    currency: defaultCurrency,
    metadata: { kind: "proposal_payment" },
  });

  return res.status(201).json({
    checkoutUrl: checkoutSession.url,
    sessionId: checkoutSession.id,
  });
});

/**
 * ✅ assinatura por plano
 * POST /subscriptions/checkout/:planId  (planId = pro | premium)
 */
router.post("/subscriptions/checkout/:planId", authenticate, async (req: AuthenticatedRequest, res) => {
  const idempotencyKey = getRequiredIdempotencyKey(req.header("Idempotency-Key"));
  if (!idempotencyKey) {
    return res.status(400).json({ message: "Header Idempotency-Key é obrigatório." });
  }

  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedBody = subscriptionCheckoutSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ message: "Dados inválidos.", errors: parsedBody.error.flatten() });
  }

  const planId = String(req.params.planId || "").trim().toLowerCase();

  if (planId === "free") {
    return res.status(400).json({ message: "Plano free não possui checkout no Stripe." });
  }

  const result = await createSubscriptionCheckoutSession({
    userId,
    planId,
    idempotencyKey,
    successUrl: parsedBody.data.successUrl,
    cancelUrl: parsedBody.data.cancelUrl,
  });

  if (!result.ok) {
    return res.status(result.status).json(result.body);
  }

  return res.status(201).json({ checkoutUrl: result.session.url, sessionId: result.session.id });
});

/**
 * Compatibilidade:
 * POST /subscriptions/checkout  -> assume "pro"
 */
router.post("/subscriptions/checkout", authenticate, async (req: AuthenticatedRequest, res) => {
  const idempotencyKey = getRequiredIdempotencyKey(req.header("Idempotency-Key"));
  if (!idempotencyKey) {
    return res.status(400).json({ message: "Header Idempotency-Key é obrigatório." });
  }

  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedBody = subscriptionCheckoutSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ message: "Dados inválidos.", errors: parsedBody.error.flatten() });
  }

  const result = await createSubscriptionCheckoutSession({
    userId,
    planId: "pro",
    idempotencyKey,
    successUrl: parsedBody.data.successUrl,
    cancelUrl: parsedBody.data.cancelUrl,
  });

  if (!result.ok) {
    return res.status(result.status).json(result.body);
  }

  return res.status(201).json({ checkoutUrl: result.session.url, sessionId: result.session.id });
});

/**
 * ✅ retorna plano do usuário
 */
router.get("/me", authenticate, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const [payments, subscription] = await Promise.all([
    storage.getRecentPaymentsByUser(userId),
    storage.getActiveSubscriptionByUser(userId),
  ]);

  const priceId = subscription?.stripePriceId ?? null;
  const status = subscription?.status ?? null;

  const planId: PlanId = isActiveSubscriptionStatus(status) ? planFromPriceId(priceId) : "free";

  return res.json({
    payments,
    subscription,
    plan: {
      planId,
      status,
      priceId,
      isSubscribed: planId !== "free",
    },
  });
});

router.post("/webhook", async (req, res) => {
  if (!stripeWebhookSecret) {
    return res.status(500).json({ message: "Webhook da Stripe não configurado." });
  }

  const signature = req.header("stripe-signature");
  if (!signature) return res.status(400).json({ message: "Assinatura Stripe ausente." });

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, signature, stripeWebhookSecret);
  } catch {
    return res.status(400).json({ message: "Webhook inválido." });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as any;
      const kind = session.metadata?.kind;

      await storage.markPaymentSessionStatus(session.id, "paid");

      if (kind === "proposal_payment") {
        const userId = Number(session.metadata?.userId ?? 0);
        const proposalId = Number(session.metadata?.proposalId ?? 0);

        if (userId > 0 && proposalId > 0) {
          await storage.updateProposalStatus(userId, proposalId, "vendida");
        }
      }

      if (kind === "platform_subscription") {
        const userId = Number(session.metadata?.userId ?? 0);

        const stripeSubscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : typeof session.subscription === "object" && session.subscription
              ? session.subscription.id
              : null;

        if (userId > 0 && stripeSubscriptionId && typeof session.customer === "string") {
          const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
          const priceId = subscription.items.data[0]?.price?.id;

          if (priceId) {
            await storage.upsertUserSubscription({
              userId,
              stripeSubscriptionId,
              stripeCustomerId: session.customer,
              stripePriceId: priceId,
              status: subscription.status,
              currentPeriodEnd: new Date(subscription.current_period_end * 1000),
              cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
            });
          }
        }
      }
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object as any;
      await storage.markPaymentSessionStatus(session.id, "expired");
    }

    if (event.type === "payment_intent.payment_failed") {
      const paymentIntent = event.data.object as any;
      const paymentSession = await storage.findPaymentSessionByPaymentIntentId(paymentIntent.id);

      if (paymentSession) {
        await storage.markPaymentSessionStatus(paymentSession.stripeSessionId, "failed");
      }
    }

    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted" ||
      event.type === "customer.subscription.created"
    ) {
      const subscription = event.data.object as any;

      const userId = Number(subscription.metadata?.userId ?? 0);
      const priceId = subscription.items.data[0]?.price?.id;

      if (userId > 0 && priceId) {
        await storage.upsertUserSubscription({
          userId,
          stripeSubscriptionId: subscription.id,
          stripeCustomerId: String(subscription.customer),
          stripePriceId: priceId,
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000)
            : null,
          cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
        });
      }
    }

    return res.status(200).json({ received: true, requestId: crypto.randomUUID() });
  } catch {
    return res.status(500).json({ message: "Falha ao processar webhook Stripe." });
  }
});

export default router;
