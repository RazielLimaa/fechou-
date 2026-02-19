import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { authenticateOrMvp, type AuthenticatedRequest } from '../middleware/auth.js';
import { storage, type ProposalStatus } from '../storage.js';
import { createCheckoutPreferenceWithFreelancerToken, getValidFreelancerAccessToken } from '../services/mercadoPago.js';

const router = Router();

const createProposalSchema = z.object({
  title: z.string().trim().min(2).max(180),
  clientName: z.string().trim().min(2).max(140),
  description: z.string().trim().min(5).max(5000),
  value: z.coerce.number().positive().max(9999999999.99)
});

const statusSchema = z.object({
  status: z.enum(['pendente', 'vendida', 'cancelada'])
});

const proposalIdSchema = z.coerce.number().int().positive();
const querySchema = z.object({
  status: z.enum(['pendente', 'vendida', 'cancelada']).optional()
});

const shareLinkSchema = z.object({
  expiresInHours: z.coerce.number().int().min(1).max(24 * 30).default(72)
});

const signContractSchema = z.object({
  signerName: z.string().trim().min(2).max(140),
  signerDocument: z.string().trim().min(5).max(40)
});

function hashSha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

router.get('/public/:token', async (req, res) => {
  const token = String(req.params.token ?? '').trim();

  if (token.length < 32) {
    return res.status(400).json({ message: 'Token inválido.' });
  }

  const tokenHash = hashSha256(token);
  const proposal = await storage.getProposalByShareTokenHash(tokenHash);

  if (!proposal || !proposal.shareTokenExpiresAt || proposal.shareTokenExpiresAt.getTime() < Date.now()) {
    return res.status(404).json({ message: 'Link de contrato inválido ou expirado.' });
  }

  return res.json({
    id: proposal.id,
    title: proposal.title,
    clientName: proposal.clientName,
    description: proposal.description,
    value: proposal.value,
    status: proposal.status,
    contract: {
      signed: Boolean(proposal.contractSignedAt),
      signedAt: proposal.contractSignedAt,
      signerName: proposal.contractSignerName,
      canPay: Boolean(proposal.paymentReleasedAt)
    }
  });
});

router.post('/public/:token/sign', async (req, res) => {
  const token = String(req.params.token ?? '').trim();
  const parsed = signContractSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Dados inválidos.', errors: parsed.error.flatten() });
  }

  if (token.length < 32) {
    return res.status(400).json({ message: 'Token inválido.' });
  }

  const tokenHash = hashSha256(token);
  const proposal = await storage.getProposalByShareTokenHash(tokenHash);

  if (!proposal || !proposal.shareTokenExpiresAt || proposal.shareTokenExpiresAt.getTime() < Date.now()) {
    return res.status(404).json({ message: 'Link de contrato inválido ou expirado.' });
  }

  if (proposal.contractSignedAt) {
    return res.status(409).json({ message: 'Contrato já foi assinado.' });
  }

  const userAgent = String(req.headers['user-agent'] ?? 'unknown');
  const signatureHash = hashSha256(
    `${proposal.id}|${parsed.data.signerName}|${parsed.data.signerDocument}|${req.ip}|${userAgent}`
  );

  const signed = await storage.markProposalContractSignedByToken(
    tokenHash,
    parsed.data.signerName,
    signatureHash
  );

  return res.status(201).json({
    ok: true,
    proposalId: signed?.id,
    signedAt: signed?.contractSignedAt
  });
});

router.use(authenticateOrMvp);

router.post('/:id/share-link', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Não autenticado.' });

  const parsedId = proposalIdSchema.safeParse(req.params.id);
  if (!parsedId.success) {
    return res.status(400).json({ message: 'ID inválido.' });
  }

  const parsedBody = shareLinkSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({ message: 'Dados inválidos.', errors: parsedBody.error.flatten() });
  }

  const proposal = await storage.getProposalById(userId, parsedId.data);
  if (!proposal) {
    return res.status(404).json({ message: 'Proposta não encontrada.' });
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSha256(rawToken);
  const expiresAt = new Date(Date.now() + parsedBody.data.expiresInHours * 60 * 60 * 1000);

  await storage.setProposalShareToken(userId, parsedId.data, tokenHash, expiresAt);

  return res.status(201).json({
    shareToken: rawToken,
    expiresAt,
    path: `/api/proposals/public/${rawToken}`
  });
});

router.post('/', async (req: AuthenticatedRequest, res) => {
  const parsed = createProposalSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Dados inválidos.', errors: parsed.error.flatten() });
  }

  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const proposal = await storage.createProposal({
    userId,
    title: parsed.data.title,
    clientName: parsed.data.clientName,
    description: parsed.data.description,
    value: parsed.data.value.toFixed(2)
  });

  return res.status(201).json(proposal);
});

router.get('/', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const parsedQuery = querySchema.safeParse(req.query);

  if (!parsedQuery.success) {
    return res.status(400).json({ message: 'Filtro inválido.' });
  }

  const status = parsedQuery.data.status as ProposalStatus | undefined;
  const data = await storage.listProposals(userId, status);
  return res.json(data);
});

router.get('/:id', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const parsedId = proposalIdSchema.safeParse(req.params.id);

  if (!parsedId.success) {
    return res.status(400).json({ message: 'ID inválido.' });
  }

  const proposal = await storage.getProposalById(userId, parsedId.data);

  if (!proposal) {
    return res.status(404).json({ message: 'Proposta não encontrada.' });
  }

  return res.json(proposal);
});


router.post('/:id/payment-link', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Não autenticado.' });

  const parsedId = proposalIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: 'ID inválido.' });

  const proposal = await storage.getProposalById(userId, parsedId.data);
  if (!proposal) return res.status(404).json({ message: 'Proposta não encontrada.' });

  const amountCents = Math.round(Number(proposal.value) * 100);
  if (amountCents <= 0) {
    return res.status(400).json({ message: 'Valor da proposta inválido.' });
  }

  if (proposal.lifecycleStatus === 'PAID' || proposal.lifecycleStatus === 'CANCELLED') {
    return res.status(409).json({ message: 'A proposta não permite novo pagamento.' });
  }

  if (!['SENT', 'ACCEPTED'].includes(proposal.lifecycleStatus)) {
    return res.status(409).json({ message: 'A proposta precisa estar em SENT ou ACCEPTED para gerar pagamento.' });
  }

  const existingPayment = await storage.findPaymentByProposalId(proposal.id);
  if (existingPayment?.status === 'PENDING') {
    return res.json({ paymentUrl: existingPayment.paymentUrl });
  }

  const freelancerAccessToken = await getValidFreelancerAccessToken(userId);

  const publicHash = proposal.publicHash ?? crypto.randomBytes(18).toString('hex');
  if (!proposal.publicHash) {
    await storage.ensureProposalPublicHash(userId, proposal.id, publicHash);
  }

  const notificationUrl = `${process.env.APP_URL}/api/webhooks/mercadopago`;
  const preference = await createCheckoutPreferenceWithFreelancerToken({
    freelancerAccessToken,
    proposalId: proposal.id,
    title: proposal.title,
    amountCents,
    currency: 'BRL',
    notificationUrl,
    frontendPublicPath: `/p/${publicHash}`,
  });

  const paymentUrl = preference.init_point || preference.sandbox_init_point;

  if (!paymentUrl) {
    return res.status(502).json({ message: 'Mercado Pago não retornou URL de pagamento.' });
  }

  await storage.upsertProposalPayment({
    proposalId: proposal.id,
    status: 'PENDING',
    externalPreferenceId: preference.id ?? null,
    externalPaymentId: null,
    paymentUrl,
    amountCents,
  });

  return res.status(201).json({ paymentUrl });
});

router.patch('/:id/status', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const parsedId = proposalIdSchema.safeParse(req.params.id);

  if (!parsedId.success) {
    return res.status(400).json({ message: 'ID inválido.' });
  }

  const parsed = statusSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Dados inválidos.', errors: parsed.error.flatten() });
  }

  const updated = await storage.updateProposalStatus(userId, parsedId.data, parsed.data.status);

  if (!updated) {
    return res.status(404).json({ message: 'Proposta não encontrada.' });
  }

  return res.json(updated);
});

export default router;
