# Security Hardening Implementation — 2026-03-25

## 1) Inventário de superfície (estado atual pós-hardening)

### Pública
- `GET /health`, `GET /api/health`
- `GET /api/profile/public/:slugOrId`
- `POST /api/ratings`
- `GET /api/ratings/contract/:contractId`

### Autenticada
- Todas as rotas `authenticate` e rotas que antes usavam `authenticateOrMvp` (agora estritamente JWT).

### Webhook
- `POST /api/webhooks/mercadopago`
- `POST /api/payments/webhook`

### OAuth callback
- `GET /api/mercadopago/callback`

### Links públicos tokenizados
- `/api/proposals/public/:token`
- `/api/proposals/public/:token/sign`
- `/api/payments/public/:token/checkout`

### Deception routes
- `/admin`, `/wp-admin`, `/phpmyadmin`, `/internal`, `/debug`, `/api/internal/status`, `/api/admin/login`

## 2) Matriz de achados tratados
- Auth bypass via MVP/header: **corrigido**.
- BOLA em cláusulas de contratos: **corrigido**.
- Webhook fail-open sem segredo: **corrigido**.
- OAuth Google via access_token de frontend: **corrigido para code flow backend-only**.
- Ratings públicos manipuláveis por `userId`: **corrigido com token público vinculado ao contrato**.
- Enumeração de perfil/PII por fallback: **corrigido**.
- Logs de assinatura sensível: **removidos**.

## 3) Plano aplicado por prioridade
### P0
- Remoção efetiva de fallback MVP para autenticação.
- Ownership obrigatório nas mutações de cláusulas.
- Webhooks fail-closed em validação de assinatura.

### P1
- Endurecimento de OAuth Mercado Pago state com cookie HttpOnly curto.
- Endurecimento de OAuth Google para `authorization_code` no backend.
- Mitigação de fraude de ratings (token de link público exigido).

### P2
- Request ID padrão para rastreabilidade.
- Rotas deception para detecção de scanners automatizados.
- Fail-fast de segredos críticos em produção.

## 4) Arquivos alterados
- `src/middleware/auth.ts`
- `src/routes/auth.routes.ts`
- `src/routes/contracts.routes.ts`
- `src/services/contracts/clause.service.ts`
- `src/services/mercadoPago.ts`
- `src/services/Mercadopago subscriptions.service.ts`
- `src/routes/mercadopago.routes.ts`
- `src/routes/profile.routes.ts`
- `src/routes/rating.routes.ts`
- `src/routes/proposals.routes.ts`
- `src/routes/templates.routes.ts`
- `src/routes/webhooks.routes.ts`
- `src/app.ts`
- `src/server.ts`

## 5) Riscos residuais
- Rate-limit distribuído ainda depende de store de infraestrutura (Redis) para cobertura multi-instância ideal.
- Refresh token rotativo/cookies de sessão ainda não foi migrado integralmente nesta rodada.
- RLS em banco ainda não implementado (exige migração e estratégia de roles em infraestrutura).

## 6) Dependências de infraestrutura
- Provisionar Redis para limiter/replay distribuído (próxima etapa).
- Definir rotação operacional de `TOKENS_ENCRYPTION_KEY`, `MERCADO_PAGO_WEBHOOK_SECRET`, `MP_WEBHOOK_SECRET`.

## 7) Checklist final
- Auth: ✅
- Session: ⚠️ parcial (refresh/cookie hardening completo pendente)
- Authz: ✅ (ownership em cláusulas)
- OAuth: ✅ parcial (Google code flow backend, MP state-cookie)
- CSRF: ⚠️ pendente para fluxos baseados em cookie
- Webhooks: ✅ fail-closed
- Secrets: ✅ fail-fast em produção
- Encryption: ✅ bloqueio plaintext em produção para tokens MP
- Rate limit: ⚠️ sem Redis distribuído nesta rodada
- Deception: ✅
- Logging: ✅ request id + evento deception
- Database security/RLS: ⚠️ pendente
- Public links: ✅ reforço em rating com token público
- Public profiles: ✅ sem fallback enumerável e sem e-mail público
- CI security gates: ⚠️ pendente
