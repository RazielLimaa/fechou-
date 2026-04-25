# Fechou Legal Blueprint

Esta fundacao juridica foi organizada para substituir o antigo catalogo combinatorio por uma base curada, auditavel e orientada a risco.

## Onde esta cada entrega

- Catalogo juridico estruturado: `src/services/contracts/legal-blueprint.ts`
- Adaptador para seed e busca legacy: `src/services/contracts/clause-engine.ts`
- Geracao automatica no backend: `src/services/contracts/contract-automation.service.ts`
- Endpoint de blueprint completo: `GET /api/clauses/catalog/blueprint`
- Endpoint para aplicar selecao automatica em um contrato: `POST /api/contracts/:id/auto-generate`
- Seed SQL gerado: `seed_fechou.sql`

## O que o blueprint entrega

- Contrato-modelo consolidado em `contractModelText`, com clausulas numeradas e placeholders operacionais.
- Catalogo modular com clausulas curadas, `required`, `riskLevel`, `appliesTo`, `variablesTemplate`, `jurisprudenceNotes`, `version` e `status`.
- Regras do motor juridico em `decisionRules`, com selecao por `audience`, `contractModels`, risco, dados pessoais, suporte, IP e metodo de assinatura.
- Warnings de risco para B2C, autenticacao fraca, juros genericos, ausencia de DPA e indefinicao de titularidade de codigo.
- Blueprint de evidence pack com eventos minimos, hash, log append-only e formatos exportaveis.
- Controle de volume de clausulas automaticas no `auto-generate`: `clauseMode` (`essential`, `balanced`, `complete`, `robust`, `custom`) e/ou `targetClauseCount`, preservando um minimo recomendado quando o limite pedido criaria lacunas.
- Campos de preenchimento contratual expostos para o front: `providerDocument`, `providerAddress`, `clientDocument` e `clientAddress`, com retorno `templateFields` e `missingTemplateFields` no `auto-generate`.

## Fontes oficiais priorizadas

- Planalto: Lei 14.063/2020, MP 2.200-2/2001, Lei 14.879/2024, Lei 14.905/2024, Codigo Civil compilado e LGPD.
- ANPD: guia de agentes de tratamento, guia de seguranca da informacao, Resolucao 2/2022 e Resolucao 4/2023.
- STJ: referencias oficiais para assinatura fora da ICP-Brasil, onus da prova quando a assinatura e impugnada, notificacao por e-mail, limitacao de responsabilidade empresarial e clausula penal.

## Observacoes importantes

- O texto foi desenhado para velocidade de operacao com lastro juridico, mas nao substitui revisao humana em casos de alto valor, regulacao setorial ou operacoes internacionais.
- A persistencia ainda usa a tabela legacy `clauses`; o proximo passo estrutural e criar `clause_versions`, `contract_clause_snapshot` e `contract_events`.
- O endpoint `/api/contracts/:id/auto-generate` atualiza as clausulas do contrato de forma deterministica e retorna o texto consolidado do contrato para revisao.
- O endpoint `/api/contracts/:id/auto-generate` aceita limite de clausulas automaticas. Use preferencialmente `targetClauseCount`; aliases aceitos: `maxAutomaticClauses`, `automaticClauseCount`, `autoClauseCount`, `clauseCount` e `clauseLimit`.
- Para evitar marcadores como `CNPJ [preencher]`, o front deve enviar os dados de qualificacao das partes. O backend tambem aceita aliases legados como `contratadaDocumento`, `contratadaEndereco`, `contratanteDocumento` e `contratanteEndereco`.
- A sincronizacao do catalogo agora purga IDs antigos da tabela `clauses`, mantendo apenas o conjunto curado do sistema novo.
