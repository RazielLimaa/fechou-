import type { ContractContext, DecisionLog, RiskItem, RiskProfile, ValidationIssue } from "./domain.js";
import type { RiskSeverity } from "./types.js";
import { MCC_BASE_LEGAL_REFERENCES } from "./catalog.js";

const RISK_WEIGHT: Record<RiskSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function nowIso() {
  return new Date().toISOString();
}

function overall(items: RiskItem[]): RiskSeverity {
  return items.reduce<RiskSeverity>((current, item) => (RISK_WEIGHT[item.severity] > RISK_WEIGHT[current] ? item.severity : current), "low");
}

function dedupe(items: RiskItem[]): RiskItem[] {
  const byCode = new Map<string, RiskItem>();
  for (const item of items) {
    const current = byCode.get(item.code);
    if (!current || RISK_WEIGHT[item.severity] > RISK_WEIGHT[current.severity]) byCode.set(item.code, item);
  }
  return Array.from(byCode.values());
}

export class RiskEngine {
  assess(context: ContractContext, extraItems: RiskItem[] = [], validationIssues: ValidationIssue[] = []): { riskProfile: RiskProfile; decisions: DecisionLog[] } {
    const items: RiskItem[] = [];

    if (context.amountBand === "high") {
      items.push(risk("high_value_contract", "high", "Contrato de alto valor", "Valor elevado aumenta impacto de inadimplemento.", "Reforcar garantia, multa e prova."));
    }
    if (context.consumerContext && context.adhesionContext) {
      items.push(risk("consumer_adhesion", "high", "Consumo em adesao", "Controle de abusividade e interpretacao protetiva.", "Aplicar linguagem clara, destaque e guardrails."));
    }
    if (context.hasSensitiveData) {
      items.push(risk("sensitive_data_processing", "high", "Dados sensiveis", "Risco regulatorio e de dano aumentado.", "Usar LGPD robusta, logs e incidente."));
    }
    if (context.formRequirement === "public_deed") {
      items.push(risk("special_form_requirement", "critical", "Forma legal especial", "Fluxo digital simples pode ser insuficiente.", "Bloquear finalizacao e orientar formalidade externa."));
    }
    if (context.executiveTitlePriority) {
      items.push(risk("executive_title_expectation", "medium", "Expectativa de executividade", "A estrategia exige testemunhas e prova reforcada.", "Coletar testemunhas, hash e autenticacao."));
    }

    const validationRisks = validationIssues
      .filter((issue) => issue.blocking || issue.severity === "error")
      .map<RiskItem>((issue) => ({
        code: `validation.${issue.code}`,
        severity: issue.blocking ? "critical" : "high",
        title: issue.message,
        description: issue.impact,
        mitigation: issue.recommendation,
        source: "validation",
        legalReferences: issue.legalReferences,
      }));

    const merged = dedupe([...items, ...extraItems, ...validationRisks]);
    const riskProfile: RiskProfile = {
      overall: overall(merged),
      items: merged,
      tags: Array.from(new Set(merged.map((item) => item.code))),
    };

    return {
      riskProfile,
      decisions: [
        {
          id: `decision.risk.${Math.random().toString(36).slice(2, 10)}`,
          stage: "risk",
          actionType: "risk_assessed",
          subjectType: "risk_profile",
          summary: `Risco consolidado: ${riskProfile.overall}.`,
          rationale: "O MCC agrega contexto, regras e validacoes para explicar risco.",
          evidence: { tags: riskProfile.tags },
          legalReferences: MCC_BASE_LEGAL_REFERENCES,
          happenedAt: nowIso(),
        },
      ],
    };
  }
}

function risk(code: string, severity: RiskSeverity, title: string, description: string, mitigation: string): RiskItem {
  return { code, severity, title, description, mitigation, source: "context", legalReferences: MCC_BASE_LEGAL_REFERENCES };
}
