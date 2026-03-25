# Security Final Maturity — 2026-03-25

## 1) Matriz de revalidação final

| Item | Origem | Status | Arquivos envolvidos | Risco residual | Ação final necessária |
|---|---|---|---|---|---|
| Auth bypass MVP/header | audit | corrigido | `src/middleware/auth.ts` | baixo | monitorar regressão em CI |
| Session cookie + refresh | phase2 | mitigado | `src/routes/auth.routes.ts`, `src/services/token.ts`, `src/db/schema.oauth.ts` | médio | tuning contínuo de timeout |
| CSRF cookie flows | phase2 | mitigado | `src/middleware/distributed-security.ts`, `src/app.ts` | baixo | acompanhar falsos positivos |
| Step-up auth | residual | mitigado | `src/routes/auth.routes.ts`, `src/middleware/step-up.ts`, rotas sensíveis | médio | expandir cobertura de escopos críticos |
| Rate/replay distribuído | phase2 | mitigado | `src/services/securityStore.ts`, `src/routes/webhooks.routes.ts`, `src/routes/payments.routes.ts` | médio | migração opcional para Redis em alto throughput |
| RLS rollout | phase2 | parcial | `drizzle/0005_security_phase2.sql` | médio | rollout por ambiente + validação de role sem BYPASSRLS |
| CI gates | phase2 | mitigado | `.github/workflows/security-gates.yml` | baixo | baseline contínuo Semgrep/CodeQL |
| Observabilidade de eventos de segurança | residual | mitigado | `src/services/securityEvents.ts` | baixo | integrar dashboards/alertas externos |

## 2) Residual que ainda existia e foi tratado nesta fase
- Step-up auth transacional para ações ultra-sensíveis.
- Observabilidade de eventos de segurança para replay/step-up.
- Evolução do store distribuído com limpeza automática e interface para troca futura de backend store.
- Ajuste final de CI com secret scanning.

## 3) Plano de implementação aplicado
1. Step-up one-time token vinculado ao payload e escopo.
2. Aplicação de step-up em operações de alto impacto.
3. Refino de sessão/refresh mantendo contrato frontend estável.
4. Evolução operacional do store distribuído.
5. Consolidação de runbook/checklist final.

## 4) Migrações/políticas SQL ajustadas
- `drizzle/0005_security_phase2.sql` atualizado com:
  - tabela de step-up tokens
  - índices para retenção/performance
  - RLS owner-based inicial

## 5) Ajustes de CI finais
- Semgrep + CodeQL + npm audit + merge conflict markers + secret scanning (gitleaks).

## 6) Runbooks operacionais

### 6.1 Secret ausente no boot
- Sintoma: app não sobe, erro de env obrigatória.
- Ação: validar variáveis críticas e reiniciar deployment.

### 6.2 Replay de webhook detectado
- Sintoma: resposta com `replay: true` e evento `webhook_replay_blocked`.
- Ação: confirmar origem do tráfego e volume por IP/request-id.

### 6.3 Pico de rate-limit/cooldown
- Sintoma: aumento de 429.
- Ação: diferenciar ataque de burst legítimo, ajustar limites por escopo.

### 6.4 Erro de rollout RLS
- Sintoma: 403/0-row inesperado em queries de owner.
- Ação: validar `app.user_id`, políticas, role sem BYPASSRLS.

### 6.5 Falha de sessão/refresh
- Sintoma: sessões revogadas ou refresh inválido.
- Ação: verificar reuse detection e expiração absoluta/idle.

## 7) Dependências de infra ainda necessárias
- Redis dedicado (opcional, recomendado para alto throughput).
- Observabilidade centralizada (SIEM/metrics).
- Política formal de rotação de segredos/chaves.

## 8) Checklist final de backend maduro
- Sessão robusta: ✅
- Refresh rotation/reuse: ✅
- CSRF em cookie flows: ✅
- Step-up auth sensível: ✅
- Rate/replay distribuído: ✅
- RLS inicial e rollout seguro: ✅ parcial
- CI gates úteis: ✅
- Observabilidade + runbooks: ✅
