import { Router } from 'express';
import { storage } from '../storage.js';
import { fetchPaymentById, getValidFreelancerAccessToken, verifyMercadoPagoWebhookSignature } from '../services/mercadoPago.js';
import { webhookRateLimiter } from '../middleware/security.js';
import { distributedRateLimit } from '../middleware/distributed-security.js';
import { markReplayToken } from '../services/securityStore.js';
import { logSecurityEvent } from '../services/securityEvents.js';

const router = Router();

router.use(webhookRateLimiter);
router.use(distributedRateLimit({
  scope: 'webhook-mercadopago',
  limit: Number(process.env.RATE_LIMIT_WEBHOOK_MAX ?? 120),
  windowMs: Number(process.env.RATE_LIMIT_WEBHOOK_WINDOW_MS ?? 60_000),
}));

router.post('/mercadopago', async (req, res) => {
  const topic = String(req.query.topic ?? req.body?.type ?? '').toLowerCase();
  const dataId = String(req.query['data.id'] ?? req.body?.data?.id ?? req.body?.id ?? '').trim();
  const requestId = String(req.header('x-request-id') ?? '');
  const signature = req.header('x-signature');

  const validSignature = verifyMercadoPagoWebhookSignature({
    xSignature: signature,
    xRequestId: requestId,
    dataId,
  });

  if (!validSignature) {
    return res.status(401).json({ message: 'Assinatura do webhook Mercado Pago inválida.' });
  }

  if (requestId) {
    const replay = await markReplayToken({
      scope: 'mp-webhook-request',
      token: requestId,
      ttlMs: 10 * 60 * 1000,
    });
    if (replay.replay) {
      logSecurityEvent({
        eventName: 'webhook_replay_blocked',
        severity: 'high',
        requestId: (req as any).requestId ?? requestId,
        ip: req.ip,
        route: req.originalUrl,
      });
      return res.status(200).json({ received: true, requestId, replay: true });
    }
  }

  if (!dataId || !(topic.includes('payment') || topic === '')) {
    return res.status(200).json({ received: true, ignored: true, requestId });
  }

  try {
    const paymentId = dataId;
    const proposalPayment = await storage.findPaymentByExternalPaymentId(paymentId);
    if (proposalPayment?.status === 'CONFIRMED') {
      return res.status(200).json({ received: true, requestId, alreadyConfirmed: true });
    }

    const pending = await storage.listPendingProposalPayments();

    for (const row of pending) {
      const proposal = await storage.getProposalByIdUnscoped(row.proposalId);
      if (!proposal) continue;

      const token = await getValidFreelancerAccessToken(proposal.userId);
      const payment = await fetchPaymentById({ accessToken: token, paymentId });
      const externalReference = payment.external_reference ?? '';
      const expectedRef = `fechou:${proposal.id}`;

      if (externalReference !== expectedRef) continue;

      if (row.status === 'CONFIRMED') {
        return res.status(200).json({ received: true, requestId, alreadyConfirmed: true });
      }

      const expectedAmount = Number(proposal.value) * 100;
      if (payment.status === 'approved' && Math.round(payment.transaction_amount * 100) === Math.round(expectedAmount)) {
        await storage.markProposalPaymentConfirmed({ proposalId: proposal.id, externalPaymentId: String(payment.id) });
        await storage.updateProposalLifecycleStatus(proposal.userId, proposal.id, 'PAID');
        await storage.updateProposalStatus(proposal.userId, proposal.id, 'vendida');
        return res.status(200).json({ received: true, requestId, confirmed: true });
      }

      await storage.upsertProposalPayment({
        proposalId: proposal.id,
        status: 'FAILED',
        externalPreferenceId: row.externalPreferenceId,
        externalPaymentId: String(payment.id),
        paymentUrl: row.paymentUrl,
        amountCents: row.amountCents,
      });

      return res.status(200).json({ received: true, requestId, confirmed: false });
    }

    return res.status(200).json({ received: true, requestId, ignored: true });
  } catch (error) {
    console.error(error);
    return res.status(200).json({ received: true, requestId, deferred: true });
  }
});

export default router;
