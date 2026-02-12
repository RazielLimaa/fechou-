import { Router } from 'express';
import { z } from 'zod';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import { storage, type ProposalStatus } from '../storage.js';

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
