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

function generateContractAnalysis(vitals: ContractVitals, event: DetectedEvent, proposal: ProposalInput): string {
  const parts: string[] = [];

  parts.push(`Esta proposta está aberta há ${vitals.ageInDays} dias`);

  if (vitals.ageInDays <= 2) parts.push('— ainda dentro da janela quente de decisão.');
  else if (vitals.ageInDays <= 7) parts.push('— na zona de atenção: momentum ainda existe, mas está esfriando.');
  else if (vitals.ageInDays <= 14) parts.push('— ritmo comprometido. A probabilidade de fechar cai ~30% após 2 semanas.');
  else parts.push('— zona crítica. Estatisticamente, menos de 20% destas propostas fecham sem intervenção ativa.');

  if (vitals.isRepeatClient) parts.push(` ${proposal.clientName} já comprou de você antes — isso aumenta a chance de fechamento em até 60%.`);
  if (vitals.isHighTicket) parts.push(` Ticket acima da média: vale dedicar energia extra para não desperdiçar esta oportunidade.`);
  if (vitals.signals.includes('price_objection')) parts.push(' Sinal de resistência a preço detectado no histórico — prepare uma ancora de valor antes de retomar.');
  if (vitals.signals.includes('competitor')) parts.push(' Há sinais de concorrência ativa — velocidade de resposta é decisiva agora.');
  if (vitals.signals.includes('urgency')) parts.push(' O cliente demonstrou urgência anteriormente — use isso como alavanca.');
  if (vitals.signals.includes('decision_maker')) parts.push(' Possível ausência do decisor real — valide quem aprova antes de insistir no fechamento.');
  if (vitals.signals.includes('positive_signal')) parts.push(' Cliente já demonstrou entusiasmo — o obstáculo é provavelmente interno, não a proposta.');
  if (!vitals.hasDescription) parts.push(' Proposta com pouco contexto registrado — adicionar notas melhora a qualidade das próximas abordagens.');

  return parts.join('');
}

// ─── Detecção de eventos ──────────────────────────────────────────────────────

function detectEvents(proposal: ProposalInput, avgValue: number, allProposals: ProposalInput[]): DetectedEvent[] {
  const value = toNumber(proposal.value);
  const age = daysBetween(new Date(proposal.createdAt));
  const fullText = normalize(`${proposal.title} ${proposal.description ?? ''} ${proposal.notes ?? ''}`);
  const signals = detectTextSignals(fullText);
  const events: DetectedEvent[] = [];
  const isOpen = proposal.status !== 'vendida' && proposal.status !== 'cancelada';

  if (!isOpen) return [];

  if (age >= 3 && age < 7)  events.push({ type: 'PROPOSAL_STALE',          reason: `Proposta pendente há ${age} dias — janela de follow-up ideal.`,               weight: 0.7 });
  if (age >= 2)             events.push({ type: 'VIEWED_NO_REPLY',          reason: 'Sem resposta após contato inicial — cliente ainda não decidiu.',              weight: 0.6 });
  if (age >= 7 && age < 14) events.push({ type: 'GHOSTED',                  reason: `Cliente sem retorno há ${age} dias — intervenção necessária.`,                weight: 0.8 });
  if (age >= 14)            events.push({ type: 'GHOSTED',                  reason: `${age} dias sem resposta — risco de perda silenciosa.`,                       weight: 0.95 });
  if (signals.includes('price_objection')) events.push({ type: 'ASKED_DISCOUNT', reason: 'Sinal de objeção de preço detectado.', weight: 0.85 });
  if (signals.includes('competitor'))      events.push({ type: 'COMPETITOR_SIGNAL', reason: 'Cliente comparando com concorrentes.', weight: 0.9 });
  if (signals.includes('budget_constraint')) events.push({ type: 'BUDGET_SIGNAL', reason: 'Restrição de orçamento sinalizada.', weight: 0.8 });
  if (signals.includes('urgency'))           events.push({ type: 'URGENCY_SIGNAL', reason: 'Cliente demonstrou urgência — capitalize agora.', weight: 0.85 });
  if (signals.includes('decision_maker'))    events.push({ type: 'DECISION_MAKER_ABSENT', reason: 'Decisor pode não estar envolvido diretamente.', weight: 0.75 });
  if (signals.includes('scope_issue'))       events.push({ type: 'SCOPE_MISMATCH', reason: 'Possível desalinhamento de escopo detectado.', weight: 0.8 });
  if (value > Math.max(1500, avgValue * 1.5)) events.push({ type: 'HIGH_TICKET', reason: 'Oportunidade de ticket acima da média.', weight: 0.9 });

  const wonFromClient = allProposals.filter(p => normalize(p.clientName) === normalize(proposal.clientName) && p.status === 'vendida').length;
  if (wonFromClient > 0) events.push({ type: 'REPEAT_CLIENT', reason: `${proposal.clientName} é cliente recorrente — relacionamento ativo.`, weight: 0.95 });

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

const ANGLE_COPY: Record<CopilotAngle, { hook: string; value: string; cta: string }> = {
  SEGURANCA:          { hook: 'Quero garantir que você tome a melhor decisão aqui.',                value: 'Trabalhamos para eliminar qualquer risco do seu lado.',                           cta: 'Posso te enviar uma garantia por escrito para facilitar a aprovação?' },
  ROI:                { hook: 'Fiz uma conta rápida com base no que você me contou.',               value: 'O retorno esperado justifica o investimento em menos de {X} meses.',             cta: 'Quer que eu monte uma projeção de ROI personalizada?' },
  VELOCIDADE:         { hook: 'Tenho uma janela aberta que se encaixa perfeitamente no seu prazo.', value: 'Posso iniciar imediatamente após a confirmação.',                                cta: 'Confirma hoje e a gente já agenda o kick-off para essa semana?' },
  PROVA:              { hook: 'Tive um cliente com situação parecida com a sua.',                   value: 'Eles saíram desse projeto com {resultado concreto}.',                             cta: 'Posso te apresentar o caso completo ou conectar vocês diretamente?' },
  SIMPLICIDADE:       { hook: 'Quero simplificar isso para você.',                                  value: 'Resumindo em 2 passos: aprovação hoje, entrega em {prazo}.',                      cta: 'O que falta para a gente dar o "go" agora?' },
  URGENCIA:           { hook: 'Tenho uma última vaga no próximo ciclo.',                            value: 'Depois disso, a próxima disponibilidade é para {mês seguinte}.',                  cta: 'Confirma até hoje para eu reservar sua vaga?' },
  EXCLUSIVIDADE:      { hook: 'Essa proposta tem condições que não costumo oferecer.',              value: 'Estruturei especificamente para o que você precisa — não é um modelo genérico.',   cta: 'Faz sentido aproveitarmos isso agora?' },
  PARCERIA:           { hook: 'Penso em você como um parceiro de longo prazo, não só um projeto.',  value: 'Quero que esse trabalho gere resultado real e duradouro para você.',              cta: 'Posso te ligar em 10 minutos para alinharmos os próximos passos?' },
  RESULTADO_CONCRETO: { hook: 'Deixa eu ser bem direto sobre o que você vai ter no final.',         value: 'Ao fechar isso, você terá: {entregável 1}, {entregável 2} e {entregável 3}.',      cta: 'Isso resolve o que você precisa? Se sim, é só dar o "ok".' },
  CUSTO_DA_INACAO:    { hook: 'Quero te mostrar o que acontece se a gente não avançar agora.',     value: 'Cada semana sem isso custa {custo tangível} em {métrica relevante}.',              cta: 'Vale a pena adiar? Posso te ajudar a calcular o impacto real.' },
};

const INTENT_FRAMING: Record<CopilotIntent, string> = {
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
};

const BEST_TIME: Record<ApproachChannel, string> = {
  whatsapp:    'Terça a quinta, entre 9h–11h ou 14h–16h',
  email:       'Terça a quinta, às 8h ou 17h (abertura maior)',
  ligacao:     'Terça a quinta, entre 10h–11h30 ou 15h–17h',
  loom:        'Qualquer dia, envie de manhã para ver até o fim do dia',
  presencial:  'Agende com 2 dias de antecedência, prefira manhãs',
};

const FOLLOW_UP_IN: Record<ApproachChannel, string> = {
  whatsapp:    '24–48h sem resposta',
  email:       '48–72h sem resposta',
  ligacao:     'Se não atender, tente em outro horário no mesmo dia',
  loom:        '48h — verifique se foi assistido',
  presencial:  '24h após a reunião',
};

function buildApproachVariants(
  proposal: ProposalInput,
  intent: CopilotIntent,
  angles: CopilotAngle[],
  vitals: ContractVitals,
  primaryEvent: DetectedEvent
): ApproachVariant[] {
  const tones: Tone[] = ['curto', 'consultivo', 'direto', 'empático', 'provocativo'];

  return angles.slice(0, 5).map((angle, i) => {
    const tone   = tones[i] ?? 'direto';
    const channel = CHANNELS[i];
    const copy   = ANGLE_COPY[angle];
    const name   = proposal.clientName.split(' ')[0]; // primeiro nome

    // Abertura varia por tom
    const openings: Record<Tone, string> = {
      curto:       `Oi ${name}, tudo bem?`,
      consultivo:  `Olá ${name}, queria retomar uma conversa importante sobre a proposta que te enviei.`,
      direto:      `${name}, preciso de uma resposta sua.`,
      empático:    `Oi ${name}, sei que você está ocupado — prometo ser breve.`,
      provocativo: `${name}, e se eu te dissesse que você está deixando dinheiro na mesa?`,
    };

    // Corpo varia por ângulo
    const body = [
      copy.hook,
      copy.value.replace('{X}', '3').replace('{resultado concreto}', 'aumento de produtividade e redução de retrabalho'),
      primaryEvent.reason,
      `A estratégia aqui é ${INTENT_FRAMING[intent]}.`,
    ].join(' ');

    // CTA varia por tom
    const ctas: Record<Tone, string> = {
      curto:       copy.cta,
      consultivo:  `${copy.cta} Posso reservar 15 minutos na sua agenda?`,
      direto:      `Confirma com um "sim" e eu avanço amanhã cedo.`,
      empático:    `Sem pressão — mas me fala: ainda faz sentido para você?`,
      provocativo: `O que exatamente te impede de fechar isso hoje?`,
    };

    // Subject para email/loom
    const subjects: Record<Tone, string> = {
      curto:       `Re: ${proposal.title}`,
      consultivo:  `Próximos passos: ${proposal.title}`,
      direto:      `Decisão pendente — ${proposal.title}`,
      empático:    `${name}, uma dúvida rápida sobre a proposta`,
      provocativo: `O custo de esperar mais uma semana`,
    };

    const fullMessage = channel === 'whatsapp' || channel === 'ligacao'
      ? `${openings[tone]} ${body} ${ctas[tone]}`
      : `Assunto: ${subjects[tone]}\n\n${openings[tone]}\n\n${body}\n\n${ctas[tone]}\n\nAté logo,\n[Seu nome]`;

    return {
      tone,
      channel,
      subject: channel === 'email' || channel === 'loom' ? subjects[tone] : undefined,
      opening: openings[tone],
      body,
      cta: ctas[tone],
      fullMessage,
      bestTime: BEST_TIME[channel],
      followUpIn: FOLLOW_UP_IN[channel],
    };
  });
}

// ─── Diagnóstico do pipeline ──────────────────────────────────────────────────

function diagnosePipeline(proposals: ProposalInput[]): PipelineDiagnosis {
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
  let bottleneck = 'Nenhum gargalo crítico identificado.';
  if (conversionRate < 15)         bottleneck = 'Baixa conversão — revise a qualidade e o posicionamento das propostas.';
  else if (criticalProposals >= 3) bottleneck = 'Muitas propostas críticas (+14d) — follow-up estruturado é urgente.';
  else if (avgCycledays > 14)      bottleneck = 'Ciclo de venda longo — adicione urgência e validade às propostas.';
  else if (avgTicket < 1500)       bottleneck = 'Ticket médio baixo — revise precificação e pacotes de serviço.';

  const recommendations: string[] = [];
  if (conversionRate < 30)      recommendations.push('Implemente follow-up em 48h após envio de proposta.');
  if (avgCycledays > 10)        recommendations.push('Adicione validade de 7 dias em todas as propostas.');
  if (criticalProposals > 0)    recommendations.push(`Priorize as ${criticalProposals} proposta(s) crítica(s) ainda hoje.`);
  if (avgTicket < 2000)         recommendations.push('Crie um pacote "completo" com 30–40% de valor adicionado.');
  if (momentum === 'desacelerando') recommendations.push('Envie pelo menos 3 novas propostas esta semana.');
  if (open.length < 3)          recommendations.push('Pipeline fraco — aumente prospecção ativa para ter mais oportunidades.');

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
  diagnosis: PipelineDiagnosis
): CopilotDashboardAlert[] {
  const alerts: CopilotDashboardAlert[] = [];
  const open = proposals.filter(p => p.status !== 'vendida' && p.status !== 'cancelada');

  // Alerta crítico: proposta mais velha
  const oldest = open.sort((a, b) => daysBetween(new Date(a.createdAt)) - daysBetween(new Date(b.createdAt))).at(-1);
  if (oldest && daysBetween(new Date(oldest.createdAt)) >= 14) {
    alerts.push({
      id: `stale_${oldest.id}`,
      severity: 'critical',
      title: 'Proposta em risco de perda silenciosa',
      message: `${oldest.clientName} está há ${daysBetween(new Date(oldest.createdAt))} dias sem resposta. Probabilidade de fechar cai abaixo de 20%.`,
      actionLabel: 'Ver abordagem',
      proposalId: oldest.id,
      metric: `${daysBetween(new Date(oldest.createdAt))}d`,
    });
  }

  // Alerta de aceleração
  if (diagnosis.momentum === 'acelerando') {
    alerts.push({
      id: 'momentum_up',
      severity: 'celebration',
      title: 'Pipeline acelerando! 🚀',
      message: 'Você fechou mais negócios este mês do que no anterior. Mantenha o ritmo e considere aumentar preços.',
      metric: `+${diagnosis.winRateLastMonth.toFixed(0)}%`,
    });
  }

  // Alerta de desaceleração
  if (diagnosis.momentum === 'desacelerando') {
    alerts.push({
      id: 'momentum_down',
      severity: 'warning',
      title: 'Queda no volume de fechamentos',
      message: 'O ritmo de vendas diminuiu. Aumente prospecção e revise as propostas abertas.',
    });
  }

  // Pipeline vazio
  if (open.length < 2) {
    alerts.push({
      id: 'empty_pipeline',
      severity: 'warning',
      title: 'Pipeline fraco',
      message: 'Menos de 2 propostas abertas. Você precisa de mais oportunidades ativas para manter receita consistente.',
    });
  }

  // Conversão muito baixa
  if (diagnosis.conversionRate < 15 && proposals.length >= 5) {
    alerts.push({
      id: 'low_conversion',
      severity: 'critical',
      title: 'Conversão crítica',
      message: `Apenas ${diagnosis.conversionRate.toFixed(1)}% das propostas fecham. Algo no processo ou na proposta precisa mudar.`,
      metric: `${diagnosis.conversionRate.toFixed(1)}%`,
    });
  }

  // Ticket abaixo do potencial
  if (diagnosis.avgTicket > 0 && diagnosis.avgTicket < 1500) {
    alerts.push({
      id: 'low_ticket',
      severity: 'info',
      title: 'Ticket médio abaixo do potencial',
      message: 'Freelancers do mesmo segmento cobram em média R$2.500–R$5.000. Revise sua precificação.',
      metric: `R$${diagnosis.avgTicket.toFixed(0)}`,
    });
  }

  return alerts.slice(0, 5);
}

// ─── Dicas de desenvolvimento profissional ───────────────────────────────────

function generateDevelopmentTips(
  proposals: ProposalInput[],
  diagnosis: PipelineDiagnosis
): DevelopmentTip[] {
  const tips: DevelopmentTip[] = [];
  const open      = proposals.filter(p => p.status !== 'vendida' && p.status !== 'cancelada');
  const sold      = proposals.filter(p => p.status === 'vendida');
  const cancelled = proposals.filter(p => p.status === 'cancelada');

  // Dica de precificação
  if (diagnosis.avgTicket < 2000 && sold.length >= 2) {
    tips.push({
      category: 'precificacao',
      title: 'Estratégia de Âncora de Preço',
      insight: 'Apresentar apenas um preço faz o cliente comparar com concorrentes. Apresentar 3 opções (básico, recomendado, premium) faz ele comparar opções suas.',
      actionable: 'Crie 3 versões da sua proposta atual: 60%, 100% e 140% do valor. Apresente sempre as 3.',
      priority: 'alta',
      source: 'bestpractice',
    });
  }

  // Dica de comunicação
  const avgAge = open.length > 0 ? open.reduce((s, p) => s + daysBetween(new Date(p.createdAt)), 0) / open.length : 0;
  if (avgAge > 7) {
    tips.push({
      category: 'comunicacao',
      title: 'O follow-up que não parece follow-up',
      insight: 'A maioria dos follow-ups falha porque parecem cobrança. Os melhores trazem valor novo: um insight, um resultado de cliente similar, ou uma pergunta que abre conversa.',
      actionable: 'No seu próximo follow-up, comece com: "Vi isso e lembrei de você:" + algo relevante ao negócio do cliente.',
      priority: 'alta',
      source: 'bestpractice',
    });
  }

  // Dica de processo
  if (diagnosis.conversionRate < 35) {
    tips.push({
      category: 'processo',
      title: 'Discovery antes de proposta',
      insight: 'Propostas enviadas sem uma reunião de discovery têm 40% menos chance de fechar. O cliente precisa sentir que você entende o problema, não só o escopo.',
      actionable: 'Adicione ao seu processo: 1 call de 30 minutos antes de qualquer proposta acima de R$1.500.',
      priority: 'alta',
      source: 'benchmark',
    });
  }

  // Dica de posicionamento
  if (proposals.filter(p => normalize(`${p.title} ${p.description ?? ''}`).includes('desconto')).length > 0) {
    tips.push({
      category: 'posicionamento',
      title: 'Como responder pedido de desconto',
      insight: 'Dar desconto imediatamente sinaliza que o preço original era inflado. Manter o preço e reduzir escopo mantém sua credibilidade.',
      actionable: 'Use: "Não consigo reduzir o valor, mas posso ajustar o escopo para caber no seu orçamento. O que você pode abrir mão?" ',
      priority: 'alta',
      source: 'bestpractice',
    });
  }

  // Dica de mindset
  if (cancelled.length > sold.length) {
    tips.push({
      category: 'mindset',
      title: 'A taxa de cancelamento não é pessoal',
      insight: 'Taxa de cancelamento alta geralmente indica desalinhamento de expectativas, não qualidade do trabalho. Descobrir o "não" mais rápido também é uma vitória — libera energia para os "sins".',
      actionable: 'Após cada cancelamento, mande uma mensagem: "Entendo, sem problema. O que eu poderia ter feito diferente?" Você vai descobrir padrões valiosos.',
      priority: 'media',
      source: 'pattern',
    });
  }

  // Dica técnica de proposta
  const withoutDesc = proposals.filter(p => !p.description || p.description.length < 50).length;
  if (withoutDesc > proposals.length * 0.4) {
    tips.push({
      category: 'tecnica',
      title: 'Propostas sem contexto têm menos chance',
      insight: 'Uma proposta com escopo vago faz o cliente criar expectativas erradas. Quanto mais específico, menos retrabalho e mais confiança.',
      actionable: 'Adicione em toda proposta: problema que resolve, 3 entregáveis principais, o que NÃO está incluído, e o próximo passo após aprovação.',
      priority: 'media',
      source: 'bestpractice',
    });
  }

  // Dica de ciclo rápido
  if (diagnosis.avgCycledays > 10) {
    tips.push({
      category: 'processo',
      title: 'Validade cria urgência real',
      insight: 'Propostas sem prazo ficam em "vou ver depois" indefinidamente. Uma validade de 7 dias força a decisão sem parecer agressivo.',
      actionable: 'Adicione no final de toda proposta: "Esta proposta é válida por 7 dias. Após isso, será necessário refazer o levantamento." ',
      priority: 'media',
      source: 'bestpractice',
    });
  }

  return tips.slice(0, 4);
}

// ─── Função principal exportada ───────────────────────────────────────────────

export function generateCopilotPlan(userId: number, proposals: ProposalInput[]): CopilotPlanResult {
  const open = proposals.filter(p => p.status !== 'vendida' && p.status !== 'cancelada');

  const diagnosis    = diagnosePipeline(proposals);
  const dashboardAlerts = generateDashboardAlerts(proposals, diagnosis);
  const developmentTips = generateDevelopmentTips(proposals, diagnosis);

  if (!open.length) {
    return {
      generatedAt: new Date().toISOString(),
      ritual: {
        objective: 'Nenhuma proposta aberta. Foque em prospecção.',
        maxMinutes: 10,
        mood: 'Hora de plantar novas sementes 🌱',
      },
      pipelineDiagnosis: diagnosis,
      dashboardAlerts,
      developmentTips,
      primaryAction: null,
      secondaryActions: [],
      totalAnalyzed: 0,
      totalRecommended: 0,
      nextCheckIn: 'Volte quando tiver novas propostas enviadas.',
    };
  }

  const avgValue = open.reduce((acc, p) => acc + toNumber(p.value), 0) / open.length;
  const memory   = userMemory.get(userId) ?? [];
  const now      = Date.now();
  const memory14d = memory.filter(m => now - m.createdAt <= 14 * 86_400_000);

  const actions: CopilotAction[] = [];

  for (const proposal of open) {
    const events = detectEvents(proposal, avgValue, proposals);
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

    const approaches = buildApproachVariants(proposal, intent, angles, vitals, primaryEvent);
    const contractAnalysis = generateContractAnalysis(vitals, primaryEvent, proposal);

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
        ? 'Alta probabilidade de perda silenciosa. Clientes que não respondem em 14d raramente fecham sem intervenção direta.'
        : 'Perder o momentum agora significa recomeçar o processo de convencimento do zero.',
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
  const moods = [
    'Cada "não" te aproxima do próximo "sim" 💪',
    'Consistência bate talento quando talento não é consistente 🎯',
    'Uma ação hoje vale mais que dez planos amanhã 🚀',
    'Você está a uma conversa de distância do próximo fechamento 📞',
  ];
  const mood = moods[Math.floor(now / 86_400_000) % moods.length];

  const nextCheckIn = actions.some(a => a.vitals.ageInDays >= 14)
    ? 'Hoje — há propostas críticas que não podem esperar.'
    : actions.some(a => a.vitals.ageInDays >= 7)
    ? 'Amanhã cedo — janela de follow-up ideal.'
    : 'Em 2–3 dias — pipeline saudável, mantenha o ritmo.';

  return {
    generatedAt: new Date().toISOString(),
    ritual: {
      objective: 'Execute 1 ação prioritária + 2 secundárias em até 5 minutos',
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
export function analyzeProposal(userId: number, proposal: ProposalInput, allProposals: ProposalInput[]) {
  const avgValue = allProposals
    .filter(p => p.status !== 'vendida' && p.status !== 'cancelada')
    .reduce((s, p) => s + toNumber(p.value), 0) / Math.max(1, allProposals.length);

  const vitals    = analyzeContractVitals(proposal, allProposals, avgValue);
  const events    = detectEvents(proposal, avgValue, allProposals);
  const primaryEvent = events[0] ?? { type: 'VIEWED_NO_REPLY' as CopilotEventType, reason: 'Proposta aguardando retorno.', weight: 0.5 };
  const intent    = mapEventToIntent(primaryEvent.type, vitals);
  const angles    = chooseAngles(userId, intent, proposal.id);
  const approaches = buildApproachVariants(proposal, intent, angles, vitals, primaryEvent);
  const contractAnalysis = generateContractAnalysis(vitals, primaryEvent, proposal);

  return { vitals, events, intent, angles, approaches, contractAnalysis };
}