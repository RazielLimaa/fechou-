import { Router } from 'express';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import { storage } from '../storage.js';

const router = Router();

router.use(authenticate);

type ProposalStatus = 'pendente' | 'vendida' | 'cancelada' | string;

type ProposalRow = {
  id: number;
  title: string;
  clientName: string;
  status: ProposalStatus;
  value: string;
  createdAt: Date;
};

type InsightLevel = 'info' | 'warning' | 'critical';

const periodSchema = z.object({
  period: z.enum(['monthly', 'weekly']).default('monthly')
});


const rankedQuerySchema = z.object({
  period: z.enum(['monthly', 'weekly']).default('monthly'),
  limit: z.coerce.number().int().min(1).max(50).default(8)
});

const insightQuerySchema = z.object({
  period: z.enum(['monthly', 'weekly']).default('monthly'),
  limit: z.coerce.number().int().min(1).max(10).default(6)
});


async function generatePremiumDashboardXlsxWithPython(input: {
  period: 'monthly' | 'weekly';
  proposals: ProposalRow[];
}) {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'fechou-premium-export-'));
  const outputPath = path.join(tempDir, 'premium-dashboard.xlsx');
  const scriptPath = path.resolve(process.cwd(), 'scripts', 'generate_premium_dashboard_excel.py');

  const payload = JSON.stringify({
    period: input.period,
    proposals: input.proposals.map((p) => ({
      id: p.id,
      title: p.title,
      clientName: p.clientName,
      status: p.status,
      value: p.value,
      createdAt: new Date(p.createdAt).toISOString()
    }))
  });

  const run = (pythonBin: string) => new Promise<void>((resolve, reject) => {
    const child = spawn(pythonBin, [scriptPath, outputPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(stderr || `python exited with ${code}`));
    });

    child.stdin.write(payload);
    child.stdin.end();
  });

  try {
    try {
      await run(process.env.PYTHON_BIN ?? 'python3');
    } catch (error) {
      if (process.env.PYTHON_BIN) throw error;
      await run('python');
    }

    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

const actionQuerySchema = z.object({
  period: z.enum(['monthly', 'weekly']).default('monthly'),
  limit: z.coerce.number().int().min(1).max(10).default(5)
});

const csvEscape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

const toNumber = (rawValue: string) => {
  if (!rawValue) return 0;
  return Number(rawValue.replace(/\./g, '').replace(',', '.')) || 0;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const daysBetween = (isoDate: string | Date, now = new Date()) => {
  const d = new Date(isoDate);
  const ms = now.getTime() - d.getTime();
  return Math.max(0, Math.floor(ms / 86400000));
};

const getISOWeek = (date: Date) => {
  const workingDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = workingDate.getUTCDay() || 7;
  workingDate.setUTCDate(workingDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(workingDate.getUTCFullYear(), 0, 1));
  return Math.ceil((((workingDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
};

function computeHealthScore(params: {
  total: number;
  sold: number;
  pending: number;
  canceled: number;
  totalRevenue: number;
  avgTicket: number;
  pendingAgingAvg: number;
  recentSoldCount: number;
}) {
  const { total, sold, pending, canceled, totalRevenue, avgTicket, pendingAgingAvg, recentSoldCount } = params;

  if (total === 0) {
    return { score: 0, reasons: ['Sem dados suficientes ainda.'] };
  }

  const conversion = sold / total;
  const pendingRate = pending / total;
  const canceledRate = canceled / total;

  let score = 100;

  if (conversion < 0.10) score -= 30;
  else if (conversion < 0.20) score -= 18;
  else if (conversion < 0.30) score -= 10;

  if (pendingRate > 0.60) score -= 20;
  else if (pendingRate > 0.45) score -= 12;

  if (canceledRate > 0.25) score -= 18;
  else if (canceledRate > 0.15) score -= 10;

  if (pendingAgingAvg > 14) score -= 14;
  else if (pendingAgingAvg > 7) score -= 8;

  if (totalRevenue > 0) score += 4;
  if (avgTicket > 0) score += 3;
  if (recentSoldCount === 0) score -= 10;

  score = clamp(score, 0, 100);

  const reasons: string[] = [];
  reasons.push(`Conversão: ${(conversion * 100).toFixed(1)}%`);
  reasons.push(`Pendências: ${(pendingRate * 100).toFixed(1)}%`);
  reasons.push(`Cancelamentos: ${(canceledRate * 100).toFixed(1)}%`);
  reasons.push(`Aging médio pendente: ${pendingAgingAvg.toFixed(0)} dias`);
  reasons.push(`Vendas recentes (30d): ${recentSoldCount}`);

  return { score, reasons };
}

function generateInsights(params: {
  total: number;
  sold: number;
  pending: number;
  canceled: number;
  conversionRatePct: number;
  totalRevenue: number;
  pendingAgingAvg: number;
  biggestPending?: { title: string; clientName: string; value: number; daysOpen: number };
  trend?: { lastPeriodSold: number; prevPeriodSold: number };
}) {
  const { total, sold, pending, canceled, conversionRatePct, totalRevenue, pendingAgingAvg, biggestPending, trend } = params;

  const out: Array<{ id: string; level: InsightLevel; title: string; description: string; metric?: string }> = [];

  if (total === 0) {
    out.push({
      id: 'no-data',
      level: 'info',
      title: 'Sem dados suficientes',
      description: 'Crie ou importe propostas para liberar métricas e insights.'
    });
    return out;
  }

  if (conversionRatePct < 15) {
    out.push({
      id: 'low-conversion',
      level: 'warning',
      title: 'Conversão abaixo do ideal',
      description: `Sua conversão está em ${conversionRatePct.toFixed(1)}%. Priorize follow-up nas pendências de maior valor.`,
      metric: `${conversionRatePct.toFixed(1)}%`
    });
  } else {
    out.push({
      id: 'conversion-ok',
      level: 'info',
      title: 'Conversão saudável',
      description: `Conversão atual em ${conversionRatePct.toFixed(1)}%. Mantenha consistência e reduza aging nas pendências.`,
      metric: `${conversionRatePct.toFixed(1)}%`
    });
  }

  const pendingRate = pending / total;
  if (pendingRate > 0.55) {
    out.push({
      id: 'pending-high',
      level: pendingAgingAvg > 10 ? 'critical' : 'warning',
      title: 'Volume alto de pendências',
      description: `Pendências representam ${(pendingRate * 100).toFixed(1)}% do funil. Aging médio de ${pendingAgingAvg.toFixed(0)} dias.`,
      metric: `${pending} pendentes`
    });
  }

  if (totalRevenue === 0 && sold === 0) {
    out.push({
      id: 'no-revenue',
      level: 'critical',
      title: 'Nenhuma receita realizada',
      description: 'Você ainda não registrou vendas. Comece atacando as pendências mais valiosas e recentes.'
    });
  }

  const canceledRate = canceled / total;
  if (canceledRate > 0.2) {
    out.push({
      id: 'canceled-high',
      level: 'warning',
      title: 'Cancelamentos acima do normal',
      description: `Taxa de cancelamento em ${(canceledRate * 100).toFixed(1)}%. Revise preço/escopo e tempo de resposta.`
    });
  }

  if (biggestPending) {
    out.push({
      id: 'biggest-pending',
      level: 'info',
      title: 'Maior oportunidade em aberto',
      description: `“${biggestPending.title}” (${biggestPending.clientName}) está pendente há ${biggestPending.daysOpen} dias.`,
      metric: `R$ ${biggestPending.value.toFixed(2)}`
    });
  }

  if (trend) {
    const { lastPeriodSold, prevPeriodSold } = trend;
    if (prevPeriodSold > 0) {
      const deltaPct = ((lastPeriodSold - prevPeriodSold) / prevPeriodSold) * 100;
      if (deltaPct <= -25) {
        out.push({
          id: 'trend-drop',
          level: 'warning',
          title: 'Queda de vendas no período',
          description: `Vendas caíram ${Math.abs(deltaPct).toFixed(0)}% vs. período anterior. Aja nas pendências e no SLA.`,
          metric: `${lastPeriodSold} vendidos`
        });
      } else if (deltaPct >= 25) {
        out.push({
          id: 'trend-up',
          level: 'info',
          title: 'Crescimento de vendas no período',
          description: `Vendas subiram ${deltaPct.toFixed(0)}% vs. período anterior. Replique os canais e cadência.`,
          metric: `${lastPeriodSold} vendidos`
        });
      }
    }
  }

  const weight: Record<InsightLevel, number> = { critical: 3, warning: 2, info: 1 };
  out.sort((a, b) => weight[b.level] - weight[a.level]);

  return out.slice(0, 6);
}

function generateNextActions(params: {
  pending: Array<ProposalRow & { numericValue: number; daysOpen: number }>;
  soldCount: number;
  pendingCount: number;
  conversionRatePct: number;
}) {
  const { pending, soldCount, pendingCount, conversionRatePct } = params;

  const actions: Array<{ id: string; title: string; description: string; priority: 'P1' | 'P2' | 'P3' }> = [];

  const pendingOldHigh = pending
    .filter((p) => p.daysOpen >= 7)
    .sort((a, b) => b.numericValue - a.numericValue)
    .slice(0, 3);

  if (pendingOldHigh.length > 0) {
    actions.push({
      id: 'p1-old-high',
      priority: 'P1',
      title: 'Atacar pendências antigas de alto valor',
      description: `Você tem ${pendingOldHigh.length} pendências ≥7 dias com alto valor. Priorize follow-up e prazo.`
    });
  }

  if (conversionRatePct < 15 && pendingCount > 0) {
    actions.push({
      id: 'p1-conversion',
      priority: 'P1',
      title: 'Melhorar conversão do funil',
      description: 'Crie um playbook simples de follow-up (D+1, D+3, D+7) e teste ajustes de proposta/preço.'
    });
  }

  if (soldCount === 0 && pendingCount > 0) {
    actions.push({
      id: 'p2-first-sale',
      priority: 'P2',
      title: 'Buscar primeira venda',
      description: 'Selecione 5 pendências mais recentes e faça contato hoje com CTA claro (assinatura/pagamento).'
    });
  }

  actions.push({
    id: 'p3-hygiene',
    priority: 'P3',
    title: 'Higienizar funil',
    description: 'Revisar propostas canceladas para entender motivos e ajustar template de proposta.'
  });

  const weight = { P1: 3, P2: 2, P3: 1 };
  actions.sort((a, b) => weight[b.priority] - weight[a.priority]);

  return actions.slice(0, 5);
}

function computePremiumDashboard(proposals: ProposalRow[], viewMode: 'monthly' | 'weekly') {
  if (!proposals.length) {
    return {
      soldCount: 0,
      pendingCount: 0,
      canceledCount: 0,
      totalValue: 0,
      pendingValue: 0,
      avgTicket: 0,
      conversionRatePct: 0,
      chartData: [] as Array<{ name: string; sold: number; pending: number; revenue: number }>,
      pendingReasons: [
        { name: 'Aguardando Assinatura', value: 0 },
        { name: 'Aguardando Pagamento', value: 0 },
        { name: 'Em Revisão', value: 0 }
      ],
      pendingRanked: [] as Array<ProposalRow & { numericValue: number; daysOpen: number }>,
      trend: { lastPeriodSold: 0, prevPeriodSold: 0 },
      revenueSpark: [] as Array<{ name: string; revenue: number }>,
      health: { score: 0, reasons: ['Sem dados suficientes ainda.'] },
      insights: [] as Array<{ id: string; level: InsightLevel; title: string; description: string; metric?: string }>,
      actions: [] as Array<{ id: string; title: string; description: string; priority: 'P1' | 'P2' | 'P3' }>,
      pendingAgingAvg: 0,
      recentSoldCount: 0,
      biggestPending: undefined as { title: string; clientName: string; value: number; daysOpen: number } | undefined
    };
  }

  const now = new Date();

  const sold = proposals.filter((p) => p.status === 'vendida');
  const pending = proposals.filter((p) => p.status === 'pendente');
  const canceled = proposals.filter((p) => p.status === 'cancelada');

  const soldRevenue = sold.reduce((acc, p) => acc + toNumber(p.value), 0);
  const pendingValue = pending.reduce((acc, p) => acc + toNumber(p.value), 0);

  const total = proposals.length;
  const conversionRatePct = total > 0 ? (sold.length / total) * 100 : 0;
  const avgTicket = sold.length > 0 ? soldRevenue / sold.length : 0;

  const grouped = new Map<string, { sold: number; pending: number; revenue: number }>();

  proposals.forEach((p) => {
    const createdAt = new Date(p.createdAt);
    const key = viewMode === 'monthly'
      ? `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`
      : `${createdAt.getFullYear()}-W${String(getISOWeek(createdAt)).padStart(2, '0')}`;

    const current = grouped.get(key) ?? { sold: 0, pending: 0, revenue: 0 };
    if (p.status === 'vendida') {
      current.sold += 1;
      current.revenue += toNumber(p.value);
    }
    if (p.status === 'pendente') {
      current.pending += 1;
    }

    grouped.set(key, current);
  });

  const chartData = Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, values]) => ({
      name,
      sold: values.sold,
      pending: values.pending,
      revenue: Number(values.revenue.toFixed(2))
    }));

  const revenueSpark = chartData.slice(-10).map((d) => ({ name: d.name, revenue: d.revenue }));

  const pendingRanked = pending
    .map((p) => ({
      ...p,
      numericValue: toNumber(p.value),
      daysOpen: daysBetween(p.createdAt, now)
    }))
    .sort((a, b) => b.numericValue - a.numericValue);

  const pendingReasons = [
    { name: 'Aguardando Assinatura', value: Math.max(0, Math.round(pending.length * 0.45)) },
    { name: 'Aguardando Pagamento', value: Math.max(0, Math.round(pending.length * 0.35)) },
    { name: 'Em Revisão', value: Math.max(0, Math.round(pending.length * 0.2)) }
  ].filter((x) => x.value > 0);

  const last = chartData.at(-1);
  const prev = chartData.at(-2);
  const trend = {
    lastPeriodSold: last?.sold ?? 0,
    prevPeriodSold: prev?.sold ?? 0
  };

  const pendingAgingAvg = pendingRanked.length > 0
    ? pendingRanked.reduce((acc, p) => acc + p.daysOpen, 0) / pendingRanked.length
    : 0;

  const recentSoldCount = sold.filter((p) => daysBetween(p.createdAt, now) <= 30).length;

  const biggestPending = pendingRanked[0]
    ? {
      title: pendingRanked[0].title,
      clientName: pendingRanked[0].clientName,
      value: pendingRanked[0].numericValue,
      daysOpen: pendingRanked[0].daysOpen
    }
    : undefined;

  const health = computeHealthScore({
    total,
    sold: sold.length,
    pending: pending.length,
    canceled: canceled.length,
    totalRevenue: soldRevenue,
    avgTicket,
    pendingAgingAvg,
    recentSoldCount
  });

  const insights = generateInsights({
    total,
    sold: sold.length,
    pending: pending.length,
    canceled: canceled.length,
    conversionRatePct,
    totalRevenue: soldRevenue,
    pendingAgingAvg,
    biggestPending,
    trend
  });

  const actions = generateNextActions({
    pending: pendingRanked,
    soldCount: sold.length,
    pendingCount: pending.length,
    conversionRatePct
  });

  return {
    soldCount: sold.length,
    pendingCount: pending.length,
    canceledCount: canceled.length,
    totalValue: soldRevenue,
    pendingValue,
    avgTicket,
    conversionRatePct,
    chartData,
    pendingReasons,
    pendingRanked,
    trend,
    revenueSpark,
    health,
    insights,
    actions,
    pendingAgingAvg,
    recentSoldCount,
    biggestPending
  };
}


async function loadDashboardForUser(userId: number, period: 'monthly' | 'weekly') {
  const proposals = (await storage.listProposals(userId)) as ProposalRow[];
  const dashboard = computePremiumDashboard(proposals, period);
  return { proposals, dashboard };
}

router.get('/sales', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const metrics = await storage.getSalesMetrics(userId);
  return res.json(metrics);
});

router.get('/premium-dashboard', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const parsedQuery = periodSchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({ message: 'Parâmetro period inválido. Use monthly ou weekly.' });
  }

  const viewMode = parsedQuery.data.period;
  const { dashboard } = await loadDashboardForUser(userId, viewMode);

  return res.json({
    period: viewMode,
    generatedAt: new Date().toISOString(),
    ...dashboard
  });
});

router.get('/premium-dashboard/kpis', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const parsedQuery = periodSchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({ message: 'Parâmetro period inválido. Use monthly ou weekly.' });
  }

  const period = parsedQuery.data.period;
  const { dashboard } = await loadDashboardForUser(userId, period);

  return res.json({
    period,
    soldCount: dashboard.soldCount,
    pendingCount: dashboard.pendingCount,
    canceledCount: dashboard.canceledCount,
    totalValue: dashboard.totalValue,
    pendingValue: dashboard.pendingValue,
    avgTicket: dashboard.avgTicket,
    conversionRatePct: dashboard.conversionRatePct
  });
});

router.get('/premium-dashboard/charts', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const parsedQuery = periodSchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({ message: 'Parâmetro period inválido. Use monthly ou weekly.' });
  }

  const period = parsedQuery.data.period;
  const { dashboard } = await loadDashboardForUser(userId, period);

  return res.json({
    period,
    chartData: dashboard.chartData,
    revenueSpark: dashboard.revenueSpark,
    trend: dashboard.trend
  });
});

router.get('/premium-dashboard/health', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const parsedQuery = periodSchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({ message: 'Parâmetro period inválido. Use monthly ou weekly.' });
  }

  const period = parsedQuery.data.period;
  const { dashboard } = await loadDashboardForUser(userId, period);

  return res.json({
    period,
    health: dashboard.health,
    pendingAgingAvg: dashboard.pendingAgingAvg,
    recentSoldCount: dashboard.recentSoldCount
  });
});

router.get('/premium-dashboard/insights', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const parsedQuery = insightQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({ message: 'Parâmetros inválidos. Use period=monthly|weekly e limit entre 1 e 10.' });
  }

  const { period, limit } = parsedQuery.data;
  const { dashboard } = await loadDashboardForUser(userId, period);

  return res.json({
    period,
    insights: dashboard.insights.slice(0, limit)
  });
});

router.get('/premium-dashboard/actions', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const parsedQuery = actionQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({ message: 'Parâmetros inválidos. Use period=monthly|weekly e limit entre 1 e 10.' });
  }

  const { period, limit } = parsedQuery.data;
  const { dashboard } = await loadDashboardForUser(userId, period);

  return res.json({
    period,
    actions: dashboard.actions.slice(0, limit)
  });
});

router.get('/premium-dashboard/pending-reasons', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const parsedQuery = periodSchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({ message: 'Parâmetro period inválido. Use monthly ou weekly.' });
  }

  const period = parsedQuery.data.period;
  const { dashboard } = await loadDashboardForUser(userId, period);

  return res.json({
    period,
    pendingReasons: dashboard.pendingReasons
  });
});

router.get('/premium-dashboard/pending-ranked', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const parsedQuery = rankedQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({ message: 'Parâmetros inválidos. Use period=monthly|weekly e limit entre 1 e 50.' });
  }

  const { period, limit } = parsedQuery.data;
  const { dashboard } = await loadDashboardForUser(userId, period);

  return res.json({
    period,
    biggestPending: dashboard.biggestPending,
    pendingRanked: dashboard.pendingRanked.slice(0, limit)
  });
});

router.get('/premium-dashboard/executive-summary', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const parsedQuery = periodSchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({ message: 'Parâmetro period inválido. Use monthly ou weekly.' });
  }

  const period = parsedQuery.data.period;
  const { dashboard } = await loadDashboardForUser(userId, period);

  const risk = dashboard.insights.some((i) => i.level === 'critical')
    ? 'Alto'
    : dashboard.insights.some((i) => i.level === 'warning')
      ? 'Médio'
      : 'Baixo';

  return res.json({
    period,
    conversionRatePct: dashboard.conversionRatePct,
    pendingValue: dashboard.pendingValue,
    avgTicket: dashboard.avgTicket,
    risk
  });
});


router.get('/premium-dashboard/export-template.xlsx', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const parsedQuery = periodSchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({ message: 'Parâmetro period inválido. Use monthly ou weekly.' });
  }

  const period = parsedQuery.data.period;
  const proposals = (await storage.listProposals(userId)) as ProposalRow[];

  if (!proposals.length) {
    return res.status(400).json({ message: 'Nenhuma proposta para exportar.' });
  }

  try {
    const xlsxBuffer = await generatePremiumDashboardXlsxWithPython({ period, proposals });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="premium-dashboard-${period}.xlsx"`);
    return res.send(xlsxBuffer);
  } catch (error) {
    console.error('[premium-dashboard-export] erro ao gerar xlsx', error);
    return res.status(500).json({ message: 'Falha ao gerar planilha premium.' });
  }
});

router.get('/premium-dashboard/export.csv', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const proposals = (await storage.listProposals(userId)) as ProposalRow[];
  const dashboard = computePremiumDashboard(proposals, 'monthly');

  if (!proposals.length) {
    return res.status(400).json({ message: 'Nenhuma proposta para exportar.' });
  }

  const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const pendingReasons = ['Aguardando Assinatura', 'Aguardando Pagamento', 'Em Revisão'];

  const monthlyMap = new Map<string, { sold: number; pending: number; revenue: number; total: number }>();
  const weeklyMap = new Map<string, { sold: number; pending: number; revenue: number; total: number }>();

  proposals.forEach((proposal) => {
    const createdAt = new Date(proposal.createdAt);
    const monthlyKey = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`;
    const weeklyKey = `${createdAt.getFullYear()}-W${String(getISOWeek(createdAt)).padStart(2, '0')}`;
    const value = toNumber(proposal.value);

    const updateMap = (map: Map<string, { sold: number; pending: number; revenue: number; total: number }>, key: string) => {
      const current = map.get(key) || { sold: 0, pending: 0, revenue: 0, total: 0 };
      current.total += 1;
      if (proposal.status === 'vendida') {
        current.sold += 1;
        current.revenue += value;
      }
      if (proposal.status === 'pendente') {
        current.pending += 1;
      }
      map.set(key, current);
    };

    updateMap(monthlyMap, monthlyKey);
    updateMap(weeklyMap, weeklyKey);
  });

  const overallAvgTicket = dashboard.soldCount ? dashboard.totalValue / dashboard.soldCount : 0;

  const headers = [
    'proposal_id', 'titulo_proposta', 'cliente', 'status', 'valor_brl', 'data_criacao_iso', 'ano', 'trimestre', 'mes_numero', 'mes_nome',
    'semana_iso', 'periodo_mensal', 'periodo_semanal', 'is_vendida', 'is_pendente', 'is_cancelada', 'receita_realizada_brl',
    'motivo_pendencia', 'dias_aberta', 'mensal_total_contratos', 'mensal_contratos_vendidos', 'mensal_contratos_pendentes',
    'mensal_receita_total_brl', 'mensal_taxa_conversao_percentual', 'mensal_ticket_medio_brl', 'semanal_total_contratos',
    'semanal_contratos_vendidos', 'semanal_contratos_pendentes', 'semanal_receita_total_brl', 'semanal_taxa_conversao_percentual',
    'semanal_ticket_medio_brl', 'kpi_total_contratos_vendidos_geral', 'kpi_receita_total_geral_brl', 'kpi_contratos_pendentes_geral',
    'kpi_ticket_medio_geral_brl', 'health_score_0_100', 'pendencias_aging_medio_dias'
  ];

  const rows = proposals.map((proposal) => {
    const createdAt = new Date(proposal.createdAt);
    const value = toNumber(proposal.value);
    const year = createdAt.getFullYear();
    const month = createdAt.getMonth() + 1;
    const isoWeek = getISOWeek(createdAt);
    const monthlyKey = `${year}-${String(month).padStart(2, '0')}`;
    const weeklyKey = `${year}-W${String(isoWeek).padStart(2, '0')}`;
    const monthAgg = monthlyMap.get(monthlyKey) || { sold: 0, pending: 0, revenue: 0, total: 0 };
    const weekAgg = weeklyMap.get(weeklyKey) || { sold: 0, pending: 0, revenue: 0, total: 0 };
    const isSold = proposal.status === 'vendida';
    const isPending = proposal.status === 'pendente';
    const isCanceled = proposal.status === 'cancelada';
    const stableReasonIndex = String(proposal.id).length % pendingReasons.length;
    const pendingReason = isPending ? pendingReasons[stableReasonIndex] : 'N/A';

    const monthlyConversion = monthAgg.total ? (monthAgg.sold / monthAgg.total) * 100 : 0;
    const weeklyConversion = weekAgg.total ? (weekAgg.sold / weekAgg.total) * 100 : 0;
    const monthlyAvg = monthAgg.sold ? monthAgg.revenue / monthAgg.sold : 0;
    const weeklyAvg = weekAgg.sold ? weekAgg.revenue / weekAgg.sold : 0;

    return [
      csvEscape(proposal.id), csvEscape(proposal.title), csvEscape(proposal.clientName), csvEscape(proposal.status),
      csvEscape(value.toFixed(2)), csvEscape(createdAt.toISOString()), csvEscape(year), csvEscape(`T${Math.ceil(month / 3)}`),
      csvEscape(month), csvEscape(monthNames[createdAt.getMonth()]), csvEscape(isoWeek), csvEscape(monthlyKey), csvEscape(weeklyKey),
      csvEscape(isSold ? 1 : 0), csvEscape(isPending ? 1 : 0), csvEscape(isCanceled ? 1 : 0), csvEscape(isSold ? value.toFixed(2) : '0.00'),
      csvEscape(pendingReason), csvEscape(daysBetween(createdAt)), csvEscape(monthAgg.total), csvEscape(monthAgg.sold), csvEscape(monthAgg.pending),
      csvEscape(monthAgg.revenue.toFixed(2)), csvEscape(monthlyConversion.toFixed(2)), csvEscape(monthlyAvg.toFixed(2)), csvEscape(weekAgg.total),
      csvEscape(weekAgg.sold), csvEscape(weekAgg.pending), csvEscape(weekAgg.revenue.toFixed(2)), csvEscape(weeklyConversion.toFixed(2)),
      csvEscape(weeklyAvg.toFixed(2)), csvEscape(dashboard.soldCount), csvEscape(dashboard.totalValue.toFixed(2)), csvEscape(dashboard.pendingCount),
      csvEscape(overallAvgTicket.toFixed(2)), csvEscape(dashboard.health.score), csvEscape(dashboard.pendingAgingAvg.toFixed(0))
    ];
  });

  const BOM = '\uFEFF';
  const csvContent = BOM + headers.join(';') + '\n' + rows.map((row) => row.join(';')).join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="PowerBI_Vendas_Completo_${new Date().toISOString().slice(0, 10)}.csv"`);

  return res.send(csvContent);
});

export default router;