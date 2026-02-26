# Fechou! Backend API

API em **Express + TypeScript + Drizzle ORM + PostgreSQL + Stripe** para gestão de freelancers, propostas, templates, métricas e pagamentos.

## 1) Pré-requisitos
- Node.js 20+
- PostgreSQL 14+
- Conta Stripe (modo teste ou produção)

## 2) Configuração rápida
```bash
cp .env.example .env
npm install
```

Preencha no `.env`:
- Banco (`DATABASE_URL`)
- Segurança (`JWT_SECRET` forte)
- Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_MONTHLY_PLAN_PRICE_ID`)

## 3) Banco de dados
```bash
npm run db:generate
npm run db:migrate
```

## 4) Rodando backend
```bash
npm run dev
```

Health check:
```bash
curl http://localhost:3001/health
```

## 5) Endpoints principais
Base URL: `http://localhost:3001/api`

### Auth
- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`

### Propostas
- `POST /proposals`
- `GET /proposals?status=pendente|vendida|cancelada`
- `GET /proposals/:id`
- `PATCH /proposals/:id/status`

### Templates
- `GET /templates?category=...`
- `GET /templates/:id`

### Metrics
- `GET /metrics/sales`
- `GET /metrics/premium-dashboard?period=monthly|weekly`
- `GET /metrics/premium-dashboard/export.csv`
- Estrutura completa da página conectada: `docs/premium-dashboard-page-structure.md`

### Payments (Stripe)
- `POST /payments/proposals/:id/checkout` (freelancer gera link de checkout para cliente pagar a proposta)
- `POST /payments/subscriptions/checkout` (freelancer assina seu plano mensal da plataforma)
- `GET /payments/me` (histórico resumido de pagamentos e assinatura)
- `POST /payments/webhook` (endpoint de webhook Stripe assinado)

## 6) Fluxos de pagamento

### 6.1 Cliente paga proposta do freelancer
1. Freelancer autenticado chama `POST /payments/proposals/:id/checkout` com:
   - `successUrl`
   - `cancelUrl`
   - opcional `clientEmail`
2. Backend cria Stripe Checkout Session segura em modo `payment`.
3. Frontend redireciona cliente para `checkoutUrl`.
4. Stripe notifica `POST /payments/webhook`.
5. Backend valida assinatura do webhook e marca proposta como `vendida`.

### 6.2 Freelancer paga assinatura mensal da plataforma
1. Freelancer autenticado chama `POST /payments/subscriptions/checkout` com `successUrl` e `cancelUrl`.
2. Backend cria Checkout Session em modo `subscription` com o `STRIPE_MONTHLY_PLAN_PRICE_ID`.
3. Stripe envia webhooks de assinatura e backend atualiza `user_subscriptions`.

## 7) Segurança aplicada no módulo de pagamentos
- Webhook Stripe validado por assinatura (`stripe-signature` + `STRIPE_WEBHOOK_SECRET`).
- `Idempotency-Key` obrigatório na criação de sessões para evitar duplicidade.
- Nenhum dado sensível do Stripe retornado para o frontend.
- Validação estrita de entrada com Zod em todos endpoints de pagamento.
- Separação de fluxo autenticado (checkout) e fluxo não autenticado (webhook assinado).
- Status de pagamentos persistidos em tabela própria para auditoria.

## 8) Exemplo rápido: checkout de proposta
```bash
curl -X POST http://localhost:3001/api/payments/proposals/1/checkout \
  -H "Authorization: Bearer TOKEN_AQUI" \
  -H "Idempotency-Key: 2f8d6d11-9e3a-4f2f-9f38-0d68f7f499b7" \
  -H "Content-Type: application/json" \
  -d '{"successUrl":"https://seu-front.com/pagamento/sucesso","cancelUrl":"https://seu-front.com/pagamento/cancelado","clientEmail":"cliente@email.com"}'
```

## 9) Observação importante de segurança
Não existe software com risco zero absoluto. Este projeto foi reforçado com práticas robustas, mas para manter segurança de forma contínua você deve:
- manter dependências atualizadas,
- usar HTTPS sempre,
- aplicar rotação de segredos,
- monitorar logs/eventos,
- executar testes de segurança em CI/CD (SAST/DAST e auditorias periódicas).
