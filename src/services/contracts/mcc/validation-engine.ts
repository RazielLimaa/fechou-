import type { ContractClause, ContractContext, DecisionLog, EvidenceProfile, ValidationIssue } from "./domain.js";
import { LEGAL_REFERENCES } from "./catalog.js";

function nowIso() {
  return new Date().toISOString();
}

function issue(input: Omit<ValidationIssue, "blocking"> & { blocking?: boolean }): ValidationIssue {
  return { ...input, blocking: Boolean(input.blocking) };
}

function hasClause(clauses: ContractClause[], code: string) {
  return clauses.some((item) => item.clauseCode === code);
}

function clauseIntensity(clauses: ContractClause[], code: string) {
  return clauses.find((item) => item.clauseCode === code)?.style.intensity;
}

export class ValidationEngine {
  validate(
    context: ContractContext,
    clauses: ContractClause[],
    evidenceProfile: EvidenceProfile,
    seededIssues: ValidationIssue[] = [],
  ): { issues: ValidationIssue[]; decisions: DecisionLog[] } {
    const issues: ValidationIssue[] = [...seededIssues];

    if ((context.contractKind === "service_agreement" || context.contractKind === "project_statement" || context.contractKind === "saas") && !hasClause(clauses, "payment_terms")) {
      issues.push(
        issue({
          code: "missing_payment_terms",
          severity: "blocker",
          category: "financial",
          impact: "Contrato sem pagamento definido dificulta exigibilidade e prova do inadimplemento.",
          message: "Ausencia de clausula financeira essencial.",
          userMessage: "Falta dizer quanto, quando e como o cliente paga.",
          recommendation: "Inclua preco, vencimento, metodo, faturamento e consequencias de atraso.",
          legalReferences: [LEGAL_REFERENCES.cc104, LEGAL_REFERENCES.cc422],
          clauseCodes: ["payment_terms"],
          blocking: true,
        }),
      );
    }

    if (context.hasPersonalData && (!hasClause(clauses, "lgpd_roles") || !hasClause(clauses, "lgpd_security"))) {
      issues.push(
        issue({
          code: "lgpd_incomplete",
          severity: "blocker",
          category: "lgpd",
          impact: "Tratamento de dados sem papeis, finalidade e seguranca fragiliza conformidade.",
          message: "Bloco LGPD incompleto.",
          userMessage: "Como ha dados pessoais, o contrato precisa dizer quem trata, para que e com quais salvaguardas.",
          recommendation: "Inclua papeis, finalidade, base, seguranca, registros e responsabilidade.",
          legalReferences: [LEGAL_REFERENCES.lgpd6, LEGAL_REFERENCES.lgpd7, LEGAL_REFERENCES.lgpd46],
          clauseCodes: ["lgpd_roles", "lgpd_security"],
          blocking: true,
        }),
      );
    }

    if (context.hasSensitiveData && !hasClause(clauses, "lgpd_incident_response")) {
      issues.push(
        issue({
          code: "sensitive_data_without_incident_response",
          severity: "error",
          category: "lgpd",
          impact: "Dados sensiveis sem protocolo de incidente aumentam risco regulatorio.",
          message: "Dados sensiveis sem resposta a incidente.",
          userMessage: "Para dados sensiveis, falta definir como incidentes serao comunicados e tratados.",
          recommendation: "Adicione protocolo de incidente, prazo, cooperacao e preservacao de evidencias.",
          legalReferences: [LEGAL_REFERENCES.lgpd46],
          clauseCodes: ["lgpd_incident_response"],
        }),
      );
    }

    if (context.consumerContext && hasClause(clauses, "liability_cap_b2b")) {
      issues.push(
        issue({
          code: "consumer_with_b2b_liability_cap",
          severity: "blocker",
          category: "consumer",
          impact: "Limitacao empresarial pode ser abusiva em relacao de consumo.",
          message: "Clausula B2B em contrato de consumo.",
          userMessage: "Esta limitacao foi pensada para empresas e nao deve entrar automaticamente em contrato com consumidor.",
          recommendation: "Substitua por linguagem de equilibrio e responsabilidade compatibilizada com o CDC.",
          legalReferences: [LEGAL_REFERENCES.cdc51, LEGAL_REFERENCES.cdc54],
          clauseCodes: ["liability_cap_b2b"],
          blocking: true,
        }),
      );
    }

    if (context.adhesionContext && hasClause(clauses, "arbitration_clause") && !hasClause(clauses, "adhesion_highlight_notice")) {
      issues.push(
        issue({
          code: "irregular_adhesion_arbitration",
          severity: "blocker",
          category: "arbitration",
          impact: "Arbitragem em adesao pode perder eficacia sem destaque e aceite especifico.",
          message: "Arbitragem irregular em adesao.",
          userMessage: "A arbitragem precisa aparecer em destaque e ter aceite proprio.",
          recommendation: "Inclua destaque, resumo e log separado de consentimento.",
          legalReferences: [LEGAL_REFERENCES.arbitragem4, LEGAL_REFERENCES.cdc54],
          clauseCodes: ["arbitration_clause", "adhesion_highlight_notice"],
          blocking: true,
        }),
      );
    }

    if (clauseIntensity(clauses, "penalty_clause") === "strong" && (context.consumerContext || context.amountBand === "low")) {
      issues.push(
        issue({
          code: "excessive_penalty_risk",
          severity: "warning",
          category: "financial",
          impact: "Multa forte pode ser reduzida judicialmente se desproporcional.",
          message: "Risco de multa excessiva.",
          userMessage: "A multa esta forte para este contexto; se for exagerada, pode ser reduzida.",
          recommendation: "Calibre percentual, teto, gatilho e proporcionalidade.",
          legalReferences: [LEGAL_REFERENCES.cc413, LEGAL_REFERENCES.cdc51],
          clauseCodes: ["penalty_clause"],
        }),
      );
    }

    if (context.hasDeliverables && !hasClause(clauses, "deliverables_acceptance")) {
      issues.push(
        issue({
          code: "missing_acceptance_flow",
          severity: "warning",
          category: "evidence",
          impact: "Sem aceite, fica mais dificil provar entrega conforme.",
          message: "Ausencia de fluxo de aceite.",
          userMessage: "Falta um jeito objetivo de dizer quando a entrega foi aceita.",
          recommendation: "Adicione criterio de aceite, prazo de contestacao e registro do aceite.",
          legalReferences: [LEGAL_REFERENCES.cc113, LEGAL_REFERENCES.cc422],
          clauseCodes: ["deliverables_acceptance"],
        }),
      );
    }

    if (context.formRequirement === "public_deed") {
      issues.push(
        issue({
          code: "special_form_not_satisfied_by_digital_contract",
          severity: "blocker",
          category: "form",
          impact: "Assinatura digital nao substitui automaticamente forma legal especial.",
          message: "Forma especial pendente.",
          userMessage: "O contrato digital sozinho pode nao ser suficiente para esta operacao.",
          recommendation: "Encaminhe para escritura publica ou formalidade exigida antes de finalizar.",
          legalReferences: [LEGAL_REFERENCES.cc107, LEGAL_REFERENCES.cc108],
          clauseCodes: ["real_estate_form_alert"],
          blocking: true,
        }),
      );
    }

    if (context.handlesIntellectualProperty && !hasClause(clauses, "ip_license") && !hasClause(clauses, "ip_assignment")) {
      issues.push(
        issue({
          code: "missing_ip_strategy",
          severity: "error",
          category: "ip",
          impact: "Sem estrategia de propriedade intelectual, a disputa sobre titularidade fica aberta.",
          message: "Propriedade intelectual indefinida.",
          userMessage: "Falta escolher se havera licenca, cessao ou titularidade do prestador.",
          recommendation: "Defina a tese de IP antes de gerar o contrato final.",
          legalReferences: [LEGAL_REFERENCES.cc104, LEGAL_REFERENCES.cc422],
          clauseCodes: ["ip_license", "ip_assignment"],
        }),
      );
    }

    if (context.executiveTitlePriority && evidenceProfile.witnesses !== "required_for_target") {
      issues.push(
        issue({
          code: "executive_title_evidence_gap",
          severity: "warning",
          category: "evidence",
          impact: "A estrategia de executividade esta desalinhada com testemunhas e evidence pack.",
          message: "Lacuna probatoria para art. 784.",
          userMessage: "Se voce quer reforcar execucao, colete duas testemunhas e preserve o evidence pack.",
          recommendation: "Ative bloco de testemunhas e eventos de assinatura, hash e timestamp.",
          legalReferences: [LEGAL_REFERENCES.cpc784],
          clauseCodes: ["witness_block", "evidence_pack"],
        }),
      );
    }

    return {
      issues,
      decisions: [
        {
          id: `decision.validation.${Math.random().toString(36).slice(2, 10)}`,
          stage: "validation",
          actionType: "validation_completed",
          subjectType: "contract_draft",
          summary: `Validacao encontrou ${issues.length} ponto(s).`,
          rationale: "Cada issue possui categoria, impacto e recomendacao amigavel.",
          evidence: { issueCodes: issues.map((item) => item.code) },
          legalReferences: [],
          happenedAt: nowIso(),
        },
      ],
    };
  }
}
