/**
 * src/services/copilot.ts
 *
 * COPILOTO DE ABORDAGEM — Motor de Inteligência Autônoma
 * ────────────────────────────────────────────────────────
 * Analisa cada contrato de ponta a ponta:
 *  • Ciclo de vida completo (criação → inatividade → risco de perda)
 *  • Padrões de comportamento do cliente (sinais textuais, tempo, valor)
 *  • Saúde do pipeline do usuário em tempo real
 *  • Geração de 5 abordagens distintas por oportunidade
 *  • Dicas de desenvolvimento profissional contextuais
 *  • Sistema de memória anti-repetição com cooldown inteligente
 *  • Score de prioridade multicritério
 *  • Diagnóstico autônomo do dashboard completo
 */

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type CanonicalStage =
  | 'LEAD_IN'
  | 'CONVERSA_ATIVA'
  | 'PROPOSTA_ENVIADA'
  | 'NEGOCIACAO'
  | 'GANHOU'
  | 'PERDEU';

export type CopilotEventType =
  | 'PROPOSAL_STALE'
  | 'VIEWED_NO_REPLY'
  | 'ASKED_DISCOUNT'
  | 'GHOSTED'
  | 'HIGH_TICKET'
  | 'SCOPE_MISMATCH'
  | 'COMPETITOR_SIGNAL'
  | 'BUDGET_SIGNAL'
  | 'URGENCY_SIGNAL'
  | 'DECISION_MAKER_ABSENT'
  | 'OBJECTION_DELIVERY'
  | 'REPEAT_CLIENT';

export type CopilotIntent =
  | 'FOLLOW_UP'
  | 'OBJECTION_PRICE'
  | 'ANCHOR_PLAN'
  | 'CLOSE'
  | 'BREAKUP'
  | 'REFRAME_VALUE'
  | 'SOCIAL_PROOF'
  | 'URGENCY_CREATION'
  | 'SCOPE_REDUCTION'
  | 'RELATIONSHIP_NURTURE';

export type CopilotAngle =
  | 'SEGURANCA'
  | 'ROI'
  | 'VELOCIDADE'
  | 'PROVA'
  | 'SIMPLICIDADE'
  | 'URGENCIA'
  | 'EXCLUSIVIDADE'
  | 'PARCERIA'
  | 'RESULTADO_CONCRETO'
  | 'CUSTO_DA_INACAO';

export type Tone = 'curto' | 'consultivo' | 'direto' | 'empático' | 'provocativo';

export type ApproachChannel = 'whatsapp' | 'email' | 'ligacao' | 'loom' | 'presencial';

export type CopilotLocale = 'pt-BR' | 'en';

export type ProposalInput = {
  id: number;
  title: string;
  clientName: string;
  status: string;
  value: string;
  createdAt: Date;
  updatedAt?: Date;
  description?: string;
  notes?: string;
  tags?: string[];
  viewCount?: number;
  lastViewedAt?: Date;
};

// ─── Tipos internos ───────────────────────────────────────────────────────────

type DetectedEvent = {
  type: CopilotEventType;
  reason: string;
  weight: number; // 0–1, para priorização
};

type ActionRecord = {
  proposalId: number;
  intent: CopilotIntent;
  angle: CopilotAngle;
  structureHash: string;
  createdAt: number;
  status: 'PENDING' | 'DONE' | 'DISMISSED';
};

type ContractVitals = {
  ageInDays: number;
  value: number;
  stage: CanonicalStage;
  hasDescription: boolean;
  descriptionLength: number;
  isHighTicket: boolean;
  isRepeatClient: boolean;
  daysSinceUpdate: number;
  velocityScore: number; // quão rápido o ciclo avança
  signals: string[];     // sinais textuais detectados
};

// ─── Abordagem completa por oportunidade ─────────────────────────────────────

export type ApproachVariant = {
  tone: Tone;
  channel: ApproachChannel;
  subject?: string;       // para email/loom
  opening: string;        // primeira frase de impacto
  body: string;           // desenvolvimento
  cta: string;            // call-to-action final
  fullMessage: string;    // mensagem completa pronta para copiar
  bestTime: string;       // quando enviar
  followUpIn: string;     // quando fazer o próximo contato
};

export type DevelopmentTip = {
  category: 'precificacao' | 'comunicacao' | 'processo' | 'posicionamento' | 'mindset' | 'tecnica';
  title: string;
  insight: string;
  actionable: string;
  priority: 'alta' | 'media' | 'baixa';
  source: 'pattern' | 'benchmark' | 'bestpractice';
};

export type CopilotAction = {
  proposalId: number;
  clientName: string;
  proposalTitle: string;
  stage: CanonicalStage;
  value: number;
  vitals: ContractVitals;
  event: CopilotEventType;
  intent: CopilotIntent;
  angle: CopilotAngle;
  priorityScore: number;
  whyNow: string;
  riskIfIgnore: string;
  contractAnalysis: string;  // análise profunda do contrato
  approaches: ApproachVariant[]; // 5 abordagens distintas
  suggestion: Record<Tone, string>; // compatibilidade reversa
};

export type PipelineDiagnosis = {
  overallHealth: 'critico' | 'atencao' | 'bom' | 'excelente';
  healthScore: number;
  conversionRate: number;
  avgCycledays: number;
  avgTicket: number;
  bottleneck: string;
  momentum: 'acelerando' | 'estavel' | 'desacelerando';
  criticalProposals: number;
  winRateLastMonth: number;
  recommendations: string[];
};

export type CopilotDashboardAlert = {
  id: string;
  severity: 'critical' | 'warning' | 'info' | 'celebration';
  title: string;
  message: string;
  actionLabel?: string;
  proposalId?: number;
  metric?: string;
};

export type CopilotPlanResult = {
  generatedAt: string;
  ritual: {
    objective: string;
    maxMinutes: number;
    mood: string;
  };
  pipelineDiagnosis: PipelineDiagnosis;
  dashboardAlerts: CopilotDashboardAlert[];
  developmentTips: DevelopmentTip[];
  primaryAction: CopilotAction | null;
  secondaryActions: CopilotAction[];
  totalAnalyzed: number;
  totalRecommended: number;
  nextCheckIn: string; // quando o usuário deve voltar a verificar
};

// ─── Memória por usuário ──────────────────────────────────────────────────────

const userMemory = new Map<number, ActionRecord[]>();
const clientInteractionMap = new Map<string, number[]>(); // clientName → proposalIds ganhos

// ─── Helpers ──────────────────────────────────────────────────────────────────

type LocaleInput = CopilotLocale | string | string[] | null | undefined;

function isCopilotLocale(value: string | undefined): value is CopilotLocale {
  return value === 'pt-BR' || value === 'en';
}

export function resolveCopilotLocale(acceptLanguage?: LocaleInput): CopilotLocale {
  if (Array.isArray(acceptLanguage)) {
    return resolveCopilotLocale(acceptLanguage[0]);
  }

  const header = acceptLanguage ?? undefined;
  if (isCopilotLocale(header)) {
    return header;
  }

  return header?.startsWith('pt-BR') ? 'pt-BR' : 'en';
}

const ANGLES: CopilotAngle[] = [
  'SEGURANCA','ROI','VELOCIDADE','PROVA','SIMPLICIDADE',
  'URGENCIA','EXCLUSIVIDADE','PARCERIA','RESULTADO_CONCRETO','CUSTO_DA_INACAO'
];

function toNumber(rawValue: string | number): number {
  if (!rawValue) return 0;
  if (typeof rawValue === 'number') return isFinite(rawValue) ? rawValue : 0;
  return Number(String(rawValue).replace(/\./g, '').replace(',', '.')) || 0;
}

function normalize(text: string): string {
  return text.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim();
}

function hashLike(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

function daysBetween(d: Date, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(d).getTime()) / 86_400_000));
}

function detectTextSignals(text: string): string[] {
  const t = normalize(text);
  const signals: string[] = [];
  if (/desconto|barato|caro|preco|orcamento|custo/.test(t)) signals.push('price_objection');
  if (/concorrente|outro fornecedor|cotando|comparando|alternativa/.test(t)) signals.push('competitor');
  if (/urgente|urgencia|rapido|preciso logo|prazo|deadline|entrega/.test(t)) signals.push('urgency');
  if (/diretor|ceo|socio|gerente|aprovacao|comite|reuniao/.test(t)) signals.push('decision_maker');
  if (/redesign|refazer|escopo|mudar|ajustar|diferente/.test(t)) signals.push('scope_issue');
  if (/orcamento limitado|budget|verba|corte/.test(t)) signals.push('budget_constraint');
  if (/nao sei|talvez|pensar|ver|consultar|avaliar/.test(t)) signals.push('indecision');
  if (/otimo|perfeito|adorei|excelente|gostei|incrivel/.test(t)) signals.push('positive_signal');
  return signals;
}

export function canonicalStageFromProposalStatus(status: string): CanonicalStage {
  if (status === 'vendida') return 'GANHOU';
  if (status === 'cancelada') return 'PERDEU';
  if (status === 'negociacao') return 'NEGOCIACAO';
  if (status === 'conversa') return 'CONVERSA_ATIVA';
  return 'PROPOSTA_ENVIADA';
}

// ─── Análise profunda do contrato ─────────────────────────────────────────────

function analyzeContractVitals(
  proposal: ProposalInput,
  allProposals: ProposalInput[],
  avgValue: number
): ContractVitals {
  const value = toNumber(proposal.value);
  const ageInDays = daysBetween(new Date(proposal.createdAt));
  const updatedAt = proposal.updatedAt ? new Date(proposal.updatedAt) : new Date(proposal.createdAt);
  const daysSinceUpdate = daysBetween(updatedAt);
  const stage = canonicalStageFromProposalStatus(proposal.status);

  // Detecta se é cliente recorrente
  const wonFromThisClient = allProposals.filter(
    p => normalize(p.clientName) === normalize(proposal.clientName) && p.status === 'vendida'
  ).length;
  const isRepeatClient = wonFromThisClient > 0;

  // Score de velocidade: quanto mais rápido o ciclo ideal, melhor
  const expectedCycleDays = value > 10000 ? 14 : value > 3000 ? 7 : 3;
  const velocityScore = Math.max(0, 1 - ageInDays / (expectedCycleDays * 3));

  const fullText = `${proposal.title} ${proposal.description ?? ''} ${proposal.notes ?? ''}`;
  const signals = detectTextSignals(fullText);

  return {
    ageInDays,
    value,
    stage,
    hasDescription: !!proposal.description && proposal.description.length > 20,
    descriptionLength: (proposal.description ?? '').length,
    isHighTicket: value > Math.max(1500, avgValue * 1.5),
    isRepeatClient,
    daysSinceUpdate,
    velocityScore,
    signals,
  };
}

function generateContractAnalysis(
  vitals: ContractVitals,
  event: DetectedEvent,
  proposal: ProposalInput,
  locale: CopilotLocale
): string {
  const parts: string[] = [];

  if (locale === 'pt-BR') {
    parts.push(`Esta proposta está aberta há ${vitals.ageInDays} dias`);

    if (vitals.ageInDays <= 2) parts.push('— ainda dentro da janela quente de decisão.');
    else if (vitals.ageInDays <= 7) parts.push('— na zona de atenção: momentum ainda existe, mas está esfriando.');
    else if (vitals.ageInDays <= 14) parts.push('— ritmo comprometido. A chance de fechamento tende a cair após 2 semanas.');
    else parts.push('— zona crítica. Propostas paradas por tanto tempo normalmente precisam de intervenção ativa.');

    if (vitals.isRepeatClient) parts.push(` ${proposal.clientName} já comprou de você antes — use esse histórico para retomar com contexto.`);
    if (vitals.isHighTicket) parts.push(' Ticket acima da média: vale dedicar energia extra para não desperdiçar esta oportunidade.');
    if (vitals.signals.includes('price_objection')) parts.push(' Sinal de resistência a preço detectado no histórico — prepare uma âncora de valor antes de retomar.');
    if (vitals.signals.includes('competitor')) parts.push(' Há sinais de concorrência ativa — velocidade de resposta é decisiva agora.');
    if (vitals.signals.includes('urgency')) parts.push(' O cliente demonstrou urgência anteriormente — retome com próximo passo claro.');
    if (vitals.signals.includes('decision_maker')) parts.push(' Possível ausência do decisor real — valide quem aprova antes de insistir no fechamento.');
    if (vitals.signals.includes('positive_signal')) parts.push(' Cliente já demonstrou entusiasmo — o obstáculo pode ser interno, não a proposta.');
    if (!vitals.hasDescription) parts.push(' Proposta com pouco contexto registrado — adicionar notas melhora a qualidade das próximas abordagens.');

    return parts.join('');
  }

  parts.push(`This proposal has been open for ${vitals.ageInDays} days`);

  if (vitals.ageInDays <= 2) parts.push(' and is still inside the warm decision window.');
  else if (vitals.ageInDays <= 7) parts.push('; momentum still exists, but it is cooling down.');
  else if (vitals.ageInDays <= 14) parts.push('; the sales pace is slowing and the close window needs attention.');
  else parts.push('; this is a critical window and likely needs an active re-engagement.');

  if (vitals.isRepeatClient) parts.push(` ${proposal.clientName} has bought from you before, so reopen the conversation with that context.`);
  if (vitals.isHighTicket) parts.push(' This is above your average ticket, so it deserves focused follow-up.');
  if (vitals.signals.includes('price_objection')) parts.push(' Price resistance appears in the history, so anchor value before discussing price.');
  if (vitals.signals.includes('competitor')) parts.push(' There are signs of active comparison with competitors, so response speed matters now.');
  if (vitals.signals.includes('urgency')) parts.push(' The client previously showed urgency, so come back with a clear next step.');
  if (vitals.signals.includes('decision_maker')) parts.push(' The real decision maker may be missing, so confirm who approves before pushing for a close.');
  if (vitals.signals.includes('positive_signal')) parts.push(' The client has shown enthusiasm, so the blocker may be internal rather than the proposal itself.');
  if (!vitals.hasDescription) parts.push(' The proposal has limited context recorded, so better notes will improve future recommendations.');

  return parts.join('');
}

// ─── Detecção de eventos ──────────────────────────────────────────────────────

function detectEvents(
  proposal: ProposalInput,
  avgValue: number,
  allProposals: ProposalInput[],
  locale: CopilotLocale
): DetectedEvent[] {
  const value = toNumber(proposal.value);
  const age = daysBetween(new Date(proposal.createdAt));
  const fullText = normalize(`${proposal.title} ${proposal.description ?? ''} ${proposal.notes ?? ''}`);
  const signals = detectTextSignals(fullText);
  const events: DetectedEvent[] = [];
  const isOpen = proposal.status !== 'vendida' && proposal.status !== 'cancelada';

  if (!isOpen) return [];

  const text = {
    proposalStale: locale === 'pt-BR'
      ? `Proposta pendente há ${age} dias — janela de follow-up ideal.`
      : `Proposal pending for ${age} days — ideal follow-up window.`,
    viewedNoReply: locale === 'pt-BR'
      ? 'Sem resposta após contato inicial — cliente ainda não decidiu.'
      : 'No reply after the initial contact — the client has not decided yet.',
    ghosted: locale === 'pt-BR'
      ? `Cliente sem retorno há ${age} dias — intervenção necessária.`
      : `Client has not replied for ${age} days — intervention needed.`,
    ghostedCritical: locale === 'pt-BR'
      ? `${age} dias sem resposta — risco de perda silenciosa.`
      : `${age} days without a reply — silent-loss risk.`,
    price: locale === 'pt-BR'
      ? 'Sinal de objeção de preço detectado.'
      : 'Price objection signal detected.',
    competitor: locale === 'pt-BR'
      ? 'Cliente comparando com concorrentes.'
      : 'Client appears to be comparing competitors.',
    budget: locale === 'pt-BR'
      ? 'Restrição de orçamento sinalizada.'
      : 'Budget constraint signaled.',
    urgency: locale === 'pt-BR'
      ? 'Cliente demonstrou urgência — capitalize agora.'
      : 'Client showed urgency — use the momentum now.',
    decisionMaker: locale === 'pt-BR'
      ? 'Decisor pode não estar envolvido diretamente.'
      : 'The decision maker may not be directly involved.',
    scope: locale === 'pt-BR'
      ? 'Possível desalinhamento de escopo detectado.'
      : 'Possible scope mismatch detected.',
    highTicket: locale === 'pt-BR'
      ? 'Oportunidade de ticket acima da média.'
      : 'Above-average ticket opportunity.',
    repeatClient: locale === 'pt-BR'
      ? `${proposal.clientName} é cliente recorrente — relacionamento ativo.`
      : `${proposal.clientName} is a repeat client — active relationship.`,
  };

  if (age >= 3 && age < 7)  events.push({ type: 'PROPOSAL_STALE', reason: text.proposalStale, weight: 0.7 });
  if (age >= 2)             events.push({ type: 'VIEWED_NO_REPLY', reason: text.viewedNoReply, weight: 0.6 });
  if (age >= 7 && age < 14) events.push({ type: 'GHOSTED', reason: text.ghosted, weight: 0.8 });
  if (age >= 14)            events.push({ type: 'GHOSTED', reason: text.ghostedCritical, weight: 0.95 });
  if (signals.includes('price_objection')) events.push({ type: 'ASKED_DISCOUNT', reason: text.price, weight: 0.85 });
  if (signals.includes('competitor'))      events.push({ type: 'COMPETITOR_SIGNAL', reason: text.competitor, weight: 0.9 });
  if (signals.includes('budget_constraint')) events.push({ type: 'BUDGET_SIGNAL', reason: text.budget, weight: 0.8 });
  if (signals.includes('urgency'))           events.push({ type: 'URGENCY_SIGNAL', reason: text.urgency, weight: 0.85 });
  if (signals.includes('decision_maker'))    events.push({ type: 'DECISION_MAKER_ABSENT', reason: text.decisionMaker, weight: 0.75 });
  if (signals.includes('scope_issue'))       events.push({ type: 'SCOPE_MISMATCH', reason: text.scope, weight: 0.8 });
  if (value > Math.max(1500, avgValue * 1.5)) events.push({ type: 'HIGH_TICKET', reason: text.highTicket, weight: 0.9 });

  const wonFromClient = allProposals.filter(p => normalize(p.clientName) === normalize(proposal.clientName) && p.status === 'vendida').length;
  if (wonFromClient > 0) events.push({ type: 'REPEAT_CLIENT', reason: text.repeatClient, weight: 0.95 });

  // Retorna os 3 eventos mais relevantes para não sobrecarregar
  return events.sort((a, b) => b.weight - a.weight).slice(0, 3);
}

// ─── Mapeamento evento → intent ───────────────────────────────────────────────

function mapEventToIntent(event: CopilotEventType, vitals: ContractVitals): CopilotIntent {
  if (event === 'ASKED_DISCOUNT' || event === 'BUDGET_SIGNAL') return 'OBJECTION_PRICE';
  if (event === 'HIGH_TICKET' || event === 'REPEAT_CLIENT')    return 'ANCHOR_PLAN';
  if (event === 'COMPETITOR_SIGNAL')                           return 'REFRAME_VALUE';
  if (event === 'SCOPE_MISMATCH')                              return 'SCOPE_REDUCTION';
  if (event === 'URGENCY_SIGNAL')                              return 'URGENCY_CREATION';
  if (event === 'DECISION_MAKER_ABSENT')                       return 'RELATIONSHIP_NURTURE';
  if (event === 'GHOSTED' && vitals.ageInDays >= 21)           return 'BREAKUP';
  if (event === 'GHOSTED')                                     return 'SOCIAL_PROOF';
  return 'FOLLOW_UP';
}

// ─── Seleção de ângulo com memória ────────────────────────────────────────────

function chooseAngles(userId: number, intent: CopilotIntent, proposalId: number): CopilotAngle[] {
  const preferred: Record<CopilotIntent, CopilotAngle[]> = {
    FOLLOW_UP:           ['VELOCIDADE', 'SIMPLICIDADE', 'PROVA', 'PARCERIA', 'ROI'],
    OBJECTION_PRICE:     ['ROI', 'RESULTADO_CONCRETO', 'CUSTO_DA_INACAO', 'SEGURANCA', 'PROVA'],
    ANCHOR_PLAN:         ['ROI', 'PROVA', 'EXCLUSIVIDADE', 'RESULTADO_CONCRETO', 'SEGURANCA'],
    CLOSE:               ['URGENCIA', 'SIMPLICIDADE', 'SEGURANCA', 'RESULTADO_CONCRETO', 'CUSTO_DA_INACAO'],
    BREAKUP:             ['URGENCIA', 'CUSTO_DA_INACAO', 'SIMPLICIDADE', 'ROI', 'PARCERIA'],
    REFRAME_VALUE:       ['RESULTADO_CONCRETO', 'PROVA', 'EXCLUSIVIDADE', 'ROI', 'PARCERIA'],
    SOCIAL_PROOF:        ['PROVA', 'RESULTADO_CONCRETO', 'SEGURANCA', 'PARCERIA', 'ROI'],
    URGENCY_CREATION:    ['URGENCIA', 'CUSTO_DA_INACAO', 'EXCLUSIVIDADE', 'VELOCIDADE', 'ROI'],
    SCOPE_REDUCTION:     ['SIMPLICIDADE', 'VELOCIDADE', 'SEGURANCA', 'ROI', 'PARCERIA'],
    RELATIONSHIP_NURTURE:['PARCERIA', 'SEGURANCA', 'PROVA', 'VELOCIDADE', 'RESULTADO_CONCRETO'],
  };

  const memory = userMemory.get(userId) ?? [];
  const now = Date.now();
  const cooldownMs = 5 * 86_400_000; // 5 dias de cooldown por ângulo
  const recentAngles = new Set(
    memory.filter(m => now - m.createdAt <= cooldownMs).map(m => m.angle)
  );

  // Retorna os 5 ângulos preferidos, priorizando os não usados recentemente
  const list = preferred[intent] ?? ANGLES;
  const fresh = list.filter(a => !recentAngles.has(a));
  const fallback = list.filter(a => recentAngles.has(a));
  return [...fresh, ...fallback].slice(0, 5);
}

// ─── Score de prioridade ──────────────────────────────────────────────────────

function scoreOpportunity(params: {
  value: number;
  avgValue: number;
  event: CopilotEventType;
  daysOpen: number;
  stage: CanonicalStage;
  vitals: ContractVitals;
}): number {
  const { value, avgValue, event, daysOpen, stage, vitals } = params;

  const valueRelative  = Math.min(1, avgValue > 0 ? value / (avgValue * 2) : value / 20000);
  const timing         = Math.min(1, daysOpen / 10);
  const eventWeight: Record<CopilotEventType, number> = {
    REPEAT_CLIENT:          1.0,
    HIGH_TICKET:            0.95,
    COMPETITOR_SIGNAL:      0.9,
    URGENCY_SIGNAL:         0.9,
    ASKED_DISCOUNT:         0.85,
    GHOSTED:                0.85,
    PROPOSAL_STALE:         0.75,
    SCOPE_MISMATCH:         0.75,
    BUDGET_SIGNAL:          0.7,
    VIEWED_NO_REPLY:        0.65,
    DECISION_MAKER_ABSENT:  0.65,
    OBJECTION_DELIVERY:     0.6,
  };
  const stageWeight  = stage === 'NEGOCIACAO' ? 1.0 : stage === 'PROPOSTA_ENVIADA' ? 0.85 : 0.6;
  const repeatBonus  = vitals.isRepeatClient ? 0.15 : 0;
  const velocityPen  = vitals.velocityScore < 0.3 ? -0.1 : 0; // penaliza se muito lento
  const signalBonus  = vitals.signals.includes('positive_signal') ? 0.1 : 0;

  const raw = (
    0.25 * valueRelative +
    0.20 * timing +
    0.20 * (eventWeight[event] ?? 0.5) +
    0.15 * stageWeight +
    0.10 * vitals.velocityScore +
    0.10 * (1 - Math.min(1, daysOpen / 30))
  ) * 100 + repeatBonus * 100 + velocityPen * 100 + signalBonus * 100;

  return Math.round(Math.min(100, Math.max(0, raw)));
}

// ─── Geração de 5 abordagens distintas ───────────────────────────────────────

const CHANNELS: ApproachChannel[] = ['whatsapp', 'email', 'ligacao', 'loom', 'presencial'];

type AngleCopy = { hook: string; value: string; cta: string };

const ANGLE_COPY: Record<CopilotLocale, Record<CopilotAngle, AngleCopy>> = {
  'pt-BR': {
    SEGURANCA:          { hook: 'Quero garantir que você tome a melhor decisão aqui.',               value: 'Trabalhamos para reduzir riscos e deixar o próximo passo claro.',                   cta: 'Posso te enviar um resumo objetivo para facilitar a aprovação?' },
    ROI:                { hook: 'Fiz uma conta rápida com base no que você me contou.',              value: 'A ideia é conectar o investimento ao resultado esperado, sem inflar promessa.',      cta: 'Quer que eu monte uma visão simples de retorno para decidirmos com mais clareza?' },
    VELOCIDADE:         { hook: 'Tenho uma janela aberta que se encaixa bem no seu prazo.',           value: 'Posso iniciar logo após a confirmação, mantendo o escopo combinado.',                cta: 'Confirma hoje e a gente já agenda o kick-off para esta semana?' },
    PROVA:              { hook: 'Tive um cliente com situação parecida com a sua.',                  value: 'O ponto central foi sair com um processo mais claro e menos retrabalho.',             cta: 'Posso te mostrar a lógica do caso sem expor dados confidenciais?' },
    SIMPLICIDADE:       { hook: 'Quero simplificar isso para você.',                                 value: 'Resumindo em 2 passos: aprovação, depois execução dentro do prazo combinado.',       cta: 'O que falta para a gente dar o "go" agora?' },
    URGENCIA:           { hook: 'Tenho uma janela limitada para começar no próximo ciclo.',          value: 'Se deixarmos passar, preciso reorganizar a agenda antes de assumir o início.',        cta: 'Confirma até hoje para eu reservar sua vaga?' },
    EXCLUSIVIDADE:      { hook: 'Essa proposta foi desenhada para o seu cenário.',                   value: 'Estruturei especificamente para o que você precisa — não é um modelo genérico.',      cta: 'Faz sentido aproveitarmos isso agora?' },
    PARCERIA:           { hook: 'Penso em você como um parceiro de longo prazo, não só um projeto.', value: 'Quero que esse trabalho gere resultado real e duradouro para você.',                 cta: 'Posso te ligar em 10 minutos para alinharmos os próximos passos?' },
    RESULTADO_CONCRETO: { hook: 'Deixa eu ser bem direto sobre o que você vai ter no final.',        value: 'Ao fechar isso, você terá os entregáveis definidos e um caminho claro de execução.', cta: 'Isso resolve o que você precisa? Se sim, é só dar o "ok".' },
    CUSTO_DA_INACAO:    { hook: 'Quero te mostrar o que acontece se a gente não avançar agora.',     value: 'Cada semana sem decisão mantém o problema aberto e empurra o impacto para frente.',  cta: 'Vale a pena adiar? Posso te ajudar a calcular o impacto real.' },
  },
  en: {
    SEGURANCA:          { hook: 'I want to make sure you feel confident about this decision.',        value: 'The goal is to reduce risk and make the next step clear.',                           cta: 'Can I send you a short summary to make approval easier?' },
    ROI:                { hook: 'I ran a quick value check based on what you shared.',                value: 'The idea is to connect the investment to the expected outcome without overpromising.', cta: 'Would you like me to outline a simple return view so we can decide with more clarity?' },
    VELOCIDADE:         { hook: 'I have an open slot that fits your timeline well.',                  value: 'I can start shortly after confirmation while keeping the agreed scope intact.',        cta: 'Can you confirm today so we can schedule kickoff for this week?' },
    PROVA:              { hook: 'I worked with a client in a similar situation.',                     value: 'The key outcome was a clearer process and less rework.',                              cta: 'Can I show you the logic of that case without exposing confidential details?' },
    SIMPLICIDADE:       { hook: 'I want to make this simpler for you.',                              value: 'In two steps: approval first, then delivery within the agreed timeline.',             cta: 'What is missing for us to give this the go-ahead now?' },
    URGENCIA:           { hook: 'I have a limited window to start in the next cycle.',                value: 'If we miss it, I will need to reorganize the schedule before committing to a start.',  cta: 'Can you confirm today so I can reserve your slot?' },
    EXCLUSIVIDADE:      { hook: 'This proposal was built around your specific situation.',           value: 'I structured it for what you need — it is not a generic template.',                   cta: 'Does it make sense to use this window now?' },
    PARCERIA:           { hook: 'I see this as a long-term partnership, not just one project.',       value: 'I want this work to create a real and lasting result for you.',                       cta: 'Can I call you for 10 minutes to align the next steps?' },
    RESULTADO_CONCRETO: { hook: 'Let me be direct about what you will have at the end.',             value: 'By approving this, you get the defined deliverables and a clear execution path.',      cta: 'Does this solve what you need? If yes, just reply with an ok.' },
    CUSTO_DA_INACAO:    { hook: 'I want to show what happens if we do not move now.',                value: 'Each week without a decision keeps the problem open and pushes the impact forward.',  cta: 'Is it worth delaying? I can help you estimate the real impact.' },
  },
};

const INTENT_FRAMING: Record<CopilotLocale, Record<CopilotIntent, string>> = {
  'pt-BR': {
    FOLLOW_UP:           'retomada natural e objetiva',
    OBJECTION_PRICE:     'reposicionamento de valor antes de falar em preço',
    ANCHOR_PLAN:         'apresentação de opções com âncora de valor',
    CLOSE:               'pedido direto de confirmação com próximo passo claro',
    BREAKUP:             'fechamento respeitoso com janela final de 48h',
    REFRAME_VALUE:       'reposicionamento estratégico frente à concorrência',
    SOCIAL_PROOF:        'uso de caso similar para gerar confiança',
    URGENCY_CREATION:    'criação de urgência legítima baseada em disponibilidade',
    SCOPE_REDUCTION:     'simplificação do escopo para reduzir fricção de decisão',
    RELATIONSHIP_NURTURE:'nutrição do relacionamento sem pressão de fechamento',
  },
  en: {
    FOLLOW_UP:           'a natural and focused follow-up',
    OBJECTION_PRICE:     'value repositioning before discussing price',
    ANCHOR_PLAN:         'options anchored around value',
    CLOSE:               'a direct confirmation request with a clear next step',
    BREAKUP:             'a respectful final window before closing the loop',
    REFRAME_VALUE:       'strategic repositioning against competitor comparison',
    SOCIAL_PROOF:        'using a similar case to build confidence',
    URGENCY_CREATION:    'legitimate urgency based on availability',
    SCOPE_REDUCTION:     'scope simplification to reduce decision friction',
    RELATIONSHIP_NURTURE:'relationship nurturing without close pressure',
  },
};

const BEST_TIME: Record<CopilotLocale, Record<ApproachChannel, string>> = {
  'pt-BR': {
    whatsapp:    'Terça a quinta, entre 9h–11h ou 14h–16h',
    email:       'Terça a quinta, às 8h ou 17h',
    ligacao:     'Terça a quinta, entre 10h–11h30 ou 15h–17h',
    loom:        'Qualquer dia, envie de manhã para ser visto até o fim do dia',
    presencial:  'Agende com 2 dias de antecedência, prefira manhãs',
  },
  en: {
    whatsapp:    'Tuesday to Thursday, between 9–11 AM or 2–4 PM',
    email:       'Tuesday to Thursday, at 8 AM or 5 PM',
    ligacao:     'Tuesday to Thursday, between 10–11:30 AM or 3–5 PM',
    loom:        'Any day, send in the morning so it can be watched by end of day',
    presencial:  'Schedule 2 days ahead, preferably in the morning',
  },
};

const FOLLOW_UP_IN: Record<CopilotLocale, Record<ApproachChannel, string>> = {
  'pt-BR': {
    whatsapp:    '24–48h sem resposta',
    email:       '48–72h sem resposta',
    ligacao:     'Se não atender, tente em outro horário no mesmo dia',
    loom:        '48h — verifique se foi assistido',
    presencial:  '24h após a reunião',
  },
  en: {
    whatsapp:    '24–48h without a reply',
    email:       '48–72h without a reply',
    ligacao:     'If they do not answer, try another time on the same day',
    loom:        '48h — check whether it was watched',
    presencial:  '24h after the meeting',
  },
};

function buildApproachVariants(
  proposal: ProposalInput,
  intent: CopilotIntent,
  angles: CopilotAngle[],
  vitals: ContractVitals,
  primaryEvent: DetectedEvent,
  locale: CopilotLocale
): ApproachVariant[] {
  const tones: Tone[] = ['curto', 'consultivo', 'direto', 'empático', 'provocativo'];

  return angles.slice(0, 5).map((angle, i) => {
    const tone   = tones[i] ?? 'direto';
    const channel = CHANNELS[i];
    const copy   = ANGLE_COPY[locale][angle];
    const name   = proposal.clientName.split(' ')[0]; // primeiro nome

    // Abertura varia por tom
    const openings: Record<Tone, string> = locale === 'pt-BR'
      ? {
          curto:       `Oi ${name}, tudo bem?`,
          consultivo:  `Olá ${name}, queria retomar uma conversa importante sobre a proposta que te enviei.`,
          direto:      `${name}, preciso de uma resposta sua.`,
          empático:    `Oi ${name}, sei que você está ocupado — prometo ser breve.`,
          provocativo: `${name}, e se eu te dissesse que essa decisão pode estar ficando mais cara com o tempo?`,
        }
      : {
          curto:       `Hi ${name}, how are you?`,
          consultivo:  `Hi ${name}, I wanted to revisit an important conversation about the proposal I sent you.`,
          direto:      `${name}, I need your answer on this.`,
          empático:    `Hi ${name}, I know you are busy, so I will keep this brief.`,
          provocativo: `${name}, what if this decision is getting more expensive with time?`,
        };

    // Corpo varia por ângulo
    const body = [
      copy.hook,
      copy.value,
      primaryEvent.reason,
      locale === 'pt-BR'
        ? `A estratégia aqui é ${INTENT_FRAMING[locale][intent]}.`
        : `The strategy here is ${INTENT_FRAMING[locale][intent]}.`,
    ].join(' ');

    // CTA varia por tom
    const ctas: Record<Tone, string> = locale === 'pt-BR'
      ? {
          curto:       copy.cta,
          consultivo:  `${copy.cta} Posso reservar 15 minutos na sua agenda?`,
          direto:      'Confirma com um "sim" e eu avanço amanhã cedo.',
          empático:    'Sem pressão — mas me fala: ainda faz sentido para você?',
          provocativo: 'O que exatamente falta para fechar isso hoje?',
        }
      : {
          curto:       copy.cta,
          consultivo:  `${copy.cta} Can I reserve 15 minutes on your calendar?`,
          direto:      'Reply with "yes" and I will move this forward tomorrow morning.',
          empático:    'No pressure, but tell me: does this still make sense for you?',
          provocativo: 'What exactly is missing for you to approve this today?',
        };

    // Subject para email/loom
    const subjects: Record<Tone, string> = locale === 'pt-BR'
      ? {
          curto:       `Re: ${proposal.title}`,
          consultivo:  `Próximos passos: ${proposal.title}`,
          direto:      `Decisão pendente — ${proposal.title}`,
          empático:    `${name}, uma dúvida rápida sobre a proposta`,
          provocativo: 'O custo de esperar mais uma semana',
        }
      : {
          curto:       `Re: ${proposal.title}`,
          consultivo:  `Next steps: ${proposal.title}`,
          direto:      `Pending decision — ${proposal.title}`,
          empático:    `${name}, a quick question about the proposal`,
          provocativo: 'The cost of waiting another week',
        };

    const fullMessage = channel === 'whatsapp' || channel === 'ligacao'
      ? `${openings[tone]} ${body} ${ctas[tone]}`
      : locale === 'pt-BR'
      ? `Assunto: ${subjects[tone]}\n\n${openings[tone]}\n\n${body}\n\n${ctas[tone]}\n\nAté logo,\n[Seu nome]`
      : `Subject: ${subjects[tone]}\n\n${openings[tone]}\n\n${body}\n\n${ctas[tone]}\n\nBest,\n[Your name]`;

    return {
      tone,
      channel,
      subject: channel === 'email' || channel === 'loom' ? subjects[tone] : undefined,
      opening: openings[tone],
      body,
      cta: ctas[tone],
      fullMessage,
      bestTime: BEST_TIME[locale][channel],
      followUpIn: FOLLOW_UP_IN[locale][channel],
    };
  });
}

// ─── Diagnóstico do pipeline ──────────────────────────────────────────────────

function diagnosePipeline(proposals: ProposalInput[], locale: CopilotLocale): PipelineDiagnosis {
  const open      = proposals.filter(p => p.status !== 'vendida' && p.status !== 'cancelada');
  const sold      = proposals.filter(p => p.status === 'vendida');
  const cancelled = proposals.filter(p => p.status === 'cancelada');

  const denom = sold.length + cancelled.length;
  const conversionRate = denom > 0 ? (sold.length / denom) * 100 : 0;

  const now = new Date();
  const d30 = new Date(); d30.setDate(d30.getDate() - 30);
  const d60 = new Date(); d60.setDate(d60.getDate() - 60);

  const sold30  = sold.filter(p => new Date(p.createdAt) >= d30).length;
  const sold60  = sold.filter(p => new Date(p.createdAt) >= d60 && new Date(p.createdAt) < d30).length;
  const momentum: PipelineDiagnosis['momentum'] =
    sold30 > sold60 * 1.1 ? 'acelerando' :
    sold30 < sold60 * 0.9 ? 'desacelerando' : 'estavel';

  const avgCycledays = sold.length > 0
    ? sold.reduce((s, p) => s + daysBetween(new Date(p.createdAt)), 0) / sold.length
    : 0;

  const avgTicket = sold.length > 0
    ? sold.reduce((s, p) => s + toNumber(p.value), 0) / sold.length
    : 0;

  const criticalProposals = open.filter(p => daysBetween(new Date(p.createdAt)) >= 14).length;

  // Score de saúde
  let health = 0;
  health += Math.min(40, conversionRate * 0.67);
  health += Math.max(0, 25 - criticalProposals * 5);
  health += Math.min(20, sold30 * 5);
  health += momentum === 'acelerando' ? 15 : momentum === 'estavel' ? 8 : 0;
  health = Math.round(Math.min(100, health));

  const overallHealth: PipelineDiagnosis['overallHealth'] =
    health >= 75 ? 'excelente' : health >= 50 ? 'bom' : health >= 25 ? 'atencao' : 'critico';

  // Bottleneck principal
  let bottleneck = locale === 'pt-BR'
    ? 'Nenhum gargalo crítico identificado.'
    : 'No critical bottleneck identified.';
  if (conversionRate < 15) {
    bottleneck = locale === 'pt-BR'
      ? 'Baixa conversão — revise a qualidade e o posicionamento das propostas.'
      : 'Low conversion — review proposal quality and positioning.';
  } else if (criticalProposals >= 3) {
    bottleneck = locale === 'pt-BR'
      ? 'Muitas propostas críticas (+14d) — follow-up estruturado é urgente.'
      : 'Many critical proposals (+14d) — structured follow-up is urgent.';
  } else if (avgCycledays > 14) {
    bottleneck = locale === 'pt-BR'
      ? 'Ciclo de venda longo — adicione urgência e validade às propostas.'
      : 'Long sales cycle — add urgency and expiration dates to proposals.';
  } else if (avgTicket < 1500) {
    bottleneck = locale === 'pt-BR'
      ? 'Ticket médio baixo — revise precificação e pacotes de serviço.'
      : 'Low average ticket — review pricing and service packages.';
  }

  const recommendations: string[] = [];
  if (conversionRate < 30) {
    recommendations.push(locale === 'pt-BR'
      ? 'Implemente follow-up em 48h após envio de proposta.'
      : 'Add a follow-up within 48h after sending each proposal.');
  }
  if (avgCycledays > 10) {
    recommendations.push(locale === 'pt-BR'
      ? 'Adicione validade de 7 dias em todas as propostas.'
      : 'Add a 7-day expiration date to every proposal.');
  }
  if (criticalProposals > 0) {
    recommendations.push(locale === 'pt-BR'
      ? `Priorize as ${criticalProposals} proposta(s) crítica(s) ainda hoje.`
      : `Prioritize the ${criticalProposals} critical proposal(s) today.`);
  }
  if (avgTicket < 2000) {
    recommendations.push(locale === 'pt-BR'
      ? 'Crie um pacote "completo" com 30–40% de valor adicionado.'
      : 'Create a complete package with 30–40% more added value.');
  }
  if (momentum === 'desacelerando') {
    recommendations.push(locale === 'pt-BR'
      ? 'Envie pelo menos 3 novas propostas esta semana.'
      : 'Send at least 3 new proposals this week.');
  }
  if (open.length < 3) {
    recommendations.push(locale === 'pt-BR'
      ? 'Pipeline fraco — aumente prospecção ativa para ter mais oportunidades.'
      : 'Weak pipeline — increase active prospecting to create more opportunities.');
  }

  return {
    overallHealth,
    healthScore: health,
    conversionRate,
    avgCycledays,
    avgTicket,
    bottleneck,
    momentum,
    criticalProposals,
    winRateLastMonth: denom > 0 ? (sold30 / Math.max(1, sold30 + sold60)) * 100 : 0,
    recommendations,
  };
}

// ─── Alertas do dashboard ─────────────────────────────────────────────────────

function generateDashboardAlerts(
  proposals: ProposalInput[],
  diagnosis: PipelineDiagnosis,
  locale: CopilotLocale
): CopilotDashboardAlert[] {
  const alerts: CopilotDashboardAlert[] = [];
  const open = proposals.filter(p => p.status !== 'vendida' && p.status !== 'cancelada');

  // Alerta crítico: proposta mais velha
  const oldest = open.sort((a, b) => daysBetween(new Date(a.createdAt)) - daysBetween(new Date(b.createdAt))).at(-1);
  if (oldest && daysBetween(new Date(oldest.createdAt)) >= 14) {
    alerts.push({
      id: `stale_${oldest.id}`,
      severity: 'critical',
      title: locale === 'pt-BR' ? 'Proposta em risco de perda silenciosa' : 'Proposal at silent-loss risk',
      message: locale === 'pt-BR'
        ? `${oldest.clientName} está há ${daysBetween(new Date(oldest.createdAt))} dias sem resposta. Retome com uma abordagem clara.`
        : `${oldest.clientName} has been without a reply for ${daysBetween(new Date(oldest.createdAt))} days. Re-engage with a clear approach.`,
      actionLabel: locale === 'pt-BR' ? 'Ver abordagem' : 'View approach',
      proposalId: oldest.id,
      metric: `${daysBetween(new Date(oldest.createdAt))}d`,
    });
  }

  // Alerta de aceleração
  if (diagnosis.momentum === 'acelerando') {
    alerts.push({
      id: 'momentum_up',
      severity: 'celebration',
      title: locale === 'pt-BR' ? 'Pipeline acelerando!' : 'Pipeline accelerating!',
      message: locale === 'pt-BR'
        ? 'Você fechou mais negócios este mês do que no anterior. Mantenha o ritmo e revise oportunidades de preço.'
        : 'You closed more deals this month than in the previous one. Keep the pace and review pricing opportunities.',
      metric: `+${diagnosis.winRateLastMonth.toFixed(0)}%`,
    });
  }

  // Alerta de desaceleração
  if (diagnosis.momentum === 'desacelerando') {
    alerts.push({
      id: 'momentum_down',
      severity: 'warning',
      title: locale === 'pt-BR' ? 'Queda no volume de fechamentos' : 'Drop in closed deals',
      message: locale === 'pt-BR'
        ? 'O ritmo de vendas diminuiu. Aumente prospecção e revise as propostas abertas.'
        : 'Sales pace has slowed. Increase prospecting and review open proposals.',
    });
  }

  // Pipeline vazio
  if (open.length < 2) {
    alerts.push({
      id: 'empty_pipeline',
      severity: 'warning',
      title: locale === 'pt-BR' ? 'Pipeline fraco' : 'Weak pipeline',
      message: locale === 'pt-BR'
        ? 'Menos de 2 propostas abertas. Você precisa de mais oportunidades ativas para manter receita consistente.'
        : 'Fewer than 2 open proposals. You need more active opportunities to keep revenue consistent.',
    });
  }

  // Conversão muito baixa
  if (diagnosis.conversionRate < 15 && proposals.length >= 5) {
    alerts.push({
      id: 'low_conversion',
      severity: 'critical',
      title: locale === 'pt-BR' ? 'Conversão crítica' : 'Critical conversion rate',
      message: locale === 'pt-BR'
        ? `Apenas ${diagnosis.conversionRate.toFixed(1)}% das propostas fecham. Algo no processo ou na proposta precisa mudar.`
        : `Only ${diagnosis.conversionRate.toFixed(1)}% of proposals close. Something in the process or proposal needs to change.`,
      metric: `${diagnosis.conversionRate.toFixed(1)}%`,
    });
  }

  // Ticket abaixo do potencial
  if (diagnosis.avgTicket > 0 && diagnosis.avgTicket < 1500) {
    alerts.push({
      id: 'low_ticket',
      severity: 'info',
      title: locale === 'pt-BR' ? 'Ticket médio abaixo do potencial' : 'Average ticket below potential',
      message: locale === 'pt-BR'
        ? 'Seu ticket médio está baixo para um posicionamento premium. Revise sua precificação e seus pacotes.'
        : 'Your average ticket is low for a premium positioning. Review your pricing and packages.',
      metric: `R$${diagnosis.avgTicket.toFixed(0)}`,
    });
  }

  return alerts.slice(0, 5);
}

// ─── Dicas de desenvolvimento profissional ───────────────────────────────────

function generateDevelopmentTips(
  proposals: ProposalInput[],
  diagnosis: PipelineDiagnosis,
  locale: CopilotLocale
): DevelopmentTip[] {
  const tips: DevelopmentTip[] = [];
  const open      = proposals.filter(p => p.status !== 'vendida' && p.status !== 'cancelada');
  const sold      = proposals.filter(p => p.status === 'vendida');
  const cancelled = proposals.filter(p => p.status === 'cancelada');

  // Dica de precificação
  if (diagnosis.avgTicket < 2000 && sold.length >= 2) {
    tips.push({
      category: 'precificacao',
      title: locale === 'pt-BR' ? 'Estratégia de Âncora de Preço' : 'Price Anchor Strategy',
      insight: locale === 'pt-BR'
        ? 'Apresentar apenas um preço facilita a comparação com concorrentes. Três opções ajudam o cliente a comparar caminhos dentro da sua própria solução.'
        : 'Showing only one price makes competitor comparison easier. Three options help the client compare paths within your own solution.',
      actionable: locale === 'pt-BR'
        ? 'Crie 3 versões da sua proposta atual: essencial, recomendada e premium. Deixe claro o que muda em valor e escopo.'
        : 'Create 3 versions of your current proposal: essential, recommended, and premium. Make the value and scope differences clear.',
      priority: 'alta',
      source: 'bestpractice',
    });
  }

  // Dica de comunicação
  const avgAge = open.length > 0 ? open.reduce((s, p) => s + daysBetween(new Date(p.createdAt)), 0) / open.length : 0;
  if (avgAge > 7) {
    tips.push({
      category: 'comunicacao',
      title: locale === 'pt-BR' ? 'O follow-up que não parece cobrança' : 'The Follow-Up That Does Not Feel Like Pressure',
      insight: locale === 'pt-BR'
        ? 'Follow-ups funcionam melhor quando trazem valor novo: um insight, um exemplo relevante ou uma pergunta que reabre a conversa.'
        : 'Follow-ups work better when they bring new value: an insight, a relevant example, or a question that reopens the conversation.',
      actionable: locale === 'pt-BR'
        ? 'No próximo follow-up, comece com algo útil ao contexto do cliente antes de pedir decisão.'
        : 'In the next follow-up, start with something useful to the client context before asking for a decision.',
      priority: 'alta',
      source: 'bestpractice',
    });
  }

  // Dica de processo
  if (diagnosis.conversionRate < 35) {
    tips.push({
      category: 'processo',
      title: locale === 'pt-BR' ? 'Discovery antes de proposta' : 'Discovery Before Proposal',
      insight: locale === 'pt-BR'
        ? 'Quando a proposta sai sem discovery, o cliente pode sentir que você entendeu só o escopo, não o problema de negócio.'
        : 'When a proposal goes out without discovery, the client may feel you understood only the scope, not the business problem.',
      actionable: locale === 'pt-BR'
        ? 'Adicione uma call curta de discovery antes de propostas de maior valor ou maior incerteza.'
        : 'Add a short discovery call before higher-value or higher-uncertainty proposals.',
      priority: 'alta',
      source: 'benchmark',
    });
  }

  // Dica de posicionamento
  if (proposals.filter(p => normalize(`${p.title} ${p.description ?? ''}`).includes('desconto')).length > 0) {
    tips.push({
      category: 'posicionamento',
      title: locale === 'pt-BR' ? 'Como responder pedido de desconto' : 'How to Respond to a Discount Request',
      insight: locale === 'pt-BR'
        ? 'Desconto imediato pode enfraquecer sua percepção de valor. Manter preço e ajustar escopo preserva clareza comercial.'
        : 'An immediate discount can weaken perceived value. Holding price and adjusting scope preserves commercial clarity.',
      actionable: locale === 'pt-BR'
        ? 'Use: "Consigo ajustar o escopo para caber melhor no orçamento. Qual parte é menos prioritária para você agora?"'
        : 'Use: "I can adjust the scope to fit the budget better. Which part is less urgent for you right now?"',
      priority: 'alta',
      source: 'bestpractice',
    });
  }

  // Dica de mindset
  if (cancelled.length > sold.length) {
    tips.push({
      category: 'mindset',
      title: locale === 'pt-BR' ? 'A taxa de cancelamento não é pessoal' : 'Cancellation Rate Is Not Personal',
      insight: locale === 'pt-BR'
        ? 'Cancelamento alto geralmente aponta desalinhamento de expectativa. Descobrir o "não" mais cedo libera energia para oportunidades melhores.'
        : 'A high cancellation rate usually points to expectation mismatch. Finding the "no" earlier frees energy for better opportunities.',
      actionable: locale === 'pt-BR'
        ? 'Após cada cancelamento, pergunte com leveza: "O que poderia ter deixado essa proposta mais alinhada para você?"'
        : 'After each cancellation, ask lightly: "What would have made this proposal feel better aligned for you?"',
      priority: 'media',
      source: 'pattern',
    });
  }

  // Dica técnica de proposta
  const withoutDesc = proposals.filter(p => !p.description || p.description.length < 50).length;
  if (withoutDesc > proposals.length * 0.4) {
    tips.push({
      category: 'tecnica',
      title: locale === 'pt-BR' ? 'Propostas sem contexto perdem força' : 'Proposals Without Context Lose Strength',
      insight: locale === 'pt-BR'
        ? 'Escopo vago cria expectativa errada. Quanto mais específico, menor o risco de retrabalho e maior a confiança.'
        : 'Vague scope creates mismatched expectations. The more specific it is, the lower the rework risk and the higher the trust.',
      actionable: locale === 'pt-BR'
        ? 'Inclua em toda proposta: problema que resolve, principais entregáveis, o que não está incluído e próximo passo após aprovação.'
        : 'Include in every proposal: the problem solved, main deliverables, what is not included, and the next step after approval.',
      priority: 'media',
      source: 'bestpractice',
    });
  }

  // Dica de ciclo rápido
  if (diagnosis.avgCycledays > 10) {
    tips.push({
      category: 'processo',
      title: locale === 'pt-BR' ? 'Validade cria urgência real' : 'Expiration Creates Real Urgency',
      insight: locale === 'pt-BR'
        ? 'Propostas sem prazo tendem a virar "vejo depois". Uma validade clara ajuda a decisão sem soar agressiva.'
        : 'Proposals without a deadline tend to become "I will check later." A clear expiration helps the decision without sounding aggressive.',
      actionable: locale === 'pt-BR'
        ? 'Adicione no final: "Esta proposta é válida por 7 dias. Depois disso, revisamos escopo, agenda e valores."'
        : 'Add at the end: "This proposal is valid for 7 days. After that, we will review scope, schedule, and pricing."',
      priority: 'media',
      source: 'bestpractice',
    });
  }

  return tips.slice(0, 4);
}

// ─── Função principal exportada ───────────────────────────────────────────────

export function generateCopilotPlan(
  userId: number,
  proposals: ProposalInput[],
  acceptLanguage?: LocaleInput
): CopilotPlanResult {
  const locale = resolveCopilotLocale(acceptLanguage);
  const open = proposals.filter(p => p.status !== 'vendida' && p.status !== 'cancelada');

  const diagnosis    = diagnosePipeline(proposals, locale);
  const dashboardAlerts = generateDashboardAlerts(proposals, diagnosis, locale);
  const developmentTips = generateDevelopmentTips(proposals, diagnosis, locale);

  if (!open.length) {
    return {
      generatedAt: new Date().toISOString(),
      ritual: {
        objective: locale === 'pt-BR'
          ? 'Nenhuma proposta aberta. Foque em prospecção.'
          : 'No open proposals. Focus on prospecting.',
        maxMinutes: 10,
        mood: locale === 'pt-BR'
          ? 'Hora de abrir novas conversas.'
          : 'Time to open new conversations.',
      },
      pipelineDiagnosis: diagnosis,
      dashboardAlerts,
      developmentTips,
      primaryAction: null,
      secondaryActions: [],
      totalAnalyzed: 0,
      totalRecommended: 0,
      nextCheckIn: locale === 'pt-BR'
        ? 'Volte quando tiver novas propostas enviadas.'
        : 'Check back when you have new sent proposals.',
    };
  }

  const avgValue = open.reduce((acc, p) => acc + toNumber(p.value), 0) / open.length;
  const memory   = userMemory.get(userId) ?? [];
  const now      = Date.now();
  const memory14d = memory.filter(m => now - m.createdAt <= 14 * 86_400_000);

  const actions: CopilotAction[] = [];

  for (const proposal of open) {
    const events = detectEvents(proposal, avgValue, proposals, locale);
    if (!events.length) continue;

    const primaryEvent = events[0];
    const vitals = analyzeContractVitals(proposal, proposals, avgValue);
    const intent = mapEventToIntent(primaryEvent.type, vitals);
    const angles = chooseAngles(userId, intent, proposal.id);
    const stage  = vitals.stage;
    const value  = vitals.value;

    const baseText     = `${intent}|${angles[0]}|${proposal.clientName}|${proposal.title}`;
    const structureHash = hashLike(normalize(baseText));

    if (memory14d.some(m => m.structureHash === structureHash)) continue;

    const priorityScore = scoreOpportunity({
      value, avgValue, event: primaryEvent.type,
      daysOpen: vitals.ageInDays, stage, vitals,
    });

    const approaches = buildApproachVariants(proposal, intent, angles, vitals, primaryEvent, locale);
    const contractAnalysis = generateContractAnalysis(vitals, primaryEvent, proposal, locale);

    // Compatibilidade reversa: suggestion por tone simples
    const suggestion: Record<Tone, string> = {
      curto:       approaches.find(a => a.tone === 'curto')?.fullMessage       ?? '',
      consultivo:  approaches.find(a => a.tone === 'consultivo')?.fullMessage  ?? '',
      direto:      approaches.find(a => a.tone === 'direto')?.fullMessage      ?? '',
      empático:    approaches.find(a => a.tone === 'empático')?.fullMessage    ?? '',
      provocativo: approaches.find(a => a.tone === 'provocativo')?.fullMessage ?? '',
    };

    actions.push({
      proposalId: proposal.id,
      clientName: proposal.clientName,
      proposalTitle: proposal.title,
      stage,
      value,
      vitals,
      event: primaryEvent.type,
      intent,
      angle: angles[0],
      priorityScore,
      whyNow: primaryEvent.reason,
      riskIfIgnore: vitals.ageInDays >= 14
        ? locale === 'pt-BR'
          ? 'Risco alto de perda silenciosa. Propostas sem resposta por 14 dias precisam de retomada direta e respeitosa.'
          : 'High silent-loss risk. Proposals without a reply for 14 days need a direct and respectful re-engagement.'
        : locale === 'pt-BR'
          ? 'Perder o momentum agora pode exigir reconstruir contexto e confiança depois.'
          : 'Losing momentum now may require rebuilding context and trust later.',
      contractAnalysis,
      approaches,
      suggestion,
    });
  }

  actions.sort((a, b) => b.priorityScore - a.priorityScore);
  const topCount     = Math.max(1, Math.ceil(actions.length * 0.4));
  const shortlisted  = actions.slice(0, topCount);
  const [primaryAction, ...rest] = shortlisted;
  const secondaryActions = rest.slice(0, 3);

  // Salva memória anti-repetição
  const records = shortlisted.map(a => ({
    proposalId: a.proposalId,
    intent: a.intent,
    angle: a.angle,
    structureHash: hashLike(normalize(`${a.intent}|${a.angle}|${a.clientName}|${a.proposalTitle}`)),
    createdAt: now,
    status: 'PENDING' as const,
  }));
  userMemory.set(userId, [...memory14d, ...records].slice(-200));

  // Mood do ritual
  const moods = locale === 'pt-BR'
    ? [
        'Cada conversa bem conduzida aumenta sua clareza comercial.',
        'Consistência vence quando vira rotina simples.',
        'Uma ação hoje vale mais que dez planos amanhã.',
        'Você pode estar a uma conversa de distância do próximo fechamento.',
      ]
    : [
        'Every well-run conversation improves your sales clarity.',
        'Consistency wins when it becomes a simple routine.',
        'One action today is worth more than ten plans tomorrow.',
        'You may be one conversation away from the next close.',
      ];
  const mood = moods[Math.floor(now / 86_400_000) % moods.length];

  const nextCheckIn = actions.some(a => a.vitals.ageInDays >= 14)
    ? locale === 'pt-BR'
      ? 'Hoje — há propostas críticas que não podem esperar.'
      : 'Today — there are critical proposals that should not wait.'
    : actions.some(a => a.vitals.ageInDays >= 7)
    ? locale === 'pt-BR'
      ? 'Amanhã cedo — janela de follow-up ideal.'
      : 'Tomorrow morning — ideal follow-up window.'
    : locale === 'pt-BR'
      ? 'Em 2–3 dias — pipeline saudável, mantenha o ritmo.'
      : 'In 2–3 days — healthy pipeline, keep the pace.';

  return {
    generatedAt: new Date().toISOString(),
    ritual: {
      objective: locale === 'pt-BR'
        ? 'Execute 1 ação prioritária + 2 secundárias em até 5 minutos'
        : 'Complete 1 primary action + 2 secondary actions in up to 5 minutes',
      maxMinutes: 5,
      mood,
    },
    pipelineDiagnosis: diagnosis,
    dashboardAlerts,
    developmentTips,
    primaryAction: primaryAction ?? null,
    secondaryActions,
    totalAnalyzed: open.length,
    totalRecommended: shortlisted.length,
    nextCheckIn,
  };
}

// ─── Funções auxiliares exportadas ───────────────────────────────────────────

export function getApproachForProposal(userId: number, proposalId: number, tone: Tone) {
  const memory = userMemory.get(userId) ?? [];
  const hit = memory.find(m => m.proposalId === proposalId);
  if (!hit) return null;
  return { proposalId, tone, intent: hit.intent, angle: hit.angle };
}

export function markActionStatus(userId: number, proposalId: number, status: 'DONE' | 'DISMISSED') {
  const memory = userMemory.get(userId) ?? [];
  const idx = memory.findIndex(m => m.proposalId === proposalId);
  if (idx === -1) return false;
  memory[idx] = { ...memory[idx], status };
  userMemory.set(userId, memory);
  return true;
}

/** Retorna análise completa de um contrato específico */
export function analyzeProposal(
  userId: number,
  proposal: ProposalInput,
  allProposals: ProposalInput[],
  acceptLanguage?: LocaleInput
) {
  const locale = resolveCopilotLocale(acceptLanguage);
  const avgValue = allProposals
    .filter(p => p.status !== 'vendida' && p.status !== 'cancelada')
    .reduce((s, p) => s + toNumber(p.value), 0) / Math.max(1, allProposals.length);

  const vitals    = analyzeContractVitals(proposal, allProposals, avgValue);
  const events    = detectEvents(proposal, avgValue, allProposals, locale);
  const primaryEvent = events[0] ?? {
    type: 'VIEWED_NO_REPLY' as CopilotEventType,
    reason: locale === 'pt-BR' ? 'Proposta aguardando retorno.' : 'Proposal waiting for a reply.',
    weight: 0.5,
  };
  const intent    = mapEventToIntent(primaryEvent.type, vitals);
  const angles    = chooseAngles(userId, intent, proposal.id);
  const approaches = buildApproachVariants(proposal, intent, angles, vitals, primaryEvent, locale);
  const contractAnalysis = generateContractAnalysis(vitals, primaryEvent, proposal, locale);

  return { vitals, events, intent, angles, approaches, contractAnalysis };
}
