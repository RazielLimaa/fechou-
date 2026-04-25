# Motor de Modelagem Contratual Contextual (MCC)

Blueprint tecnico para evoluir o Fechou de um gerador de documentos para um motor deterministico, auditavel e orientado a decisoes explicaveis.

Este documento descreve o desenho de producao e aponta o esqueleto implementado em `src/services/contracts/mcc`.

## 1. Arquitetura

O MCC deve ser um nucleo deterministico. IA pode enriquecer entrada, sugerir texto ou explicar escolhas, mas nao deve ser a fonte de verdade das decisoes juridicas.

Fluxo dos componentes:

1. `Context Engine`: normaliza entrada, classifica contrato, relacao B2B/B2C, adesao, valor, dados pessoais, IP, forma legal e fatos.
2. `Risk Engine`: cria perfil de risco inicial e consolidado.
3. `Evidence/Proof Engine`: recomenda assinatura, testemunhas e eventos probatorios.
4. `Rule Engine`: aplica regras com prioridade, encadeamento, fallback, conflitos e obrigatoriedade.
5. `Clause Composition Engine`: seleciona clausulas, variantes e intensidades.
6. `Contract Graph`: estrutura o contrato em nos vivos e dependencias.
7. `Validation Engine`: detecta lacunas juridicas, abusividade, conflito, LGPD incompleta e prova fraca.
8. `Score Engine`: calcula score por cobertura legal, financeiro, clareza, prova e equilibrio.
9. `Snapshot/Decision Log`: congela contexto, clausulas, graph, score e trilha explicavel.

Principio central: cada resultado precisa responder `por que entrou`, `qual regra disparou`, `qual base legal suporta`, `qual risco reduz` e `qual evidencia foi exigida`.

## 2. Dominio

Entidades principais:

- `Contract`: agregado raiz do contrato final, status, snapshot atual e tenant.
- `ContractDraft`: resultado modelado pelo MCC antes da aprovacao ou assinatura.
- `ContractContext`: fatos normalizados usados por regras e validacoes.
- `ClauseCatalog`: clausula abstrata, sem texto final, com categoria, node, risco e base legal.
- `ClauseVariant`: variante concreta por intensidade, rigidez e perfil de linguagem.
- `ClauseRule`: regra deterministica com condicao, prioridade, acoes, fallback e base legal.
- `ClauseDependency`: relacao entre clausulas: `requires`, `reinforces`, `conflicts_with`, `fallback_to`.
- `ContractClause`: clausula efetivamente selecionada para um draft.
- `RiskProfile`: riscos de contexto, regra e validacao.
- `ValidationIssue`: erro, alerta ou bloqueio juridico/probatorio.
- `ContractScore`: score total e dimensoes.
- `EvidenceProfile`: assinatura recomendada, testemunhas, eventos e prontidao probatoria.
- `ContractSnapshot`: versao imutavel do resultado.
- `DecisionLog`: log append-only de decisoes explicaveis.

Value objects e enums:

- `Money`: `amountCents`, `currency`.
- `ClauseStyleProfile`: intensidade, rigidez e linguagem.
- `LegalReference`: fonte, artigo, URL e observacao.
- `EvidenceEventRequirement`: evento, campos e obrigatoriedade.
- `ContractKind`: service agreement, project statement, SaaS, license, NDA, partnership, real estate.
- `PartyRelationshipKind`: B2B ou B2C.
- `ClauseIntensityLevel`: light, medium, strong.
- `ValidationSeverity`: info, warning, error, blocker.
- `SignatureLevel`: simple, advanced, qualified.

## 3. Banco de dados

O schema alvo esta em `src/db/schema.mcc.ts` e foi mantido separado do `schema.ts` legado.

Tabelas alvo:

- `contracts`: agregado contratual, status, tipo, relacao, valor, contexto de consumo/adesao e snapshot atual.
- `contract_contexts`: entrada bruta, contexto normalizado, fatos e hash do contexto.
- `clause_catalog`: catalogo abstrato e versionado de clausulas.
- `clause_variants`: texto/variante por intensidade, linguagem, rigidez e hash.
- `clause_rules`: regras versionadas com condicoes, acoes e fallback.
- `clause_dependencies`: dependencias, reforcos e conflitos entre clausulas.
- `contract_clauses`: clausulas selecionadas por contrato, posicao, node, intensidade e hash.
- `validation_issues`: issues por contrato/snapshot, com severidade e recomendacao.
- `contract_scores`: score total, dimensoes, penalidades e hash.
- `evidence_profiles`: assinatura, testemunhas, eventos exigidos e readiness.
- `decision_logs`: trilha append-only com `previousHash` e `entryHash`.
- `contract_snapshots`: versao imutavel do contrato modelado.

Regras de persistencia:

- Nunca editar snapshot assinado.
- Nunca hard delete de clausula publicada.
- Sempre preservar `clauseCode`, `variantId`, `variantVersion`, `contentHash` e `decisionRefs`.
- Decision log deve ser append-only e idealmente encadeado por hash.
- Toda decisao do motor deve ser reproduzivel a partir de contexto, regras, catalogo e versoes.

## 4. Rule Engine

O rule engine implementado em `rule-engine.ts` usa:

- prioridade decrescente;
- condicoes compostas `all`, `any`, `not` e `fact`;
- acoes `select_clause`, `exclude_clause`, `raise_risk`, `raise_issue`, `set_evidence`, `set_fact`;
- fallback por regra;
- selecao de intensidade mais forte quando regras colidem;
- emissao de `DecisionLog` por acao relevante.

Exemplos obrigatorios implementados:

- Prestacao de servico seleciona `object_scope`, `term_duration`, `payment_terms`, `deliverables_acceptance`.
- Valor alto seleciona multa forte, juros, garantia e evidence pack reforcado.
- Dados pessoais selecionam `lgpd_roles` e `lgpd_security`.
- Dados sensiveis sobem LGPD para forte e adicionam incidente.
- IP por cessao exclui licenca; IP por licenca exclui cessao.
- Recorrencia adiciona cobranca recorrente e reajuste.
- Consumo adiciona transparencia e remove limitacao B2B.
- Arbitragem tem fallback para foro.
- Arbitragem em adesao exige destaque e aceite especifico.
- Prioridade de titulo executivo adiciona testemunhas e prova reforcada.
- Forma especial imobiliaria gera blocker.

## 5. Contract Graph

O contrato nao deve ser tratado como lista linear de textos. Ele e um grafo.

Nos:

- `core`: partes, objeto, escopo, definicoes.
- `financial`: preco, pagamento, recorrencia, reajuste e mora.
- `execution`: prazo, entregaveis, aceite, milestones.
- `risk`: multa, garantia, responsabilidade, inadimplemento.
- `legal`: LGPD, assinatura, prova, IP, forma legal.
- `disputes`: foro, arbitragem, destaque de adesao.
- `annexes`: anexos, OS, politicas e snapshots.

Como os nos se fortalecem:

- `penalty_clause` requer `payment_terms`.
- `collateral_guarantee` reforca `penalty_clause`.
- `lgpd_security` requer `lgpd_roles`.
- `lgpd_incident_response` requer `lgpd_security`.
- `arbitration_clause` requer `adhesion_highlight_notice` se houver adesao.
- `witness_block` reforca `evidence_pack`.

O graph permite explicar lacunas: por exemplo, um contrato pode ter uma multa forte, mas sem pagamento claro ela fica desconectada.

## 6. Intensidade das clausulas

Toda clausula deve ter:

- `intensity`: light, medium, strong.
- `rigidity`: flexible, balanced, strict.
- `language`: plain Portuguese, formal, technical, consumer friendly.
- `guardrails`: limites para evitar texto abusivo ou fragil.

Exemplo de multa:

- `light`: baixa exposicao, foco em mora simples.
- `medium`: inadimplemento relevante, prazo de cura e proporcionalidade.
- `strong`: alto valor, garantia e prova, com alerta de reducao judicial se excessiva.

Exemplo de LGPD:

- `medium`: papeis, finalidade, base, seguranca e retencao.
- `strong`: instrucoes, suboperadores, incidente, logs, cooperacao e segregacao.

## 7. Validacao juridica

Cada issue tem:

- severidade;
- categoria;
- impacto;
- mensagem tecnica;
- mensagem amigavel;
- recomendacao;
- referencias legais;
- clausulas afetadas;
- flag `blocking`.

Validacoes implementadas:

- ausencia de pagamento;
- LGPD incompleta;
- dados sensiveis sem incidente;
- limitacao B2B em B2C;
- arbitragem irregular em adesao;
- multa forte em consumo ou baixo valor;
- ausencia de aceite;
- forma legal especial;
- IP indefinido;
- lacuna probatoria para art. 784.

O motor nao deve prometer validade absoluta. Ele deve sinalizar robustez, fragilidade e proximos passos.

## 8. Score contratual

Dimensoes:

- `legalCoverage`: cobertura legal e ausencia de blockers.
- `financialProtection`: pagamento, juros, multa, garantia e reajuste.
- `clarity`: objeto, prazo, aceite e anexos.
- `evidence`: assinatura, hash, aceite, eventos, testemunhas.
- `legalBalance`: equilibrio em consumo, adesao e arbitragem.

Peso atual:

- cobertura legal: 30%;
- protecao financeira: 20%;
- clareza: 15%;
- prova: 20%;
- equilibrio juridico: 15%.

Grades:

- A: 90+;
- B: 80-89;
- C: 70-79;
- D: 60-69;
- E: abaixo de 60.

## 9. Pipeline

1. Input do usuario.
2. Interpretacao e classificacao pelo Context Engine.
3. Risco inicial.
4. Evidence profile base.
5. Estrutura base do contrato.
6. Aplicacao de regras.
7. Dependencias e conflitos.
8. Intensidade das clausulas.
9. Validacao juridica.
10. Risco consolidado.
11. Score.
12. Snapshot e decision log.
13. Saida explicavel.

Controle de volume para UX:

- O usuario pode pedir um contrato mais enxuto por `clauseMode` ou `targetClauseCount`.
- O limite deve ser interpretado como "ate N clausulas", preservando o minimo recomendado para nao criar lacunas obvias.
- O motor deve retornar metadados de selecao (`requestedCount`, `selectedCount`, `minimumRecommendedCount`, `raisedToMinimum`) para o front explicar ajustes sem texto massivo.
- Se o usuario pedir menos que o minimo recomendado, a interface deve mostrar uma explicacao curta, por exemplo: "Mantivemos 6 clausulas essenciais para evitar lacunas importantes."

Campos de preenchimento:

- O motor deve expor `templateFields` e `missingTemplateFields` para o front saber quais dados precisam ser pedidos.
- Dados de qualificacao das partes devem entrar no contexto: `providerDocument`, `providerAddress`, `clientDocument` e `clientAddress`.
- A interface deve mostrar esses campos de forma simples, com textos curtos como "Documento da empresa que emite o contrato" e "Endereco usado na qualificacao".
- O contrato nao deve seguir para assinatura com marcadores como `CNPJ [preencher]` sem alerta claro ao usuario.

## 10. Codigo

Arquivos criados:

- `src/services/contracts/mcc/types.ts`: enums e value objects.
- `src/services/contracts/mcc/domain.ts`: entidades e contratos de dominio.
- `src/services/contracts/mcc/catalog.ts`: catalogo, variantes, dependencias e regras base.
- `src/services/contracts/mcc/rule-engine.ts`: executor deterministico de regras.
- `src/services/contracts/mcc/context-engine.ts`: normalizacao e fatos.
- `src/services/contracts/mcc/risk-engine.ts`: risco contextual e consolidado.
- `src/services/contracts/mcc/evidence-engine.ts`: assinatura, testemunhas e eventos.
- `src/services/contracts/mcc/clause-composition-engine.ts`: composicao de clausulas.
- `src/services/contracts/mcc/contract-graph.ts`: graph vivo do contrato.
- `src/services/contracts/mcc/validation-engine.ts`: validacao juridica.
- `src/services/contracts/mcc/score-engine.ts`: score contratual.
- `src/services/contracts/mcc/engine.ts`: orquestrador do pipeline.
- `src/services/contracts/mcc/examples.ts`: cenarios reais de uso.
- `src/db/schema.mcc.ts`: schema Drizzle alvo.

Uso:

```ts
import { contractModelingEngine } from "./services/contracts/mcc/index.js";

const result = contractModelingEngine.model({
  contractKindHint: "saas",
  relationshipKindHint: "b2b",
  amount: { amountCents: 150_000_00, currency: "BRL" },
  recurringBilling: true,
  hasDeliverables: true,
  hasPersonalData: true,
  ipMode: "license",
  executiveTitlePriority: true,
  parties: [
    { role: "provider", documentType: "cnpj", isBusiness: true, isConsumer: false, isAdherent: false },
    { role: "customer", documentType: "cnpj", isBusiness: true, isConsumer: false, isAdherent: false },
  ],
});
```

## 11. Exemplos

Cenario B2B SaaS alto valor:

- classifica como `saas/b2b/high`;
- adiciona escopo, prazo, pagamento, aceite;
- adiciona LGPD minima;
- adiciona licenca de IP;
- reforca multa, juros, garantia e evidence pack;
- recomenda assinatura avancada ou qualificada conforme objetivo probatorio;
- adiciona testemunhas se o usuario quer reforco do art. 784.

Cenario B2C adesao:

- adiciona transparencia de consumo;
- remove limitacao B2B;
- exige destaque;
- se houver arbitragem, exige aceite especifico;
- penaliza score se houver linguagem agressiva ou prova insuficiente.

## 12. Melhorias futuras

- Persistir regras, variantes e dependencias no banco em vez de catalogo estatico.
- Adicionar `clause_versions` formal para major/minor/patch juridico.
- Criar endpoint `POST /api/contracts/:id/model-contextual`.
- Salvar `DecisionLog` com cadeia de hashes real.
- Gerar PDF com anexo tecnico de evidencias.
- Integrar IA apenas como camada assistiva: explicar, resumir, sugerir perguntas e preencher lacunas.
- Criar simulador de risco por vertical: SaaS, agencia, consultoria, audiovisual, aluguel, licenca.
- Criar teste de regressao juridica para regras criticas.
- Adicionar revisao humana obrigatoria para blockers e alto valor.
