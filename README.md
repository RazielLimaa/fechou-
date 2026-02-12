# Fechou! Backend API

API em **Express + TypeScript + Drizzle ORM + PostgreSQL** para gestão de freelancers, propostas, templates e métricas de vendas.

## 1) Pré-requisitos

- Node.js 20+
- PostgreSQL 14+

## 2) Configuração rápida

```bash
cp .env.example .env
npm install
```

Edite o `.env` com a conexão do PostgreSQL, `JWT_SECRET` forte (mínimo 32 caracteres) e `CORS_ORIGIN` do frontend.

## 3) Banco de dados (Drizzle)

1. Crie o banco `fechou` no PostgreSQL.
2. Gere migrações:

```bash
npm run db:generate
```

3. Execute migrações:

```bash
npm run db:migrate
```

## 4) Rodando o backend

Modo desenvolvimento:

```bash
npm run dev
```

Build + produção:

```bash
npm run build
npm start
```

Health check:

```bash
curl http://localhost:3001/health
```

## 5) Endpoints para conectar no frontend

Base URL: `http://localhost:3001/api`

### Auth
- `POST /auth/register` → registerUser
- `POST /auth/login` → loginUser
- `GET /auth/me` → getUserProfile (Bearer token)

### Propostas
- `POST /proposals` → createProposal
- `GET /proposals?status=pendente|vendida|cancelada` → listProposals
- `GET /proposals/:id` → getProposalById
- `PATCH /proposals/:id/status` → updateProposalStatus

### Templates
- `GET /templates?category=...` → listTemplates
- `GET /templates/:id` → getTemplateDetails

### Dashboard
- `GET /metrics/sales` → getSalesMetrics

## 6) Hardening e segurança implementados

- `helmet` para cabeçalhos de segurança HTTP.
- Rate-limit global da API e rate-limit dedicado para autenticação.
- Validação de payload com Zod em todas as rotas principais.
- Sanitização de corpo de requisição (remove chaves perigosas, limita profundidade e tamanho).
- `express.json` com limite de tamanho de body (`30kb`).
- `x-powered-by` desabilitado.
- JWT com `issuer`, `audience`, algoritmo explícito e expiração curta (default `15m`).
- `JWT_SECRET` com verificação de tamanho mínimo.
- Senha forte obrigatória no registro (mín. 12 chars, maiúscula, minúscula, número e especial).
- PostgreSQL com suporte a SSL opcional via env (`DATABASE_SSL=true`).

## 7) Fluxo recomendado de integração no frontend

1. Faça cadastro/login e guarde o `token` de forma segura.
2. Envie `Authorization: Bearer <token>` nas rotas protegidas.
3. Liste propostas com `GET /proposals` e filtros por status.
4. Abra detalhe da proposta com `GET /proposals/:id`.
5. Atualize status com `PATCH /proposals/:id/status`.
6. Consulte templates por categoria em `GET /templates`.
7. Alimente dashboards com `GET /metrics/sales`.

## 8) Exemplos rápidos

### Registrar usuário

> Senha precisa ser forte.

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Ana","email":"ana@email.com","password":"Senha@123456"}'
```

### Login

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ana@email.com","password":"Senha@123456"}'
```
