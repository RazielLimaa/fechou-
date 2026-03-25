# Auditoria de Segurança Profunda do Backend (Node.js/TypeScript)

Data: 2026-03-25 (UTC)  
Escopo: `src/app.ts`, `src/middleware/*`, `src/routes/*`, `src/services/*`, `src/storage.ts`, `src/db/schema*.ts`

## Resumo executivo

**Postura geral: risco alto para produção**. Foram identificados **6 bloqueadores de deploy** com potencial de exploração prática imediata:

1. **Bypass de autenticação por fallback MVP + `x-user-id` controlado pelo cliente** em múltiplas rotas autenticadas via `authenticateOrMvp`.  
2. **BOLA/IDOR em operações de cláusulas de contrato** (edição/reordenação/remoção sem ownership check do usuário).  
3. **Webhooks com fail-open quando segredo está ausente** (assinatura aceita como válida).  
4. **Fluxo Google OAuth inseguro (implicit via access_token do frontend)** sem `state/nonce/PKCE`, contra RFC 9700/OAuth BCP.  
5. **Endpoint público de rating permite fraude de avaliação** (sem autenticação forte do avaliador/sem prova de posse do link).  
6. **PII exposta e enumeração de usuários em perfil público** (fallback busca todos usuários por nome e pode expor `email` em cenário sem profile row).

Além disso, há dívida estrutural de segurança (código legado OAuth paralelo, stores em memória para estado crítico e logs sensíveis em rotas de assinatura).

---

## 1) Inventário de rotas (matriz)

Legenda de status: **OK**, **ATENÇÃO**, **FALHA**.

| Método | Rota | Superfície | Auth | Autorização de recurso | Middleware relevante | Validação | Risco principal | Severidade | Status |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/health` | pública | não | n/a | helmet/cors/global RL | n/a | info leak baixo | baixa | OK |
| GET | `/api/health` | pública | não | n/a | helmet/cors/global RL | n/a | info leak baixo | baixa | OK |
| POST | `/api/auth/register` | pública | não | n/a | sanitize + api RL | zod forte | brute force sem limiter dedicado | média | ATENÇÃO |
| POST | `/api/auth/login` | pública | não | n/a | sanitize + api RL | zod forte | brute force/credential stuffing | alta | ATENÇÃO |
| POST | `/api/auth/google` | pública | não | n/a | sanitize + api RL | zod mínimo + fetch google | OAuth flow inseguro | crítica | FALHA |
| GET | `/api/auth/me` | autenticada | bearer | self | `authenticate` | implícita | ok | baixa | OK |
| GET | `/api/proposals/public/:token` | link público | token URL | token hash | rateLimit local in-memory | token regex + hash | enumeração/PII por link | média | ATENÇÃO |
| POST | `/api/proposals/public/:token/sign` | link público | token URL | token hash | rateLimit local in-memory | zod + assinatura PNG | replay/distribuído | média | ATENÇÃO |
| POST | `/api/proposals/:id/share-link` | autenticada (mvp) | **authenticateOrMvp** | owner esperado | none | zod | auth bypass por MVP | crítica | FALHA |
| POST | `/api/proposals` | autenticada (mvp) | **authenticateOrMvp** | self | none | zod | auth bypass por MVP | crítica | FALHA |
| GET | `/api/proposals` | autenticada (mvp) | **authenticateOrMvp** | self | none | zod query | auth bypass por MVP | crítica | FALHA |
| GET | `/api/proposals/:id` | autenticada (mvp) | **authenticateOrMvp** | owner | none | zod | auth bypass por MVP | crítica | FALHA |
| PATCH | `/api/proposals/:id/cancel` | autenticada (mvp) | **authenticateOrMvp** | owner | rateLimit local | zod | auth bypass por MVP | crítica | FALHA |
| POST | `/api/proposals/:id/mark-paid` | autenticada (mvp) | **authenticateOrMvp** | owner | none | zod | auth bypass por MVP | crítica | FALHA |
| POST | `/api/proposals/:id/payment-link` | autenticada (mvp) | **authenticateOrMvp** | owner | none | zod | auth bypass + abuso financeiro | crítica | FALHA |
| PATCH | `/api/proposals/:id/status` | autenticada (mvp) | **authenticateOrMvp** | owner | none | zod | auth bypass por MVP | crítica | FALHA |
| GET | `/api/templates/*` | autenticada | bearer | plano | authenticate + requirePlan | parcial | rota `/advanced` vazia/indefinida | baixa | ATENÇÃO |
| GET | `/api/metrics/*` | autenticada | bearer | self | authenticate | zod query | baixo | baixa | OK |
| POST | `/api/payments/public/:token/checkout` | link público | token URL | token hash | sanitize + api RL | zod urls | abuso de URL externa | média | ATENÇÃO |
| POST | `/api/payments/subscriptions/checkout` | autenticada | bearer | self | authenticate | zod | ok | baixa | OK |
| POST | `/api/payments/subscriptions/confirm` | autenticada | bearer | self parcial | authenticate | **sem zod** | parsing frouxo + fallback arriscado | média | ATENÇÃO |
| POST | `/api/payments/subscriptions/cancel` | autenticada | bearer | self | authenticate | n/a | ok | baixa | OK |
| GET | `/api/payments/me` | autenticada | bearer | self | authenticate | n/a | ok | baixa | OK |
| POST | `/api/payments/webhook` | webhook | assinatura | n/a | raw body + skip sanitize | validação parcial | fail-open secret ausente | crítica | FALHA |
| POST | `/api/webhooks/mercadopago` | webhook | assinatura | n/a | webhookRateLimiter | validação parcial | fail-open secret ausente + replay store memória | crítica | FALHA |
| GET | `/api/mercadopago/connect` | OAuth start | **authenticateOrMvp** | self | sensitive RL | n/a | auth bypass MVP | alta | FALHA |
| GET | `/api/mercadopago/callback` | OAuth callback | state | state->user | sensitive RL | code/state string | state store memória | média | ATENÇÃO |
| GET | `/api/mercadopago/status` | autenticada (mvp) | **authenticateOrMvp** | self | sensitive RL | n/a | auth bypass MVP | alta | FALHA |
| POST | `/api/mercadopago/api-key/verify` | integração | **authenticateOrMvp** | self | sensitive RL | zod | auth bypass MVP | alta | FALHA |
| POST | `/api/mercadopago/api-key/register` | integração | **authenticateOrMvp** | self | sensitive RL | zod | auth bypass MVP | alta | FALHA |
| POST | `/api/contracts` | autenticada (mvp) | **authenticateOrMvp** | self | contractCreationRateLimiter | zod | auth bypass MVP | crítica | FALHA |
| POST | `/api/contracts/render` | autenticada (mvp) | **authenticateOrMvp** | owner | none | zod | log sensível payload | média | ATENÇÃO |
| POST | `/api/contracts/provider-signature` | autenticada (mvp) | **authenticateOrMvp** | self | none | zod | log sensível assinatura | alta | FALHA |
| GET/DELETE | `/api/contracts/provider-signature` | autenticada (mvp) | **authenticateOrMvp** | self | none | n/a | auth bypass MVP | crítica | FALHA |
| GET | `/api/contracts` | autenticada (mvp) | **authenticateOrMvp** | self | none | n/a | auth bypass MVP | crítica | FALHA |
| GET | `/api/contracts/:id` | autenticada (mvp) | **authenticateOrMvp** | owner | none | zod | auth bypass MVP | crítica | FALHA |
| POST | `/api/contracts/:id/clauses` | autenticada (mvp) | **authenticateOrMvp** | **owner ausente** | none | zod | BOLA/IDOR | crítica | FALHA |
| PATCH | `/api/contracts/:id/clauses/reorder` | autenticada (mvp) | **authenticateOrMvp** | **owner ausente** | none | zod | BOLA/IDOR | crítica | FALHA |
| PATCH | `/api/contracts/:id/clauses/:clauseId` | autenticada (mvp) | **authenticateOrMvp** | **owner ausente** | none | zod | BOLA/IDOR | crítica | FALHA |
| DELETE | `/api/contracts/:id/clauses/:clauseId` | autenticada (mvp) | **authenticateOrMvp** | **owner ausente** | none | zod | BOLA/IDOR | crítica | FALHA |
| PATCH | `/api/contracts/:id/layout` | autenticada (mvp) | **authenticateOrMvp** | owner | none | zod | auth bypass MVP | crítica | FALHA |
| POST | `/api/contracts/:id/pdf` | autenticada (mvp) | **authenticateOrMvp** | owner | none | zod | auth bypass MVP | crítica | FALHA |
| POST | `/api/contracts/:id/logo` | autenticada (mvp) | **authenticateOrMvp** | owner | upload limiter + multer | forte | auth bypass MVP | alta | FALHA |
| DELETE | `/api/contracts/:id/logo` | autenticada (mvp) | **authenticateOrMvp** | owner | none | zod | auth bypass MVP | crítica | FALHA |
| GET | `/api/contracts/:id/signature` | autenticada (mvp) | **authenticateOrMvp** | owner | none | zod | auth bypass MVP | crítica | FALHA |
| POST/GET | `/api/contracts/:id/provider-signature` | autenticada (mvp) | **authenticateOrMvp** | owner | none | zod | auth bypass MVP | crítica | FALHA |
| POST | `/api/contracts/:id/share-link` | autenticada (mvp) | **authenticateOrMvp** | owner | none | zod | auth bypass MVP | crítica | FALHA |
| POST | `/api/contracts/:id/mark-paid` | autenticada (mvp) | **authenticateOrMvp** | owner | none | zod | auth bypass MVP | crítica | FALHA |
| PATCH | `/api/contracts/:id/cancel` | autenticada (mvp) | **authenticateOrMvp** | owner | none | zod | auth bypass MVP | crítica | FALHA |
| GET | `/api/clauses` | autenticada (mvp) | **authenticateOrMvp** | n/a | none | zod | auth bypass MVP | alta | FALHA |
| GET/POST/DELETE | `/api/user/pix-key` | autenticada (mvp) | **authenticateOrMvp** | self | none | zod | auth bypass MVP | crítica | FALHA |
| GET/PATCH | `/api/profile/me` | autenticada (mvp) | **authenticateOrMvp** | self | none | zod | auth bypass MVP | crítica | FALHA |
| GET | `/api/profile/public/:slugOrId` | pública | não | perfil público | none | regex parcial | enumeração + possível exposição email | alta | FALHA |
| GET/POST | `/api/score/*` | mix | parcial mvp | self/public | none | baixa | auth bypass MVP nas rotas privadas | alta | FALHA |
| POST | `/api/ratings` | pública | não | contrato alvo | none | zod | fraude de avaliação | alta | FALHA |
| GET | `/api/ratings/contract/:contractId` | pública | não | contrato | none | id int | enumeração de rating | média | ATENÇÃO |
| GET | `/api/ratings/me` | autenticada (mvp) | **authenticateOrMvp** | self | none | n/a | auth bypass MVP | alta | FALHA |
| GET/POST | `/api/copilot/*` | autenticada | bearer | self | authenticate | zod parcial | sem rate limiting dedicado | baixa | ATENÇÃO |

---

## 2) Matriz de achados (vulnerabilidades)

### A-01 — Bypass de autenticação por `authenticateOrMvp` + `x-user-id`
- **Severidade:** Crítica
- **Arquivos:** `src/middleware/auth.ts`, múltiplas rotas sob `authenticateOrMvp`
- **Categoria:** OWASP API Top 10 2023 API2 (Broken Authentication), ASVS V2
- **Exploração:** atacante chama qualquer rota “autenticada” sem Bearer e injeta `x-user-id: 1`; middleware aceita e define `req.user`.
- **Impacto real:** leitura/alteração de dados de conta de terceiros (propostas, contratos, PIX key, perfil, integrações MP, etc.).
- **Causa raiz:** fallback de identidade confiando em header controlado pelo cliente e fallback global `MVP_USER_ID`.
- **Evidência técnica:** `resolveAuthenticatedUserId` aceita `x-user-id` e depois `MVP_USER_ID`; `authenticateOrMvp` usa esse fallback quando JWT falha/ausente.
- **Correção recomendada:** remover `authenticateOrMvp` de produção, aceitar apenas JWT válido; isolar modo MVP atrás de flag hard-fail em produção + allowlist de IP/dev.
- **Prioridade:** P0 imediato.

### A-02 — BOLA/IDOR em manipulação de cláusulas de contrato
- **Severidade:** Crítica
- **Arquivos:** `src/routes/contracts.routes.ts`, `src/services/contracts/clause.service.ts`
- **Categoria:** OWASP API1 (BOLA), ASVS V4
- **Exploração:** usuário A altera/remover/reordena cláusulas de contrato de B chamando endpoints com `contractId` de B.
- **Impacto real:** adulteração de contrato alheio (integridade jurídica comprometida).
- **Causa raiz:** serviço de cláusulas consulta contrato por `id` sem filtrar `userId`; rotas não passam owner ao serviço.
- **Evidência técnica:** `addClauseToContract/updateClauseContent/removeClauseFromContract/reorderClauses` operam apenas por `contractId`.
- **Correção recomendada:** exigir `userId` em todas as funções do service e filtrar `contracts.userId = req.user.id` em todas as operações.
- **Prioridade:** P0 imediato.

### A-03 — Webhook assinatura fail-open quando segredo ausente
- **Severidade:** Crítica
- **Arquivos:** `src/services/mercadoPago.ts`, `src/services/Mercadopago subscriptions.service.ts`
- **Categoria:** API8 (Security Misconfiguration), ASVS V14
- **Exploração:** em ambiente com secret ausente, qualquer payload forjado é aceito como válido.
- **Impacto real:** fraude de pagamento/assinatura, alteração de status financeiro via evento falso.
- **Causa raiz:** `if (!webhookSecret) return true` e `if (!secret) return true`.
- **Evidência técnica:** validação explícita retorna `true` sem segredo.
- **Correção recomendada:** fail-fast no boot (process.exit) se webhook habilitado sem secret; validação deve falhar fechado sempre.
- **Prioridade:** P0 imediato.

### A-04 — OAuth Google inseguro (implicit/token from frontend)
- **Severidade:** Crítica
- **Arquivos:** `src/routes/auth.routes.ts`
- **Categoria:** API2, ASVS V4/V5, OAuth 2.0 BCP (RFC 9700)
- **Exploração:** fluxo sem `state`/`nonce`/PKCE abre superfície para login CSRF e confusão de contexto de sessão.
- **Impacto real:** vinculação indevida de conta, autenticação em contexto não intencional.
- **Causa raiz:** backend aceita `access_token` enviado pelo frontend e consulta `userinfo/tokeninfo`.
- **Evidência técnica:** comentário e implementação explícitos do fluxo implicit.
- **Correção recomendada:** migrar para Authorization Code + PKCE, validar `state`/`nonce`, preferir verificação de ID token no backend com `aud/iss/exp/nonce`.
- **Prioridade:** P0 imediato.

### A-05 — Fraude de avaliação (rota pública de ratings)
- **Severidade:** Alta
- **Arquivos:** `src/routes/rating.routes.ts`
- **Categoria:** API1/API3 (BOLA/BOPLA), ASVS V4
- **Exploração:** atacante publica rating para qualquer contrato assinado conhecendo `contractId` + `userId` do freelancer.
- **Impacto real:** manipulação reputacional/score comercial.
- **Causa raiz:** endpoint público sem autenticação do avaliador ou prova criptográfica de posse do contexto (token assinado de conclusão).
- **Evidência técnica:** `POST /api/ratings` é pública e só valida existência de contrato + `userId` correspondente.
- **Correção recomendada:** exigir token one-time emitido no evento de assinatura/pagamento, com TTL curto e bind ao contrato.
- **Prioridade:** P1.

### A-06 — Exposição e enumeração em perfil público
- **Severidade:** Alta
- **Arquivos:** `src/routes/profile.routes.ts`
- **Categoria:** API3 (Excessive Data Exposure), API9 (Improper Inventory)
- **Exploração:** endpoint tenta fallback por nome consultando toda tabela de usuários; facilita enumeração de usuários. Em cenários sem linha de profile, `buildPublicProfile` inclui `email`.
- **Impacto real:** descoberta de base de usuários/PII.
- **Causa raiz:** fallback “friendly slug” e shape de resposta diferente por presença de profile.
- **Evidência técnica:** busca `allUsers` e matching por normalização de nome.
- **Correção recomendada:** remover fallback por nome; resolver apenas slug explícito e IDs públicos não sequenciais; nunca incluir email em endpoint público.
- **Prioridade:** P1.

### A-07 — Logging sensível em fluxo de assinatura
- **Severidade:** Alta
- **Arquivos:** `src/routes/contracts.routes.ts`
- **Categoria:** ASVS V9 (Logging)
- **Exploração:** logs podem conter prefixo/tamanho e potencialmente payload de assinatura (biometria digitalizada).
- **Impacto real:** vazamento de dados sensíveis em observabilidade.
- **Causa raiz:** logs de debug em produção não removidos (`[provider-sig] ...`).
- **Correção recomendada:** remover logs de payload, manter apenas requestId + resultado de validação (sem conteúdo).
- **Prioridade:** P1.

### A-08 — Rate limiting crítico em memória/local
- **Severidade:** Média
- **Arquivos:** `src/routes/proposals.routes.ts`, `src/routes/webhooks.routes.ts`, `src/routes/mercadopago.routes.ts`
- **Categoria:** API4 (Unrestricted Resource Consumption)
- **Exploração:** bypass em ambiente distribuído (múltiplas instâncias), reinício zera contador.
- **Impacto real:** brute force e abuso não contidos.
- **Causa raiz:** `Map` local para rate/replay/state.
- **Correção recomendada:** Redis compartilhado + chaves por IP+identidade+rota; replay cache distribuído com TTL.
- **Prioridade:** P2.

### A-09 — Controles de brute force não aplicados no auth
- **Severidade:** Média
- **Arquivos:** `src/routes/auth.routes.ts`, `src/middleware/security.ts`
- **Categoria:** API4
- **Exploração:** apenas limiter global `/api` (200 req/janela) sem limite estrito por login/register.
- **Impacto real:** credential stuffing mais viável.
- **Causa raiz:** `authRateLimiter` existe mas não foi aplicado nas rotas auth.
- **Correção recomendada:** aplicar limiter dedicado por IP + por email hash + lock progressivo.
- **Prioridade:** P2.

### A-10 — Criptografia opcional de tokens de integração
- **Severidade:** Média
- **Arquivos:** `src/services/mercadoPago.ts`
- **Categoria:** ASVS V6
- **Exploração:** ausência de `TOKENS_ENCRYPTION_KEY` salva token em texto puro no banco (`encryptToken` retorna plain).
- **Impacto real:** comprometimento total de contas MP em vazamento de DB.
- **Causa raiz:** fallback inseguro intencional.
- **Correção recomendada:** tornar chave obrigatória em produção + rotação de chaves + migração de dados legados.
- **Prioridade:** P2.

### A-11 — Verificação de assinatura sem timing-safe em subscriptions webhook
- **Severidade:** Baixa/Média
- **Arquivos:** `src/services/Mercadopago subscriptions.service.ts`
- **Categoria:** ASVS V6
- **Exploração:** comparação `expected === v1` suscetível a side-channel teórico.
- **Impacto real:** baixo, mas má prática criptográfica.
- **Causa raiz:** comparação direta de string HMAC.
- **Correção recomendada:** `crypto.timingSafeEqual` com validação de tamanho.
- **Prioridade:** P3.

### A-12 — Rota `templates/advanced` incompleta
- **Severidade:** Baixa
- **Arquivos:** `src/routes/templates.routes.ts`
- **Categoria:** Hardening/Qualidade
- **Exploração:** comportamento indefinido, rota sem resposta explícita.
- **Impacto real:** inconsistência, possível DOS leve por timeout.
- **Causa raiz:** placeholder em produção.
- **Correção recomendada:** implementar ou remover.
- **Prioridade:** P3.

---

## 3) Bloqueadores de produção (go-live blockers)

1. Remover `authenticateOrMvp` de produção e qualquer aceitação de `x-user-id` do cliente.
2. Corrigir ownership em todas as operações de cláusulas (`contractId` sempre escopado por `userId`).
3. Tornar validação de webhook fail-closed; secret obrigatório para iniciar app.
4. Migrar OAuth Google para Authorization Code + PKCE + state/nonce.
5. Corrigir endpoint público de ratings com prova forte de autorização (token one-time assinado).
6. Eliminar enumeração/PII no perfil público (sem fallback por varredura de usuários).

---

## 4) Riscos médios e baixos por probabilidade x impacto

### Médios (probabilidade média/alta, impacto médio/alto)
- Brute force em auth por ausência de limiter dedicado por credencial.
- Replay/rate limit in-memory em ambiente horizontal.
- Token de integração sem criptografia obrigatória em produção.

### Baixos (probabilidade baixa ou impacto limitado)
- Comparação não constante de HMAC em uma implementação de webhook.
- Rota placeholder sem resposta clara.
- Exposição de `allowedOrigins` em erro de CORS (reconhecimento de superfície).

---

## 5) Falsos controles (“parece seguro” mas não protege)

- **`authenticateOrMvp`**: parece middleware de auth, mas aceita identidade do cliente por header/fallback.
- **Webhook signature check**: existe função de assinatura, porém retorna válido sem secret.
- **Rate limiting**: existe, mas partes críticas usam memória local não compartilhada.
- **Sanitização global**: remove tags HTML, mas não substitui validação/authorization por recurso.

---

## 6) Dívida estrutural de segurança

- Existem **dois stacks de autenticação** (`middleware/auth.ts` e `middleware/middleware.ts` + `services/token.ts`) com padrões diferentes de audience/issuer e controles divergentes.
- Código com comentários “DEBUG — remover após resolver” em rotas sensíveis.
- Lógicas críticas de estado (OAuth state, replay webhook, rate maps) em memória local.
- Fluxo legado/MVP misturado em rotas de produção, aumentando chance de regressão.

---

## 7) Plano de correção

### Hoje (P0)
1. Remover fallback MVP do runtime de produção e bloquear `x-user-id`/headers de identidade.
2. Patch de ownership nas cláusulas de contrato (rota + service + testes).
3. Fail-fast de secrets de webhook e invalidar qualquer evento sem assinatura válida.
4. Congelar endpoint público de rating até adicionar token one-time.

### Próxima sprint (P1/P2)
1. OAuth Google: Authorization Code + PKCE + state + nonce + auditoria de redirect URI.
2. Reescrever perfil público para slug-only, sem fallback por varredura e sem campos sensíveis.
3. Adicionar rate limit distribuído (Redis) para auth, links públicos e webhooks.
4. Remover logs sensíveis e padronizar logging estruturado com requestId.

### Endurecimento contínuo
1. SAST + DAST no CI com gates para OWASP ASVS/API Top 10.
2. Threat modeling trimestral dos fluxos de pagamento/webhook/OAuth.
3. Testes de autorização negativos (BOLA/BOPLA) por endpoint em pipeline.
4. Gestão de segredos: obrigatoriedade, rotação e detecção de configuração insegura.

---

## 8) Testes necessários (automatizados + manuais)

### Auth bypass
- Sem `Authorization`, chamar rotas `authenticateOrMvp` com e sem `x-user-id`.
- Token inválido + `x-user-id` válido deve falhar 401.

### IDOR/BOLA
- Usuário A tentar alterar cláusulas/contratos/propostas do usuário B por ID direto.
- Cobrir GET/POST/PATCH/DELETE em contratos e propostas.

### Enumeração
- Fuzz de `/api/profile/public/:slugOrId` com nomes comuns e IDs sequenciais.
- Validar respostas homogêneas (404 genérico) sem leak.

### Brute force
- Login/register/google endpoints com carga automatizada; validar bloqueio progressivo.

### CSRF/Sessão
- (Quando cookies de sessão forem usados) validar proteção CSRF e SameSite adequado.

### Replay/Webhook
- Repetir mesmo webhook com mesmo request-id em cluster simulado.
- Testar webhook sem secret configurado: app deve falhar ao iniciar.

### Webhook inválido
- Assinatura alterada, `ts` vencido, `data.id` ausente.

### Links públicos
- Token inválido/expirado, reuse de assinatura, brute force de tokens.

### Perfis públicos
- Garantir ausência de `email`, `pixKey`, ids internos sensíveis.

### Mass assignment
- Enviar campos extras em PATCH profile/layout e confirmar whitelist estrita.

### Rate limit abuse
- Distribuir chamadas entre múltiplos nós para validar backend compartilhado.

### Segredo ausente em produção
- Testes de boot: ausência de secrets críticos deve impedir startup.

---

## Resumo técnico final

- A arquitetura atual mistura controles robustos pontuais (Zod, `jwt.verify` com issuer/audience, validação de upload) com **atalhos de MVP e fallbacks perigosos** que quebram o modelo zero-trust.
- O principal vetor explorável hoje é **impersonação por header/fallback** seguido de abuso de rotas de negócio.
- O segundo vetor é **manipulação de recursos por ID sem ownership check consistente**.
- O terceiro vetor é **injeção de eventos falsos via webhooks quando segredos não estão presentes**.

Sem correção dos bloqueadores P0, o risco residual para produção permanece **inaceitável**.
