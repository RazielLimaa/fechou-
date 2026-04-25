import type { ContractContext, DecisionLog, MccIntakeInput } from "./domain.js";
import { MCC_BASE_LEGAL_REFERENCES } from "./catalog.js";

const HIGH_VALUE_THRESHOLD_CENTS = 10_000_000;
const MEDIUM_VALUE_THRESHOLD_CENTS = 2_000_000;

function nowIso() {
  return new Date().toISOString();
}

function decision(summary: string, rationale: string, evidence: Record<string, unknown>): DecisionLog {
  return {
    id: `decision.context.${Math.random().toString(36).slice(2, 10)}`,
    stage: "context",
    actionType: "context_interpreted",
    subjectType: "contract_context",
    summary,
    rationale,
    evidence,
    legalReferences: [],
    happenedAt: nowIso(),
  };
}

function detectContractKind(input: MccIntakeInput): ContractContext["contractKind"] {
  if (input.contractKindHint) return input.contractKindHint;
  if (input.involvesRealEstate) return "real_estate";

  const text = `${input.contractName ?? ""} ${input.freeTextSummary ?? ""} ${(input.businessContextTags ?? []).join(" ")}`.toLowerCase();
  if (text.includes("saas") || text.includes("software") || text.includes("plataforma")) return "saas";
  if (text.includes("licenca") || text.includes("license")) return "license";
  if (text.includes("nda") || text.includes("confidencial")) return "nda";
  if (text.includes("parceria") || text.includes("partnership")) return "partnership";
  if (text.includes("projeto") || input.milestoneBilling) return "project_statement";
  return "service_agreement";
}

function amountBand(amountCents: number): ContractContext["amountBand"] {
  if (amountCents >= HIGH_VALUE_THRESHOLD_CENTS) return "high";
  if (amountCents >= MEDIUM_VALUE_THRESHOLD_CENTS) return "medium";
  return "low";
}

export class ContextEngine {
  interpret(input: MccIntakeInput): { context: ContractContext; decisions: DecisionLog[] } {
    const contractKind = detectContractKind(input);
    const relationshipKind = input.relationshipKindHint ?? (input.parties.some((party) => party.isConsumer) ? "b2c" : "b2b");
    const formRequirement = input.formRequirementHint ?? (input.involvesRealEstate || contractKind === "real_estate" ? "public_deed" : "written");
    const band = amountBand(input.amount.amountCents);
    const consumerContext = relationshipKind === "b2c";
    const adhesionContext = Boolean(input.isAdhesion || input.parties.some((party) => party.isAdherent));
    const handlesIp = Boolean(input.handlesIntellectualProperty || input.sourceCodeDelivery || (input.ipMode && input.ipMode !== "none"));
    const ipMode = input.ipMode ?? (handlesIp ? "license" : "none");
    const now = nowIso();

    const facts = {
      "contract.kind": contractKind,
      "relationship.kind": relationshipKind,
      "relationship.isConsumer": consumerContext,
      "relationship.isAdhesion": adhesionContext,
      "financial.amountCents": input.amount.amountCents,
      "financial.amountBand": band,
      "financial.highValue": band === "high",
      "financial.recurringBilling": Boolean(input.recurringBilling),
      "financial.milestoneBilling": Boolean(input.milestoneBilling),
      "execution.hasDeliverables": Boolean(input.hasDeliverables),
      "data.hasPersonalData": Boolean(input.hasPersonalData),
      "data.hasSensitiveData": Boolean(input.hasSensitiveData),
      "ip.handlesIp": handlesIp,
      "ip.mode": ipMode,
      "dispute.arbitrationRequested": Boolean(input.arbitrationRequested),
      "proof.executiveTitlePriority": Boolean(input.executiveTitlePriority),
      "form.requiresPublicDeed": formRequirement === "public_deed",
      ...(input.facts ?? {}),
    };

    const context: ContractContext = {
      id: `ctx.${input.contractId ?? "draft"}.${Math.random().toString(36).slice(2, 10)}`,
      tenantId: input.tenantId,
      contractId: input.contractId,
      contractName: input.contractName,
      contractKind,
      relationshipKind,
      consumerContext,
      adhesionContext,
      amount: input.amount,
      amountBand: band,
      duration: input.duration,
      recurringBilling: Boolean(input.recurringBilling),
      milestoneBilling: Boolean(input.milestoneBilling),
      hasDeliverables: Boolean(input.hasDeliverables),
      hasPersonalData: Boolean(input.hasPersonalData),
      hasSensitiveData: Boolean(input.hasSensitiveData),
      handlesIntellectualProperty: handlesIp,
      ipMode,
      sourceCodeDelivery: Boolean(input.sourceCodeDelivery),
      arbitrationRequested: Boolean(input.arbitrationRequested),
      executiveTitlePriority: Boolean(input.executiveTitlePriority),
      involvesRealEstate: Boolean(input.involvesRealEstate),
      formRequirement,
      desiredLanguageProfile: input.desiredLanguageProfile ?? (consumerContext ? "consumer_friendly" : "formal"),
      parties: input.parties,
      facts,
      legalReferences: MCC_BASE_LEGAL_REFERENCES,
      audit: { createdAt: now, updatedAt: now, version: 1 },
    };

    return {
      context,
      decisions: [
        decision("Contexto contratual classificado.", "A classificacao orienta regras, prova, score e validacoes.", {
          contractKind,
          relationshipKind,
          adhesionContext,
          amountBand: band,
          formRequirement,
          ipMode,
        }),
      ],
    };
  }
}
