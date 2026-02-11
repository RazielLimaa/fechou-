import { Router } from 'express';
import { z } from 'zod';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import { storage, type ProposalStatus } from '../storage.js';

const router = Router();

const createProposalSchema = z.object({
  title: z.string().min(2),
  clientName: z.string().min(2),
  description: z.string().min(5),
  value: z.coerce.number().positive()
});

const statusSchema = z.object({
  status: z.enum(['pendente', 'vendida', 'cancelada'])
});

router.use(authenticate);

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

  const status = req.query.status as ProposalStatus | undefined;

  if (status && !['pendente', 'vendida', 'cancelada'].includes(status)) {
    return res.status(400).json({ message: 'Status inválido.' });
  }

  const data = await storage.listProposals(userId, status);
  return res.json(data);
});

router.get('/:id', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const proposalId = Number(req.params.id);

  if (Number.isNaN(proposalId)) {
    return res.status(400).json({ message: 'ID inválido.' });
  }

  const proposal = await storage.getProposalById(userId, proposalId);

  if (!proposal) {
    return res.status(404).json({ message: 'Proposta não encontrada.' });
  }

  return res.json(proposal);
});

router.patch('/:id/status', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const proposalId = Number(req.params.id);

  if (Number.isNaN(proposalId)) {
    return res.status(400).json({ message: 'ID inválido.' });
  }

  const parsed = statusSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Dados inválidos.', errors: parsed.error.flatten() });
  }

  const updated = await storage.updateProposalStatus(userId, proposalId, parsed.data.status);

  if (!updated) {
    return res.status(404).json({ message: 'Proposta não encontrada.' });
  }

  return res.json(updated);
});

export default router;
