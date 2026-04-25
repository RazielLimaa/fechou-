import type { ContractContext, DecisionLog, EvidenceProfile, RiskProfile } from "./domain.js";
import type { EvidenceEventRequirement, EvidenceRecommendationPatch, SignatureLevel } from "./types.js";

function nowIso() {
  return new Date().toISOString();
}

function signatureRank(level: SignatureLevel): number {
  if (level === "qualified") return 3;
  if (level === "advanced") return 2;
  return 1;
}

function dedupeEvents(events: EvidenceEventRequirement[]) {
  const map = new Map<string, EvidenceEventRequirement>();
  for (const event of events) {
    const current = map.get(event.code);
    map.set(event.code, current ? { ...current, ...event, required: current.required || event.required } : event);
  }
  return Array.from(map.values());
}

export class EvidenceEngine {
  recommend(context: ContractContext, riskProfile: RiskProfile): { evidenceProfile: EvidenceProfile; decisions: DecisionLog[] } {
    const baseEvents: EvidenceEventRequirement[] = [
      { code: "document_hash", required: true, description: "Hash do snapshot final", fields: ["algorithm", "hash"] },
      { code: "timestamp", required: true, description: "Carimbo temporal", fields: ["timestamp", "provider"] },
      { code: "acceptance_record", required: true, description: "Registro de aceite", fields: ["acceptedAt", "acceptedBy"] },
      { code: "audit_log", required: true, description: "Log append-only", fields: ["event", "actor", "occurredAt"] },
    ];

    const extraEvents: EvidenceEventRequirement[] =
      riskProfile.overall === "high" || riskProfile.overall === "critical"
        ? [
            { code: "ip_capture", required: true, description: "IP do signatario", fields: ["ip"] },
            { code: "user_agent", required: true, description: "User agent do dispositivo", fields: ["userAgent"] },
            { code: "authentication_factor", required: true, description: "Metodo de autenticacao", fields: ["method", "result"] },
          ]
        : [];

    let recommendedSignature: SignatureLevel = "simple";
    if (context.consumerContext || context.adhesionContext || context.amountBand !== "low") recommendedSignature = "advanced";
    if (context.formRequirement === "public_deed" || (context.executiveTitlePriority && context.amountBand === "high")) {
      recommendedSignature = "qualified";
    }

    const notes: string[] = [];
    if (context.formRequirement === "public_deed") notes.push("Assinatura qualificada reforca prova, mas nao substitui forma especial.");
    if (context.executiveTitlePriority) notes.push("Testemunhas reforcam a estrategia do art. 784, sem garantia absoluta.");

    const evidenceProfile: EvidenceProfile = {
      recommendedSignature,
      witnesses: context.executiveTitlePriority ? "required_for_target" : context.amountBand === "high" ? "recommended" : "not_needed",
      requiredEvents: dedupeEvents([...baseEvents, ...extraEvents]),
      captureIp: true,
      captureUserAgent: true,
      captureTimestamp: true,
      captureDocumentHash: true,
      captureAcceptanceRecord: true,
      targetExecutiveTitle: context.executiveTitlePriority,
      executiveTitleReadiness: context.executiveTitlePriority
        ? recommendedSignature === "qualified"
          ? "strong"
          : "reinforced"
        : signatureRank(recommendedSignature) >= 2
          ? "reinforced"
          : "weak",
      notes,
    };

    return {
      evidenceProfile,
      decisions: [
        {
          id: `decision.evidence.${Math.random().toString(36).slice(2, 10)}`,
          stage: "evidence",
          actionType: "evidence_profile_built",
          subjectType: "evidence_profile",
          summary: `Assinatura recomendada: ${recommendedSignature}.`,
          rationale: "A recomendacao considera risco, consumo, adesao, forma legal e valor.",
          evidence: { witnesses: evidenceProfile.witnesses, events: evidenceProfile.requiredEvents.map((item) => item.code) },
          legalReferences: [],
          happenedAt: nowIso(),
        },
      ],
    };
  }

  applyPatch(base: EvidenceProfile, patch: EvidenceRecommendationPatch): EvidenceProfile {
    const recommendedSignature =
      patch.recommendedSignature && signatureRank(patch.recommendedSignature) > signatureRank(base.recommendedSignature)
        ? patch.recommendedSignature
        : base.recommendedSignature;

    return {
      ...base,
      recommendedSignature,
      witnesses: patch.witnesses ?? base.witnesses,
      executiveTitleReadiness: patch.executiveTitleReadiness ?? base.executiveTitleReadiness,
      requiredEvents: dedupeEvents([...(base.requiredEvents ?? []), ...(patch.requiredEvents ?? [])]),
      notes: Array.from(new Set([...(base.notes ?? []), ...(patch.addNotes ?? [])])),
    };
  }
}
