/**
 * src/routes/copilot.ts
 *
 * Router do Copiloto de Abordagem
 * Todos os endpoints requerem autenticação.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import { distributedRateLimit } from '../middleware/distributed-security.js';
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
router.use(distributedRateLimit({
  scope: 'copilot',
  limit: 120,
  windowMs: 10 * 60 * 1000,
}));

// ─── Schemas de validação ─────────────────────────────────────────────────────

const toneSchema = z.object({
  tone: z.enum(['curto', 'consultivo', 'direto', 'empático', 'provocativo']).default('consultivo'),
});

const proposalIdSchema = z.coerce.number().int().positive();
const localeQuerySchema = z.enum(['pt-BR', 'en']).optional();

function firstHeaderValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return firstHeaderValue(value[0]);
  return typeof value === 'string' ? value : undefined;
}

function getCopilotLocale(req: AuthenticatedRequest): string | undefined {
  const queryLocale = localeQuerySchema.safeParse(req.query.locale).success
    ? req.query.locale
    : localeQuerySchema.safeParse(req.query.lang).success
    ? req.query.lang
    : undefined;

  return firstHeaderValue(queryLocale)
    ?? firstHeaderValue(req.headers['x-fechou-locale'])
    ?? firstHeaderValue(req.headers['x-app-locale'])
    ?? firstHeaderValue(req.headers['x-locale'])
    ?? firstHeaderValue(req.headers['accept-language']);
}

const routeMessages = {
  'pt-BR': {
    unauthenticated: 'Não autenticado.',
    invalidId: 'ID inválido.',
    invalidParams: 'Parâmetros inválidos.',
    proposalNotFound: 'Proposta não encontrada.',
    actionNotFound: 'Ação não encontrada.',
    opportunityActionNotFound: 'Ação não encontrada para esta oportunidade.',
    planError: 'Erro ao gerar plano do copiloto.',
    diagnosisError: 'Erro ao gerar diagnóstico.',
    tipsError: 'Erro ao gerar dicas.',
    analyzeError: 'Erro ao analisar proposta.',
    approachesError: 'Erro ao gerar abordagens.',
  },
  en: {
    unauthenticated: 'Unauthenticated.',
    invalidId: 'Invalid ID.',
    invalidParams: 'Invalid parameters.',
    proposalNotFound: 'Proposal not found.',
    actionNotFound: 'Action not found.',
    opportunityActionNotFound: 'Action not found for this opportunity.',
    planError: 'Failed to generate copilot plan.',
    diagnosisError: 'Failed to generate diagnosis.',
    tipsError: 'Failed to generate tips.',
    analyzeError: 'Failed to analyze proposal.',
    approachesError: 'Failed to generate approaches.',
  },
};

type RouteMessageKey = keyof typeof routeMessages.en;

function routeMessage(req: AuthenticatedRequest, key: RouteMessageKey): string {
  const locale = getCopilotLocale(req)?.startsWith('pt-BR') ? 'pt-BR' : 'en';
  return routeMessages[locale][key];
}

// ─── GET /copilot/today ───────────────────────────────────────────────────────
// Plano completo do dia: diagnóstico, alertas, dicas, ações prioritárias.
// Esse é o endpoint "motor autônomo" — chame ao abrir o dashboard.

router.get('/today', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: routeMessage(req, 'unauthenticated') });

  try {
    const proposals = await storage.listProposals(userId);
    const plan = generateCopilotPlan(userId, proposals as any, getCopilotLocale(req));

    return res.json(plan);
  } catch (err) {
    console.error('[copilot/today]', err);
    return res.status(500).json({ message: routeMessage(req, 'planError') });
  }
});

// ─── GET /copilot/diagnosis ───────────────────────────────────────────────────
// Diagnóstico do pipeline em tempo real (sem ações específicas).

router.get('/diagnosis', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: routeMessage(req, 'unauthenticated') });

  try {
    const proposals = await storage.listProposals(userId);
    const plan = generateCopilotPlan(userId, proposals as any, getCopilotLocale(req));

    return res.json({
      diagnosis: plan.pipelineDiagnosis,
      alerts: plan.dashboardAlerts,
      nextCheckIn: plan.nextCheckIn,
    });
  } catch (err) {
    console.error('[copilot/diagnosis]', err);
    return res.status(500).json({ message: routeMessage(req, 'diagnosisError') });
  }
});

// ─── GET /copilot/tips ────────────────────────────────────────────────────────
// Dicas de desenvolvimento profissional baseadas no padrão do usuário.

router.get('/tips', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: routeMessage(req, 'unauthenticated') });

  try {
    const proposals = await storage.listProposals(userId);
    const plan = generateCopilotPlan(userId, proposals as any, getCopilotLocale(req));

    return res.json({
      tips: plan.developmentTips,
      totalTips: plan.developmentTips.length,
    });
  } catch (err) {
    console.error('[copilot/tips]', err);
    return res.status(500).json({ message: routeMessage(req, 'tipsError') });
  }
});

// ─── GET /copilot/proposals/:proposalId/analyze ───────────────────────────────
// Análise profunda de um contrato específico: vitals, eventos, 5 abordagens.

router.get('/proposals/:proposalId/analyze', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: routeMessage(req, 'unauthenticated') });

  const idParsed = proposalIdSchema.safeParse(req.params.proposalId);
  if (!idParsed.success) return res.status(400).json({ message: routeMessage(req, 'invalidId') });

  try {
    const allProposals = await storage.listProposals(userId) as any[];
    const proposal     = allProposals.find((p: any) => p.id === idParsed.data);

    if (!proposal) return res.status(404).json({ message: routeMessage(req, 'proposalNotFound') });

    const analysis = analyzeProposal(userId, proposal, allProposals, getCopilotLocale(req));

    return res.json({
      proposalId: proposal.id,
      clientName: proposal.clientName,
      proposalTitle: proposal.title,
      ...analysis,
    });
  } catch (err) {
    console.error('[copilot/analyze]', err);
    return res.status(500).json({ message: routeMessage(req, 'analyzeError') });
  }
});

// ─── GET /copilot/proposals/:proposalId/approaches ───────────────────────────
// Retorna todas as 5 abordagens geradas para uma proposta.
// Query param: ?tone=curto|consultivo|direto|empático|provocativo

router.get('/proposals/:proposalId/approaches', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: routeMessage(req, 'unauthenticated') });

  const idParsed   = proposalIdSchema.safeParse(req.params.proposalId);
  const toneParsed = toneSchema.safeParse(req.query);

  if (!idParsed.success || !toneParsed.success) {
    return res.status(400).json({ message: routeMessage(req, 'invalidParams') });
  }

  try {
    const allProposals = await storage.listProposals(userId) as any[];
    const proposal     = allProposals.find((p: any) => p.id === idParsed.data);

    if (!proposal) return res.status(404).json({ message: routeMessage(req, 'proposalNotFound') });

    const analysis = analyzeProposal(userId, proposal, allProposals, getCopilotLocale(req));
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
    return res.status(500).json({ message: routeMessage(req, 'approachesError') });
  }
});

// ─── GET /copilot/actions/:proposalId/approach ───────────────────────────────
// Compatibilidade com a versão anterior do router.

router.get('/actions/:proposalId/approach', (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: routeMessage(req, 'unauthenticated') });

  const idParsed   = proposalIdSchema.safeParse(req.params.proposalId);
  const toneParsed = toneSchema.safeParse(req.query);

  if (!idParsed.success || !toneParsed.success) {
    return res.status(400).json({ message: routeMessage(req, 'invalidParams') });
  }

  const result = getApproachForProposal(userId, idParsed.data, toneParsed.data.tone as Tone);
  if (!result) return res.status(404).json({ message: routeMessage(req, 'opportunityActionNotFound') });

  return res.json(result);
});

// ─── POST /copilot/actions/:proposalId/done ───────────────────────────────────

router.post('/actions/:proposalId/done', (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: routeMessage(req, 'unauthenticated') });

  const idParsed = proposalIdSchema.safeParse(req.params.proposalId);
  if (!idParsed.success) return res.status(400).json({ message: routeMessage(req, 'invalidId') });

  const ok = markActionStatus(userId, idParsed.data, 'DONE');
  if (!ok) return res.status(404).json({ message: routeMessage(req, 'actionNotFound') });

  return res.json({ ok: true, status: 'DONE' });
});

// ─── POST /copilot/actions/:proposalId/dismiss ───────────────────────────────

router.post('/actions/:proposalId/dismiss', (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: routeMessage(req, 'unauthenticated') });

  const idParsed = proposalIdSchema.safeParse(req.params.proposalId);
  if (!idParsed.success) return res.status(400).json({ message: routeMessage(req, 'invalidId') });

  const ok = markActionStatus(userId, idParsed.data, 'DISMISSED');
  if (!ok) return res.status(404).json({ message: routeMessage(req, 'actionNotFound') });

  return res.json({ ok: true, status: 'DISMISSED' });
});

export default router;
