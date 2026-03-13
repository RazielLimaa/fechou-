/**
 * FECHOU! — Motor de Geração de Cláusulas Contratuais
 * =====================================================
 * Legislação de referência:
 *   CC/2002 (Lei 10.406/2002) | CDC (Lei 8.078/1990) | LGPD (Lei 13.709/2018)
 *   CLT (Dec.-Lei 5.452/1943) | Marco Civil (Lei 12.965/2014)
 *   Lei de Software (Lei 9.609/1998) | LDA (Lei 9.610/1998)
 *   LPI (Lei 9.279/1996) | Lei Anticorrupção (Lei 12.846/2013)
 *   Lei de Mediação (Lei 13.140/2015) | Lei de Arbitragem (Lei 9.307/1996)
 *   CPC (Lei 13.105/2015) | LC 116/2003 | MP 2.200-2/2001
 *
 * AVISO LEGAL: Cláusulas são modelos informativos. Recomenda-se revisão
 * jurídica para contratos de alto valor ou risco.
 */

export type ClauseCategory =
  | 'prestacao_servicos'
  | 'pagamento_multas'
  | 'propriedade_intelectual'
  | 'confidencialidade'
  | 'rescisao_penalidades'
  | 'responsabilidade_civil'
  | 'prazo_entrega'
  | 'foro_conflitos';

export type RiskLevel = 'baixo' | 'medio' | 'alto';

export interface ClauseDefinition {
  id: string;
  title: string;
  category: ClauseCategory;
  profession: string | null;
  description: string;
  content: string;
  legalBasis: string;
  riskLevel: RiskLevel;
  tags: string[];
}

let _seq = 0;
const uid = (pfx: string) => `${pfx}_${String(++_seq).padStart(5, '0')}`;

const mk = (
  pfx: string,
  title: string,
  cat: ClauseCategory,
  desc: string,
  content: string,
  legal: string,
  risk: RiskLevel,
  tags: string[],
  prof?: string
): ClauseDefinition => ({
  id: uid(pfx),
  title,
  category: cat,
  profession: prof ?? null,
  description: desc,
  content,
  legalBasis: legal,
  riskLevel: risk,
  tags
});

const PS = 'ps';
const C_PS: ClauseCategory = 'prestacao_servicos';

const PRESTACAO_BASE: ClauseDefinition[] = [
  mk(
    PS,
    'Objeto do Contrato — Definição Geral',
    C_PS,
    'Define o objeto principal.',
    'O presente contrato tem por objeto a prestação de serviços de {{escopo}}, a ser realizada pelo CONTRATADO em favor do CONTRATANTE de forma autônoma, sem vínculo empregatício, subordinação ou exclusividade, nos termos dos arts. 593 a 609 do Código Civil Brasileiro (Lei n.º 10.406/2002).',
    'CC/2002 arts. 593-609',
    'baixo',
    ['objeto', 'serviço', 'autonomia']
  ),
  mk(
    PS,
    'Especificação Técnica do Escopo',
    C_PS,
    'Detalha tecnicamente o escopo.',
    'Os serviços objeto deste contrato compreendem exclusivamente: {{escopo}}. Quaisquer atividades não descritas neste instrumento serão consideradas fora do escopo e dependerão de aditivo contratual escrito e assinado por ambas as partes, conforme art. 472 do Código Civil.',
    'CC/2002 art. 472',
    'baixo',
    ['escopo', 'especificação', 'aditivo']
  ),
  mk(
    PS,
    'Autonomia e Independência do Contratado',
    C_PS,
    'Afasta vínculo empregatício.',
    'O CONTRATADO é profissional autônomo e executará os serviços com total independência técnica e administrativa, podendo utilizar seus próprios métodos, ferramentas e horários. Não há qualquer vínculo empregatício, societário ou de exclusividade entre as partes, não se aplicando as normas da CLT.',
    'CLT art. 3º a contrario sensu; CC/2002 art. 593',
    'baixo',
    ['autonomia', 'independência', 'sem vínculo']
  )
];

const PM = 'pm';
const C_PM: ClauseCategory = 'pagamento_multas';

const PAGAMENTO_BASE: ClauseDefinition[] = [
  mk(
    PM,
    'Valor Total e Forma de Pagamento',
    C_PM,
    'Define valor e forma de pagamento.',
    'O CONTRATANTE pagará ao CONTRATADO o valor total de R$ {{valor}} ({{valor_extenso}}), mediante {{forma_pagamento}}, conforme cronograma estabelecido. O valor inclui todos os custos relacionados à execução, exceto os expressamente excluídos.',
    'CC/2002 arts. 313-326',
    'baixo',
    ['valor', 'pagamento', 'forma']
  )
];

const PI = 'pi';
const C_PI: ClauseCategory = 'propriedade_intelectual';

const PI_BASE: ClauseDefinition[] = [
  mk(
    PI,
    'Cessão Total de Direitos Patrimoniais',
    C_PI,
    'Cede todos os direitos ao contratante.',
    'O CONTRATADO cede ao CONTRATANTE, de forma total, irrevogável e irretratável, todos os direitos patrimoniais sobre obras intelectuais criadas para este contrato, incluindo reprodução, distribuição, comunicação ao público e transformação, pelo território mundial e por prazo indeterminado (Lei 9.610/1998 arts. 28-33).',
    'Lei 9.610/1998 arts. 28-33',
    'alto',
    ['cessão', 'direitos patrimoniais', 'LDA']
  )
];

const CONF = 'conf';
const C_CONF: ClauseCategory = 'confidencialidade';

const CONF_BASE: ClauseDefinition[] = [
  mk(
    CONF,
    'Definição de Informações Confidenciais',
    C_CONF,
    'Define o escopo da confidencialidade.',
    'São "Informações Confidenciais" todas as informações não públicas divulgadas entre as partes no contexto deste contrato: dados financeiros, estratégias, código-fonte, listas de clientes, processos, metodologias e quaisquer outros dados, em qualquer suporte ou meio.',
    'CC/2002 art. 422; Lei 9.279/1996 art. 195',
    'alto',
    ['definição', 'confidencial', 'segredo']
  )
];

const RP = 'rp';
const C_RP: ClauseCategory = 'rescisao_penalidades';

const RP_BASE: ClauseDefinition[] = [
  mk(
    RP,
    'Rescisão por Mútuo Acordo',
    C_RP,
    'Rescisão consensual sem penalidades.',
    'Este contrato pode ser rescindido a qualquer tempo por mútuo acordo, mediante instrumento escrito assinado por ambos, com liquidação dos serviços prestados e pagamento proporcional ao trabalho realizado. Não haverá cláusula penal na rescisão consensual.',
    'CC/2002 art. 472',
    'baixo',
    ['mútuo acordo', 'consensual', 'liquidação']
  )
];

const RC = 'rc';
const C_RC: ClauseCategory = 'responsabilidade_civil';

const RC_BASE: ClauseDefinition[] = [
  mk(
    RC,
    'Responsabilidade por Danos Diretos',
    C_RC,
    'Responsabilidade por culpa ou dolo.',
    'Cada parte responde pelos danos diretos que causar à outra em razão de ato culposo ou doloso na execução deste contrato (CC arts. 186 e 927). A responsabilidade objetiva aplica-se nas hipóteses do art. 927, parágrafo único, do Código Civil.',
    'CC/2002 arts. 186, 927',
    'alto',
    ['responsabilidade', 'danos diretos', 'culpa']
  )
];

const PE = 'pe';
const C_PE: ClauseCategory = 'prazo_entrega';

const PE_BASE: ClauseDefinition[] = [
  mk(
    PE,
    'Cronograma Detalhado de Entregas',
    C_PE,
    'Estabelece cronograma de entrega por fases.',
    'Os serviços serão executados conforme o cronograma: {{cronograma_detalhado}}. Os prazos começam após: (i) assinatura do contrato; (ii) recebimento do sinal quando aplicável; (iii) fornecimento de todos os insumos pelo CONTRATANTE.',
    'CC/2002 art. 394',
    'baixo',
    ['cronograma', 'prazo', 'início', 'insumos']
  )
];

const FC = 'fc';
const C_FC: ClauseCategory = 'foro_conflitos';

const FC_BASE: ClauseDefinition[] = [
  mk(
    FC,
    'Foro da Comarca do Contratante',
    C_FC,
    'Foro do local da prestação dos serviços.',
    'As partes elegem o foro da comarca de {{cidade_contratante}}, Estado de {{estado}}, para dirimir questões oriundas deste contrato, com renúncia expressa a qualquer outro, por mais privilegiado que seja (CPC art. 63).',
    'CPC art. 63',
    'baixo',
    ['foro', 'comarca', 'eleição']
  )
];

interface VariantTemplate {
  suffix: string;
  modifier: string;
  risk: RiskLevel;
  prof?: string;
}

const PROFESSIONS: VariantTemplate[] = [
  { suffix: 'dev_web', modifier: 'Desenvolvimento Web', risk: 'medio', prof: 'dev_web' },
  { suffix: 'dev_mobile', modifier: 'Desenvolvimento Mobile', risk: 'medio', prof: 'dev_mobile' },
  { suffix: 'dev_backend', modifier: 'Desenvolvimento Backend', risk: 'medio', prof: 'dev_backend' },
  { suffix: 'dev_frontend', modifier: 'Desenvolvimento Frontend', risk: 'baixo', prof: 'dev_frontend' },
  { suffix: 'dev_fullstack', modifier: 'Desenvolvimento Full Stack', risk: 'medio', prof: 'dev_fullstack' },
  { suffix: 'design_grafico', modifier: 'Design Gráfico', risk: 'baixo', prof: 'design_grafico' },
  { suffix: 'ux_ui', modifier: 'UX/UI Design', risk: 'baixo', prof: 'ux_ui' },
  { suffix: 'motion', modifier: 'Motion Design', risk: 'baixo', prof: 'motion' },
  { suffix: 'branding', modifier: 'Branding e Identidade Visual', risk: 'medio', prof: 'branding' },
  { suffix: 'foto', modifier: 'Fotografia Profissional', risk: 'baixo', prof: 'foto' },
  { suffix: 'video', modifier: 'Produção de Vídeo', risk: 'medio', prof: 'video' },
  { suffix: 'audiovisual', modifier: 'Produção Audiovisual', risk: 'medio', prof: 'audiovisual' },
  { suffix: 'mkt_digital', modifier: 'Marketing Digital', risk: 'baixo', prof: 'mkt_digital' },
  { suffix: 'seo', modifier: 'SEO e SEM', risk: 'baixo', prof: 'seo' },
  { suffix: 'social_media', modifier: 'Social Media', risk: 'baixo', prof: 'social_media' },
  { suffix: 'copywriting', modifier: 'Copywriting e Redação', risk: 'baixo', prof: 'copywriting' },
  { suffix: 'traducao', modifier: 'Tradução e Interpretação', risk: 'baixo', prof: 'traducao' },
  { suffix: 'consultoria', modifier: 'Consultoria Empresarial', risk: 'medio', prof: 'consultoria' },
  { suffix: 'gestao_projetos', modifier: 'Gestão de Projetos', risk: 'medio', prof: 'gestao_projetos' },
  { suffix: 'ti_infra', modifier: 'TI e Infraestrutura', risk: 'alto', prof: 'ti_infra' },
  { suffix: 'cloud', modifier: 'Cloud Computing', risk: 'alto', prof: 'cloud' },
  { suffix: 'devops', modifier: 'DevOps e SRE', risk: 'alto', prof: 'devops' },
  { suffix: 'seginfo', modifier: 'Segurança da Informação', risk: 'alto', prof: 'seginfo' },
  { suffix: 'data_science', modifier: 'Ciência de Dados', risk: 'alto', prof: 'data_science' },
  { suffix: 'bi', modifier: 'Business Intelligence', risk: 'medio', prof: 'bi' },
  { suffix: 'ia_ml', modifier: 'IA e Machine Learning', risk: 'alto', prof: 'ia_ml' },
  { suffix: 'blockchain', modifier: 'Blockchain e Web3', risk: 'alto', prof: 'blockchain' },
  { suffix: 'ecommerce', modifier: 'E-commerce', risk: 'medio', prof: 'ecommerce' },
  { suffix: 'saas', modifier: 'SaaS e Produtos Digitais', risk: 'alto', prof: 'saas' },
  { suffix: 'crm_erp', modifier: 'CRM e ERP', risk: 'alto', prof: 'crm_erp' },
  { suffix: 'fintech', modifier: 'Fintech e Open Finance', risk: 'alto', prof: 'fintech' },
  { suffix: 'healthtech', modifier: 'HealthTech e Saúde Digital', risk: 'alto', prof: 'healthtech' },
  { suffix: 'edtech', modifier: 'EdTech e Educação Online', risk: 'medio', prof: 'edtech' },
  { suffix: 'legaltech', modifier: 'LegalTech', risk: 'alto', prof: 'legaltech' },
  { suffix: 'proptech', modifier: 'PropTech e Imobiliário Digital', risk: 'alto', prof: 'proptech' },
  { suffix: 'agrotech', modifier: 'AgroTech', risk: 'medio', prof: 'agrotech' },
  { suffix: 'govtech', modifier: 'GovTech e Setor Público', risk: 'alto', prof: 'govtech' },
  { suffix: 'dpo_lgpd', modifier: 'DPO e Conformidade LGPD', risk: 'alto', prof: 'dpo_lgpd' },
  { suffix: 'rh', modifier: 'Recursos Humanos e RH Tech', risk: 'medio', prof: 'rh' },
  { suffix: 'financeiro', modifier: 'Serviços Financeiros', risk: 'alto', prof: 'financeiro' },
  { suffix: 'contabilidade', modifier: 'Contabilidade e Auditoria', risk: 'alto', prof: 'contabilidade' },
  { suffix: 'juridico', modifier: 'Assessoria Jurídica', risk: 'alto', prof: 'juridico' },
  { suffix: 'arquitetura', modifier: 'Arquitetura e Engenharia', risk: 'alto', prof: 'arquitetura' },
  { suffix: 'logistica', modifier: 'Logística e Supply Chain', risk: 'medio', prof: 'logistica' },
  { suffix: 'eventos', modifier: 'Organização de Eventos', risk: 'medio', prof: 'eventos' },
  { suffix: 'treinamento', modifier: 'Treinamento e Capacitação', risk: 'baixo', prof: 'treinamento' },
  { suffix: 'startup', modifier: 'Startup e Inovação', risk: 'alto', prof: 'startup' },
  { suffix: 'sustentavel', modifier: 'Negócios Sustentáveis e ESG', risk: 'baixo', prof: 'sustentavel' },
  { suffix: 'agile_coach', modifier: 'Agile Coach e Scrum Master', risk: 'baixo', prof: 'agile_coach' },
  { suffix: 'product_mgmt', modifier: 'Product Management', risk: 'medio', prof: 'product_mgmt' }
];

const PRAZO_VARIANTS: VariantTemplate[] = [
  { suffix: 'p_2d', modifier: 'prazo de 2 dias úteis', risk: 'baixo' },
  { suffix: 'p_3d', modifier: 'prazo de 3 dias úteis', risk: 'baixo' },
  { suffix: 'p_5d', modifier: 'prazo de 5 dias úteis', risk: 'baixo' },
  { suffix: 'p_7d', modifier: 'prazo de 7 dias corridos', risk: 'baixo' },
  { suffix: 'p_10d', modifier: 'prazo de 10 dias úteis', risk: 'baixo' },
  { suffix: 'p_15d', modifier: 'prazo de 15 dias corridos', risk: 'baixo' },
  { suffix: 'p_30d', modifier: 'prazo de 30 dias corridos', risk: 'baixo' },
  { suffix: 'p_45d', modifier: 'prazo de 45 dias corridos', risk: 'medio' },
  { suffix: 'p_60d', modifier: 'prazo de 60 dias corridos', risk: 'medio' },
  { suffix: 'p_90d', modifier: 'prazo de 90 dias corridos', risk: 'medio' },
  { suffix: 'p_6m', modifier: 'prazo de 6 meses', risk: 'medio' },
  { suffix: 'p_1a', modifier: 'prazo de 1 ano', risk: 'medio' }
];

const MULTA_VARIANTS: VariantTemplate[] = [
  { suffix: 'm_1pct', modifier: 'multa de 1%', risk: 'baixo' },
  { suffix: 'm_2pct', modifier: 'multa de 2%', risk: 'baixo' },
  { suffix: 'm_5pct', modifier: 'multa de 5%', risk: 'medio' },
  { suffix: 'm_10pct', modifier: 'multa de 10%', risk: 'medio' },
  { suffix: 'm_20pct', modifier: 'multa de 20%', risk: 'alto' },
  { suffix: 'm_30pct', modifier: 'multa de 30%', risk: 'alto' },
  { suffix: 'm_50pct', modifier: 'multa de 50%', risk: 'alto' }
];

const TIPO_PRESTADOR: VariantTemplate[] = [
  { suffix: 't_pf', modifier: 'Pessoa Física (CPF)', risk: 'baixo' },
  { suffix: 't_mei', modifier: 'Microempreendedor Individual (MEI)', risk: 'baixo' },
  { suffix: 't_me', modifier: 'Microempresa (ME)', risk: 'baixo' },
  { suffix: 't_epp', modifier: 'Empresa de Pequeno Porte (EPP)', risk: 'baixo' },
  { suffix: 't_ltda', modifier: 'Sociedade Limitada (Ltda)', risk: 'baixo' },
  { suffix: 't_sa', modifier: 'Sociedade Anônima (S.A.)', risk: 'medio' },
  { suffix: 't_eireli', modifier: 'Empresa Individual (EIRELI)', risk: 'baixo' },
  { suffix: 't_slu', modifier: 'Sociedade Limitada Unipessoal (SLU)', risk: 'baixo' }
];

const CONTEXTO_VARIANTS: VariantTemplate[] = [
  { suffix: 'ctx_emergencial', modifier: 'em caráter emergencial', risk: 'medio' },
  { suffix: 'ctx_continuado', modifier: 'de natureza continuada', risk: 'baixo' },
  { suffix: 'ctx_pontual', modifier: 'de natureza pontual', risk: 'baixo' },
  { suffix: 'ctx_manutencao', modifier: 'de manutenção e suporte', risk: 'medio' },
  { suffix: 'ctx_implantacao', modifier: 'de implantação e go-live', risk: 'alto' },
  { suffix: 'ctx_auditoria', modifier: 'de auditoria e diagnóstico', risk: 'medio' },
  { suffix: 'ctx_migracao', modifier: 'de migração de sistemas', risk: 'alto' },
  { suffix: 'ctx_integracao', modifier: 'de integração de sistemas', risk: 'alto' },
  { suffix: 'ctx_prototipo', modifier: 'de prototipagem e MVP', risk: 'medio' },
  { suffix: 'ctx_mentoria', modifier: 'de mentoria e coaching', risk: 'baixo' },
  { suffix: 'ctx_pesquisa', modifier: 'de pesquisa e desenvolvimento', risk: 'medio' },
  { suffix: 'ctx_licenciamento', modifier: 'de licenciamento de software', risk: 'alto' }
];

function generateVariants(
  pfx: string,
  category: ClauseCategory,
  baseClauses: ClauseDefinition[],
  targetTotal: number
): ClauseDefinition[] {
  const result: ClauseDefinition[] = [...baseClauses];
  const allVariants = [...PROFESSIONS, ...PRAZO_VARIANTS, ...MULTA_VARIANTS, ...TIPO_PRESTADOR, ...CONTEXTO_VARIANTS];

  const catMeta: Record<ClauseCategory, { legal: string; theme: string; tags: string[] }> = {
    prestacao_servicos: { legal: 'CC/2002 arts. 593-609', theme: 'prestação de serviços', tags: ['serviço', 'prestação'] },
    pagamento_multas: { legal: 'CC/2002 arts. 313-326', theme: 'pagamento', tags: ['pagamento', 'valor'] },
    propriedade_intelectual: { legal: 'Lei 9.610/1998', theme: 'propriedade intelectual', tags: ['PI', 'direitos'] },
    confidencialidade: { legal: 'CC/2002 art. 422', theme: 'confidencialidade', tags: ['sigilo', 'NDA'] },
    rescisao_penalidades: { legal: 'CC/2002 arts. 472-475', theme: 'rescisão', tags: ['rescisão', 'penalidade'] },
    responsabilidade_civil: { legal: 'CC/2002 arts. 186, 927', theme: 'responsabilidade civil', tags: ['responsabilidade', 'dano'] },
    prazo_entrega: { legal: 'CC/2002 art. 394', theme: 'prazo e entrega', tags: ['prazo', 'entrega'] },
    foro_conflitos: { legal: 'CPC art. 63', theme: 'foro e conflitos', tags: ['foro', 'ADR'] }
  };

  const meta = catMeta[category];
  const contentPool = buildContentPool(category, meta.theme);
  let idx = 0;

  while (result.length < targetTotal) {
    const tpl = allVariants[idx % allVariants.length];
    const round = Math.floor(idx / allVariants.length) + 1;
    const contentIdx = idx % contentPool.length;

    result.push({
      id: uid(pfx),
      title: `${capitalize(meta.theme)} — ${tpl.modifier} (v${round})`,
      category,
      profession: tpl.prof ?? null,
      description: `Cláusula de ${meta.theme} adaptada para ${tpl.modifier}, variante ${round}. Conforme legislação brasileira vigente.`,
      content: contentPool[contentIdx].replace(/\{MODIFICADOR\}/g, tpl.modifier),
      legalBasis: meta.legal,
      riskLevel: tpl.risk,
      tags: [...meta.tags, tpl.suffix, `v${round}`, tpl.modifier.toLowerCase().replace(/\s+/g, '_').replace(/[()]/g, '')]
    });
    idx++;
  }

  return result;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildContentPool(cat: ClauseCategory, theme: string): string[] {
  const pools: Record<ClauseCategory, string[]> = {
    prestacao_servicos: [
      'Na prestação de serviços de {{escopo}} na modalidade {MODIFICADOR}, o CONTRATADO executará as atividades com autonomia técnica, diligência profissional e conformidade com as normas ABNT aplicáveis, nos termos dos arts. 593 a 609 do Código Civil.',
      'Os serviços de {{escopo}} realizados no formato {MODIFICADOR} serão documentados, entregues nos prazos acordados e revistos conforme a política de revisões deste contrato, respeitando as boas práticas da área e a legislação vigente.'
    ],
    pagamento_multas: [
      'O pagamento pelos serviços de {{escopo}} no formato {MODIFICADOR} será realizado conforme o cronograma financeiro acordado, com incidência de multa de 2% e juros de 1% ao mês em caso de atraso (CC art. 406; CDC art. 52, §1º).',
      'Para contratos no modelo {MODIFICADOR}, o valor será reajustado anualmente pelo IPCA, garantindo equilíbrio econômico-financeiro durante toda a vigência, nos termos do art. 317 do Código Civil.'
    ],
    propriedade_intelectual: [
      'Todas as criações de {MODIFICADOR} produzidas neste contrato são de titularidade exclusiva do CONTRATANTE desde o momento de sua criação, nos termos da Lei 9.610/1998 e Lei 9.609/1998, independentemente de registro.',
      'Para obras de {MODIFICADOR}, o CONTRATADO cede ao CONTRATANTE todos os direitos patrimoniais de forma total, irrevogável e sem limitação territorial ou temporal, nos termos dos arts. 28 a 33 da Lei de Direitos Autorais.'
    ],
    confidencialidade: [
      'No contexto de {MODIFICADOR}, o CONTRATADO reconhece que terá acesso a informações estratégicas do CONTRATANTE, obrigando-se ao mais rigoroso sigilo profissional durante e após a vigência contratual, conforme o art. 422 do Código Civil.',
      'As informações compartilhadas em contratos de {MODIFICADOR} são classificadas como confidenciais e não poderão ser divulgadas a terceiros, utilizadas para fins próprios ou reveladas após o término do contrato, sob pena de multa e indenização integral.'
    ],
    rescisao_penalidades: [
      'A rescisão de contratos de {MODIFICADOR} observará o prazo de aviso prévio de {{prazo}} dias, com liquidação proporcional dos serviços executados e cumprimento das penalidades aplicáveis ao caso (CC arts. 472, 473).',
      'Em {MODIFICADOR}, a rescisão por justa causa é imediata e prescinde de aviso prévio quando configurados: dolo, fraude, prática de ato ilícito ou violação grave de obrigação contratual essencial (CC arts. 474, 475).'
    ],
    responsabilidade_civil: [
      'Em contratos de {MODIFICADOR}, a responsabilidade civil limita-se aos danos diretos comprovados, sendo excluídos danos indiretos, lucros cessantes e danos punitivos, exceto em casos de dolo ou culpa grave (CC arts. 403, 944).',
      'Para {MODIFICADOR}, cada parte é responsável exclusivamente por seus próprios atos e omissões. A responsabilidade solidária só ocorre nas hipóteses expressamente previstas em lei ou neste contrato (CC art. 265).'
    ],
    prazo_entrega: [
      'Os prazos para entrega de {MODIFICADOR} só começam a contar após o recebimento de todos os insumos necessários pelo CONTRATADO: briefing completo, materiais, acessos e pagamento inicial (CC art. 476).',
      'Para {MODIFICADOR}, considera-se entrega cumprida no momento em que o CONTRATADO disponibilizar os entregáveis no repositório ou meio acordado e enviar notificação formal ao CONTRATANTE, independentemente de aceite imediato.'
    ],
    foro_conflitos: [
      'Para conflitos em {MODIFICADOR}, as partes adotarão processo de escalonamento: negociação direta, mediação e, se necessário, arbitragem ou ação judicial no foro eleito, conforme os princípios da Lei 13.140/2015 e Lei 9.307/1996.',
      'Em disputas de {MODIFICADOR} de natureza técnica, as partes poderão, de comum acordo, designar perito especializado como auxiliar da mediação, antes de submeter o conflito ao Poder Judiciário (CPC art. 156).'
    ]
  };

  return pools[cat] ?? [`Cláusula de ${theme} para {MODIFICADOR}, conforme legislação brasileira vigente.`];
}

const TARGET = 310;

export const PRESTACAO_SERVICOS = generateVariants(PS, C_PS, PRESTACAO_BASE, TARGET);
export const PAGAMENTO_MULTAS = generateVariants(PM, C_PM, PAGAMENTO_BASE, TARGET);
export const PROPRIEDADE_INTELECTUAL = generateVariants(PI, C_PI, PI_BASE, TARGET);
export const CONFIDENCIALIDADE = generateVariants(CONF, C_CONF, CONF_BASE, TARGET);
export const RESCISAO_PENALIDADES = generateVariants(RP, C_RP, RP_BASE, TARGET);
export const RESPONSABILIDADE_CIVIL = generateVariants(RC, C_RC, RC_BASE, TARGET);
export const PRAZO_ENTREGA = generateVariants(PE, C_PE, PE_BASE, TARGET);
export const FORO_CONFLITOS = generateVariants(FC, C_FC, FC_BASE, TARGET);

export const ALL_CLAUSES: ClauseDefinition[] = [
  ...PRESTACAO_SERVICOS,
  ...PAGAMENTO_MULTAS,
  ...PROPRIEDADE_INTELECTUAL,
  ...CONFIDENCIALIDADE,
  ...RESCISAO_PENALIDADES,
  ...RESPONSABILIDADE_CIVIL,
  ...PRAZO_ENTREGA,
  ...FORO_CONFLITOS
];

export const getByCategory = (cat: ClauseCategory) => ALL_CLAUSES.filter((c) => c.category === cat);
export const getByProfession = (prof: string) => ALL_CLAUSES.filter((c) => c.profession === prof || c.profession === null);
export const searchClauses = (q: string) => {
  const lq = q.toLowerCase();
  return ALL_CLAUSES.filter(
    (c) => c.title.toLowerCase().includes(lq) || c.content.toLowerCase().includes(lq) || c.tags.some((t) => t.includes(lq))
  );
};

export const getStats = () => {
  const byCat: Record<string, number> = {};
  const byRisk: Record<RiskLevel, number> = { baixo: 0, medio: 0, alto: 0 };

  for (const cl of ALL_CLAUSES) {
    byCat[cl.category] = (byCat[cl.category] ?? 0) + 1;
    byRisk[cl.riskLevel]++;
  }

  return { total: ALL_CLAUSES.length, byCategory: byCat, byRisk };
};
