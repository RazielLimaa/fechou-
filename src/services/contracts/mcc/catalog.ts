import type { ClauseCatalog, ClauseDependency, ClauseRule, ClauseVariant } from "./domain.js";
import type { LegalReference } from "./types.js";

function legal(sourceId: string, label: string, article: string, url: string, note: string): LegalReference {
  return { sourceId, label, article, url, note };
}

const CC = "https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm";
const CDC = "https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm";
const LGPD = "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm";
const ASSINATURAS = "https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2020/lei/l14063.htm";
const MP_2200 = "https://www.planalto.gov.br/Ccivil_03/MPV/Antigas_2001/2200-2.htm";
const CPC = "https://www.planalto.gov.br/ccivil_03/_Ato2015-2018/2015/Lei/L13105compilada.htm";
const ARBITRAGEM = "https://www.planalto.gov.br/ccivil_03/leis/l9307.htm";

export const LEGAL_REFERENCES = {
  cc104: legal("cc-104", "Codigo Civil", "art. 104", CC, "Validade do negocio juridico."),
  cc107: legal("cc-107", "Codigo Civil", "art. 107", CC, "Liberdade de forma salvo exigencia legal."),
  cc108: legal("cc-108", "Codigo Civil", "art. 108", CC, "Forma publica para certos negocios imobiliarios."),
  cc113: legal("cc-113", "Codigo Civil", "art. 113", CC, "Interpretacao por boa-fe e usos."),
  cc421a: legal("cc-421a", "Codigo Civil", "art. 421-A", CC, "Paridade e revisao excepcional em contratos civis e empresariais."),
  cc422: legal("cc-422", "Codigo Civil", "art. 422", CC, "Boa-fe e probidade."),
  cc423: legal("cc-423", "Codigo Civil", "art. 423", CC, "Ambiguidade favorece aderente."),
  cc424: legal("cc-424", "Codigo Civil", "art. 424", CC, "Renuncia antecipada abusiva em adesao."),
  cc408: legal("cc-408", "Codigo Civil", "art. 408", CC, "Clausula penal."),
  cc413: legal("cc-413", "Codigo Civil", "art. 413", CC, "Reducao judicial de multa excessiva."),
  cc478: legal("cc-478", "Codigo Civil", "art. 478", CC, "Onerosidade excessiva."),
  cdc46: legal("cdc-46", "CDC", "art. 46", CDC, "Conhecimento previo e compreensivel."),
  cdc47: legal("cdc-47", "CDC", "art. 47", CDC, "Interpretacao favoravel ao consumidor."),
  cdc51: legal("cdc-51", "CDC", "art. 51", CDC, "Clausulas abusivas nulas."),
  cdc54: legal("cdc-54", "CDC", "art. 54", CDC, "Contrato de adesao e destaque."),
  lgpd6: legal("lgpd-6", "LGPD", "art. 6", LGPD, "Principios do tratamento de dados."),
  lgpd7: legal("lgpd-7", "LGPD", "art. 7", LGPD, "Bases legais."),
  lgpd37: legal("lgpd-37", "LGPD", "art. 37", LGPD, "Registro de operacoes."),
  lgpd46: legal("lgpd-46", "LGPD", "art. 46", LGPD, "Seguranca e sigilo."),
  assinatura4: legal("lei-14063-4", "Lei 14.063/2020", "art. 4", ASSINATURAS, "Niveis de assinatura eletronica."),
  mp2200: legal("mp-2200-10", "MP 2.200-2/2001", "art. 10", MP_2200, "ICP-Brasil e outros meios de prova."),
  cpc784: legal("cpc-784", "CPC", "art. 784", CPC, "Titulo executivo extrajudicial."),
  arbitragem4: legal("arbitragem-4", "Lei de Arbitragem", "art. 4", ARBITRAGEM, "Arbitragem em contrato de adesao."),
} as const;

export const MCC_BASE_LEGAL_REFERENCES = Object.values(LEGAL_REFERENCES);

export const MCC_CLAUSE_CATALOG: ClauseCatalog[] = [
  c("parties_qualification", "Partes e qualificacao", "core", true, "strong", 10, [LEGAL_REFERENCES.cc104, LEGAL_REFERENCES.cc113], ["validity"]),
  c("object_scope", "Objeto, escopo e exclusoes", "core", true, "strong", 20, [LEGAL_REFERENCES.cc104, LEGAL_REFERENCES.cc422], ["scope"]),
  c("term_duration", "Prazo, vigencia e marcos", "execution", false, "medium", 30, [LEGAL_REFERENCES.cc422], ["duration"]),
  c("payment_terms", "Preco, faturamento e vencimentos", "financial", false, "medium", 40, [LEGAL_REFERENCES.cc104, LEGAL_REFERENCES.cc422], ["financial"]),
  c("deliverables_acceptance", "Entrega, aceite e contestacao", "execution", false, "medium", 50, [LEGAL_REFERENCES.cc113, LEGAL_REFERENCES.cdc47], ["acceptance"]),
  c("recurring_billing", "Cobranca recorrente e renovacao", "financial", false, "medium", 60, [LEGAL_REFERENCES.cc421a, LEGAL_REFERENCES.cdc46], ["recurrence"]),
  c("price_adjustment", "Reajuste e recomposicao", "financial", false, "medium", 70, [LEGAL_REFERENCES.cc478], ["reajuste"]),
  c("penalty_clause", "Clausula penal", "risk", false, "medium", 80, [LEGAL_REFERENCES.cc408, LEGAL_REFERENCES.cc413], ["penalty"]),
  c("default_interest", "Juros, correcao e mora", "financial", false, "medium", 90, [LEGAL_REFERENCES.cc408], ["default"]),
  c("collateral_guarantee", "Garantia adicional", "risk", false, "medium", 100, [LEGAL_REFERENCES.cpc784], ["guarantee"]),
  c("lgpd_roles", "LGPD, papeis e finalidades", "legal", false, "medium", 110, [LEGAL_REFERENCES.lgpd6, LEGAL_REFERENCES.lgpd7], ["privacy"]),
  c("lgpd_security", "LGPD, seguranca e registros", "legal", false, "medium", 120, [LEGAL_REFERENCES.lgpd37, LEGAL_REFERENCES.lgpd46], ["privacy"]),
  c("lgpd_incident_response", "LGPD, incidente e cooperacao", "legal", false, "strong", 130, [LEGAL_REFERENCES.lgpd46], ["privacy"]),
  c("ip_license", "Titularidade do prestador com licenca", "legal", false, "medium", 140, [LEGAL_REFERENCES.cc421a], ["ip"]),
  c("ip_assignment", "Cessao patrimonial delimitada", "legal", false, "strong", 150, [LEGAL_REFERENCES.cc104], ["ip"]),
  c("liability_cap_b2b", "Limitacao de responsabilidade B2B", "risk", false, "medium", 160, [LEGAL_REFERENCES.cc421a], ["liability"]),
  c("consumer_balance_notice", "Transparencia e equilibrio em consumo", "risk", false, "strong", 170, [LEGAL_REFERENCES.cdc46, LEGAL_REFERENCES.cdc51, LEGAL_REFERENCES.cdc54], ["consumer"]),
  c("arbitration_clause", "Clausula compromissoria", "disputes", false, "medium", 180, [LEGAL_REFERENCES.arbitragem4], ["arbitration"]),
  c("adhesion_highlight_notice", "Destaque e aceite especifico", "disputes", false, "strong", 190, [LEGAL_REFERENCES.cc423, LEGAL_REFERENCES.cc424, LEGAL_REFERENCES.cdc54], ["adhesion"]),
  c("jurisdiction_clause", "Foro e conexao territorial", "disputes", false, "medium", 200, [LEGAL_REFERENCES.cc422], ["forum"]),
  c("electronic_signature", "Assinatura eletronica", "legal", true, "medium", 210, [LEGAL_REFERENCES.assinatura4, LEGAL_REFERENCES.mp2200], ["signature"]),
  c("witness_block", "Bloco de testemunhas", "legal", false, "strong", 220, [LEGAL_REFERENCES.cpc784], ["witness"]),
  c("evidence_pack", "Pacote de evidencias", "legal", true, "medium", 230, [LEGAL_REFERENCES.assinatura4, LEGAL_REFERENCES.mp2200], ["evidence"]),
  c("real_estate_form_alert", "Alerta de forma legal especial", "legal", false, "strong", 240, [LEGAL_REFERENCES.cc107, LEGAL_REFERENCES.cc108], ["form"]),
  c("annex_matrix", "Hierarquia documental e anexos", "annexes", true, "medium", 250, [LEGAL_REFERENCES.cc113], ["annex"]),
];

function c(
  code: string,
  title: string,
  node: ClauseCatalog["node"],
  baseRequired: boolean,
  defaultIntensity: ClauseCatalog["defaultIntensity"],
  sortOrder: number,
  legalReferences: ClauseCatalog["legalReferences"],
  riskTags: string[],
): ClauseCatalog {
  return {
    id: `clause.${code}`,
    code,
    title,
    description: title,
    node,
    appliesToKinds: ["any"],
    appliesToRelationships: ["any"],
    baseRequired,
    defaultIntensity,
    sortOrder,
    legalReferences,
    riskTags,
    version: "1.0.0",
    active: true,
  };
}

export const MCC_CLAUSE_VARIANTS: ClauseVariant[] = [
  ...MCC_CLAUSE_CATALOG.map((clause) =>
    v(clause.code, clause.defaultIntensity, clause.defaultIntensity === "strong" ? "strict" : "balanced", clause.title, clause.legalReferences),
  ),
  v("penalty_clause", "light", "flexible", "Multa leve para baixa exposicao.", [LEGAL_REFERENCES.cc408, LEGAL_REFERENCES.cc413]),
  v("penalty_clause", "strong", "strict", "Multa reforcada com alerta de reducao judicial.", [LEGAL_REFERENCES.cc408, LEGAL_REFERENCES.cc413]),
  v("lgpd_roles", "strong", "strict", "Governanca LGPD reforcada.", [LEGAL_REFERENCES.lgpd6, LEGAL_REFERENCES.lgpd7]),
  v("lgpd_security", "strong", "strict", "Seguranca LGPD reforcada.", [LEGAL_REFERENCES.lgpd37, LEGAL_REFERENCES.lgpd46]),
  v("electronic_signature", "strong", "strict", "Assinatura e evidencias reforcadas.", [LEGAL_REFERENCES.assinatura4, LEGAL_REFERENCES.mp2200]),
  v("evidence_pack", "strong", "strict", "Evidence pack reforcado com logs e hash.", [LEGAL_REFERENCES.assinatura4, LEGAL_REFERENCES.mp2200, LEGAL_REFERENCES.cpc784]),
];

function v(
  clauseCode: string,
  intensity: ClauseVariant["intensity"],
  rigidity: ClauseVariant["rigidity"],
  summary: string,
  legalReferences: ClauseVariant["legalReferences"],
): ClauseVariant {
  return {
    id: `variant.${clauseCode}.${intensity}`,
    clauseCode,
    intensity,
    rigidity,
    language: intensity === "strong" && clauseCode.includes("consumer") ? "consumer_friendly" : "formal",
    summary,
    templateKey: `${clauseCode}.${intensity}`,
    guardrails: [],
    legalReferences,
    version: "1.0.0",
    active: true,
  };
}

export const MCC_CLAUSE_DEPENDENCIES: ClauseDependency[] = [
  d("deliverables_acceptance", "object_scope", "requires", "Aceite depende de escopo objetivo."),
  d("recurring_billing", "payment_terms", "requires", "Recorrencia depende de preco e vencimento."),
  d("price_adjustment", "payment_terms", "requires", "Reajuste depende da base financeira."),
  d("penalty_clause", "payment_terms", "requires", "Multa depende da obrigacao principal."),
  d("default_interest", "payment_terms", "requires", "Juros dependem de vencimento e mora."),
  d("collateral_guarantee", "penalty_clause", "reinforces", "Garantia reforca inadimplemento."),
  d("lgpd_security", "lgpd_roles", "requires", "Seguranca depende de papeis e finalidades."),
  d("lgpd_incident_response", "lgpd_security", "requires", "Incidente depende de seguranca."),
  d("ip_assignment", "ip_license", "conflicts_with", "Cessao e licenca conflitam como tese principal."),
  d("ip_license", "ip_assignment", "conflicts_with", "Licenca e cessao conflitam como tese principal."),
  {
    ...d("arbitration_clause", "adhesion_highlight_notice", "requires", "Arbitragem em adesao exige destaque."),
    condition: { kind: "fact", fact: "relationship.isAdhesion", operator: "eq", value: true },
  },
  d("witness_block", "evidence_pack", "reinforces", "Testemunhas precisam de evidence pack."),
  d("real_estate_form_alert", "electronic_signature", "reinforces", "Forma especial precisa explicar limite da assinatura."),
];

function d(
  fromClauseCode: string,
  toClauseCode: string,
  kind: ClauseDependency["kind"],
  rationale: string,
): ClauseDependency {
  return {
    id: `dep.${fromClauseCode}.${toClauseCode}.${kind}`,
    fromClauseCode,
    toClauseCode,
    kind,
    rationale,
  };
}

export const MCC_CLAUSE_RULES: ClauseRule[] = [
  r("service_minimum_structure", 100, { kind: "fact", fact: "contract.kind", operator: "in", value: ["service_agreement", "project_statement", "saas"] }, [
    select("object_scope", "strong", "Escopo delimitado evita lacuna.", true),
    select("term_duration", "medium", "Prazo e vigencia sao essenciais.", true),
    select("payment_terms", "medium", "Pagamento e vencimento sao nucleares.", true),
    select("deliverables_acceptance", "medium", "Aceite objetivo reforca prova.", true),
  ], [LEGAL_REFERENCES.cc104, LEGAL_REFERENCES.cc422]),
  r("high_value_reinforcement", 95, { kind: "fact", fact: "financial.highValue", operator: "eq", value: true }, [
    select("penalty_clause", "strong", "Alto valor pede remedio robusto."),
    select("default_interest", "medium", "Mora precisa ser previsivel."),
    select("collateral_guarantee", "medium", "Garantia reduz credito descoberto."),
    select("evidence_pack", "strong", "Valor alto exige prova forte."),
    { type: "set_evidence", reason: "Prova acompanha risco economico.", patch: { recommendedSignature: "advanced", addNotes: ["Alto valor deve usar autenticacao reforcada."] } },
    { type: "raise_risk", risk: { code: "high_value_exposure", severity: "high", title: "Exposicao economica elevada", description: "Valor alto detectado.", mitigation: "Reforcar garantias, assinatura e evidencias." } },
  ], [LEGAL_REFERENCES.cc408, LEGAL_REFERENCES.cc413, LEGAL_REFERENCES.cpc784]),
  r("personal_data_minimum", 94, { kind: "fact", fact: "data.hasPersonalData", operator: "eq", value: true }, [
    select("lgpd_roles", "medium", "Papeis e finalidades sao essenciais.", true),
    select("lgpd_security", "medium", "Seguranca e registros sao obrigatorios.", true),
    { type: "set_evidence", reason: "Tratamento de dados deve deixar rastro.", patch: { requiredEvents: [{ code: "processing_log", required: true, description: "Registro de tratamento", fields: ["operation", "actor"] }] } },
  ], [LEGAL_REFERENCES.lgpd6, LEGAL_REFERENCES.lgpd7, LEGAL_REFERENCES.lgpd37, LEGAL_REFERENCES.lgpd46]),
  r("sensitive_data_hardening", 93, { kind: "fact", fact: "data.hasSensitiveData", operator: "eq", value: true }, [
    select("lgpd_roles", "strong", "Dados sensiveis pedem governanca forte."),
    select("lgpd_security", "strong", "Dados sensiveis exigem seguranca reforcada."),
    select("lgpd_incident_response", "strong", "Resposta a incidente precisa estar contratada."),
  ], [LEGAL_REFERENCES.lgpd46]),
  r("ip_assignment_mode", 92, { kind: "fact", fact: "ip.mode", operator: "eq", value: "assignment" }, [
    select("ip_assignment", "strong", "Estrategia escolhida e cessao."),
    { type: "exclude_clause", clauseCode: "ip_license", reason: "Licenca conflita com cessao." },
  ], [LEGAL_REFERENCES.cc104]),
  r("ip_license_mode", 91, { kind: "fact", fact: "ip.mode", operator: "in", value: ["license", "provider_owned"] }, [
    select("ip_license", "medium", "Estrategia preserva titularidade e concede uso."),
    { type: "exclude_clause", clauseCode: "ip_assignment", reason: "Cessao conflita com licenca." },
  ], [LEGAL_REFERENCES.cc421a]),
  r("recurring_billing_support", 90, { kind: "fact", fact: "financial.recurringBilling", operator: "eq", value: true }, [
    select("recurring_billing", "medium", "Modelo recorrente detectado."),
    select("price_adjustment", "medium", "Contrato recorrente precisa de reajuste."),
  ], [LEGAL_REFERENCES.cc421a, LEGAL_REFERENCES.cc478]),
  r("consumer_balance", 89, { kind: "fact", fact: "relationship.kind", operator: "eq", value: "b2c" }, [
    select("consumer_balance_notice", "strong", "B2C exige destaque e equilibrio.", true),
    { type: "exclude_clause", clauseCode: "liability_cap_b2b", reason: "Limitacao B2B nao deve migrar para consumo." },
    { type: "raise_risk", legalReferences: [LEGAL_REFERENCES.cdc46, LEGAL_REFERENCES.cdc51], risk: { code: "consumer_control", severity: "high", title: "Controle de abusividade", description: "Contrato em consumo.", mitigation: "Destacar limitacoes e bloquear abuso." } },
  ], [LEGAL_REFERENCES.cdc46, LEGAL_REFERENCES.cdc51, LEGAL_REFERENCES.cdc54]),
  {
    ...r("arbitration_or_jurisdiction", 88, { kind: "fact", fact: "dispute.arbitrationRequested", operator: "eq", value: true }, [
      select("arbitration_clause", "medium", "Opcao escolhida foi arbitragem."),
    ], [LEGAL_REFERENCES.arbitragem4]),
    fallbackActions: [select("jurisdiction_clause", "medium", "Sem arbitragem, usar foro com conexao real.")],
  },
  r("adhesion_arbitration_guard", 87, { kind: "all", conditions: [{ kind: "fact", fact: "relationship.isAdhesion", operator: "eq", value: true }, { kind: "fact", fact: "dispute.arbitrationRequested", operator: "eq", value: true }] }, [
    select("adhesion_highlight_notice", "strong", "Adesao exige aceite especifico e destacado."),
    { type: "raise_issue", issue: { code: "arbitration_requires_highlight", severity: "warning", category: "arbitration", impact: "Sem aceite destacado, a clausula pode perder eficacia.", message: "Arbitragem em adesao exige destaque.", userMessage: "A arbitragem so fica forte se o fluxo colher aceite destacado.", recommendation: "Exiba a clausula em destaque e preserve log separado.", legalReferences: [LEGAL_REFERENCES.arbitragem4, LEGAL_REFERENCES.cdc54], clauseCodes: ["arbitration_clause", "adhesion_highlight_notice"] } },
  ], [LEGAL_REFERENCES.arbitragem4, LEGAL_REFERENCES.cdc54]),
  r("executive_title_priority", 86, { kind: "fact", fact: "proof.executiveTitlePriority", operator: "eq", value: true }, [
    select("witness_block", "strong", "Estrategia busca reforco executivo."),
    select("evidence_pack", "strong", "Executividade pratica depende de prova forte."),
    { type: "set_evidence", reason: "Prioridade probatoria declarada.", patch: { recommendedSignature: "advanced", witnesses: "required_for_target", executiveTitleReadiness: "strong", addNotes: ["Nao ha promessa de titulo executivo automatico."] } },
  ], [LEGAL_REFERENCES.cpc784, LEGAL_REFERENCES.assinatura4]),
  r("real_estate_form", 85, { kind: "fact", fact: "form.requiresPublicDeed", operator: "eq", value: true }, [
    select("real_estate_form_alert", "strong", "Operacao indica forma legal especial."),
    { type: "set_evidence", reason: "Assinatura qualificada reforca prova, mas nao substitui forma legal.", patch: { recommendedSignature: "qualified" } },
    { type: "raise_issue", issue: { code: "public_deed_requirement", severity: "blocker", category: "form", impact: "Formalizacao digital isolada pode ser insuficiente.", message: "Possivel exigencia de forma especial.", userMessage: "Este contrato precisa de tratamento fora do fluxo digital simples.", recommendation: "Encaminhe para escritura ou formalidade especial antes da finalizacao.", legalReferences: [LEGAL_REFERENCES.cc107, LEGAL_REFERENCES.cc108], clauseCodes: ["real_estate_form_alert"], blocking: true } },
  ], [LEGAL_REFERENCES.cc107, LEGAL_REFERENCES.cc108]),
  r("b2b_liability_cap", 80, { kind: "fact", fact: "relationship.kind", operator: "eq", value: "b2b" }, [
    select("liability_cap_b2b", "medium", "B2B simetrico admite limitacao calibrada."),
  ], [LEGAL_REFERENCES.cc421a]),
];

function r(
  code: string,
  priority: number,
  when: ClauseRule["when"],
  actions: ClauseRule["actions"],
  legalReferences: LegalReference[],
): ClauseRule {
  return {
    id: `rule.${code}`,
    code,
    name: code.replaceAll("_", " "),
    priority,
    stage: "composition",
    mandatory: priority >= 89,
    when,
    actions,
    legalReferences,
    rationale: "Regra deterministica do MCC.",
    active: true,
  };
}

function select(
  clauseCode: string,
  intensity: NonNullable<Extract<ClauseRule["actions"][number], { type: "select_clause" }>["intensity"]>,
  reason: string,
  required = false,
): Extract<ClauseRule["actions"][number], { type: "select_clause" }> {
  return { type: "select_clause", clauseCode, intensity, reason, required };
}
