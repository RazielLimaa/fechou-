import { v5 as uuidv5 } from "uuid";

export type ClauseRiskLevel = "baixo" | "medio" | "alto";
export type ClauseStatus = "published" | "draft" | "deprecated";
export type AudienceKind = "b2b" | "b2c";
export type ContractModelKind = "saas" | "projeto" | "servico_continuado";
export type SupportLevel = "none" | "horario_comercial" | "estendido";
export type IpMode = "licenca" | "cessao" | "titularidade_prestador";
export type ClauseVolumeMode = "essential" | "balanced" | "complete" | "robust" | "custom";
export type LegalClauseCategory =
  | "institucional_governanca"
  | "escopo_entregaveis"
  | "preco_cobranca"
  | "propriedade_intelectual"
  | "confidencialidade"
  | "dados_privacidade"
  | "seguranca_evidencias"
  | "responsabilidade_garantias"
  | "rescisao_continuidade"
  | "disputas_comunicacoes"
  | "compliance_operacional";

export interface OfficialLegalSource {
  id: string;
  title: string;
  kind: "lei" | "medida_provisoria" | "guia" | "regulacao" | "jurisprudencia";
  url: string;
  note: string;
}

export interface JurisprudenceNote {
  tribunal: string;
  referencia: string;
  resumo: string;
  sourceUrl: string;
  decisionDate?: string;
}

export interface LegalClauseDefinition {
  id: string;
  slug: string;
  title: string;
  category: LegalClauseCategory;
  description: string;
  required: boolean;
  riskLevel: ClauseRiskLevel;
  appliesTo: string[];
  variablesTemplate: Record<string, string>;
  contentTemplate: string;
  jurisprudenceNotes: JurisprudenceNote[];
  version: string;
  status: ClauseStatus;
  orderIndex: number;
  professionTags: string[];
}

export interface LegalDecisionRule {
  id: string;
  priority: number;
  ifAll?: string[];
  ifAny?: string[];
  thenAdd: string[];
  thenRemove?: string[];
  rationale: string;
}

export interface RiskWarningDefinition {
  code: string;
  severity: "info" | "warning" | "critical";
  condition: string;
  message: string;
  recommendation: string;
}

export interface EvidenceEventDefinition {
  code: string;
  description: string;
  required: boolean;
  fields: string[];
}

export interface ContractBlueprintContext {
  audience: AudienceKind;
  contractModels: ContractModelKind[];
  riskLevel: ClauseRiskLevel;
  personalData: boolean;
  sensitiveData: boolean;
  sourceCodeDelivery: boolean;
  ipMode: IpMode;
  supportLevel: SupportLevel;
  subscription: boolean;
  milestoneBilling: boolean;
  includeArbitration: boolean;
  includeEscrow: boolean;
  includePortfolioUse: boolean;
  includeChargebackRule: boolean;
  includeHandOver: boolean;
  authenticationMethods: string[];
  valueBand?: "baixo" | "medio" | "alto";
  clientName?: string;
  clientDocument?: string;
  clientAddress?: string;
  providerName?: string;
  providerDocument?: string;
  providerAddress?: string;
  objectSummary?: string;
  serviceScope?: string;
  deliverablesSummary?: string;
  paymentTerms?: string;
  contractValue?: string;
  durationLabel?: string;
  executionDateLabel?: string;
  forumCityUf?: string;
  forumConnection?: string;
  supportSummary?: string;
  subprocessorSummary?: string;
  securitySummary?: string;
  clauseMode?: ClauseVolumeMode;
  targetClauseCount?: number;
}

export interface ClauseSelectionSummary {
  mode?: ClauseVolumeMode;
  requestedCount?: number;
  appliedLimit?: number;
  availableCount: number;
  selectedCount: number;
  minimumRecommendedCount: number;
  raisedToMinimum: boolean;
}

export interface ContractTemplateFieldStatus {
  key: string;
  label: string;
  section: "partes" | "contrato" | "financeiro" | "operacional" | "juridico";
  required: boolean;
  missing: boolean;
  value: string;
  placeholder: string;
  helperText: string;
}

export interface LegalBlueprintBundle {
  sources: OfficialLegalSource[];
  defaultContext: ContractBlueprintContext;
  contractModelText: string;
  catalog: LegalClauseDefinition[];
  decisionRules: LegalDecisionRule[];
  warnings: RiskWarningDefinition[];
  versioningRecommendations: string[];
  migrationRecommendations: string[];
  evidencePack: {
    exportFormats: string[];
    hashAlgorithm: string;
    appendOnlyLog: boolean;
    events: EvidenceEventDefinition[];
  };
  templateFields: ContractTemplateFieldStatus[];
  missingTemplateFields: ContractTemplateFieldStatus[];
}

const CLAUSE_NAMESPACE = "6f6ea649-67e5-4bb4-a4e4-2f1622326f17";

function clauseIdFromSlug(slug: string) {
  return uuidv5(`fechou:legal-clause:${slug}`, CLAUSE_NAMESPACE);
}

type ClauseSeed = Omit<LegalClauseDefinition, "id" | "version" | "status"> & {
  version?: string;
  status?: ClauseStatus;
};

function clause(seed: ClauseSeed): LegalClauseDefinition {
  return {
    id: clauseIdFromSlug(seed.slug),
    version: seed.version ?? "1.0.0",
    status: seed.status ?? "published",
    ...seed,
  };
}

export const OFFICIAL_LEGAL_SOURCES: OfficialLegalSource[] = [
  {
    id: "lei-14063-2020",
    title: "Lei 14.063/2020",
    kind: "lei",
    url: "https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2020/Lei/L14063.htm",
    note: "Classifica assinaturas eletrônicas e serve de referência regulatória relevante para atos eletrônicos.",
  },
  {
    id: "mp-2200-2-2001",
    title: "MP 2.200-2/2001",
    kind: "medida_provisoria",
    url: "https://www.planalto.gov.br/ccivil_03/mpv/antigas_2001/2200-2.htm",
    note: "Institui a ICP-Brasil e preserva a validade de outros meios de comprovação de autoria e integridade.",
  },
  {
    id: "lei-14879-2024",
    title: "Lei 14.879/2024",
    kind: "lei",
    url: "https://www.planalto.gov.br/ccivil_03/_Ato2023-2026/2024/Lei/L14879.htm",
    note: "Exige pertinência na eleição de foro e combate o juízo aleatório.",
  },
  {
    id: "lei-14905-2024",
    title: "Lei 14.905/2024",
    kind: "lei",
    url: "https://www.planalto.gov.br/ccivil_03/_Ato2023-2026/2024/Lei/L14905.htm",
    note: "Atualiza o tratamento de juros e atualização monetária no Código Civil.",
  },
  {
    id: "codigo-civil-compilado",
    title: "Código Civil compilado",
    kind: "lei",
    url: "https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm",
    note: "Base das regras de boa-fé, mora, cláusula penal, responsabilidade e revisão contratual.",
  },
  {
    id: "lgpd",
    title: "Lei 13.709/2018 (LGPD)",
    kind: "lei",
    url: "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm",
    note: "Define bases legais, papéis, segurança e direitos em tratamento de dados pessoais.",
  },
  {
    id: "guia-agentes-anpd",
    title: "Guia ANPD - Agentes de Tratamento e Encarregado",
    kind: "guia",
    url: "https://www.gov.br/governodigital/pt-br/privacidade-e-seguranca/outros-documentos-externos/anpd_guia_agentes_de_tratamento.pdf",
    note: "Referência prática para enquadrar controlador, operador e encarregado.",
  },
  {
    id: "guia-seguranca-anpd",
    title: "Guia ANPD - Segurança da Informação",
    kind: "guia",
    url: "https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_seguranca_da_informacao_para_atpps___defeso_eleitoral.pdf",
    note: "Orienta medidas técnicas e administrativas proporcionais para agentes de pequeno porte.",
  },
  {
    id: "resolucao-anpd-2-2022",
    title: "Resolução CD/ANPD 2/2022",
    kind: "regulacao",
    url: "https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-2-de-27-de-janeiro-de-2022",
    note: "Regulamenta a aplicação da LGPD para agentes de tratamento de pequeno porte.",
  },
  {
    id: "resolucao-anpd-4-2023",
    title: "Resolução CD/ANPD 4/2023",
    kind: "regulacao",
    url: "https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-publica-regulamento-de-dosimetria/Resolucaon4CDANPD24.02.2023.pdf",
    note: "Aprova o regulamento de dosimetria e aplicação de sanções administrativas.",
  },
];

const jurisprudence = {
  nonIcpSignature: {
    tribunal: "STJ",
    referencia: "REsp 2.197.156 / notícia de 18/03/2026",
    resumo: "Assinatura em plataforma privada pode ser válida se houver conjunto probatório suficiente sobre autoria e manifestação de vontade.",
    sourceUrl:
      "https://www.stj.jus.br/sites/portalp/Paginas/Comunicacao/Noticias/2026/18032026-Terceira-Turma-valida-emprestimo-digital-com-assinatura-em-plataforma-nao-certificada-pela-ICP-Brasil.aspx",
    decisionDate: "2026-03-18",
  } satisfies JurisprudenceNote,
  burdenConsumerSignature: {
    tribunal: "STJ",
    referencia: "Tema Repetitivo 1.061",
    resumo: "Se o consumidor impugnar a assinatura apresentada pelo fornecedor, cabe a este comprovar a autenticidade do documento.",
    sourceUrl:
      "https://processo.stj.jus.br/repetitivos/temas_repetitivos/pesquisa.jsp?novaConsulta=true&num_processo_classe=1846649&tipo_pesquisa=T",
    decisionDate: "2021-08-25",
  } satisfies JurisprudenceNote,
  liabilityCapB2b: {
    tribunal: "STJ",
    referencia: "notícia de 06/02/2024",
    resumo: "Cláusula limitativa de responsabilidade em contrato empresarial tende a ser prestigiada quando houver equilíbrio e previsibilidade.",
    sourceUrl:
      "https://www.stj.jus.br/sites/portalp/Paginas/Comunicacao/Noticias/2024/06022024-E-valida-clausula-que-limita-responsabilidade-contratual-entre-multinacional-e-representante-brasileira.aspx",
    decisionDate: "2024-02-06",
  } satisfies JurisprudenceNote,
  emailNotice: {
    tribunal: "STJ",
    referencia: "notícia de 28/02/2024",
    resumo: "Comunicação contratual por e-mail pode produzir efeitos quando houver suporte probatório idôneo.",
    sourceUrl:
      "https://www.stj.jus.br/sites/portalp/Paginas/Comunicacao/Noticias/2024/28022024-Vontade-de-rescindir-contrato-de-aluguel-pode-ser-comunicada-por-e-mail--decide-Terceira-Turma.aspx",
    decisionDate: "2024-02-28",
  } satisfies JurisprudenceNote,
  franchiseAcceptance: {
    tribunal: "STJ",
    referencia: "notícia de 12/08/2021",
    resumo: "O comportamento concludente das partes pode evidenciar aceitação válida mesmo sem assinatura formal do instrumento.",
    sourceUrl:
      "https://www.stj.jus.br/sites/portalp/Paginas/Comunicacao/Noticias/12082021-Contrato-de-franquia-nao-assinado-e-valido-se-o-comportamento-das-partes-demonstrar-aceitacao-do-negocio.aspx",
    decisionDate: "2021-08-12",
  } satisfies JurisprudenceNote,
  electronicExecutiveTitle: {
    tribunal: "STJ",
    referencia: "notícia de 28/05/2018",
    resumo: "Contrato eletrônico pode sustentar execução quando o contexto probatório lhe confere autenticidade e força documental.",
    sourceUrl:
      "https://www.stj.jus.br/sites/portalp/Paginas/Comunicacao/Noticias-antigas/2018/2018-05-28_14-23_Contrato-eletronico-com-assinatura-digital-mesmo-sem-testemunhas-e-titulo-executivo.aspx",
    decisionDate: "2018-05-28",
  } satisfies JurisprudenceNote,
  clausePenalty: {
    tribunal: "STJ",
    referencia: "REsp 1.498.484/DF",
    resumo: "A cláusula penal pode ser reduzida por equidade quando o valor se mostrar manifestamente excessivo ou o adimplemento for substancial.",
    sourceUrl:
      "https://www.stj.jus.br/websecstj/cgi/revista/REJ.cgi/ITA?dt=20190625&formato=HTML&nreg=201403066349&salvar=false&seq=1744759&tipo=0",
    decisionDate: "2019-06-25",
  } satisfies JurisprudenceNote,
  emailReceiptEvidence: {
    tribunal: "STJ",
    referencia: "notícia de 25/06/2025",
    resumo: "A prova técnica do envio e do recebimento de e-mail reforça a eficácia de notificações contratuais digitais.",
    sourceUrl:
      "https://www.stj.jus.br/sites/portalp/paginas/comunicacao/noticias/2025/25062025-notificacao-extrajudicial-por-email-e-valida-para-comprovar-atraso-do-devedor-fiduciante--decide-segunda-secao.aspx",
    decisionDate: "2025-06-25",
  } satisfies JurisprudenceNote,
};

const GOVERNANCE_CLAUSES: LegalClauseDefinition[] = [
  clause({
    slug: "partes_qualificacao",
    title: "Partes e qualificacao",
    category: "institucional_governanca",
    description: "Identifica as partes, seus representantes e dados essenciais de contato.",
    required: true,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "saas", "projeto"],
    variablesTemplate: {
      contratadaNome: "string",
      contratadaDocumento: "string",
      contratadaEndereco: "string",
      contratanteNome: "string",
      contratanteDocumento: "string",
      contratanteEndereco: "string",
    },
    contentTemplate:
      "{{contratadaNome}}, inscrita sob o documento {{contratadaDocumento}}, com endereco em {{contratadaEndereco}}, e {{contratanteNome}}, inscrito sob o documento {{contratanteDocumento}}, com endereco em {{contratanteEndereco}}, celebram o presente contrato nas condicoes abaixo.",
    jurisprudenceNotes: [],
    orderIndex: 10,
    professionTags: ["baseline"],
  }),
  clause({
    slug: "definicoes",
    title: "Definicoes",
    category: "institucional_governanca",
    description: "Reduz ambiguidades ao fixar o sentido de termos-chave.",
    required: true,
    riskLevel: "medio",
    appliesTo: ["b2b", "b2c", "saas", "projeto"],
    variablesTemplate: {
      definicoesResumo: "string",
    },
    contentTemplate:
      "Para fins deste contrato: (i) Plataforma significa {{plataformaNome}}; (ii) Servicos significa {{objetoContrato}}; (iii) Dados do Cliente significa todo dado fornecido ou gerado pelo uso da solucao; e (iv) Entregaveis significa {{definicoesResumo}}.",
    jurisprudenceNotes: [],
    orderIndex: 20,
    professionTags: ["baseline"],
  }),
  clause({
    slug: "objeto_escopo_macro",
    title: "Objeto e escopo macro",
    category: "institucional_governanca",
    description: "Delimita o proposito do contrato e o resultado pretendido.",
    required: true,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "saas", "projeto"],
    variablesTemplate: {
      objetoContrato: "string",
      escopoResumo: "string",
    },
    contentTemplate:
      "O objeto deste contrato e a prestacao de {{objetoContrato}}, limitada ao seguinte escopo: {{escopoResumo}}.",
    jurisprudenceNotes: [],
    orderIndex: 30,
    professionTags: ["baseline"],
  }),
  clause({
    slug: "hierarquia_documental",
    title: "Hierarquia de documentos",
    category: "institucional_governanca",
    description: "Define qual instrumento prevalece em caso de conflito documental.",
    required: true,
    riskLevel: "medio",
    appliesTo: ["b2b", "b2c", "saas", "projeto"],
    variablesTemplate: {
      anexosHierarquia: "string",
    },
    contentTemplate:
      "Em caso de conflito entre este contrato, anexos, ordens de servico ou politicas referidas, prevalecera a seguinte ordem: {{anexosHierarquia}}.",
    jurisprudenceNotes: [],
    orderIndex: 40,
    professionTags: ["baseline"],
  }),
  clause({
    slug: "interpretacao_boa_fe",
    title: "Interpretacao e boa-fe",
    category: "institucional_governanca",
    description: "Reflete boa-fe objetiva e interpretacao funcional do ajuste.",
    required: true,
    riskLevel: "medio",
    appliesTo: ["b2b", "b2c", "saas", "projeto"],
    variablesTemplate: {},
    contentTemplate:
      "As partes executarao e interpretarao este contrato segundo a boa-fe objetiva, a cooperacao e a funcao economica do negocio, preservando o equilibrio contratual e a utilidade pratica do objeto contratado.",
    jurisprudenceNotes: [],
    orderIndex: 50,
    professionTags: ["baseline"],
  }),
  clause({
    slug: "nao_exclusividade",
    title: "Nao exclusividade",
    category: "institucional_governanca",
    description: "Evita leitura implicita de exclusividade comercial.",
    required: false,
    riskLevel: "baixo",
    appliesTo: ["b2b", "saas", "projeto"],
    variablesTemplate: {},
    contentTemplate:
      "Este contrato nao estabelece exclusividade, salvo se houver disposicao expressa em anexo assinado pelas partes.",
    jurisprudenceNotes: [],
    orderIndex: 60,
    professionTags: ["baseline", "consultoria", "marketing", "tecnologia"],
  }),
  clause({
    slug: "subcontratacao",
    title: "Subcontratacao",
    category: "institucional_governanca",
    description: "Permite ou restringe uso de terceiros pela contratada.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "saas", "projeto"],
    variablesTemplate: {
      subcontratacaoRegra: "string",
    },
    contentTemplate:
      "A contratada podera utilizar terceiros para atividades acessorias ou especializadas, observando a seguinte regra: {{subcontratacaoRegra}}, permanecendo responsavel pela coordenacao e pela qualidade do servico.",
    jurisprudenceNotes: [],
    orderIndex: 70,
    professionTags: ["tecnologia", "consultoria", "criativo"],
  }),
];

const SCOPE_CLAUSES: LegalClauseDefinition[] = [
  clause({
    slug: "entregaveis",
    title: "Entregaveis",
    category: "escopo_entregaveis",
    description: "Torna mensuravel o resultado esperado do contrato.",
    required: true,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "projeto", "saas"],
    variablesTemplate: {
      entregaveisResumo: "string",
    },
    contentTemplate:
      "Constituem entregaveis do contrato: {{entregaveisResumo}}, observadas as exclusoes de escopo e os criterios de aceite abaixo.",
    jurisprudenceNotes: [],
    orderIndex: 80,
    professionTags: ["baseline"],
  }),
  clause({
    slug: "exclusoes_escopo",
    title: "Exclusoes de escopo",
    category: "escopo_entregaveis",
    description: "Explicita o que nao esta incluido para evitar expansao informal do escopo.",
    required: true,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "projeto", "saas"],
    variablesTemplate: {
      exclusoesEscopo: "string",
    },
    contentTemplate:
      "Nao estao incluidos neste contrato, salvo contratacao adicional expressa: {{exclusoesEscopo}}.",
    jurisprudenceNotes: [],
    orderIndex: 90,
    professionTags: ["baseline"],
  }),
  clause({
    slug: "criterios_aceite",
    title: "Criterios de aceite",
    category: "escopo_entregaveis",
    description: "Define quando a entrega e considerada aceita.",
    required: true,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "projeto", "saas"],
    variablesTemplate: {
      prazoAceiteDias: "number",
      criterioAceite: "string",
    },
    contentTemplate:
      "O contratante tera {{prazoAceiteDias}} dias corridos para verificar a entrega conforme os seguintes criterios objetivos: {{criterioAceite}}. O silencio nao implica aceite automatico quando a relacao for de consumo.",
    jurisprudenceNotes: [],
    orderIndex: 100,
    professionTags: ["baseline"],
  }),
  clause({
    slug: "aceite_automatico_b2b",
    title: "Aceite automatico por silencio qualificado",
    category: "escopo_entregaveis",
    description: "Fecha o ciclo de entrega em relacoes empresariais com prazo razoavel de revisao.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "projeto", "saas"],
    variablesTemplate: {
      prazoAceiteDias: "number",
    },
    contentTemplate:
      "Em relacoes estritamente empresariais, se o contratante nao apontar inconformidade especifica no prazo de {{prazoAceiteDias}} dias corridos apos a disponibilizacao do entregavel, o aceite sera considerado realizado para fins de faturamento e continuidade do projeto.",
    jurisprudenceNotes: [jurisprudence.franchiseAcceptance],
    orderIndex: 110,
    professionTags: ["b2b", "tecnologia", "consultoria"],
  }),
  clause({
    slug: "correcao_defeitos",
    title: "Correcao de defeitos",
    category: "escopo_entregaveis",
    description: "Distingue correcao de defeito de melhoria evolutiva.",
    required: false,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "projeto", "saas", "source_code_delivery"],
    variablesTemplate: {
      janelaCorrecaoDias: "number",
    },
    contentTemplate:
      "Defeitos reprodutiveis e diretamente vinculados ao escopo contratado, comunicados em ate {{janelaCorrecaoDias}} dias da entrega, serao corrigidos sem custo adicional. Melhorias, novas integracoes ou mudancas de requisito dependerao de novo orcamento.",
    jurisprudenceNotes: [],
    orderIndex: 120,
    professionTags: ["tecnologia"],
  }),
  clause({
    slug: "suporte_pos_entrega",
    title: "Suporte pos-entrega",
    category: "escopo_entregaveis",
    description: "Define cobertura, canal e janela de atendimento.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "b2c", "saas", "projeto", "support"],
    variablesTemplate: {
      suporteResumo: "string",
    },
    contentTemplate:
      "O suporte incluido neste contrato compreende {{suporteResumo}}. Demandas fora desse escopo serao tratadas como servico adicional.",
    jurisprudenceNotes: [],
    orderIndex: 130,
    professionTags: ["tecnologia", "consultoria"],
  }),
  clause({
    slug: "change_request",
    title: "Change request",
    category: "escopo_entregaveis",
    description: "Formaliza pedidos de mudanca com impacto em prazo e preco.",
    required: false,
    riskLevel: "alto",
    appliesTo: ["b2b", "projeto", "saas"],
    variablesTemplate: {
      fluxoChangeRequest: "string",
    },
    contentTemplate:
      "Qualquer alteracao de escopo, prazo, dependencia tecnica ou volume de entregaveis seguira o fluxo de change request: {{fluxoChangeRequest}}, com aprovacao expressa antes da execucao.",
    jurisprudenceNotes: [],
    orderIndex: 140,
    professionTags: ["tecnologia", "consultoria", "criativo"],
  }),
  clause({
    slug: "obrigacoes_cliente",
    title: "Obrigacoes do cliente",
    category: "escopo_entregaveis",
    description: "Amarra a entrega ao fornecimento de insumos pelo contratante.",
    required: true,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "saas", "projeto"],
    variablesTemplate: {
      insumosCliente: "string",
    },
    contentTemplate:
      "O contratante devera fornecer em tempo habil os seguintes insumos, acessos e aprovacoes: {{insumosCliente}}. O atraso relevante no cumprimento dessas obrigacoes suspende proporcionalmente os prazos da contratada.",
    jurisprudenceNotes: [],
    orderIndex: 150,
    professionTags: ["baseline"],
  }),
  clause({
    slug: "dependencias_tecnicas",
    title: "Dependencias tecnicas",
    category: "escopo_entregaveis",
    description: "Documenta dependencias externas e limita responsabilidade por terceiros.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "saas", "projeto", "source_code_delivery"],
    variablesTemplate: {
      dependenciasTecnicas: "string",
    },
    contentTemplate:
      "A execucao do contrato depende de {{dependenciasTecnicas}}. A contratada nao responde por indisponibilidade ou falhas causadas exclusivamente por infraestrutura, credenciais ou fornecedores controlados pelo contratante ou por terceiros independentes.",
    jurisprudenceNotes: [],
    orderIndex: 160,
    professionTags: ["tecnologia"],
  }),
  clause({
    slug: "cronograma_marcos",
    title: "Cronograma e marcos",
    category: "escopo_entregaveis",
    description: "Organiza a entrega em etapas verificaveis.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "projeto", "milestone"],
    variablesTemplate: {
      cronogramaResumo: "string",
    },
    contentTemplate:
      "O projeto seguira o cronograma e os marcos descritos a seguir: {{cronogramaResumo}}. Cada marco podera gerar faturamento, aceite parcial e replanejamento formal.",
    jurisprudenceNotes: [],
    orderIndex: 170,
    professionTags: ["projeto", "consultoria", "tecnologia"],
  }),
  clause({
    slug: "manutencao_evolutiva",
    title: "Manutencao evolutiva",
    category: "escopo_entregaveis",
    description: "Separa backlog evolutivo do escopo originalmente contratado.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "saas", "servico_continuado"],
    variablesTemplate: {
      criterioMelhoria: "string",
    },
    contentTemplate:
      "Melhorias evolutivas, novas funcionalidades e otimizacoes nao previstas no escopo inicial serao tratadas conforme o seguinte criterio: {{criterioMelhoria}}.",
    jurisprudenceNotes: [],
    orderIndex: 180,
    professionTags: ["tecnologia"],
  }),
];

const BILLING_CLAUSES: LegalClauseDefinition[] = [
  clause({
    slug: "preco_forma_pagamento",
    title: "Preco e forma de pagamento",
    category: "preco_cobranca",
    description: "Define valor contratado e estrutura basica de cobranca.",
    required: true,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "saas", "projeto"],
    variablesTemplate: {
      valorContrato: "string",
      condicoesPagamento: "string",
    },
    contentTemplate:
      "Pelos servicos descritos neste contrato, o contratante pagara o valor de {{valorContrato}}, conforme as seguintes condicoes de pagamento: {{condicoesPagamento}}.",
    jurisprudenceNotes: [],
    orderIndex: 190,
    professionTags: ["baseline"],
  }),
  clause({
    slug: "faturamento_documentos_fiscais",
    title: "Faturamento e documentos fiscais",
    category: "preco_cobranca",
    description: "Alinha emissao fiscal e recebimento.",
    required: true,
    riskLevel: "medio",
    appliesTo: ["b2b", "b2c", "saas", "projeto"],
    variablesTemplate: {
      regraFaturamento: "string",
    },
    contentTemplate:
      "A emissao de nota fiscal, recibo ou documento equivalente seguira a seguinte regra: {{regraFaturamento}}. Eventual recusa fiscal devera ser apontada de forma objetiva e imediata.",
    jurisprudenceNotes: [],
    orderIndex: 200,
    professionTags: ["baseline"],
  }),
  clause({
    slug: "reajuste_anual",
    title: "Reajuste",
    category: "preco_cobranca",
    description: "Preserva equilibrio economico em contratos recorrentes.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "b2c", "saas", "subscription"],
    variablesTemplate: {
      indiceReajuste: "string",
      reajustePeriodicidade: "string",
    },
    contentTemplate:
      "Em contratos com vigencia superior a 12 meses ou renovacao automatica, os valores poderao ser reajustados por {{indiceReajuste}} com periodicidade {{reajustePeriodicidade}}.",
    jurisprudenceNotes: [],
    orderIndex: 210,
    professionTags: ["subscription", "saas"],
  }),
  clause({
    slug: "inadimplencia_fluxo",
    title: "Inadimplencia",
    category: "preco_cobranca",
    description: "Define fluxo em caso de atraso e suspensao de obrigacoes correlatas.",
    required: true,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "saas", "projeto"],
    variablesTemplate: {
      prazoCarenciaDias: "number",
    },
    contentTemplate:
      "O atraso de pagamento superior a {{prazoCarenciaDias}} dias autoriza a adocao das medidas previstas neste contrato, sem prejuizo da cobranca dos valores vencidos, dos encargos moratorios e da suspensao proporcional de novas entregas quando juridicamente cabivel.",
    jurisprudenceNotes: [],
    orderIndex: 220,
    professionTags: ["baseline"],
  }),
  clause({
    slug: "multa_juros_correcao",
    title: "Multa, juros e correcao",
    category: "preco_cobranca",
    description: "Evita referencia vaga a juros legais e fixa parametros claros.",
    required: true,
    riskLevel: "medio",
    appliesTo: ["b2b", "b2c", "saas", "projeto"],
    variablesTemplate: {
      multaMoraPercentual: "number",
      jurosMoraPercentual: "number",
      indiceCorrecao: "string",
    },
    contentTemplate:
      "Em caso de mora, incidirao multa de {{multaMoraPercentual}}%, juros moratorios de {{jurosMoraPercentual}}% ao mes e atualizacao monetaria pelo indice {{indiceCorrecao}}, vedado o uso de referencia generica a taxa legal sem parametrizacao.",
    jurisprudenceNotes: [jurisprudence.clausePenalty],
    orderIndex: 230,
    professionTags: ["baseline"],
  }),
  clause({
    slug: "suspensao_inadimplencia",
    title: "Suspensao por falta de pagamento",
    category: "preco_cobranca",
    description: "Protege a continuidade financeira do servico recorrente.",
    required: false,
    riskLevel: "alto",
    appliesTo: ["b2b", "saas", "subscription"],
    variablesTemplate: {
      prazoSuspensaoDias: "number",
    },
    contentTemplate:
      "Nos servicos recorrentes, a contratada podera suspender o acesso a plataforma ou o atendimento apos {{prazoSuspensaoDias}} dias de inadimplencia, preservando dados e registros pelo prazo contratual de retencao.",
    jurisprudenceNotes: [],
    orderIndex: 240,
    professionTags: ["saas", "subscription"],
  }),
  clause({
    slug: "chargeback_contestacao",
    title: "Chargeback e contestacao",
    category: "preco_cobranca",
    description: "Trata disputas de cartao e meios eletronicos de pagamento.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "b2c", "saas", "subscription"],
    variablesTemplate: {
      prazoContestacaoDias: "number",
    },
    contentTemplate:
      "Em pagamentos por cartao ou carteira digital, eventual chargeback devera ser comunicado em ate {{prazoContestacaoDias}} dias e podera ensejar bloqueio preventivo do servico ate a conciliacao da divergencia documental.",
    jurisprudenceNotes: [],
    orderIndex: 250,
    professionTags: ["saas", "subscription", "ecommerce"],
  }),
  clause({
    slug: "retencoes_tributarias",
    title: "Retencoes tributarias",
    category: "preco_cobranca",
    description: "Ajusta pagamentos sujeitos a retencao fiscal.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "projeto", "servico_continuado"],
    variablesTemplate: {
      regraRetencao: "string",
    },
    contentTemplate:
      "Caso haja retencoes fiscais obrigatorias, o contratante devera observar {{regraRetencao}} e encaminhar comprovantes no prazo necessario para conciliacao contabil da contratada.",
    jurisprudenceNotes: [],
    orderIndex: 260,
    professionTags: ["b2b"],
  }),
  clause({
    slug: "despesas_reembolsaveis",
    title: "Despesas reembolsaveis",
    category: "preco_cobranca",
    description: "Regula gastos extraordinarios aprovados pelo cliente.",
    required: false,
    riskLevel: "baixo",
    appliesTo: ["b2b", "b2c", "projeto"],
    variablesTemplate: {
      regraDespesas: "string",
    },
    contentTemplate:
      "Despesas extraordinarias necessarias a execucao do contrato somente serao reembolsaveis quando previamente aprovadas, nos termos de {{regraDespesas}}.",
    jurisprudenceNotes: [],
    orderIndex: 270,
    professionTags: ["projeto", "eventos", "consultoria"],
  }),
];

const IP_CLAUSES: LegalClauseDefinition[] = [
  clause({
    slug: "titularidade_codigo_artefatos",
    title: "Titularidade de codigo e artefatos",
    category: "propriedade_intelectual",
    description: "Define a quem pertencem software, arquivos e materiais produzidos.",
    required: true,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "saas", "projeto", "source_code_delivery"],
    variablesTemplate: {
      regraTitularidade: "string",
    },
    contentTemplate:
      "A titularidade do codigo-fonte, dos artefatos e dos materiais produzidos seguira a seguinte regra: {{regraTitularidade}}, observadas as limitacoes relativas a componentes preexistentes e de terceiros.",
    jurisprudenceNotes: [],
    orderIndex: 280,
    professionTags: ["tecnologia", "criativo"],
  }),
  clause({
    slug: "licenca_saas",
    title: "Licenca de uso da plataforma",
    category: "propriedade_intelectual",
    description: "Modelo tipico SaaS sem transferencia de titularidade do software base.",
    required: false,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "saas", "subscription"],
    variablesTemplate: {
      escopoLicenca: "string",
    },
    contentTemplate:
      "A contratada concede ao contratante licenca limitada, nao exclusiva, nao transferivel e revogavel nos termos deste contrato para uso da plataforma no escopo de {{escopoLicenca}}, sem cessao da titularidade do software base.",
    jurisprudenceNotes: [],
    orderIndex: 290,
    professionTags: ["saas", "tecnologia"],
  }),
  clause({
    slug: "cessao_direitos_encomenda",
    title: "Cessao de direitos em projeto sob encomenda",
    category: "propriedade_intelectual",
    description: "Vincula a cessao ao pagamento e ao escopo contratado.",
    required: false,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "projeto", "source_code_delivery"],
    variablesTemplate: {
      escopoCessao: "string",
    },
    contentTemplate:
      "Quando houver contratacao sob encomenda com cessao expressa, os direitos patrimoniais sobre {{escopoCessao}} serao transferidos ao contratante apos a quitacao integral dos valores devidos, sem incluir ferramentas, bibliotecas e componentes preexistentes da contratada.",
    jurisprudenceNotes: [],
    orderIndex: 300,
    professionTags: ["projeto", "criativo", "tecnologia"],
  }),
  clause({
    slug: "open_source",
    title: "Componentes open source",
    category: "propriedade_intelectual",
    description: "Evita conflito entre licenca contratual e licencas de terceiros.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "saas", "projeto", "source_code_delivery"],
    variablesTemplate: {
      regraOpenSource: "string",
    },
    contentTemplate:
      "O projeto podera incorporar componentes open source ou de terceiros, sujeitos as respectivas licencas. A contratada informara, quando aplicavel, {{regraOpenSource}}.",
    jurisprudenceNotes: [],
    orderIndex: 310,
    professionTags: ["tecnologia"],
  }),
  clause({
    slug: "engenharia_reversa",
    title: "Proibicao de engenharia reversa",
    category: "propriedade_intelectual",
    description: "Protege plataforma e componentes proprietarios.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "b2c", "saas"],
    variablesTemplate: {},
    contentTemplate:
      "Salvo nas hipoteses legalmente irrenunciaveis, e vedado ao contratante descompilar, desmontar, reproduzir estrutura tecnica ou praticar engenharia reversa sobre a plataforma e seus componentes proprietarios.",
    jurisprudenceNotes: [],
    orderIndex: 320,
    professionTags: ["saas", "tecnologia"],
  }),
  clause({
    slug: "marca_portfolio",
    title: "Uso de marca e portfolio",
    category: "propriedade_intelectual",
    description: "Define quando a relacao contratual pode ser divulgada.",
    required: false,
    riskLevel: "baixo",
    appliesTo: ["b2b", "b2c", "projeto", "saas"],
    variablesTemplate: {
      portfolioRegra: "string",
    },
    contentTemplate:
      "O uso de marca, nome comercial ou mencao ao projeto em portfolio, curriculo, estudo de caso ou material comercial seguira a seguinte regra: {{portfolioRegra}}.",
    jurisprudenceNotes: [],
    orderIndex: 330,
    professionTags: ["criativo", "consultoria", "tecnologia"],
  }),
  clause({
    slug: "escrow_codigo",
    title: "Escrow ou deposito de codigo",
    category: "propriedade_intelectual",
    description: "Add-on para contratos criticos com dependencia tecnologica elevada.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "saas", "high_risk", "source_code_delivery"],
    variablesTemplate: {
      gatilhosEscrow: "string",
    },
    contentTemplate:
      "Quando contratado como add-on, o escrow ou deposito do codigo ocorrera somente nas hipoteses gatilho de {{gatilhosEscrow}}, observadas as exclusoes relativas a segredos de negocio, bibliotecas comuns e componentes de terceiros.",
    jurisprudenceNotes: [],
    orderIndex: 340,
    professionTags: ["enterprise", "tecnologia"],
  }),
];

const CONFIDENTIALITY_CLAUSES: LegalClauseDefinition[] = [
  clause({
    slug: "informacoes_confidenciais",
    title: "Informacoes confidenciais",
    category: "confidencialidade",
    description: "Define o escopo do que sera tratado como sigiloso.",
    required: true,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "saas", "projeto"],
    variablesTemplate: {},
    contentTemplate:
      "Consideram-se informacoes confidenciais todos os dados, documentos, estrategias, credenciais, materiais tecnicos e comerciais nao publicos trocados em razao deste contrato, independentemente do suporte em que estejam armazenados.",
    jurisprudenceNotes: [],
    orderIndex: 350,
    professionTags: ["baseline"],
  }),
  clause({
    slug: "uso_restrito_confidencialidade",
    title: "Uso restrito e dever de sigilo",
    category: "confidencialidade",
    description: "Limita o uso das informacoes ao objetivo do contrato.",
    required: true,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "saas", "projeto"],
    variablesTemplate: {},
    contentTemplate:
      "Cada parte utilizara as informacoes confidenciais apenas para executar este contrato, adotando o mesmo padrao de cuidado que aplica aos seus proprios segredos de negocio e vedando divulgacao a terceiros nao autorizados.",
    jurisprudenceNotes: [],
    orderIndex: 360,
    professionTags: ["baseline"],
  }),
  clause({
    slug: "prazo_sigilo",
    title: "Prazo de confidencialidade",
    category: "confidencialidade",
    description: "Mantem protecao apos o termino do vinculo contratual.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "b2c", "saas", "projeto"],
    variablesTemplate: {
      prazoSigiloAnos: "number",
    },
    contentTemplate:
      "O dever de confidencialidade permanecera vigente durante a execucao do contrato e por {{prazoSigiloAnos}} anos apos seu termino, sem prejuizo de protecao superior aplicavel por lei a segredos industriais, dados pessoais ou segredos profissionais.",
    jurisprudenceNotes: [],
    orderIndex: 370,
    professionTags: ["baseline"],
  }),
  clause({
    slug: "excecoes_confidencialidade",
    title: "Excecoes ao sigilo",
    category: "confidencialidade",
    description: "Evita vedacao absoluta incompativel com obrigacoes legais.",
    required: false,
    riskLevel: "baixo",
    appliesTo: ["b2b", "b2c", "saas", "projeto"],
    variablesTemplate: {},
    contentTemplate:
      "O dever de sigilo nao se aplica a informacoes comprovadamente publicas, legitimamente ja conhecidas pela parte receptora, obtidas de terceiro autorizado ou exigidas por lei, ordem administrativa ou judicial, hipotese em que a parte afetada devera ser avisada quando possivel.",
    jurisprudenceNotes: [],
    orderIndex: 380,
    professionTags: ["baseline"],
  }),
];

const DATA_CLAUSES: LegalClauseDefinition[] = [
  clause({
    slug: "papeis_lgpd",
    title: "Papeis das partes na LGPD",
    category: "dados_privacidade",
    description: "Define se as partes atuam como controladoras ou controlador/operador.",
    required: false,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "dados_pessoais", "saas", "projeto"],
    variablesTemplate: {
      papelDados: "string",
      finalidadeDados: "string",
    },
    contentTemplate:
      "No contexto deste contrato, as partes atuarao como {{papelDados}} para as finalidades de {{finalidadeDados}}, observando os principios e deveres previstos na LGPD.",
    jurisprudenceNotes: [],
    orderIndex: 390,
    professionTags: ["dados", "tecnologia", "baseline"],
  }),
  clause({
    slug: "dpa_operador",
    title: "Tratamento por conta do cliente (DPA simplificado)",
    category: "dados_privacidade",
    description: "Regula tratamento de dados por operador em SaaS B2B.",
    required: false,
    riskLevel: "alto",
    appliesTo: ["b2b", "saas", "dados_pessoais"],
    variablesTemplate: {
      instrucoesTratamento: "string",
    },
    contentTemplate:
      "Quando a contratada atuar como operadora, tratara os dados pessoais apenas conforme as instrucoes documentadas do contratante descritas em {{instrucoesTratamento}}, vedado o uso autonomo incompativel com o objeto do contrato.",
    jurisprudenceNotes: [],
    orderIndex: 400,
    professionTags: ["saas", "dados", "tecnologia"],
  }),
  clause({
    slug: "medidas_seguranca",
    title: "Medidas de seguranca",
    category: "dados_privacidade",
    description: "Estabelece um piso de diligencia tecnica e administrativa.",
    required: false,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "dados_pessoais", "saas", "projeto"],
    variablesTemplate: {
      medidasSegurancaResumo: "string",
    },
    contentTemplate:
      "A parte que tratar dados pessoais adotara medidas tecnicas e administrativas adequadas ao risco, incluindo {{medidasSegurancaResumo}}, sem prometer risco zero ou imunidade absoluta contra incidentes.",
    jurisprudenceNotes: [],
    orderIndex: 410,
    professionTags: ["dados", "tecnologia", "baseline"],
  }),
  clause({
    slug: "suboperadores",
    title: "Suboperadores e terceiros de apoio",
    category: "dados_privacidade",
    description: "Documenta uso de cloud, e-mail, analytics e outras camadas terceiras.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "dados_pessoais", "saas"],
    variablesTemplate: {
      suboperadoresResumo: "string",
    },
    contentTemplate:
      "A contratada podera utilizar suboperadores e prestadores de apoio essenciais a operacao, tais como {{suboperadoresResumo}}, desde que compativeis com a finalidade do tratamento e sujeitos a deveres contratuais adequados.",
    jurisprudenceNotes: [],
    orderIndex: 420,
    professionTags: ["saas", "dados", "tecnologia"],
  }),
  clause({
    slug: "incidentes_seguranca",
    title: "Incidentes de seguranca",
    category: "dados_privacidade",
    description: "Cria gatilho de resposta e comunicacao a incidentes.",
    required: false,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "dados_pessoais", "saas", "high_risk"],
    variablesTemplate: {
      prazoIncidenteHoras: "number",
    },
    contentTemplate:
      "A parte responsavel pelo ambiente afetado notificara a outra parte sem demora injustificada e, sempre que viavel, em ate {{prazoIncidenteHoras}} horas apos tomar conhecimento de incidente relevante que possa comprometer dados pessoais, integridade documental ou continuidade do servico.",
    jurisprudenceNotes: [],
    orderIndex: 430,
    professionTags: ["dados", "tecnologia", "baseline"],
  }),
  clause({
    slug: "retencao_descarte",
    title: "Retencao e descarte",
    category: "dados_privacidade",
    description: "Organiza retencao minima, descarte e anonimização.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "b2c", "dados_pessoais", "saas", "projeto"],
    variablesTemplate: {
      prazoRetencao: "string",
    },
    contentTemplate:
      "Os dados pessoais e evidencias contratuais serao retidos pelo periodo de {{prazoRetencao}}, salvo prazo superior imposto por lei, exercicio regular de direitos ou necessidade tecnica justificada, com posterior descarte seguro ou anonimização quando aplicavel.",
    jurisprudenceNotes: [],
    orderIndex: 440,
    professionTags: ["dados", "baseline"],
  }),
  clause({
    slug: "exportacao_dados",
    title: "Exportacao e portabilidade operacional",
    category: "dados_privacidade",
    description: "Previne aprisionamento excessivo do cliente em SaaS.",
    required: false,
    riskLevel: "alto",
    appliesTo: ["b2b", "saas", "dados_pessoais", "subscription"],
    variablesTemplate: {
      janelaExportacaoDias: "number",
      formatoExportacao: "string",
    },
    contentTemplate:
      "Durante a vigencia e por {{janelaExportacaoDias}} dias apos o termino, o contratante podera solicitar exportacao dos seus dados e documentos em {{formatoExportacao}}, observadas limitacoes tecnicas razoaveis e protecao de segredos de negocio da contratada.",
    jurisprudenceNotes: [],
    orderIndex: 450,
    professionTags: ["saas", "dados", "tecnologia"],
  }),
  clause({
    slug: "canal_titular",
    title: "Canal do titular e cooperacao regulatoria",
    category: "dados_privacidade",
    description: "Ajuda a operacionalizar direitos do titular e deveres regulatorios.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "b2c", "dados_pessoais"],
    variablesTemplate: {
      canalPrivacidade: "string",
    },
    contentTemplate:
      "As solicitacoes relativas a direitos do titular, privacidade e protecao de dados serao tratadas pelo canal {{canalPrivacidade}}, com cooperacao razoavel entre as partes quando houver compartilhamento de responsabilidades.",
    jurisprudenceNotes: [],
    orderIndex: 460,
    professionTags: ["dados", "baseline"],
  }),
];

const EVIDENCE_CLAUSES: LegalClauseDefinition[] = [
  clause({
    slug: "logs_auditoria",
    title: "Logs e trilha de auditoria",
    category: "seguranca_evidencias",
    description: "Consolida base minima de prova tecnica exportavel.",
    required: true,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "saas", "projeto", "assinatura_eletronica"],
    variablesTemplate: {
      eventosAuditados: "string",
    },
    contentTemplate:
      "Serao registrados e preservados, em formato tecnicamente exportavel, os seguintes eventos minimos: {{eventosAuditados}}, com marcacao temporal, identificacao do agente e integridade verificavel quando disponivel.",
    jurisprudenceNotes: [jurisprudence.electronicExecutiveTitle],
    orderIndex: 470,
    professionTags: ["baseline", "tecnologia"],
  }),
  clause({
    slug: "integridade_hash_timestamp",
    title: "Integridade documental, hash e carimbo do tempo",
    category: "seguranca_evidencias",
    description: "Cria camada adicional de prova de integridade para contratos relevantes.",
    required: false,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "saas", "projeto", "high_risk", "assinatura_eletronica"],
    variablesTemplate: {
      algoritmoHash: "string",
      timestampProvider: "string",
    },
    contentTemplate:
      "A versao final do contrato podera ser consolidada com hash {{algoritmoHash}} e, quando contratado ou exigido pelo risco da operacao, carimbo do tempo emitido por {{timestampProvider}} ou tecnologia equivalente de comprovacao temporal.",
    jurisprudenceNotes: [jurisprudence.nonIcpSignature],
    orderIndex: 480,
    professionTags: ["baseline", "tecnologia", "enterprise"],
  }),
  clause({
    slug: "assinatura_eletronica_validade",
    title: "Assinatura eletronica, validade e metodo adotado",
    category: "seguranca_evidencias",
    description: "Reconhece o metodo de assinatura e o arranjo probatorio aplicavel.",
    required: true,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "saas", "projeto", "assinatura_eletronica"],
    variablesTemplate: {
      metodoAssinatura: "string",
    },
    contentTemplate:
      "As partes reconhecem a validade juridica da assinatura eletronica realizada por {{metodoAssinatura}}, inclusive quando nao baseada em certificado ICP-Brasil, desde que acompanhada de elementos idoneos de autenticacao, integridade e manifestacao de vontade.",
    jurisprudenceNotes: [jurisprudence.nonIcpSignature],
    orderIndex: 490,
    professionTags: ["baseline", "tecnologia"],
  }),
  clause({
    slug: "autenticacao_signatario",
    title: "Autenticacao do signatario",
    category: "seguranca_evidencias",
    description: "Eleva o nivel probatorio conforme risco e valor da operacao.",
    required: false,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "assinatura_eletronica", "high_risk"],
    variablesTemplate: {
      metodosAutenticacao: "string",
    },
    contentTemplate:
      "O processo de assinatura podera exigir autenticacao por {{metodosAutenticacao}}, de forma proporcional ao risco do contrato, ao perfil das partes e a criticidade da operacao.",
    jurisprudenceNotes: [jurisprudence.burdenConsumerSignature],
    orderIndex: 500,
    professionTags: ["baseline", "tecnologia"],
  }),
  clause({
    slug: "politica_evidencias",
    title: "Pacote de evidencias exportavel",
    category: "seguranca_evidencias",
    description: "Define conteudo minimo do evidence pack.",
    required: true,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "saas", "projeto", "assinatura_eletronica"],
    variablesTemplate: {},
    contentTemplate:
      "Sempre que tecnicamente disponivel, a plataforma manterá pacote de evidencias exportavel contendo historico do documento, registros de assinatura, metadados de autenticacao, hashes, IP, user agent, carimbos temporais e referencias de versao do conteudo apresentado ao signatario.",
    jurisprudenceNotes: [jurisprudence.burdenConsumerSignature, jurisprudence.nonIcpSignature],
    orderIndex: 510,
    professionTags: ["baseline", "tecnologia"],
  }),
];

const LIABILITY_CLAUSES: LegalClauseDefinition[] = [
  clause({
    slug: "limitacao_responsabilidade_b2b",
    title: "Limitacao de responsabilidade em B2B",
    category: "responsabilidade_garantias",
    description: "Cap de responsabilidade tipico para contratos empresariais equilibrados.",
    required: false,
    riskLevel: "alto",
    appliesTo: ["b2b", "saas", "projeto"],
    variablesTemplate: {
      limiteResponsabilidade: "string",
    },
    contentTemplate:
      "Em relacoes empresariais, a responsabilidade total da contratada por perdas e danos decorrentes deste contrato limita-se a {{limiteResponsabilidade}}, ressalvados os casos excluidos por carve-out especifico.",
    jurisprudenceNotes: [jurisprudence.liabilityCapB2b],
    orderIndex: 520,
    professionTags: ["b2b", "tecnologia", "consultoria"],
  }),
  clause({
    slug: "exclusao_danos_indiretos",
    title: "Exclusao de danos indiretos",
    category: "responsabilidade_garantias",
    description: "Reduz exposicao a lucros cessantes e danos reflexos quando juridicamente admitido.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "saas", "projeto"],
    variablesTemplate: {},
    contentTemplate:
      "Salvo dolo, fraude ou hipoteses legalmente irrenunciaveis, a contratada nao respondera por danos indiretos, lucros cessantes, perda de oportunidade, dano reputacional ou interrupcao de negocios do contratante.",
    jurisprudenceNotes: [jurisprudence.liabilityCapB2b],
    orderIndex: 530,
    professionTags: ["b2b", "tecnologia"],
  }),
  clause({
    slug: "carve_outs",
    title: "Carve-outs da limitacao",
    category: "responsabilidade_garantias",
    description: "Mantem equilibrio juridico ao excluir hipoteses graves do cap.",
    required: true,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "saas", "projeto"],
    variablesTemplate: {
      excecoesResponsabilidade: "string",
    },
    contentTemplate:
      "As limitacoes de responsabilidade previstas neste contrato nao se aplicam a {{excecoesResponsabilidade}}, nem as demais hipoteses em que a lei vede exclusao ou restricao de responsabilidade.",
    jurisprudenceNotes: [jurisprudence.liabilityCapB2b],
    orderIndex: 540,
    professionTags: ["baseline"],
  }),
  clause({
    slug: "indenizacao_ip",
    title: "Indenizacao por violacao de propriedade intelectual",
    category: "responsabilidade_garantias",
    description: "Disciplina defesa e mitigacao em alegacoes de infracao a direitos de terceiros.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "saas", "projeto", "source_code_delivery"],
    variablesTemplate: {
      regraDefesaIP: "string",
    },
    contentTemplate:
      "Em alegacoes de violacao de propriedade intelectual decorrentes do uso regular do objeto contratado, as partes cooperarao conforme {{regraDefesaIP}}, excluidas hipoteses causadas por conteudo, instrucoes ou materiais fornecidos pelo contratante.",
    jurisprudenceNotes: [],
    orderIndex: 550,
    professionTags: ["tecnologia", "criativo"],
  }),
  clause({
    slug: "garantias_declaracoes",
    title: "Garantias e declaracoes",
    category: "responsabilidade_garantias",
    description: "Organiza promessas minimas sem gerar garantia absoluta de resultado.",
    required: true,
    riskLevel: "medio",
    appliesTo: ["b2b", "b2c", "saas", "projeto"],
    variablesTemplate: {
      padraoPrestacao: "string",
    },
    contentTemplate:
      "A contratada declara que executara os servicos com diligencia compativel com {{padraoPrestacao}}. Salvo previsao expressa, nao ha garantia de resultado economico, lucro, aprovacao regulatoria ou desempenho comercial especifico.",
    jurisprudenceNotes: [],
    orderIndex: 560,
    professionTags: ["baseline"],
  }),
  clause({
    slug: "sla_uptime",
    title: "SLA e disponibilidade",
    category: "responsabilidade_garantias",
    description: "Define compromisso objetivo de disponibilidade para SaaS.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "b2c", "saas", "subscription"],
    variablesTemplate: {
      slaDisponibilidade: "string",
    },
    contentTemplate:
      "Nos servicos em nuvem, a contratada envidara esforcos para manter disponibilidade mensal de {{slaDisponibilidade}}, excluidos eventos de manutencao programada, forca maior e falhas de terceiros fora do seu controle razoavel.",
    jurisprudenceNotes: [],
    orderIndex: 570,
    professionTags: ["saas", "tecnologia"],
  }),
  clause({
    slug: "forca_maior",
    title: "Forca maior",
    category: "responsabilidade_garantias",
    description: "Afasta responsabilizacao por eventos externos inevitaveis.",
    required: true,
    riskLevel: "baixo",
    appliesTo: ["b2b", "b2c", "saas", "projeto"],
    variablesTemplate: {},
    contentTemplate:
      "Nenhuma parte respondera por atraso ou inadimplemento causado por evento de forca maior ou caso fortuito, desde que comunique a ocorrencia e adote medidas razoaveis para mitigar os efeitos do evento.",
    jurisprudenceNotes: [],
    orderIndex: 580,
    professionTags: ["baseline"],
  }),
  clause({
    slug: "uso_adequado_plataforma",
    title: "Uso adequado da plataforma",
    category: "responsabilidade_garantias",
    description: "Distribui responsabilidades sobre uso indevido, credenciais e conteudo do cliente.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "b2c", "saas"],
    variablesTemplate: {},
    contentTemplate:
      "O contratante devera utilizar a plataforma conforme a lei, este contrato e a documentacao de uso, sendo responsavel por credenciais, atos de usuarios autorizados e conteudos inseridos sob sua conta, salvo falha comprovada de seguranca imputavel a contratada.",
    jurisprudenceNotes: [],
    orderIndex: 590,
    professionTags: ["saas", "tecnologia"],
  }),
  clause({
    slug: "clausula_penal_calibrada",
    title: "Clausula penal calibrada",
    category: "responsabilidade_garantias",
    description: "Evita multa desconectada da funcao do contrato e do inadimplemento.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "b2c", "projeto", "subscription"],
    variablesTemplate: {
      multaRescisoriaPercentual: "number",
    },
    contentTemplate:
      "Quando aplicavel, a clausula penal sera fixada em {{multaRescisoriaPercentual}}% sobre a base contratual pertinente, observada proporcionalidade com o inadimplemento e possibilidade de reducao equitativa nos termos da lei.",
    jurisprudenceNotes: [jurisprudence.clausePenalty],
    orderIndex: 600,
    professionTags: ["baseline"],
  }),
];

const TERMINATION_CLAUSES: LegalClauseDefinition[] = [
  clause({
    slug: "rescisao_imotivada",
    title: "Rescisao imotivada",
    category: "rescisao_continuidade",
    description: "Organiza saida ordinaria do contrato sem litigio desnecessario.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "b2c", "saas", "subscription", "servico_continuado"],
    variablesTemplate: {
      avisoPrevioDias: "number",
    },
    contentTemplate:
      "Qualquer parte podera rescindir o contrato sem motivacao especifica mediante aviso previo escrito de {{avisoPrevioDias}} dias, permanecendo devidos os valores ja vencidos e os servicos efetivamente prestados ate a data de termino.",
    jurisprudenceNotes: [],
    orderIndex: 610,
    professionTags: ["baseline"],
  }),
  clause({
    slug: "rescisao_inadimplemento",
    title: "Rescisao por inadimplemento",
    category: "rescisao_continuidade",
    description: "Preve prazo de cura e gatilho para resolucao contratual.",
    required: true,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "saas", "projeto"],
    variablesTemplate: {
      prazoCuraDias: "number",
    },
    contentTemplate:
      "O descumprimento contratual relevante autoriza a parte adimplente a notificar a parte infratora para sanar a irregularidade em ate {{prazoCuraDias}} dias, sob pena de rescisao motivada, sem prejuizo das medidas de cobranca e indenizacao cabiveis.",
    jurisprudenceNotes: [],
    orderIndex: 620,
    professionTags: ["baseline"],
  }),
  clause({
    slug: "multa_rescisao",
    title: "Multa por rescisao antecipada",
    category: "rescisao_continuidade",
    description: "Compensa custos de mobilizacao e quebra abrupta do ciclo do contrato.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "b2c", "projeto", "subscription"],
    variablesTemplate: {
      multaRescisoriaPercentual: "number",
    },
    contentTemplate:
      "A rescisao antecipada sem causa, quando aplicavel ao modelo economico do contrato, sujeita a parte resiliente a multa de {{multaRescisoriaPercentual}}% sobre a parcela remanescente pertinente, sem prejuizo do pagamento do que ja tiver sido executado.",
    jurisprudenceNotes: [jurisprudence.clausePenalty],
    orderIndex: 630,
    professionTags: ["projeto", "subscription"],
  }),
  clause({
    slug: "pagamento_proporcional",
    title: "Pagamento proporcional ao executado",
    category: "rescisao_continuidade",
    description: "Evita enriquecimento sem causa no encerramento do projeto.",
    required: true,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "projeto", "milestone"],
    variablesTemplate: {},
    contentTemplate:
      "Na hipotese de encerramento antecipado, permanecem exigiveis os valores proporcionais ao trabalho ja executado, as licencas ja utilizadas e as despesas validamente assumidas para atendimento do contrato.",
    jurisprudenceNotes: [],
    orderIndex: 640,
    professionTags: ["baseline", "projeto"],
  }),
  clause({
    slug: "transicao_handover",
    title: "Transicao e handover",
    category: "rescisao_continuidade",
    description: "Ajuda a desmobilizar o contrato sem ruptura operacional abrupta.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "saas", "projeto", "high_risk"],
    variablesTemplate: {
      regraHandover: "string",
    },
    contentTemplate:
      "Quando contratado ou necessario a continuidade operacional, a contratada prestara handover conforme {{regraHandover}}, mediante escopo, prazo e preco compativeis com o esforco adicional.",
    jurisprudenceNotes: [],
    orderIndex: 650,
    professionTags: ["saas", "tecnologia", "enterprise"],
  }),
  clause({
    slug: "continuidade_acesso_dados",
    title: "Continuidade e acesso a dados",
    category: "rescisao_continuidade",
    description: "Garante janela minima de retirada de dados e documentos.",
    required: false,
    riskLevel: "alto",
    appliesTo: ["b2b", "saas", "dados_pessoais", "subscription"],
    variablesTemplate: {
      janelaExportacaoDias: "number",
    },
    contentTemplate:
      "Encerrado o contrato, a contratada preservara os dados e documentos do contratante pelo prazo operacional de {{janelaExportacaoDias}} dias para fins de exportacao, regularizacao financeira e auditoria, apos o qual podera proceder ao descarte seguro conforme sua politica de retencao.",
    jurisprudenceNotes: [],
    orderIndex: 660,
    professionTags: ["saas", "dados", "tecnologia"],
  }),
  clause({
    slug: "sobrevivencia_obrigacoes",
    title: "Sobrevivencia de obrigacoes",
    category: "rescisao_continuidade",
    description: "Mantem vigentes obrigacoes que naturalmente sobrevivem ao termino.",
    required: true,
    riskLevel: "medio",
    appliesTo: ["b2b", "b2c", "saas", "projeto"],
    variablesTemplate: {},
    contentTemplate:
      "Permanecerao em vigor apos o termino do contrato as obrigacoes de confidencialidade, propriedade intelectual, auditoria de evidencias, pagamentos pendentes, responsabilidade por atos preteritos e protecao de dados na extensao legal e contratualmente cabivel.",
    jurisprudenceNotes: [],
    orderIndex: 670,
    professionTags: ["baseline"],
  }),
];

const DISPUTE_CLAUSES: LegalClauseDefinition[] = [
  clause({
    slug: "foro_pertinente_b2b",
    title: "Eleicao de foro com pertinencia",
    category: "disputas_comunicacoes",
    description: "Adequa a clausula de foro a redacao introduzida pela Lei 14.879/2024.",
    required: true,
    riskLevel: "alto",
    appliesTo: ["b2b", "saas", "projeto"],
    variablesTemplate: {
      foroCidadeUF: "string",
      foroPertinencia: "string",
    },
    contentTemplate:
      "Para relacoes empresariais, fica eleito o foro de {{foroCidadeUF}}, por guardar pertinencia com {{foroPertinencia}}, sem prejuizo de medidas urgentes em foro competente por lei.",
    jurisprudenceNotes: [],
    orderIndex: 680,
    professionTags: ["b2b", "baseline"],
  }),
  clause({
    slug: "foro_consumidor_b2c",
    title: "Foro favoravel ao consumidor",
    category: "disputas_comunicacoes",
    description: "Evita clausula potencialmente abusiva em relacoes de consumo.",
    required: false,
    riskLevel: "alto",
    appliesTo: ["b2c", "consumer"],
    variablesTemplate: {},
    contentTemplate:
      "Em relacoes de consumo, prevalecera o foro legalmente mais favoravel ao consumidor, sendo invalida interpretacao que imponha deslocamento abusivo ou dificulte o acesso ao Judiciario.",
    jurisprudenceNotes: [],
    orderIndex: 690,
    professionTags: ["b2c"],
  }),
  clause({
    slug: "mediacao_ou_arbitragem",
    title: "Mediacao e arbitragem opcional",
    category: "disputas_comunicacoes",
    description: "Cria escada privada de resolucao para contratos empresariais.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "saas", "projeto"],
    variablesTemplate: {
      camaraArbitral: "string",
    },
    contentTemplate:
      "Antes do ajuizamento de acao judicial, as partes buscarao solucao negociada e, se assim optarem no caso concreto, poderao submeter o litigio a mediacao ou arbitragem administrada por {{camaraArbitral}}.",
    jurisprudenceNotes: [],
    orderIndex: 700,
    professionTags: ["b2b", "enterprise"],
  }),
  clause({
    slug: "comunicacoes_eletronicas",
    title: "Comunicacoes eletronicas",
    category: "disputas_comunicacoes",
    description: "Formaliza e-mail como canal contratual com suporte probatorio.",
    required: true,
    riskLevel: "medio",
    appliesTo: ["b2b", "b2c", "saas", "projeto"],
    variablesTemplate: {
      emailFormal: "string",
    },
    contentTemplate:
      "As notificacoes e comunicacoes contratuais poderao ser realizadas por e-mail para {{emailFormal}}, cabendo a cada parte manter seus dados atualizados. Registros tecnicos de envio, entrega e autenticacao poderao ser utilizados como prova do fluxo de comunicacao.",
    jurisprudenceNotes: [jurisprudence.emailNotice, jurisprudence.emailReceiptEvidence],
    orderIndex: 710,
    professionTags: ["baseline"],
  }),
  clause({
    slug: "alteracoes_contratuais",
    title: "Alteracoes contratuais",
    category: "disputas_comunicacoes",
    description: "Evita alegacao de aditivo verbal implicito e sem lastro.",
    required: true,
    riskLevel: "medio",
    appliesTo: ["b2b", "b2c", "saas", "projeto"],
    variablesTemplate: {},
    contentTemplate:
      "Qualquer aditivo, waiver ou alteracao relevante deste contrato exigira registro escrito em meio idoneo e aceite das partes por mecanismo contratualmente valido, nao se presumindo modificacao estrutural por mera tolerancia operacional.",
    jurisprudenceNotes: [jurisprudence.franchiseAcceptance],
    orderIndex: 720,
    professionTags: ["baseline"],
  }),
  clause({
    slug: "prova_impugnacao_assinatura",
    title: "Prova em caso de impugnacao da assinatura",
    category: "disputas_comunicacoes",
    description: "Alinha o contrato ao valor probatorio esperado em litigios de assinatura contestada.",
    required: false,
    riskLevel: "alto",
    appliesTo: ["b2b", "b2c", "assinatura_eletronica"],
    variablesTemplate: {},
    contentTemplate:
      "Se houver impugnacao fundamentada da contratacao eletronica, a parte que apresentar o contrato devera disponibilizar, na extensao tecnicamente disponivel e juridicamente adequada, os registros de autenticacao, trilha de auditoria, versao assinada e evidencias de integridade do documento.",
    jurisprudenceNotes: [jurisprudence.burdenConsumerSignature],
    orderIndex: 730,
    professionTags: ["baseline"],
  }),
];

const COMPLIANCE_CLAUSES: LegalClauseDefinition[] = [
  clause({
    slug: "anti_corrupcao",
    title: "Anticorrupcao",
    category: "compliance_operacional",
    description: "Clausula empresarial padrao para contratos corporativos.",
    required: false,
    riskLevel: "baixo",
    appliesTo: ["b2b", "enterprise", "saas", "projeto"],
    variablesTemplate: {},
    contentTemplate:
      "As partes declaram que cumprirao a legislacao anticorrupcao aplicavel e nao praticarao ato que possa gerar vantagem indevida, fraude a licitacao, conflito improprio com agente publico ou ocultacao de pagamentos ilicitos.",
    jurisprudenceNotes: [],
    orderIndex: 740,
    professionTags: ["b2b", "enterprise"],
  }),
  clause({
    slug: "auditoria_compliance",
    title: "Auditoria de compliance e evidencias",
    category: "compliance_operacional",
    description: "Permite revisao proporcional de trilhas de prova e politicas aplicaveis.",
    required: false,
    riskLevel: "medio",
    appliesTo: ["b2b", "enterprise", "saas", "high_risk"],
    variablesTemplate: {
      regraAuditoria: "string",
    },
    contentTemplate:
      "Quando houver exigencia regulatoria, contratual ou de risco elevado, as partes poderao verificar conformidade documental e operacional conforme {{regraAuditoria}}, preservados sigilo, protecao de dados e limites razoaveis de frequencia e escopo.",
    jurisprudenceNotes: [],
    orderIndex: 750,
    professionTags: ["enterprise", "dados", "tecnologia"],
  }),
  clause({
    slug: "proibicao_clausulas_desconexas",
    title: "Vedacao a clausulas desconexas do contexto",
    category: "compliance_operacional",
    description: "Evita poluicao contratual e reforca coerencia entre texto e operacao.",
    required: true,
    riskLevel: "medio",
    appliesTo: ["b2b", "b2c", "saas", "projeto"],
    variablesTemplate: {},
    contentTemplate:
      "O contrato sera interpretado de modo contextual e coerente com a operacao descrita, devendo ser evitada a inclusao de clausulas tecnicamente desconexas ou nao operacionalizaveis no fluxo real da contratacao.",
    jurisprudenceNotes: [],
    orderIndex: 760,
    professionTags: ["baseline"],
  }),
];

const BASE_CATALOG: LegalClauseDefinition[] = [
  ...GOVERNANCE_CLAUSES,
  ...SCOPE_CLAUSES,
  ...BILLING_CLAUSES,
  ...IP_CLAUSES,
  ...CONFIDENTIALITY_CLAUSES,
  ...DATA_CLAUSES,
  ...EVIDENCE_CLAUSES,
  ...LIABILITY_CLAUSES,
  ...TERMINATION_CLAUSES,
  ...DISPUTE_CLAUSES,
  ...COMPLIANCE_CLAUSES,
].sort((a, b) => a.orderIndex - b.orderIndex);

export const LEGAL_CLAUSE_CATALOG: LegalClauseDefinition[] = [...BASE_CATALOG];
export const LEGAL_CLAUSE_BY_ID = new Map(LEGAL_CLAUSE_CATALOG.map((item) => [item.id, item]));
export const LEGAL_CLAUSE_BY_SLUG = new Map(LEGAL_CLAUSE_CATALOG.map((item) => [item.slug, item]));

export const DEFAULT_CONTRACT_BLUEPRINT_CONTEXT: ContractBlueprintContext = {
  audience: "b2b",
  contractModels: ["saas", "projeto"],
  riskLevel: "medio",
  personalData: true,
  sensitiveData: false,
  sourceCodeDelivery: false,
  ipMode: "licenca",
  supportLevel: "horario_comercial",
  subscription: true,
  milestoneBilling: false,
  includeArbitration: false,
  includeEscrow: false,
  includePortfolioUse: false,
  includeChargebackRule: false,
  includeHandOver: true,
  authenticationMethods: ["email", "otp_whatsapp"],
  valueBand: "medio",
  clientName: "Cliente Exemplo Ltda.",
  providerName: "Fechou Tecnologia Ltda.",
  objectSummary: "licenciamento de plataforma e servicos de implantacao",
  serviceScope: "fornecimento de plataforma de contratos digitais, parametrizacao inicial, treinamento e suporte",
  deliverablesSummary: "acesso a plataforma, setup inicial, biblioteca contratual aplicavel, logs de auditoria e evidence pack",
  paymentTerms: "mensalidade recorrente e eventual fee de implantacao",
  contractValue: "R$ 4.900,00 por mes",
  durationLabel: "12 meses, com renovacao automatica",
  executionDateLabel: "10 de abril de 2026",
  forumCityUf: "Sao Paulo/SP",
  forumConnection: "domicilio da contratada e local principal de cumprimento das obrigacoes digitais",
  supportSummary: "atendimento em horario comercial por e-mail e chat, com resposta inicial em ate 1 dia util",
  subprocessorSummary: "provedor de nuvem, e-mail transacional e monitoramento",
  securitySummary: "controle de acesso, segregacao logica, criptografia em transito, backup e trilha de auditoria",
};

const DEFAULT_BLUEPRINT_SLUGS = [
  "partes_qualificacao",
  "definicoes",
  "objeto_escopo_macro",
  "hierarquia_documental",
  "interpretacao_boa_fe",
  "entregaveis",
  "exclusoes_escopo",
  "criterios_aceite",
  "obrigacoes_cliente",
  "preco_forma_pagamento",
  "faturamento_documentos_fiscais",
  "inadimplencia_fluxo",
  "multa_juros_correcao",
  "informacoes_confidenciais",
  "uso_restrito_confidencialidade",
  "logs_auditoria",
  "assinatura_eletronica_validade",
  "politica_evidencias",
  "carve_outs",
  "garantias_declaracoes",
  "rescisao_inadimplemento",
  "pagamento_proporcional",
  "sobrevivencia_obrigacoes",
  "comunicacoes_eletronicas",
  "alteracoes_contratuais",
  "proibicao_clausulas_desconexas",
] as const;

const CLAUSE_MODE_TARGETS: Record<Exclude<ClauseVolumeMode, "custom">, number | undefined> = {
  essential: 8,
  balanced: 14,
  complete: 24,
  robust: 35,
};

const MINIMUM_RECOMMENDED_SLUGS = [
  "partes_qualificacao",
  "objeto_escopo_macro",
  "entregaveis",
  "preco_forma_pagamento",
  "assinatura_eletronica_validade",
  "rescisao_inadimplemento",
] as const;

const HIGH_PRIORITY_SLUGS = [
  "criterios_aceite",
  "obrigacoes_cliente",
  "multa_juros_correcao",
  "informacoes_confidenciais",
  "politica_evidencias",
  "garantias_declaracoes",
  "comunicacoes_eletronicas",
  "alteracoes_contratuais",
] as const;

const TEMPLATE_FIELD_DEFINITIONS: Record<
  string,
  Omit<ContractTemplateFieldStatus, "key" | "value" | "missing">
> = {
  contratadaNome: {
    label: "Nome da contratada",
    section: "partes",
    required: true,
    placeholder: "Fechou Tecnologia Ltda.",
    helperText: "Quem presta o servico ou vende a solucao.",
  },
  contratadaDocumento: {
    label: "CNPJ da contratada",
    section: "partes",
    required: true,
    placeholder: "00.000.000/0000-00",
    helperText: "Documento da empresa que emite o contrato.",
  },
  contratadaEndereco: {
    label: "Endereco da contratada",
    section: "partes",
    required: true,
    placeholder: "Rua, numero, bairro, cidade/UF, CEP",
    helperText: "Endereco comercial ou sede da contratada.",
  },
  contratanteNome: {
    label: "Nome do contratante",
    section: "partes",
    required: true,
    placeholder: "Nome ou razao social do cliente",
    helperText: "Quem contrata o servico.",
  },
  contratanteDocumento: {
    label: "CPF/CNPJ do contratante",
    section: "partes",
    required: true,
    placeholder: "CPF ou CNPJ",
    helperText: "Documento do cliente ou da empresa cliente.",
  },
  contratanteEndereco: {
    label: "Endereco do contratante",
    section: "partes",
    required: true,
    placeholder: "Rua, numero, bairro, cidade/UF, CEP",
    helperText: "Endereco do cliente usado na qualificacao.",
  },
  objetoContrato: {
    label: "Objeto do contrato",
    section: "contrato",
    required: true,
    placeholder: "Ex.: desenvolvimento de plataforma web",
    helperText: "Resumo claro do que esta sendo contratado.",
  },
  escopoResumo: {
    label: "Escopo resumido",
    section: "contrato",
    required: true,
    placeholder: "Principais entregas e limites do trabalho",
    helperText: "O que entra no servico, em linguagem objetiva.",
  },
  entregaveisResumo: {
    label: "Entregaveis",
    section: "operacional",
    required: false,
    placeholder: "Arquivos, acessos, telas, relatorios ou etapas",
    helperText: "O que sera entregue ao cliente.",
  },
  valorContrato: {
    label: "Valor do contrato",
    section: "financeiro",
    required: true,
    placeholder: "R$ 0,00",
    helperText: "Valor total, mensalidade ou regra de cobranca.",
  },
  condicoesPagamento: {
    label: "Condicoes de pagamento",
    section: "financeiro",
    required: true,
    placeholder: "Ex.: 50% na entrada e 50% na entrega",
    helperText: "Como e quando o cliente paga.",
  },
  durationLabel: {
    label: "Vigencia",
    section: "contrato",
    required: false,
    placeholder: "Ex.: 12 meses",
    helperText: "Prazo de duracao do contrato.",
  },
  executionDateLabel: {
    label: "Data-base",
    section: "contrato",
    required: false,
    placeholder: "Data da assinatura ou inicio",
    helperText: "Data usada como referencia no contrato.",
  },
  foroCidadeUF: {
    label: "Foro",
    section: "juridico",
    required: false,
    placeholder: "Cidade/UF",
    helperText: "Cidade/estado escolhido para disputas judiciais.",
  },
  foroPertinencia: {
    label: "Conexao do foro",
    section: "juridico",
    required: false,
    placeholder: "Ex.: sede da contratada",
    helperText: "Por que esse foro faz sentido para o contrato.",
  },
};

export const DECISION_RULES: LegalDecisionRule[] = [
  {
    id: "rule-b2b-aceite-e-cap",
    priority: 10,
    ifAll: ["audience:b2b"],
    thenAdd: ["aceite_automatico_b2b", "limitacao_responsabilidade_b2b", "foro_pertinente_b2b"],
    rationale: "Relacoes empresariais suportam aceite por silencio qualificado, cap de responsabilidade e foro com pertinencia.",
  },
  {
    id: "rule-b2c-pro-consumidor",
    priority: 20,
    ifAll: ["audience:b2c"],
    thenAdd: ["foro_consumidor_b2c"],
    thenRemove: ["aceite_automatico_b2b", "limitacao_responsabilidade_b2b", "foro_pertinente_b2b"],
    rationale: "Em consumo, o desenho precisa evitar assimetrias excessivas e clausulas potencialmente abusivas.",
  },
  {
    id: "rule-saas-core",
    priority: 30,
    ifAny: ["model:saas", "subscription:true"],
    thenAdd: [
      "licenca_saas",
      "suspensao_inadimplencia",
      "exportacao_dados",
      "continuidade_acesso_dados",
      "uso_adequado_plataforma",
      "sla_uptime",
      "suboperadores",
    ],
    rationale: "Operacao SaaS pede licenca, disponibilidade, continuidade de dados e disciplina de acesso.",
  },
  {
    id: "rule-project-core",
    priority: 40,
    ifAny: ["model:projeto", "milestone:true"],
    thenAdd: ["change_request", "cronograma_marcos", "correcao_defeitos", "multa_rescisao"],
    rationale: "Projetos sob encomenda precisam de controle de escopo, marcos e correcao de defeitos.",
  },
  {
    id: "rule-personal-data",
    priority: 50,
    ifAll: ["personalData:true"],
    thenAdd: [
      "papeis_lgpd",
      "medidas_seguranca",
      "incidentes_seguranca",
      "retencao_descarte",
      "canal_titular",
      "prova_impugnacao_assinatura",
    ],
    rationale: "Sempre que houver dado pessoal tratado, a estrutura de LGPD precisa estar explicita e operacional.",
  },
  {
    id: "rule-sensitive-or-high-risk",
    priority: 60,
    ifAny: ["sensitiveData:true", "risk:alto", "value:alto"],
    thenAdd: ["integridade_hash_timestamp", "autenticacao_signatario", "auditoria_compliance"],
    rationale: "Contratos mais sensiveis ou valiosos pedem reforco probatorio e controles auditaveis.",
  },
  {
    id: "rule-source-code",
    priority: 70,
    ifAll: ["sourceCodeDelivery:true"],
    thenAdd: ["titularidade_codigo_artefatos", "open_source", "change_request"],
    rationale: "Entrega de codigo-fonte exige titularidade clara, governanca de bibliotecas e gestao de mudancas.",
  },
  {
    id: "rule-ip-licenca",
    priority: 80,
    ifAll: ["ipMode:licenca"],
    thenAdd: ["licenca_saas"],
    thenRemove: ["cessao_direitos_encomenda"],
    rationale: "No modelo de licenca, a cessao integral do core da plataforma deve ser evitada.",
  },
  {
    id: "rule-ip-cessao",
    priority: 90,
    ifAll: ["ipMode:cessao"],
    thenAdd: ["cessao_direitos_encomenda"],
    rationale: "Projetos efetivamente sob encomenda podem demandar cessao patrimonial delimitada.",
  },
  {
    id: "rule-support",
    priority: 100,
    ifAny: ["support:horario_comercial", "support:estendido"],
    thenAdd: ["suporte_pos_entrega"],
    rationale: "Quando houver suporte prometido, a cobertura precisa estar claramente documentada.",
  },
  {
    id: "rule-arbitration",
    priority: 110,
    ifAll: ["arbitration:true"],
    thenAdd: ["mediacao_ou_arbitragem"],
    rationale: "A arbitragem e modulo opcional tipico de contratos empresariais e deve ser expressa.",
  },
  {
    id: "rule-escrow",
    priority: 120,
    ifAll: ["escrow:true"],
    thenAdd: ["escrow_codigo"],
    rationale: "Escrow e add-on excepcional, util em dependencia tecnologica critica.",
  },
  {
    id: "rule-portfolio",
    priority: 130,
    ifAll: ["portfolio:true"],
    thenAdd: ["marca_portfolio"],
    rationale: "Uso em portfolio deve ser opt-in e textual para nao gerar desconforto comercial.",
  },
  {
    id: "rule-chargeback",
    priority: 140,
    ifAll: ["chargeback:true"],
    thenAdd: ["chargeback_contestacao"],
    rationale: "Pagamentos online recorrentes ficam mais defensaveis com disciplina de chargeback.",
  },
  {
    id: "rule-handover",
    priority: 150,
    ifAll: ["handover:true"],
    thenAdd: ["transicao_handover"],
    rationale: "Contratos com dependencia operacional pedem janela organizada de transicao.",
  },
];

export const WARNING_LIBRARY: RiskWarningDefinition[] = [
  {
    code: "b2c_foro_distante",
    severity: "critical",
    condition: "Relacao B2C com foro nao favoravel ao consumidor ou sem pertinencia clara.",
    message: "Clausula de foro pode ser contestada ou tida como abusiva em relacao de consumo.",
    recommendation: "Use foro favoravel ao consumidor ou remeta a competencia legal.",
  },
  {
    code: "b2c_cap_responsabilidade",
    severity: "critical",
    condition: "Relacao B2C com limitacao de responsabilidade agressiva.",
    message: "Cap amplo de responsabilidade em consumo aumenta risco de nulidade parcial.",
    recommendation: "Evite cap padrao de B2B ou limite-o com cautela e transparencia reforcada.",
  },
  {
    code: "assinatura_fraca_risco_alto",
    severity: "warning",
    condition: "Contrato de alto risco com autenticacao apenas por e-mail simples.",
    message: "O arranjo probatorio pode ser insuficiente se autoria ou manifestacao de vontade forem impugnadas.",
    recommendation: "Eleve a autenticacao com OTP, selfie, geolocalizacao, gov.br ou ICP-Brasil conforme o caso.",
  },
  {
    code: "juros_genericos",
    severity: "warning",
    condition: "Clausula financeira sem parametrizacao objetiva de multa, juros e correcao.",
    message: "Referencia generica a taxa legal reduz previsibilidade e pode gerar discussao desnecessaria.",
    recommendation: "Parametrize multa, juros e indice de atualizacao monetaria no proprio contrato.",
  },
  {
    code: "dados_sem_dpa",
    severity: "critical",
    condition: "Tratamento de dados pessoais sem definicao de papeis, retencao e incidentes.",
    message: "A camada LGPD fica subdimensionada para o fluxo real do produto.",
    recommendation: "Inclua papeis, medidas de seguranca, retencao, suboperadores e fluxo de incidentes.",
  },
  {
    code: "codigo_sem_ip",
    severity: "critical",
    condition: "Entrega de codigo-fonte sem disciplina de titularidade, open source e escopo de cessao/licenca.",
    message: "A disputa de propriedade intelectual tende a ficar aberta ja na primeira divergencia comercial.",
    recommendation: "Escolha explicitamente entre licenca, cessao delimitada ou titularidade do prestador.",
  },
  {
    code: "multa_excessiva",
    severity: "warning",
    condition: "Multa rescisoria elevada e sem aderencia ao inadimplemento.",
    message: "A clausula penal pode ser reduzida judicialmente por excessividade.",
    recommendation: "Calibre a multa a funcao economica do contrato e a extensao do descumprimento.",
  },
];
export const EVIDENCE_PACK_BLUEPRINT = {
  exportFormats: ["application/pdf", "application/json"],
  hashAlgorithm: "sha256",
  appendOnlyLog: true,
  events: [
    {
      code: "contract_created",
      description: "Criacao inicial do contrato e snapshot de variaveis-base.",
      required: true,
      fields: ["contractId", "userId", "timestamp", "templateVersion", "documentHash"],
    },
    {
      code: "contract_previewed",
      description: "Visualizacao do contrato antes do envio para assinatura.",
      required: true,
      fields: ["contractId", "viewerId", "timestamp", "ip", "userAgent", "documentHash"],
    },
    {
      code: "share_link_issued",
      description: "Geracao de link publico de revisao ou assinatura.",
      required: true,
      fields: ["contractId", "timestamp", "expiresAt", "tokenHash", "issuerUserId"],
    },
    {
      code: "signature_method_selected",
      description: "Metodo e fatores de autenticacao escolhidos para a assinatura.",
      required: true,
      fields: ["contractId", "timestamp", "method", "factors", "riskLevel"],
    },
    {
      code: "signer_authenticated",
      description: "Validacao de identidade do signatario por OTP, selfie, gov.br ou equivalente.",
      required: false,
      fields: ["contractId", "timestamp", "factorType", "result", "maskedIdentifier", "ip"],
    },
    {
      code: "document_signed",
      description: "Ato de assinatura com vinculo entre signatario, versao e hash do documento.",
      required: true,
      fields: ["contractId", "timestamp", "signerName", "signerDocumentHash", "ip", "userAgent", "documentHash"],
    },
    {
      code: "provider_signature_applied",
      description: "Assinatura do prestador ou representante da contratada.",
      required: false,
      fields: ["contractId", "timestamp", "providerUserId", "documentHash"],
    },
    {
      code: "document_finalized",
      description: "Consolidacao final do documento e materializacao do evidence pack.",
      required: true,
      fields: ["contractId", "timestamp", "finalHash", "clauseSnapshotVersion", "evidencePackHash"],
    },
  ] as EvidenceEventDefinition[],
};

export const VERSIONING_RECOMMENDATIONS: string[] = [
  "Versione clausulas com semantica major.minor.patch e congele a versao usada por cada contrato.",
  "Mantenha historico reproduzivel: clauseId identifica o ativo; clauseVersion identifica o texto e os metadados vigentes naquela assinatura.",
  "Nao faca hard delete de clausulas publicadas. Marque como deprecated e preserve contratos antigos com snapshot renderizado.",
  "Curadoria premium deve registrar reviewedAt, approvedBy e referencias oficiais que motivaram a alteracao.",
  "Trate breaking changes juridicas como major: alteracao de foro, responsabilidade, LGPD, juros, multa ou metodo probatorio pede versionamento forte.",
];
export const MIGRATION_RECOMMENDATIONS: string[] = [
  "Criar tabela clause_versions para desacoplar clausula estavel do texto efetivamente publicado.",
  "Adicionar contract_clause_snapshot com clauseVersionId, renderedContent, hash e customContent opcional.",
  "Criar contract_events append-only com hash encadeado para proteger a trilha de evidencias contra edicao silenciosa.",
  "Criar perfis por profissao ou vertical usando tags e ids de clausula, em vez de titulo textual exato.",
  "Adicionar endpoint deterministico de auto-generate com payload contextual e warnings de risco antes da persistencia.",
];

const PROFESSION_PROFILES: Record<string, string[]> = {
  saas: [
    "licenca_saas",
    "sla_uptime",
    "exportacao_dados",
    "continuidade_acesso_dados",
    "uso_adequado_plataforma",
    "suboperadores",
  ],
  tecnologia: [
    "titularidade_codigo_artefatos",
    "open_source",
    "change_request",
    "dependencias_tecnicas",
    "correcao_defeitos",
  ],
  design: ["marca_portfolio", "cessao_direitos_encomenda"],
  marketing: ["nao_exclusividade", "marca_portfolio"],
  consultoria: ["change_request", "cronograma_marcos", "nao_exclusividade"],
  fotografia: ["marca_portfolio", "multa_rescisao"],
  juridico: ["informacoes_confidenciais", "uso_restrito_confidencialidade", "auditoria_compliance"],
};

export function normalizeProfessionKey(input?: string | null, contractType?: string | null) {
  const joined = `${input ?? ""} ${contractType ?? ""}`.toLowerCase();

  if (/(saas|software|cloud|devops|backend|frontend|mobile|fullstack|crm|erp|ti|tech)/.test(joined)) {
    if (/saas/.test(joined)) return "saas";
    return "tecnologia";
  }
  if (/(design|branding|ux|ui|motion|criativo)/.test(joined)) return "design";
  if (/(marketing|seo|copy|social)/.test(joined)) return "marketing";
  if (/(consult|mentoria|treinamento|agile|project|produto)/.test(joined)) return "consultoria";
  if (/(foto|fotografia|video|audiovisual)/.test(joined)) return "fotografia";
  if (/(jurid|legal)/.test(joined)) return "juridico";
  return "tecnologia";
}

export function getProfessionSuggestedClauseSlugs(profession?: string | null, contractType?: string | null) {
  const profileKey = normalizeProfessionKey(profession, contractType);
  const profile = PROFESSION_PROFILES[profileKey] ?? [];
  const baseline = [
    "partes_qualificacao",
    "objeto_escopo_macro",
    "entregaveis",
    "preco_forma_pagamento",
    "informacoes_confidenciais",
    "rescisao_inadimplemento",
    "comunicacoes_eletronicas",
    "assinatura_eletronica_validade",
    "politica_evidencias",
  ];

  return Array.from(new Set([...baseline, ...profile]));
}

function valueOrDefault(value: string | undefined, fallback: string) {
  return value?.trim() ? value : fallback;
}

function isTemplateFieldMissing(value: string) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return (
    !normalized ||
    normalized.includes("[preencher]") ||
    normalized.includes("[endereco") ||
    normalized === "cpf ou cnpj" ||
    normalized === "cnpj/cpf"
  );
}

export function buildTemplateVariables(context: Partial<ContractBlueprintContext>) {
  const merged = {
    ...DEFAULT_CONTRACT_BLUEPRINT_CONTEXT,
    ...context,
  };

  const authLabel = (merged.authenticationMethods ?? [])
    .map((method) => {
      switch (method) {
        case "otp_whatsapp":
          return "OTP via WhatsApp";
        case "otp_sms":
          return "OTP via SMS";
        case "gov_br":
          return "validacao gov.br";
        case "icp_brasil":
          return "certificado ICP-Brasil";
        default:
          return method;
      }
    })
    .join(", ");

  return {
    plataformaNome: "Fechou",
    contratadaNome: valueOrDefault(merged.providerName, "Fechou Tecnologia Ltda."),
    contratadaDocumento: valueOrDefault(merged.providerDocument, "CNPJ [preencher]"),
    contratadaEndereco: valueOrDefault(merged.providerAddress, "[endereco da contratada]"),
    contratanteNome: valueOrDefault(merged.clientName, "Cliente Exemplo Ltda."),
    contratanteDocumento: valueOrDefault(merged.clientDocument, "CNPJ/CPF [preencher]"),
    contratanteEndereco: valueOrDefault(merged.clientAddress, "[endereco do contratante]"),
    definicoesResumo: valueOrDefault(merged.deliverablesSummary, "acesso a plataforma, setup e evidencias"),
    objetoContrato: valueOrDefault(merged.objectSummary, "servicos contratados"),
    escopoResumo: valueOrDefault(merged.serviceScope, "escopo a ser detalhado em anexo"),
    anexosHierarquia: "Contrato principal > ordens de servico assinadas > anexos tecnicos > politicas referidas",
    entregaveisResumo: valueOrDefault(merged.deliverablesSummary, "entregaveis definidos em anexo"),
    exclusoesEscopo: "desenvolvimentos nao contratados, customizacoes fora do backlog aprovado, consultoria regulatoria individualizada e integracoes nao previstas",
    prazoAceiteDias: "5",
    criterioAceite: "aderencia ao escopo contratado, funcionamento dos fluxos principais e ausencia de defeitos criticos impeditivos",
    janelaCorrecaoDias: "30",
    suporteResumo: valueOrDefault(
      merged.supportSummary,
      merged.supportLevel === "estendido"
        ? "atendimento em janela estendida e suporte prioritario"
        : merged.supportLevel === "horario_comercial"
          ? "atendimento em horario comercial por canais oficiais"
          : "suporte nao incluido por padrao"
    ),
    subcontratacaoRegra:
      "somente para atividades acessorias, especializadas ou de apoio operacional, sem transferencia integral da responsabilidade principal da contratada",
    fluxoChangeRequest: "registro da solicitacao, analise de impacto, proposta comercial e aceite escrito antes da execucao",
    insumosCliente: "briefing, dados cadastrais, acessos, aprovacoes internas e informacoes necessarias a implantacao",
    dependenciasTecnicas: "infraestrutura do cliente, provedores terceiros, APIs contratadas pelo cliente e credenciais validas",
    cronogramaResumo: "marco 1: setup; marco 2: parametrizacao; marco 3: homologacao; marco 4: operacao assistida",
    criterioMelhoria: "abertura de demanda, estimativa e aprovacao especifica",
    valorContrato: valueOrDefault(merged.contractValue, "R$ [preencher]"),
    condicoesPagamento: valueOrDefault(merged.paymentTerms, "conforme cronograma financeiro definido pelas partes"),
    regraFaturamento: "emissao da nota fiscal na data de vencimento de cada parcela ou mensalidade",
    indiceReajuste: "IPCA",
    reajustePeriodicidade: "anual",
    prazoCarenciaDias: "7",
    multaMoraPercentual: "2",
    jurosMoraPercentual: "1",
    indiceCorrecao: "IPCA",
    prazoSuspensaoDias: "15",
    prazoContestacaoDias: "15",
    regraRetencao: "a legislacao tributaria aplicavel, com abatimento do valor efetivamente retido e envio do comprovante correspondente",
    regraDespesas: "aprovacao previa por escrito e apresentacao de comprovantes",
    regraTitularidade:
      merged.ipMode === "cessao"
        ? "cessao patrimonial limitada ao que for expressamente encomendado e quitado"
        : merged.ipMode === "titularidade_prestador"
          ? "titularidade integral da contratada, com licenca de uso ao contratante"
          : "licenca de uso ao contratante, sem transferencia do software base",
    escopoLicenca: "uso interno do contratante, nos limites do plano contratado e da documentacao funcional",
    escopoCessao: "os entregaveis especificamente desenvolvidos sob encomenda e descritos em ordem de servico",
    regraOpenSource: "inventario dos componentes relevantes e restricoes de licenca quando houver obrigacao de atribuicao",
    portfolioRegra:
      merged.includePortfolioUse
        ? "a contratada podera citar nome e escopo macro do projeto, sem expor dados confidenciais ou metricas sensiveis"
        : "dependera de autorizacao especifica e destacada do contratante",
    gatilhosEscrow: "falencia, descontinuacao definitiva do servico ou inadimplemento grave e nao sanado de obrigacao critica de continuidade",
    prazoSigiloAnos: "5",
    papelDados: merged.personalData ? "controladoras independentes ou controlador e operadora, conforme cada fluxo" : "nao aplicavel",
    finalidadeDados: merged.personalData ? "execucao do contrato, autenticacao, assinatura, cobranca e suporte" : "nao aplicavel",
    instrucoesTratamento: "anexo de tratamento de dados e instrucoes operacionais do cliente",
    medidasSegurancaResumo: valueOrDefault(merged.securitySummary, "controle de acesso, logs, backup, criptografia e revisao de permissoes"),
    suboperadoresResumo: valueOrDefault(merged.subprocessorSummary, "provedor de nuvem, e-mail transacional e monitoramento"),
    prazoIncidenteHoras: "48",
    prazoRetencao: "enquanto vigente o contrato e pelo prazo necessario ao exercicio regular de direitos",
    janelaExportacaoDias: "30",
    formatoExportacao: "formato eletronico estruturado e amplamente utilizado",
    canalPrivacidade: "privacidade@fechou.app",
    eventosAuditados:
      "criacao, edicao, preview, envio, autenticacao, assinatura, confirmacao de pagamento, exportacao de evidencias e alteracoes relevantes de estado",
    algoritmoHash: "SHA-256",
    timestampProvider: "provedor de carimbo do tempo contratado ou tecnologia equivalente",
    metodoAssinatura:
      merged.authenticationMethods?.includes("icp_brasil")
        ? "assinatura eletronica qualificada ou avancada na plataforma"
        : "assinatura eletronica avancada na plataforma",
    metodosAutenticacao: authLabel || "e-mail confirmado",
    limiteResponsabilidade:
      merged.subscription
        ? "o total pago pelo contratante nos 12 meses anteriores ao evento"
        : "o valor efetivamente pago pelo contrato",
    excecoesResponsabilidade: "dolo, fraude, violacao intencional, descumprimento de dever legal inafastavel, uso indevido de dados por culpa grave e obrigacoes expressamente nao limitaveis por lei",
    regraDefesaIP: "notificacao imediata, cooperacao documental e possibilidade de substituicao, licenciamento ou remocao do componente questionado",
    padraoPrestacao: "boas praticas tecnicas e diligencia profissional compativel com o mercado",
    slaDisponibilidade: "99,5%",
    multaRescisoriaPercentual: "10",
    avisoPrevioDias: "30",
    prazoCuraDias: "10",
    regraHandover: "escopo fechado, cronograma especifico e remuneracao compativel com o esforco adicional",
    foroCidadeUF: valueOrDefault(merged.forumCityUf, "Sao Paulo/SP"),
    foroPertinencia: valueOrDefault(
      merged.forumConnection,
      "o domicilio da contratada e o local principal de cumprimento das obrigacoes digitais"
    ),
    camaraArbitral: "camara escolhida de comum acordo pelas partes",
    emailFormal: "os e-mails cadastrados no onboarding e nos avisos operacionais da plataforma",
    regraAuditoria:
      "aviso previo razoavel, delimitacao objetiva de escopo, preservacao de sigilo e realizacao sem impacto material indevido na operacao",
  };
}

export function renderTemplate(contentTemplate: string, variables: Record<string, string>) {
  return contentTemplate.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, variableName: string) => {
    return variables[variableName] ?? `[${variableName}]`;
  });
}

function labelFromTemplateKey(key: string) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function getTemplateKeysFromClauses(clauses: LegalClauseDefinition[]) {
  const keys = new Set<string>([
    "contratadaNome",
    "contratanteNome",
    "objetoContrato",
    "durationLabel",
    "executionDateLabel",
  ]);

  for (const clause of clauses) {
    for (const key of Object.keys(clause.variablesTemplate)) keys.add(key);
  }

  return Array.from(keys);
}

export function buildContractTemplateFieldStatus(
  context: Partial<ContractBlueprintContext>,
  clauses?: LegalClauseDefinition[]
) {
  const resolvedClauses = clauses ?? selectClausesForContext(context).clauses;
  const variables = buildTemplateVariables(context);

  const fields = getTemplateKeysFromClauses(resolvedClauses)
    .map((key) => {
      const definition = TEMPLATE_FIELD_DEFINITIONS[key] ?? {
        label: labelFromTemplateKey(key),
        section: "operacional" as const,
        required: false,
        placeholder: "",
        helperText: "Campo usado para completar uma clausula do contrato.",
      };
      const value = String(variables[key as keyof typeof variables] ?? "").trim();

      return {
        key,
        ...definition,
        value,
        missing: definition.required && isTemplateFieldMissing(value),
      };
    })
    .sort((a, b) => {
      if (a.missing !== b.missing) return a.missing ? -1 : 1;
      if (a.required !== b.required) return a.required ? -1 : 1;
      return a.label.localeCompare(b.label);
    });

  return {
    templateFields: fields,
    missingTemplateFields: fields.filter((field) => field.missing),
  };
}

function normalizeTargetClauseCount(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.min(60, Math.trunc(value)));
}

function resolveClauseTarget(input: Partial<ContractBlueprintContext>) {
  const explicitTarget = normalizeTargetClauseCount(input.targetClauseCount);
  if (explicitTarget !== undefined) return explicitTarget;
  if (!input.clauseMode || input.clauseMode === "custom") return undefined;
  return CLAUSE_MODE_TARGETS[input.clauseMode];
}

function getMinimumRecommendedSlugs(context: ContractBlueprintContext) {
  const slugs = new Set<string>(MINIMUM_RECOMMENDED_SLUGS);

  if (context.personalData) {
    slugs.add("papeis_lgpd");
    slugs.add("medidas_seguranca");
  }

  if (context.sensitiveData) {
    slugs.add("incidentes_seguranca");
  }

  if (context.sourceCodeDelivery) {
    slugs.add(context.ipMode === "cessao" ? "cessao_direitos_encomenda" : "titularidade_codigo_artefatos");
    slugs.add("open_source");
  } else if (context.ipMode === "cessao") {
    slugs.add("cessao_direitos_encomenda");
  }

  if (context.subscription || context.contractModels.includes("saas")) {
    slugs.add("licenca_saas");
  }

  if (context.includeArbitration) slugs.add("mediacao_ou_arbitragem");
  if (context.includeEscrow) slugs.add("escrow_codigo");
  if (context.includeHandOver) slugs.add("transicao_handover");
  if (context.audience === "b2c") slugs.add("foro_consumidor_b2c");

  return slugs;
}

function scoreClauseForLimit(clause: LegalClauseDefinition, context: ContractBlueprintContext, minimumSlugs: Set<string>) {
  let score = clause.required ? 100 : 0;

  if (minimumSlugs.has(clause.slug)) score += 1000;
  if ((HIGH_PRIORITY_SLUGS as readonly string[]).includes(clause.slug)) score += 350;
  if ((DEFAULT_BLUEPRINT_SLUGS as readonly string[]).includes(clause.slug)) score += 80;
  if (clause.riskLevel === "alto") score += 70;
  if (clause.riskLevel === "medio") score += 35;

  if (clause.category === "preco_cobranca") score += 80;
  if (clause.category === "escopo_entregaveis") score += 70;
  if (clause.category === "seguranca_evidencias") score += 60;
  if (clause.category === "rescisao_continuidade") score += 50;
  if (clause.category === "disputas_comunicacoes") score += 35;
  if (context.personalData && clause.category === "dados_privacidade") score += 150;
  if ((context.sourceCodeDelivery || context.ipMode !== "titularidade_prestador") && clause.category === "propriedade_intelectual") score += 130;
  if ((context.subscription || context.contractModels.includes("saas")) && clause.appliesTo.includes("saas")) score += 100;
  if (context.milestoneBilling && clause.appliesTo.includes("projeto")) score += 80;

  return score;
}

function limitClausesForContext(
  context: ContractBlueprintContext,
  clauses: LegalClauseDefinition[]
): { clauses: LegalClauseDefinition[]; selection: ClauseSelectionSummary } {
  const requestedCount = resolveClauseTarget(context);
  const minimumSlugs = getMinimumRecommendedSlugs(context);
  const availableBySlug = new Map(clauses.map((item) => [item.slug, item]));
  const minimumClauses = Array.from(minimumSlugs)
    .map((slug) => availableBySlug.get(slug) ?? LEGAL_CLAUSE_BY_SLUG.get(slug))
    .filter((item): item is LegalClauseDefinition => Boolean(item));
  const minimumRecommendedCount = minimumClauses.length;

  if (requestedCount === undefined || requestedCount >= clauses.length) {
    return {
      clauses,
      selection: {
        mode: context.clauseMode,
        requestedCount,
        appliedLimit: requestedCount,
        availableCount: clauses.length,
        selectedCount: clauses.length,
        minimumRecommendedCount,
        raisedToMinimum: false,
      },
    };
  }

  const appliedLimit = Math.max(requestedCount, minimumRecommendedCount);
  const selected = new Map<string, LegalClauseDefinition>();

  for (const clause of minimumClauses) selected.set(clause.slug, clause);

  const ranked = clauses
    .filter((clause) => !selected.has(clause.slug))
    .sort((a, b) => {
      const scoreDiff = scoreClauseForLimit(b, context, minimumSlugs) - scoreClauseForLimit(a, context, minimumSlugs);
      return scoreDiff || a.orderIndex - b.orderIndex;
    });

  for (const clause of ranked) {
    if (selected.size >= appliedLimit) break;
    selected.set(clause.slug, clause);
  }

  const limitedClauses = Array.from(selected.values()).sort((a, b) => a.orderIndex - b.orderIndex);

  return {
    clauses: limitedClauses,
    selection: {
      mode: context.clauseMode,
      requestedCount,
      appliedLimit,
      availableCount: clauses.length,
      selectedCount: limitedClauses.length,
      minimumRecommendedCount,
      raisedToMinimum: appliedLimit > requestedCount,
    },
  };
}

export function selectClausesForContext(input: Partial<ContractBlueprintContext>) {
  const context: ContractBlueprintContext = {
    ...DEFAULT_CONTRACT_BLUEPRINT_CONTEXT,
    ...input,
    contractModels: input.contractModels?.length ? input.contractModels : DEFAULT_CONTRACT_BLUEPRINT_CONTEXT.contractModels,
    authenticationMethods: input.authenticationMethods?.length
      ? input.authenticationMethods
      : DEFAULT_CONTRACT_BLUEPRINT_CONTEXT.authenticationMethods,
  };

  const selected = new Set<string>(DEFAULT_BLUEPRINT_SLUGS);
  const tags = new Set<string>();
  tags.add(`audience:${context.audience}`);
  tags.add(`risk:${context.riskLevel}`);
  tags.add(`ipMode:${context.ipMode}`);
  tags.add(`support:${context.supportLevel}`);
  tags.add(`personalData:${String(context.personalData)}`);
  tags.add(`sensitiveData:${String(context.sensitiveData)}`);
  tags.add(`sourceCodeDelivery:${String(context.sourceCodeDelivery)}`);
  tags.add(`subscription:${String(context.subscription)}`);
  tags.add(`milestone:${String(context.milestoneBilling)}`);
  tags.add(`arbitration:${String(context.includeArbitration)}`);
  tags.add(`escrow:${String(context.includeEscrow)}`);
  tags.add(`portfolio:${String(context.includePortfolioUse)}`);
  tags.add(`chargeback:${String(context.includeChargebackRule)}`);
  tags.add(`handover:${String(context.includeHandOver)}`);
  if (context.valueBand) tags.add(`value:${context.valueBand}`);
  for (const model of context.contractModels) tags.add(`model:${model}`);

  for (const rule of [...DECISION_RULES].sort((a, b) => a.priority - b.priority)) {
    const allMatch = (rule.ifAll ?? []).every((item) => tags.has(item));
    const anyMatch = !rule.ifAny || rule.ifAny.some((item) => tags.has(item));
    if (allMatch && anyMatch) {
      for (const slug of rule.thenAdd) selected.add(slug);
      for (const slug of rule.thenRemove ?? []) selected.delete(slug);
    }
  }

  if (context.ipMode === "cessao") {
    selected.add("cessao_direitos_encomenda");
  } else {
    selected.add("titularidade_codigo_artefatos");
  }

  if (context.personalData) {
    selected.add("papeis_lgpd");
    selected.add("medidas_seguranca");
    selected.add("retencao_descarte");
  }

  if (context.supportLevel !== "none") {
    selected.add("suporte_pos_entrega");
  }

  const clauses = Array.from(selected)
    .map((slug) => LEGAL_CLAUSE_BY_SLUG.get(slug))
    .filter((item): item is LegalClauseDefinition => Boolean(item))
    .sort((a, b) => a.orderIndex - b.orderIndex);

  const limited = limitClausesForContext(context, clauses);

  return { context, clauses: limited.clauses, selection: limited.selection };
}

export function evaluateWarnings(input: Partial<ContractBlueprintContext>) {
  const context: ContractBlueprintContext = {
    ...DEFAULT_CONTRACT_BLUEPRINT_CONTEXT,
    ...input,
  };
  const warnings: RiskWarningDefinition[] = [];

  if (context.audience === "b2c") {
    warnings.push(WARNING_LIBRARY[0]!);
    warnings.push(WARNING_LIBRARY[1]!);
  }

  const weakAuthOnly =
    (context.authenticationMethods ?? []).length > 0 &&
    (context.authenticationMethods ?? []).every((item) => item === "email");
  if ((context.riskLevel === "alto" || context.valueBand === "alto") && weakAuthOnly) {
    warnings.push(WARNING_LIBRARY[2]!);
  }

  warnings.push(WARNING_LIBRARY[3]!);
  if (context.personalData) warnings.push(WARNING_LIBRARY[4]!);
  if (context.sourceCodeDelivery) warnings.push(WARNING_LIBRARY[5]!);
  warnings.push(WARNING_LIBRARY[6]!);

  return warnings;
}

export function buildContractModelText(input: Partial<ContractBlueprintContext>) {
  const { context, clauses } = selectClausesForContext(input);
  const variables = buildTemplateVariables(context);
  const renderedClauses = clauses.map((clauseItem, index) => {
    return [`Clausula ${index + 1}. ${clauseItem.title}`, renderTemplate(clauseItem.contentTemplate, variables)].join("\n");
  });
  const preamble = [
    "CONTRATO DE PRESTACAO DE SERVICOS E LICENCIAMENTO DIGITAL",
    "",
    `Pelo presente instrumento, ${variables.contratadaNome} e ${variables.contratanteNome} celebram este contrato para disciplinar ${variables.objetoContrato}, nos termos das clausulas seguintes.`,
    "",
    `Vigencia de referencia: ${valueOrDefault(context.durationLabel, "conforme prazo contratual definido pelas partes")}.`,
    `Data-base: ${valueOrDefault(context.executionDateLabel, "data da ultima assinatura eletronica valida")}.`,
  ].join("\n");
  const closing = [
    "",
    "As partes declaram que leram, compreenderam e aceitam integralmente este contrato, reconhecendo a validade do metodo de assinatura adotado e a preservacao das evidencias tecnicas correspondentes.",
  ].join("\n");

  return [preamble, renderedClauses.join("\n\n"), closing].join("\n\n");
}

export function buildLegalBlueprintBundle(input?: Partial<ContractBlueprintContext>): LegalBlueprintBundle {
  const { context, clauses } = selectClausesForContext(input ?? {});
  const templateFieldStatus = buildContractTemplateFieldStatus(context, clauses);
  return {
    sources: OFFICIAL_LEGAL_SOURCES,
    defaultContext: context,
    contractModelText: buildContractModelText(context),
    catalog: LEGAL_CLAUSE_CATALOG,
    decisionRules: DECISION_RULES,
    warnings: evaluateWarnings(context),
    versioningRecommendations: VERSIONING_RECOMMENDATIONS,
    migrationRecommendations: MIGRATION_RECOMMENDATIONS,
    evidencePack: EVIDENCE_PACK_BLUEPRINT,
    templateFields: templateFieldStatus.templateFields,
    missingTemplateFields: templateFieldStatus.missingTemplateFields,
  };
}
