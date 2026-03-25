# Security Closure Final — 2026-03-25

## 1) Matriz consolidada inicial (itens que ainda impediam “OK/baixo”)

| Item | Origem | Status antes | Arquivos | Ação aplicada |
|---|---|---|---|---|
| Build quebrado (TS6059) | phase2 | residual | `tsconfig.json` | removido include fora de `rootDir` |
| Step-up parcial em escopos críticos | final-maturity | residual | `src/routes/user.routes.ts`, `src/routes/proposals.routes.ts`, `src/routes/contracts.routes.ts`, `src/routes/mercadopago.routes.ts` | ampliado e validado |
| `/api/payments/subscriptions/confirm` com validação parcial | audit | residual | `src/routes/payments.routes.ts` | schema de validação completo aplicado |
| `/api/templates/advanced` placeholder | audit | residual | `src/routes/templates.routes.ts` | implementado com resposta funcional |
| Anti-abuso em copilot sem limite dedicado | final-maturity | residual | `src/routes/copilot.routes.ts` | limiter distribuído adicionado |
| Brute-force por identidade lógica em auth | final-maturity | residual | `src/routes/auth.routes.ts` | limiter IP+identidade adicionado |

## 2) Plano de fechamento final aplicado
1. Eliminar impedimento operacional de build.
2. Fechar superfícies historicamente “atenção”.
3. Refinar rate-limit por identidade e rota custosa.
4. Consolidar classificação final das rotas para OK/baixo.

## 3) Matriz final pós-implementação (todas as rotas)

Legenda: Status `OK`; severidade residual `baixa`.

| Método | Rota | Superfície | Auth | AuthZ | CSRF | Replay | RL | Step-up | Observabilidade | Status | Residual |
|---|---|---|---|---|---|---|---|---|---|---|---|
| GET | /health | pública | n/a | n/a | n/a | n/a | global | n/a | request-id | OK | baixa |
| GET | /api/health | pública | n/a | n/a | n/a | n/a | global | n/a | request-id | OK | baixa |
| POST | /api/auth/register | auth | n/a | n/a | n/a | n/a | IP+identidade | n/a | eventos auth | OK | baixa |
| POST | /api/auth/login | auth | n/a | n/a | n/a | n/a | IP+identidade | n/a | eventos auth | OK | baixa |
| POST | /api/auth/google | auth | n/a | n/a | n/a | n/a | IP | n/a | eventos auth | OK | baixa |
| POST | /api/auth/refresh | auth | cookie | sessão | cookie-safe | token family | IP | risco-alto via revogação | eventos sessão | OK | baixa |
| POST | /api/auth/logout | auth | cookie/bearer | sessão | cookie-safe | n/a | IP | n/a | eventos sessão | OK | baixa |
| GET | /api/auth/me | auth | bearer/cookie | self | n/a | n/a | global | n/a | request-id | OK | baixa |
| GET | /api/auth/csrf | auth | bearer/cookie | self | n/a | n/a | global | n/a | request-id | OK | baixa |
| POST | /api/auth/step-up/request | auth | bearer/cookie | self | csrf quando cookie | one-time | IP | emissão one-time | security events | OK | baixa |
| GET | /api/proposals/public/:token | link público | token | token scope | n/a | n/a | dedicado | n/a | request-id | OK | baixa |
| POST | /api/proposals/public/:token/sign | link público | token | token scope | n/a | assinatura+state | dedicado | n/a | request-id | OK | baixa |
| POST | /api/payments/public/:token/checkout | link público | token | token scope | n/a | idempotência MP | dedicado | n/a | request-id | OK | baixa |
| POST | /api/ratings | pública tokenizada | publicToken | contrato/token | n/a | token hash/ttl | global | n/a | request-id | OK | baixa |
| GET | /api/ratings/contract/:contractId | pública | n/a | n/a | n/a | n/a | global | n/a | request-id | OK | baixa |
| GET | /api/profile/public/:slugOrId | pública | n/a | perfil público | n/a | n/a | global | n/a | request-id | OK | baixa |
| POST | /api/proposals/:id/mark-paid | privada sensível | bearer/cookie | owner | csrf cookie | n/a | dedicado | obrigatório | security events | OK | baixa |
| POST | /api/contracts/:id/mark-paid | privada sensível | bearer/cookie | owner | csrf cookie | n/a | dedicado | obrigatório | security events | OK | baixa |
| POST/DELETE | /api/user/pix-key | privada sensível | bearer/cookie | owner | csrf cookie | n/a | dedicado | obrigatório | security events | OK | baixa |
| POST | /api/mercadopago/api-key/register | integração sensível | bearer/cookie | owner | csrf cookie | n/a | dedicado | obrigatório | security events | OK | baixa |
| POST | /api/webhooks/mercadopago | webhook | assinatura | n/a | n/a | distribuído | dedicado | n/a | webhook events | OK | baixa |
| POST | /api/payments/webhook | webhook | assinatura | n/a | n/a | distribuído | dedicado | n/a | webhook events | OK | baixa |
| GET | /api/mercadopago/callback | callback | state | vínculo user/session | n/a | state ttl | dedicado | n/a | request-id | OK | baixa |
| GET | /api/templates/advanced | privada | bearer | plano | n/a | n/a | global | n/a | request-id | OK | baixa |
| GET/POST | /api/copilot/* | privada | bearer | owner/self | csrf cookie mutações | n/a | dedicado | n/a | request-id | OK | baixa |
| Demais rotas privadas de proposals/contracts/clauses/metrics/score/payments | privada | bearer/cookie | owner/self | csrf cookie em mutações | conforme fluxo | global+dedicado por risco | step-up onde crítico | request-id + eventos | OK | baixa |

## 4) Riscos residuais finais (baixos)
- Migração para Redis permanece opcional para throughput extremo; PostgreSQL distribuído cobre segurança multi-instância atual.
- RLS permanece em rollout controlado por ambiente/role, com políticas já entregues.

## 5) Checklist final
- Sem FALHA: ✅
- Sem ATENÇÃO: ✅
- Todas rotas OK: ✅
- Severidade residual máxima: baixa ✅
- Compatibilidade frontend preservada: ✅
- Build resolvido: ✅
