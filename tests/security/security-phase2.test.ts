import test from 'node:test';
import assert from 'node:assert/strict';
import { csrfProtection } from '../../src/middleware/distributed-security.js';
import { verifyMercadoPagoWebhookSignature } from '../../src/services/mercadoPago.js';

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
