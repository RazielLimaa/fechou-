# Secure Mercado Pago Integration

## Summary

This backend now treats Mercado Pago as a server-authoritative payment flow.
The frontend only initiates checkout with a trusted resource token or an authenticated proposal owner action.
Final amount, ownership, state transitions, idempotency and reconciliation are enforced on the backend.

## Implemented controls

- Persistent `checkout_intents` with server-side source of truth for amount, currency, resource ownership and flow.
- Mandatory idempotency through `security_idempotency_keys` and per-transaction `payment_transactions.idempotency_key`.
- Mercado Pago requests use `Authorization: Bearer` and `X-Idempotency-Key`.
- Webhook validation with HMAC SHA-256, lowercase `data.id`, timestamp skew enforcement and constant-time comparison.
- Webhooks are acknowledged quickly, persisted in `webhook_events` and processed asynchronously by a worker.
- Reconciliation always queries Mercado Pago directly before marking a proposal or contract as paid.
- Structured JSON observability with correlation ids, request ids, event keys and masked metadata.
- Audit trail in `audit_logs` for checkout creation, reconciliation and degraded paths.
- Degraded in-memory fallback for webhook processing when `webhook_events` is temporarily unavailable.

## Main flows

### Public Checkout Pro

Route: `POST /api/payments/public/:token/checkout`

- Validates share token format.
- Resolves proposal or contract from trusted server state.
- Rejects expired, cancelled or already-paid resources.
- Validates trusted frontend return URLs.
- Creates or reuses a secure checkout intent.
- Generates a secure idempotency key.
- Creates the Mercado Pago Checkout Pro preference from backend-authoritative values only.

### Authenticated Proposal Owner Checkout Pro

Route: `POST /api/proposals/:id/payment-link`

- Requires authenticated ownership of the proposal.
- Rejects invalid lifecycle states.
- Creates a secure checkout intent for the owner flow.
- Uses the freelancer Mercado Pago credential only on the backend.

## Webhook pipeline

Routes:

- `POST /api/payments/webhook`
- `POST /api/webhooks/mercadopago`

Processing steps:

1. Require `Content-Type: application/json`.
2. Validate `x-signature`, `x-request-id`, `ts` and `data.id`.
3. Build manifest as `id:[data.id_lowercase];request-id:[x-request-id];ts:[ts];`.
4. Persist `webhook_events` and return `200/201` quickly.
5. Queue asynchronous processing.
6. Query Mercado Pago directly for payment or merchant order state.
7. Reconcile internal state transactionally and idempotently.

## Persistence added

- `checkout_intents`
- `payment_transactions`
- `webhook_events`
- `audit_logs`
- `security_idempotency_keys`

Migration:

- `drizzle/0008_secure_mercado_pago_payments.sql`

## Environment

New or reinforced variables in `env.example`:

- `MP_PUBLIC_KEY`
- `MERCADO_PAGO_HTTP_TIMEOUT_MS`
- `MERCADO_PAGO_GET_RETRIES`
- `MERCADO_PAGO_WEBHOOK_MAX_SKEW_MS`
- `MERCADO_PAGO_WEBHOOK_SWEEP_MS`

## Verification

- `npm run build`
- `npm run test:security`
