export type CanonicalStage = 'LEAD_IN' | 'CONVERSA_ATIVA' | 'PROPOSTA_ENVIADA' | 'NEGOCIACAO' | 'GANHOU' | 'PERDEU';
export type CopilotEventType = 'PROPOSAL_STALE' | 'VIEWED_NO_REPLY' | 'ASKED_DISCOUNT' | 'GHOSTED' | 'HIGH_TICKET';
export type CopilotIntent = 'FOLLOW_UP' | 'OBJECTION_PRICE' | 'ANCHOR_PLAN' | 'CLOSE' | 'BREAKUP';
export type CopilotAngle = 'SEGURANCA' | 'ROI' | 'VELOCIDADE' | 'PROVA' | 'SIMPLICIDADE' | 'URGENCIA';
export type Tone = 'curto' | 'consultivo' | 'direto';

export type ProposalInput = {
  id: number;
  title: string;
  clientName: string;
  status: string;
  value: string;
  createdAt: Date;
  description?: string;
};

type Event = {
  type: CopilotEventType;
  reason: string;
};

type ActionRecord = {
  proposalId: number;
  intent: CopilotIntent;
  angle: CopilotAngle;
  structureHash: string;
  createdAt: number;
  status: 'PENDING' | 'DONE' | 'DISMISSED';
};

export type CopilotAction = {
  proposalId: number;
  clientName: string;
  proposalTitle: string;
  stage: CanonicalStage;
  value: number;
  event: CopilotEventType;
  intent: CopilotIntent;
  angle: CopilotAngle;
  priorityScore: number;
  whyNow: string;
  riskIfIgnore: string;
  suggestion: Record<Tone, string>;
};

const userMemory = new Map<number, ActionRecord[]>();

const ANGLES: CopilotAngle[] = ['SEGURANCA', 'ROI', 'VELOCIDADE', 'PROVA', 'SIMPLICIDADE', 'URGENCIA'];

const toNumber = (rawValue: string) => {
  if (!rawValue) return 0;
  return Number(rawValue.replace(/\./g, '').replace(',', '.')) || 0;
};

const normalize = (text: string) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

const hashLike = (text: string) => {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h.toString(16);
};

const daysBetween = (d: Date, now = new Date()) => Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86400000));

export function canonicalStageFromProposalStatus(status: string): CanonicalStage {
  if (status === 'vendida') return 'GANHOU';
  if (status === 'cancelada') return 'PERDEU';
  return 'PROPOSTA_ENVIADA';
}

function detectEvents(proposal: ProposalInput, avgValue: number): Event[] {
  const value = toNumber(proposal.value);
  const age = daysBetween(new Date(proposal.createdAt));
  const titleNorm = normalize(`${proposal.title} ${proposal.description ?? ''}`);
  const events: Event[] = [];

  if (proposal.status === 'pendente' && age >= 3) {
    events.push({ type: 'PROPOSAL_STALE', reason: `Proposta está pendente há ${age} dias.` });
  }

  if (proposal.status === 'pendente' && age >= 2) {
    events.push({ type: 'VIEWED_NO_REPLY', reason: 'Sem resposta após contato recente.' });
  }

  if (proposal.status === 'pendente' && age >= 5) {
    events.push({ type: 'GHOSTED', reason: `Cliente sem retorno há ${age} dias.` });
  }

  if (titleNorm.includes('desconto') || titleNorm.includes('barato') || titleNorm.includes('preco')) {
    events.push({ type: 'ASKED_DISCOUNT', reason: 'Sinal de objeção de preço detectado no histórico.' });
  }

  if (value > Math.max(1000, avgValue * 1.5)) {
    events.push({ type: 'HIGH_TICKET', reason: 'Oportunidade de ticket acima da média do usuário.' });
  }

  return events;
}

function mapEventToIntent(event: CopilotEventType): CopilotIntent {
  if (event === 'ASKED_DISCOUNT') return 'OBJECTION_PRICE';
  if (event === 'HIGH_TICKET') return 'ANCHOR_PLAN';
  if (event === 'GHOSTED') return 'BREAKUP';
  return 'FOLLOW_UP';
}

function chooseAngle(userId: number, intent: CopilotIntent, proposalId: number): CopilotAngle {
  const preferred: Record<CopilotIntent, CopilotAngle[]> = {
    FOLLOW_UP: ['VELOCIDADE', 'SIMPLICIDADE', 'PROVA'],
    OBJECTION_PRICE: ['ROI', 'SEGURANCA', 'PROVA'],
    ANCHOR_PLAN: ['ROI', 'PROVA', 'SEGURANCA'],
    CLOSE: ['URGENCIA', 'SIMPLICIDADE', 'SEGURANCA'],
    BREAKUP: ['URGENCIA', 'SIMPLICIDADE', 'ROI']
  };

  const memory = userMemory.get(userId) ?? [];
  const now = Date.now();
  const cooldownMs = 7 * 86400000;
  const blockedAngles = new Set(memory.filter((m) => now - m.createdAt <= cooldownMs).map((m) => m.angle));

  for (const angle of preferred[intent]) {
    if (!blockedAngles.has(angle)) return angle;
  }

  return ANGLES[proposalId % ANGLES.length];
}

function scoreOpportunity(params: { value: number; avgValue: number; event: CopilotEventType; daysOpen: number; stage: CanonicalStage }): number {
  const { value, avgValue, event, daysOpen, stage } = params;
  const valueRelative = Math.min(1, avgValue > 0 ? value / (avgValue * 2) : value / 20000);
  const timing = Math.min(1, daysOpen / 7);
  const eventWeight: Record<CopilotEventType, number> = {
    HIGH_TICKET: 1,
    ASKED_DISCOUNT: 0.85,
    PROPOSAL_STALE: 0.8,
    VIEWED_NO_REPLY: 0.7,
    GHOSTED: 0.6
  };
  const risk = event === 'GHOSTED' ? 0.9 : event === 'PROPOSAL_STALE' ? 0.75 : 0.55;
  const effortInverted = stage === 'NEGOCIACAO' || stage === 'PROPOSTA_ENVIADA' ? 0.9 : 0.6;

  const score = (0.30 * valueRelative + 0.25 * timing + 0.20 * eventWeight[event] + 0.15 * risk + 0.10 * effortInverted) * 100;
  return Math.round(score);
}

function composeMessage(input: {
  clientName: string;
  proposalTitle: string;
  intent: CopilotIntent;
  angle: CopilotAngle;
  tone: Tone;
  reason: string;
}) {
  const diag: Record<Tone, string[]> = {
    curto: ['Vi que essa proposta ficou em aberto.', 'Percebi que a conversa esfriou.'],
    consultivo: ['Analisando o histórico, parece que a decisão ficou travada.', 'Vi um sinal de indecisão nesta proposta.'],
    direto: ['Proposta parada e sem decisão.', 'Temos uma pendência clara aqui.']
  };

  const impactByAngle: Record<CopilotAngle, string> = {
    SEGURANCA: 'Dá para reduzir risco e facilitar o “sim”.',
    ROI: 'O foco agora é conectar custo com retorno real.',
    VELOCIDADE: 'Quanto mais cedo resolvermos, mais rápido vira resultado.',
    PROVA: 'Mostrar caso parecido aumenta confiança de decisão.',
    SIMPLICIDADE: 'Simplificar os próximos passos reduz fricção.',
    URGENCIA: 'Sem decisão agora, a oportunidade tende a esfriar.'
  };

  const planByIntent: Record<CopilotIntent, string> = {
    FOLLOW_UP: 'Retome com 1 pergunta objetiva de decisão.',
    OBJECTION_PRICE: 'Reancore em escopo/resultado antes de falar preço.',
    ANCHOR_PLAN: 'Apresente opção base + opção recomendada com ganho claro.',
    CLOSE: 'Peça confirmação com próximo passo e data.',
    BREAKUP: 'Faça um fechamento respeitoso com janela final de resposta.'
  };

  const ctaByTone: Record<Tone, string> = {
    curto: 'Você prefere fechar isso hoje ou te aciono na próxima semana?',
    consultivo: 'Faz sentido te enviar uma versão enxuta para decidirmos hoje?',
    direto: 'Posso considerar aprovado para iniciarmos?' 
  };

  const intro = diag[input.tone][(hashLike(input.clientName + input.proposalTitle).charCodeAt(0) || 0) % diag[input.tone].length];
  return `${intro} ${input.reason} ${impactByAngle[input.angle]} ${planByIntent[input.intent]} ${ctaByTone[input.tone]}`;
}

export function generateCopilotPlan(userId: number, proposals: ProposalInput[]) {
  const open = proposals.filter((p) => p.status !== 'vendida' && p.status !== 'cancelada');
  if (!open.length) {
    return { generatedAt: new Date().toISOString(), primaryAction: null, secondaryActions: [], totalAnalyzed: 0, totalRecommended: 0 };
  }

  const avgValue = open.reduce((acc, p) => acc + toNumber(p.value), 0) / open.length;
  const memory = userMemory.get(userId) ?? [];
  const now = Date.now();
  const memory14d = memory.filter((m) => now - m.createdAt <= 14 * 86400000);

  const actions: CopilotAction[] = [];

  for (const proposal of open) {
    const events = detectEvents(proposal, avgValue);
    if (!events.length) continue;

    const event = events[0];
    const intent = mapEventToIntent(event.type);
    const angle = chooseAngle(userId, intent, proposal.id);
    const stage = canonicalStageFromProposalStatus(proposal.status);
    const value = toNumber(proposal.value);
    const daysOpen = daysBetween(new Date(proposal.createdAt));
    const priorityScore = scoreOpportunity({ value, avgValue, event: event.type, daysOpen, stage });

    const baseText = `${intent}|${angle}|${proposal.clientName}|${proposal.title}`;
    const structureHash = hashLike(normalize(baseText));

    if (memory14d.some((m) => m.structureHash === structureHash)) {
      continue;
    }

    actions.push({
      proposalId: proposal.id,
      clientName: proposal.clientName,
      proposalTitle: proposal.title,
      stage,
      value,
      event: event.type,
      intent,
      angle,
      priorityScore,
      whyNow: event.reason,
      riskIfIgnore: 'Chance alta de a negociação esfriar e virar perda silenciosa.',
      suggestion: {
        curto: composeMessage({ clientName: proposal.clientName, proposalTitle: proposal.title, intent, angle, tone: 'curto', reason: event.reason }),
        consultivo: composeMessage({ clientName: proposal.clientName, proposalTitle: proposal.title, intent, angle, tone: 'consultivo', reason: event.reason }),
        direto: composeMessage({ clientName: proposal.clientName, proposalTitle: proposal.title, intent, angle, tone: 'direto', reason: event.reason })
      }
    });
  }

  actions.sort((a, b) => b.priorityScore - a.priorityScore);
  const topCount = Math.max(1, Math.ceil(actions.length * 0.3));
  const shortlisted = actions.slice(0, topCount);
  const [primaryAction, ...rest] = shortlisted;
  const secondaryActions = rest.slice(0, 2);

  const records = shortlisted.map((a) => ({
    proposalId: a.proposalId,
    intent: a.intent,
    angle: a.angle,
    structureHash: hashLike(normalize(`${a.intent}|${a.angle}|${a.clientName}|${a.proposalTitle}`)),
    createdAt: now,
    status: 'PENDING' as const
  }));

  userMemory.set(userId, [...memory14d, ...records].slice(-200));

  return {
    generatedAt: new Date().toISOString(),
    primaryAction: primaryAction ?? null,
    secondaryActions,
    totalAnalyzed: open.length,
    totalRecommended: shortlisted.length
  };
}

export function getApproachForProposal(userId: number, proposalId: number, tone: Tone) {
  const memory = userMemory.get(userId) ?? [];
  const hit = memory.find((m) => m.proposalId === proposalId);
  if (!hit) return null;
  return { proposalId, tone, intent: hit.intent, angle: hit.angle };
}

export function markActionStatus(userId: number, proposalId: number, status: 'DONE' | 'DISMISSED') {
  const memory = userMemory.get(userId) ?? [];
  const idx = memory.findIndex((m) => m.proposalId === proposalId);
  if (idx === -1) return false;
  memory[idx] = { ...memory[idx], status };
  userMemory.set(userId, memory);
  return true;
}
