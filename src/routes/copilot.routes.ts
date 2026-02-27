import { Router } from 'express';
import { z } from 'zod';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import { storage } from '../storage.js';
import { generateCopilotPlan, getApproachForProposal, markActionStatus } from '../services/copilot.js';

const router = Router();
router.use(authenticate);

const toneSchema = z.object({ tone: z.enum(['curto', 'consultivo', 'direto']).default('consultivo') });
const proposalIdSchema = z.coerce.number().int().positive();

router.get('/today', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Não autenticado.' });

  const proposals = await storage.listProposals(userId);
  const plan = generateCopilotPlan(userId, proposals as any);

  return res.json({
    ritual: {
      objective: 'Executar 1 ação prioritária e 2 secundárias em até 5 minutos',
      maxMinutes: 5
    },
    ...plan
  });
});

router.get('/actions/:proposalId/approach', (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Não autenticado.' });

  const proposalIdParsed = proposalIdSchema.safeParse(req.params.proposalId);
  const toneParsed = toneSchema.safeParse(req.query);

  if (!proposalIdParsed.success || !toneParsed.success) {
    return res.status(400).json({ message: 'Parâmetros inválidos.' });
  }

  const result = getApproachForProposal(userId, proposalIdParsed.data, toneParsed.data.tone);
  if (!result) {
    return res.status(404).json({ message: 'Ação não encontrada para esta oportunidade.' });
  }

  return res.json(result);
});

router.post('/actions/:proposalId/done', (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Não autenticado.' });

  const proposalIdParsed = proposalIdSchema.safeParse(req.params.proposalId);
  if (!proposalIdParsed.success) return res.status(400).json({ message: 'ID inválido.' });

  const ok = markActionStatus(userId, proposalIdParsed.data, 'DONE');
  if (!ok) return res.status(404).json({ message: 'Ação não encontrada.' });

  return res.json({ ok: true, status: 'DONE' });
});

router.post('/actions/:proposalId/dismiss', (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Não autenticado.' });

  const proposalIdParsed = proposalIdSchema.safeParse(req.params.proposalId);
  if (!proposalIdParsed.success) return res.status(400).json({ message: 'ID inválido.' });

  const ok = markActionStatus(userId, proposalIdParsed.data, 'DISMISSED');
  if (!ok) return res.status(404).json({ message: 'Ação não encontrada.' });

  return res.json({ ok: true, status: 'DISMISSED' });
});

export default router;
