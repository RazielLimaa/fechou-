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

Edite o `.env` com a conexão do seu PostgreSQL e segredo JWT.

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

> Estruturas principais:
> - `users`
> - `proposals`
> - `templates`

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

## 6) Fluxo recomendado de integração no frontend

1. **Cadastro/Login**:
   - Salve o `token` retornado em memória (ou storage seguro).
2. **Requests autenticadas**:
   - Envie header: `Authorization: Bearer <token>`.
3. **Tela de propostas**:
   - Use `GET /proposals` e filtros por status.
4. **Detalhes da proposta/contrato**:
   - Use `GET /proposals/:id`.
5. **Mudança de status**:
   - Use `PATCH /proposals/:id/status`.
6. **Templates**:
   - Use `GET /templates` para listagem e `GET /templates/:id` para preencher proposta nova.
7. **Dashboard**:
   - Use `GET /metrics/sales` para total de vendas, conversão e receita.

## 7) Exemplos rápidos de consumo

### Registrar usuário

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Ana","email":"ana@email.com","password":"123456"}'
```

### Login

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ana@email.com","password":"123456"}'
```

### Criar proposta autenticada

```bash
curl -X POST http://localhost:3001/api/proposals \
  -H "Authorization: Bearer TOKEN_AQUI" \
  -H "Content-Type: application/json" \
  -d '{"title":"Landing Page","clientName":"Empresa X","description":"Escopo completo","value":3500}'
```

## Estrutura de código

- `src/storage.ts`: ponte entre rotas e banco (Drizzle queries).
- `src/db/schema.ts`: schema das tabelas.
- `src/routes/*`: endpoints da API.
- `src/middleware/auth.ts`: autenticação JWT.

