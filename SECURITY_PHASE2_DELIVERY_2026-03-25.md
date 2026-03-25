# Security Phase 2 Delivery — 2026-03-25

## 1) Matriz de confirmação do estado atual

| Item | Status | Arquivos | Risco residual |
|---|---|---|---|
| Session hardening completo | parcial -> implementado nesta fase | `src/routes/auth.routes.ts`, `src/middleware/auth.ts`, `src/services/token.ts`, `src/db/schema.oauth.ts` | monitorar rollout de cookies em produção |
| CSRF em fluxos cookie | pendente -> implementado nesta fase | `src/middleware/distributed-security.ts`, `src/app.ts`, `src/routes/auth.routes.ts` | rotas públicas/webhooks continuam corretamente excluídas |
| Rate limit distribuído | pendente -> implementado via PostgreSQL store compartilhado | `src/services/securityStore.ts`, `src/middleware/distributed-security.ts`, `src/routes/auth.routes.ts`, `src/routes/proposals.routes.ts`, `src/routes/webhooks.routes.ts` | recomendável migrar para Redis dedicado no próximo ciclo |
| Replay protection distribuída | pendente -> implementado via tabela compartilhada | `src/services/securityStore.ts`, `src/routes/webhooks.routes.ts`, `src/routes/payments.routes.ts` | cobertura pode ser expandida para mais fluxos one-time |
| RLS PostgreSQL | pendente -> entregue em migração com rollout seguro | `drizzle/0005_security_phase2.sql` | requer rollout coordenado de role/app user |
| CI security gates | pendente -> implementado | `.github/workflows/security-gates.yml` | ajustar baseline de falsos positivos |

## 2) O que faltava exatamente
- Sessão madura com cookie + refresh rotativo + logout/revogação.
- CSRF para mutações autenticadas por cookie.
- Store distribuído para limite e replay.
- RLS e políticas SQL para isolamento por linha.
- Gates mínimos de segurança no pipeline.

## 3) Plano aplicado
1. Consolidar contrato de sessão (`/login`, `/refresh`, `/logout`, `/me`) com cookies HttpOnly.
2. Aplicar CSRF em mutações com sessão cookie, preservando bearer e rotas técnicas.
3. Mover rate/replay para store compartilhado em PostgreSQL.
4. Entregar migração de RLS com políticas por owner e estratégia de rollout.
5. Criar gates de CI (Semgrep, CodeQL, audit, conflict markers).

## 4) Arquivos alterados
- `src/middleware/auth.ts`
- `src/routes/auth.routes.ts`
- `src/services/token.ts`
- `src/db/schema.oauth.ts`
- `src/db/schema.ts`
- `drizzle/0005_security_phase2.sql`
- `src/services/securityStore.ts`
- `src/middleware/distributed-security.ts`
- `src/app.ts`
- `src/routes/proposals.routes.ts`
- `src/routes/webhooks.routes.ts`
- `src/routes/payments.routes.ts`
- `.github/workflows/security-gates.yml`
- `tests/security/security-phase2.test.ts`
- `package.json`

## 5) Migrações / RLS
- `drizzle/0005_security_phase2.sql`:
  - cria tabelas `security_rate_limits` e `security_replay_tokens`
  - adiciona colunas de hardening em `refresh_tokens`
  - habilita RLS e cria políticas owner-based iniciais

## 6) Config de limiter/replay distribuído
- Implementado em `src/services/securityStore.ts` + `src/middleware/distributed-security.ts`.
- Usa chaves por escopo e TTL no banco compartilhado.
- Sem dependência de memória local.

## 7) Config de CI security gates
- `.github/workflows/security-gates.yml`:
  - merge conflict markers
  - Semgrep
  - CodeQL
  - npm audit high

## 8) Testes adicionados
- `tests/security/security-phase2.test.ts`
  - CSRF bloqueando mutação inválida
  - CSRF permitindo mutação válida
  - webhook signature fail-closed sem secret

## 9) Riscos residuais
- Redis dedicado continua recomendado para throughput alto (apesar de store distribuído já ativo via PostgreSQL).
- RLS deve ser ativado com cuidado em ambiente de produção (rollout por etapa e validação de papel).
- Step-up auth para ações ultra-sensíveis pode ser ampliado em ciclo seguinte.

## 10) Dependências de infra
- Aplicar migração SQL em ambiente.
- Validar role da aplicação sem BYPASSRLS.
- Ajustar variáveis de sessão/expiração (`JWT_REFRESH_EXPIRES_IN`, `JWT_REFRESH_ABSOLUTE_EXPIRES_IN`).

## 11) Checklist de produção madura (fase 2)
- Sessão robusta: ✅
- CSRF: ✅
- Rate/replay distribuído: ✅ (via PostgreSQL)
- RLS inicial: ✅ (migração entregue)
- CI gates: ✅
- Compatibilidade frontend: ✅ (mantido token em resposta + cookies)
