import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { csrfProtection } from '../../src/middleware/distributed-security.js';
import { verifyMercadoPagoWebhookSignature } from '../../src/services/mercadoPago.js';
import { requireStepUp } from '../../src/middleware/step-up.js';
import { buildStepUpPayloadHash } from '../../src/services/stepUp.js';
import { verifyMercadoPagoWebhookSignatureDetailed } from '../../src/services/payments/mercadoPagoSecurity.js';

function createRes() {
  const res: any = {
    statusCode: 200,
    payload: null,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.payload = body;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
  };
  return res;
}

test('csrfProtection bloqueia mutação com cookie sem header csrf', async () => {
  const middleware = csrfProtection({ allowedOrigins: ['http://localhost:5173'] });
  const req: any = {
    method: 'POST',
    originalUrl: '/api/contracts/1/mark-paid',
    headers: {},
    cookies: { access_token: 'abc' },
    header(name: string) { return this.headers[name.toLowerCase()]; },
  };
  const res = createRes();

  let nextCalled = false;
  middleware(req, res as any, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test('csrfProtection permite mutação com cookie + header csrf válido', async () => {
  const middleware = csrfProtection({ allowedOrigins: ['http://localhost:5173'] });
  const req: any = {
    method: 'PATCH',
    originalUrl: '/api/profile/me',
    headers: { 'x-csrf-token': 'token123' },
    cookies: { access_token: 'abc', csrf_token: 'token123' },
    header(name: string) { return this.headers[name.toLowerCase()]; },
  };
  const res = createRes();

  let nextCalled = false;
  middleware(req, res as any, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('webhook signature falha sem secret', async () => {
  const prev = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  delete process.env.MERCADO_PAGO_WEBHOOK_SECRET;

  const valid = verifyMercadoPagoWebhookSignature({
    xSignature: 'ts=1,v1=abc',
    xRequestId: 'req-1',
    dataId: '123',
  });

  process.env.MERCADO_PAGO_WEBHOOK_SECRET = prev;

  assert.equal(valid, false);
});

test('webhook signature rejeita timestamp stale', async () => {
  const prev = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  process.env.MERCADO_PAGO_WEBHOOK_SECRET = 'stale_secret';

  try {
    const ts = String(Date.now() - 10 * 60 * 1000);
    const manifest = `id:123;request-id:req-1;ts:${ts};`;
    const v1 = crypto.createHmac('sha256', 'stale_secret').update(manifest).digest('hex');

    const result = verifyMercadoPagoWebhookSignatureDetailed({
      xSignature: `ts=${ts},v1=${v1}`,
      xRequestId: 'req-1',
      dataId: '123',
      nowMs: Date.now(),
      maxSkewMs: 5 * 60 * 1000,
    });

    assert.equal(result.valid, false);
    assert.equal(result.reason, 'stale');
  } finally {
    if (prev === undefined) {
      delete process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    } else {
      process.env.MERCADO_PAGO_WEBHOOK_SECRET = prev;
    }
  }
});

test('webhook signature usa data.id em lowercase no manifesto', async () => {
  const prev = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  process.env.MERCADO_PAGO_WEBHOOK_SECRET = 'lowercase_secret';

  try {
    const ts = String(Date.now());
    const manifest = `id:abc123;request-id:req-2;ts:${ts};`;
    const v1 = crypto.createHmac('sha256', 'lowercase_secret').update(manifest).digest('hex');

    const result = verifyMercadoPagoWebhookSignatureDetailed({
      xSignature: `ts=${ts},v1=${v1}`,
      xRequestId: 'req-2',
      dataId: 'ABC123',
      nowMs: Date.now(),
      maxSkewMs: 5 * 60 * 1000,
    });

    assert.equal(result.valid, true);
    assert.equal(result.dataId, 'abc123');
  } finally {
    if (prev === undefined) {
      delete process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    } else {
      process.env.MERCADO_PAGO_WEBHOOK_SECRET = prev;
    }
  }
});

test('step-up payload hash é estável para payload idêntico', async () => {
  const a = buildStepUpPayloadHash({ proposalId: 10, amount: 1000 });
  const b = buildStepUpPayloadHash({ proposalId: 10, amount: 1000 });
  assert.equal(a, b);
});

test('requireStepUp retorna 403 quando token não é enviado', async () => {
  const middleware = requireStepUp('payments.mark-paid', (req) => ({ id: req.params.id }));
  const req: any = {
    user: { id: 1 },
    method: 'POST',
    originalUrl: '/api/proposals/10/mark-paid',
    params: { id: '10' },
    headers: {},
    ip: '127.0.0.1',
    header(name: string) { return this.headers[name.toLowerCase()]; },
  };
  const res = createRes();
  let nextCalled = false;
  await middleware(req, res as any, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});
