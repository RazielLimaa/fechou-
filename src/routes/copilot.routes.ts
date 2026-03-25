/**
 * src/routes/copilot.ts
 *
 * Router do Copiloto de Abordagem
 * Todos os endpoints requerem autenticação.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import { storage } from '../storage.js';
import {
  generateCopilotPlan,
  getApproachForProposal,
  markActionStatus,
  analyzeProposal,
  type Tone,
} from '../services/copilot.js';

const router = Router();
router.use(authenticate);

// ─── Schemas de validação ─────────────────────────────────────────────────────

const toneSchema = z.object({
  tone: z.enum(['curto', 'consultivo', 'direto', 'empático', 'provocativo']).default('consultivo'),
});

const proposalIdSchema = z.coerce.number().int().positive();

// ─── GET /copilot/today ───────────────────────────────────────────────────────
// Plano completo do dia: diagnóstico, alertas, dicas, ações prioritárias.
// Esse é o endpoint "motor autônomo" — chame ao abrir o dashboard.

router.get('/today', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Não autenticado.' });

  try {
    const proposals = await storage.listProposals(userId);
    const plan = generateCopilotPlan(userId, proposals as any);

    return res.json(plan);
  } catch (err) {
    console.error('[copilot/today]', err);
    return res.status(500).json({ message: 'Erro ao gerar plano do copiloto.' });
  }
});

// ─── GET /copilot/diagnosis ───────────────────────────────────────────────────
// Diagnóstico do pipeline em tempo real (sem ações específicas).

router.get('/diagnosis', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Não autenticado.' });

  try {
    const proposals = await storage.listProposals(userId);
    const plan = generateCopilotPlan(userId, proposals as any);

    return res.json({
      diagnosis: plan.pipelineDiagnosis,
      alerts: plan.dashboardAlerts,
      nextCheckIn: plan.nextCheckIn,
    });
  } catch (err) {
    console.error('[copilot/diagnosis]', err);
    return res.status(500).json({ message: 'Erro ao gerar diagnóstico.' });
  }
});

// ─── GET /copilot/tips ────────────────────────────────────────────────────────
// Dicas de desenvolvimento profissional baseadas no padrão do usuário.

router.get('/tips', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Não autenticado.' });

  try {
    const proposals = await storage.listProposals(userId);
    const plan = generateCopilotPlan(userId, proposals as any);

    return res.json({
      tips: plan.developmentTips,
      totalTips: plan.developmentTips.length,
    });
  } catch (err) {
    console.error('[copilot/tips]', err);
    return res.status(500).json({ message: 'Erro ao gerar dicas.' });
  }
});

// ─── GET /copilot/proposals/:proposalId/analyze ───────────────────────────────
// Análise profunda de um contrato específico: vitals, eventos, 5 abordagens.

router.get('/proposals/:proposalId/analyze', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Não autenticado.' });

  const idParsed = proposalIdSchema.safeParse(req.params.proposalId);
  if (!idParsed.success) return res.status(400).json({ message: 'ID inválido.' });

  try {
    const allProposals = await storage.listProposals(userId) as any[];
    const proposal     = allProposals.find((p: any) => p.id === idParsed.data);

    if (!proposal) return res.status(404).json({ message: 'Proposta não encontrada.' });

    const analysis = analyzeProposal(userId, proposal, allProposals);

    return res.json({
      proposalId: proposal.id,
      clientName: proposal.clientName,
      proposalTitle: proposal.title,
      ...analysis,
    });
  } catch (err) {
    console.error('[copilot/analyze]', err);
    return res.status(500).json({ message: 'Erro ao analisar proposta.' });
  }
});

// ─── GET /copilot/proposals/:proposalId/approaches ───────────────────────────
// Retorna todas as 5 abordagens geradas para uma proposta.
// Query param: ?tone=curto|consultivo|direto|empático|provocativo

router.get('/proposals/:proposalId/approaches', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Não autenticado.' });

  const idParsed   = proposalIdSchema.safeParse(req.params.proposalId);
  const toneParsed = toneSchema.safeParse(req.query);

  if (!idParsed.success || !toneParsed.success) {
    return res.status(400).json({ message: 'Parâmetros inválidos.' });
  }

  try {
    const allProposals = await storage.listProposals(userId) as any[];
    const proposal     = allProposals.find((p: any) => p.id === idParsed.data);

    if (!proposal) return res.status(404).json({ message: 'Proposta não encontrada.' });

    const analysis = analyzeProposal(userId, proposal, allProposals);
    const requestedTone = toneParsed.data.tone as Tone;
    const highlighted = analysis.approaches.find(a => a.tone === requestedTone) ?? analysis.approaches[0];

    return res.json({
      proposalId: proposal.id,
      intent: analysis.intent,
      contractAnalysis: analysis.contractAnalysis,
      highlighted,
      allApproaches: analysis.approaches,
    });
  } catch (err) {
    console.error('[copilot/approaches]', err);
    return res.status(500).json({ message: 'Erro ao gerar abordagens.' });
  }
});

// ─── GET /copilot/actions/:proposalId/approach ───────────────────────────────
// Compatibilidade com a versão anterior do router.

router.get('/actions/:proposalId/approach', (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Não autenticado.' });

  const idParsed   = proposalIdSchema.safeParse(req.params.proposalId);
  const toneParsed = toneSchema.safeParse(req.query);

  if (!idParsed.success || !toneParsed.success) {
    return res.status(400).json({ message: 'Parâmetros inválidos.' });
  }

  const result = getApproachForProposal(userId, idParsed.data, toneParsed.data.tone as Tone);
  if (!result) return res.status(404).json({ message: 'Ação não encontrada para esta oportunidade.' });

  return res.json(result);
});

// ─── POST /copilot/actions/:proposalId/done ───────────────────────────────────

router.post('/actions/:proposalId/done', (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Não autenticado.' });

  const idParsed = proposalIdSchema.safeParse(req.params.proposalId);
  if (!idParsed.success) return res.status(400).json({ message: 'ID inválido.' });

  const ok = markActionStatus(userId, idParsed.data, 'DONE');
  if (!ok) return res.status(404).json({ message: 'Ação não encontrada.' });

  return res.json({ ok: true, status: 'DONE' });
});

// ─── POST /copilot/actions/:proposalId/dismiss ───────────────────────────────

router.post('/actions/:proposalId/dismiss', (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Não autenticado.' });

  const idParsed = proposalIdSchema.safeParse(req.params.proposalId);
  if (!idParsed.success) return res.status(400).json({ message: 'ID inválido.' });

  const ok = markActionStatus(userId, idParsed.data, 'DISMISSED');
  if (!ok) return res.status(404).json({ message: 'Ação não encontrada.' });

  return res.json({ ok: true, status: 'DISMISSED' });
});

export default router;