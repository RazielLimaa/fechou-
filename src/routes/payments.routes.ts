import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import { storage } from '../storage.js';
import {
  centsToDecimal,
  decimalToCents,
  defaultCurrency,
  getMonthlyPlanPriceId,
  stripe,
  stripeWebhookSecret
} from '../services/stripe.js';

const router = Router();

const checkoutSchema = z.object({
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  clientEmail: z.string().email().max(180).optional()
});

const subscriptionCheckoutSchema = z.object({
  successUrl: z.string().url(),
  cancelUrl: z.string().url()
});

function getRequiredIdempotencyKey(headerValue: string | undefined) {
  if (!headerValue || headerValue.trim().length < 12) {
    return null;
  }

  return headerValue.trim();
}

router.post('/proposals/:id/checkout', authenticate, async (req: AuthenticatedRequest, res) => {
  const idempotencyKey = getRequiredIdempotencyKey(req.header('Idempotency-Key'));

  if (!idempotencyKey) {
    return res.status(400).json({ message: 'Header Idempotency-Key é obrigatório.' });
  }

  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const proposalId = Number(req.params.id);

  if (!Number.isInteger(proposalId) || proposalId <= 0) {
    return res.status(400).json({ message: 'ID da proposta inválido.' });
  }

  const parsedBody = checkoutSchema.safeParse(req.body);

  if (!parsedBody.success) {
    return res.status(400).json({ message: 'Dados inválidos.', errors: parsedBody.error.flatten() });
  }

  const proposal = await storage.getProposalById(userId, proposalId);

  if (!proposal) {
    return res.status(404).json({ message: 'Proposta não encontrada.' });
  }

  if (proposal.status === 'vendida') {
    return res.status(409).json({ message: 'Esta proposta já foi paga.' });
  }

  const proposalAmount = Number(proposal.value);
  const amountInCents = decimalToCents(proposalAmount);

  const checkoutSession = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
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
              description: proposal.description.slice(0, 300)
            }
          }
        }
      ],
      payment_intent_data: {
        metadata: {
          kind: 'proposal_payment',
          proposalId: String(proposal.id),
          userId: String(userId)
        }
      },
      metadata: {
        kind: 'proposal_payment',
        proposalId: String(proposal.id),
        userId: String(userId)
      },
      success_url: parsedBody.data.successUrl,
      cancel_url: parsedBody.data.cancelUrl
    },
    {
      idempotencyKey
    }
  );

  await storage.createPaymentSession({
    userId,
    proposalId,
    mode: 'payment',
    stripeSessionId: checkoutSession.id,
    stripePaymentIntentId:
      typeof checkoutSession.payment_intent === 'string' ? checkoutSession.payment_intent : undefined,
    amount: centsToDecimal(amountInCents),
    currency: defaultCurrency,
    metadata: {
      kind: 'proposal_payment'
    }
  });

  return res.status(201).json({
    checkoutUrl: checkoutSession.url,
    sessionId: checkoutSession.id
  });
});

router.post('/subscriptions/checkout', authenticate, async (req: AuthenticatedRequest, res) => {
  const idempotencyKey = getRequiredIdempotencyKey(req.header('Idempotency-Key'));

  if (!idempotencyKey) {
    return res.status(400).json({ message: 'Header Idempotency-Key é obrigatório.' });
  }

  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const parsedBody = subscriptionCheckoutSchema.safeParse(req.body);

  if (!parsedBody.success) {
    return res.status(400).json({ message: 'Dados inválidos.', errors: parsedBody.error.flatten() });
  }

  const user = await storage.findUserById(userId);

  if (!user) {
    return res.status(404).json({ message: 'Usuário não encontrado.' });
  }

  const stripeCustomerId = user.stripeCustomerId ?? (await stripe.customers.create({ email: user.email, name: user.name })).id;

  if (!user.stripeCustomerId) {
    await storage.setUserStripeCustomerId(user.id, stripeCustomerId);
  }

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [{ price: getMonthlyPlanPriceId(), quantity: 1 }],
      metadata: {
        kind: 'platform_subscription',
        userId: String(user.id)
      },
      success_url: parsedBody.data.successUrl,
      cancel_url: parsedBody.data.cancelUrl
    },
    {
      idempotencyKey
    }
  );

  await storage.createPaymentSession({
    userId,
    mode: 'subscription',
    stripeSessionId: session.id,
    stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : undefined,
    amount: '0.00',
    currency: defaultCurrency,
    metadata: {
      kind: 'platform_subscription_checkout'
    }
  });

  return res.status(201).json({ checkoutUrl: session.url, sessionId: session.id });
});

router.get('/me', authenticate, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const [payments, subscription] = await Promise.all([
    storage.getRecentPaymentsByUser(userId),
    storage.getActiveSubscriptionByUser(userId)
  ]);

  return res.json({ payments, subscription });
});

router.post('/webhook', async (req, res) => {
  if (!stripeWebhookSecret) {
    return res.status(500).json({ message: 'Webhook da Stripe não configurado.' });
  }

  const signature = req.header('stripe-signature');

  if (!signature) {
    return res.status(400).json({ message: 'Assinatura Stripe ausente.' });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, signature, stripeWebhookSecret);
  } catch {
    return res.status(400).json({ message: 'Webhook inválido.' });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const kind = session.metadata?.kind;

      await storage.markPaymentSessionStatus(session.id, 'paid');

      if (kind === 'proposal_payment') {
        const userId = Number(session.metadata?.userId ?? 0);
        const proposalId = Number(session.metadata?.proposalId ?? 0);

        if (userId > 0 && proposalId > 0) {
          await storage.updateProposalStatus(userId, proposalId, 'vendida');
        }
      }

      if (kind === 'platform_subscription') {
        const userId = Number(session.metadata?.userId ?? 0);
        const stripeSubscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : typeof session.subscription === 'object' && session.subscription
              ? session.subscription.id
              : null;

        if (userId > 0 && stripeSubscriptionId && typeof session.customer === 'string') {
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
              cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end)
            });
          }
        }
      }
    }

    if (event.type === 'checkout.session.expired') {
      const session = event.data.object;
      await storage.markPaymentSessionStatus(session.id, 'expired');
    }

    if (event.type === 'payment_intent.payment_failed') {
      const paymentIntent = event.data.object;

      const paymentSession = await storage.findPaymentSessionByPaymentIntentId(paymentIntent.id);

      if (paymentSession) {
        await storage.markPaymentSessionStatus(paymentSession.stripeSessionId, 'failed');
      }
    }

    if (
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted' ||
      event.type === 'customer.subscription.created'
    ) {
      const subscription = event.data.object;
      const userId = Number(subscription.metadata?.userId ?? 0);
      const priceId = subscription.items.data[0]?.price?.id;

      if (userId > 0 && priceId) {
        await storage.upsertUserSubscription({
          userId,
          stripeSubscriptionId: subscription.id,
          stripeCustomerId: String(subscription.customer),
          stripePriceId: priceId,
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
          cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end)
        });
      }
    }

    return res.status(200).json({ received: true, requestId: crypto.randomUUID() });
  } catch {
    return res.status(500).json({ message: 'Falha ao processar webhook Stripe.' });
  }
});

export default router;
