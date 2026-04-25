import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import app from "../../src/app.js";
import {
  ensureTrustedFrontendRedirectUrl,
  getPublicAppBaseUrl,
  isTrustedOriginAllowed,
  normalizeHexToken,
} from "../../src/lib/httpSecurity.js";
import {
  formatCpfCnpj,
  isValidCnpj,
  isValidCpf,
  isValidCpfOrCnpj,
  normalizeCpfCnpj,
} from "../../src/lib/brDocument.js";
import {
  decryptToken,
  encryptToken,
  resolveMercadoPagoCheckoutUrl,
} from "../../src/services/mercadoPago.js";
import {
  buildPublicPaymentExternalReference,
  buildMercadoPagoSubscriptionProviderError,
  parsePublicPaymentExternalReference,
} from "../../src/routes/payments.routes.js";
import { MercadoPagoSubscriptionApiError } from "../../src/services/Mercadopago subscriptions.service.js";
import {
  createAuthenticatedContractSignaturePreviewAsset,
  buildContractSignaturePreviewPath,
  getAuthenticatedContractSignaturePreviewAsset,
  createContractSignaturePreviewToken,
  verifyContractSignaturePreviewToken,
} from "../../src/lib/signaturePreview.js";
import { signAccessToken } from "../../src/middleware/auth.js";
import { isTrustedPreviewAssetRequest } from "../../src/routes/contracts.routes.js";
import { storage } from "../../src/storage.js";
import { contractService } from "../../src/services/contracts/contract.service.js";
import { mpSubscriptionService } from "../../src/services/Mercadopago subscriptions.service.js";

function getTrustedFrontendForTests() {
  return String(process.env.FRONTEND_URL ?? "http://127.0.0.1:5173").replace(/\/+$/, "");
}

function buildTrustedFrontendUrlForTests(path: string) {
  return `${getTrustedFrontendForTests()}${path}`;
}

function buildMercadoPagoWebhookHeaders(dataId: string, secret: string) {
  const requestId = `req_${Date.now()}`;
  const ts = String(Date.now());
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const signature = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

  return {
    "content-type": "application/json",
    "x-request-id": requestId,
    "x-signature": `ts=${ts},v1=${signature}`,
  };
}

async function withServer<T>(fn: (baseUrl: string) => Promise<T>) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Não foi possível obter a porta do servidor de teste.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await fn(baseUrl);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("ensureTrustedFrontendRedirectUrl aceita apenas URLs do frontend confiável", () => {
  const previousFrontendUrl = process.env.FRONTEND_URL;

  try {
    process.env.FRONTEND_URL = "http://localhost:5173";

    const safe = ensureTrustedFrontendRedirectUrl("http://127.0.0.1:5173/app/settings?ok=1");
    assert.equal(safe, "http://127.0.0.1:5173/app/settings?ok=1");

    const localhostAlias = ensureTrustedFrontendRedirectUrl("http://localhost:5173/app/settings?ok=2");
    assert.equal(localhostAlias, "http://localhost:5173/app/settings?ok=2");

    assert.throws(
      () => ensureTrustedFrontendRedirectUrl("https://evil.example/phish"),
      /não permitida|inválida|nao permitida|invalida/i,
    );
  } finally {
    if (previousFrontendUrl === undefined) {
      delete process.env.FRONTEND_URL;
    } else {
      process.env.FRONTEND_URL = previousFrontendUrl;
    }
  }
});

test("validador CPF/CNPJ rejeita documentos falsos e caracteres estranhos", () => {
  assert.equal(isValidCpf("529.982.247-25"), true);
  assert.equal(isValidCpf("52998224725"), true);
  assert.equal(isValidCpf("111.111.111-11"), false);
  assert.equal(isValidCpf("529abc98224725"), false);

  assert.equal(isValidCnpj("04.252.011/0001-10"), true);
  assert.equal(isValidCnpj("04252011000110"), true);
  assert.equal(isValidCnpj("04.252.011/0001-11"), false);
  assert.equal(isValidCnpj("00.000.000/0000-00"), false);

  assert.equal(isValidCpfOrCnpj("529.982.247-25"), true);
  assert.equal(normalizeCpfCnpj("04.252.011/0001-10"), "04252011000110");
  assert.equal(formatCpfCnpj("52998224725"), "529.982.247-25");
});

test("helpers críticos de URL e token continuam determinísticos", () => {
  assert.equal(getPublicAppBaseUrl(), "https://fechou.cloud");
  assert.equal(normalizeHexToken("A".repeat(64)), "a".repeat(64));
  assert.equal(normalizeHexToken("abc"), null);
  assert.equal(isTrustedOriginAllowed("http://localhost:5173", ["http://127.0.0.1:5173"]), true);
});

test("tokens sensíveis do Mercado Pago seguem criptografando e descriptografando", () => {
  const raw = "APP_USR_test_token_seguro";
  const encrypted = encryptToken(raw);

  assert.notEqual(encrypted, raw);
  assert.match(encrypted, /^enc:/);
  assert.equal(decryptToken(encrypted), raw);
});

test("checkout do Mercado Pago escolhe a URL correta para sandbox e produção", () => {
  const preference = {
    init_point: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=prod",
    sandbox_init_point: "https://sandbox.mercadopago.com.br/checkout/v1/redirect?pref_id=test",
  };

  assert.equal(resolveMercadoPagoCheckoutUrl(preference, "TEST-123"), preference.sandbox_init_point);
  assert.equal(resolveMercadoPagoCheckoutUrl(preference, "APP_USR-123"), preference.init_point);
  assert.equal(resolveMercadoPagoCheckoutUrl({ init_point: preference.init_point }, "TEST-123"), preference.init_point);
});

test("assinatura cria preapproval autorizado no Mercado Pago e usa init_point retornado pela API", async () => {
  const originalFetch = globalThis.fetch;
  const previousToken = process.env.MP_SUBSCRIPTIONS_ACCESS_TOKEN;
  const previousPlan = process.env.MP_SUBSCRIPTIONS_PLAN_PRO_ID;
  const previousBackUrl = process.env.MP_SUBSCRIPTIONS_BACK_URL;
  const previousBuyerEmail = process.env.MP_SUBSCRIPTIONS_TEST_PAYER_EMAIL;

  try {
    process.env.MP_SUBSCRIPTIONS_ACCESS_TOKEN = "TEST-123";
    process.env.MP_SUBSCRIPTIONS_PLAN_PRO_ID = "plan_pro";
    process.env.MP_SUBSCRIPTIONS_BACK_URL = "https://fechou.cloud/pagamento/confirmacao";
    process.env.MP_SUBSCRIPTIONS_TEST_PAYER_EMAIL = "test_user_123456@testuser.com";

    (globalThis as any).fetch = async (input: any, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : String(input?.url ?? "");

      if (url === "https://api.mercadopago.com/users/me") {
        return new Response(
          JSON.stringify({
            id: 999,
            email: "collector@example.com",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url === "https://api.mercadopago.com/preapproval_plan/plan_pro") {
        return new Response(
          JSON.stringify({
            id: "plan_pro",
            status: "active",
            reason: "Assinatura Pro",
            auto_recurring: {
              frequency: 1,
              frequency_type: "months",
              transaction_amount: 29,
              currency_id: "BRL",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      assert.equal(url, "https://api.mercadopago.com/preapproval");
      assert.equal(init?.method, "POST");

      const payload = JSON.parse(String(init?.body ?? "{}"));
      const headers = new Headers(init?.headers);
      assert.equal(payload.preapproval_plan_id, "plan_pro");
      assert.equal(payload.payer_email, "real-user@example.com");
      assert.equal(payload.card_token_id, "card_tok_123");
      assert.equal(payload.back_url, "https://fechou.cloud/pagamento/confirmacao");
      assert.equal(payload.status, "authorized");
      assert.equal(payload.auto_recurring.frequency, 1);
      assert.equal(payload.auto_recurring.frequency_type, "months");
      assert.equal(payload.auto_recurring.transaction_amount, 29);
      assert.equal(payload.auto_recurring.currency_id, "BRL");
      assert.match(payload.auto_recurring.start_date, /^\d{4}-\d{2}-\d{2}T/);
      assert.match(payload.external_reference, /^subscription:v2:user:7:plan:pro:nonce:[a-f0-9]{32}:sig:[a-f0-9]{32}$/i);
      assert.equal(headers.get("x-idempotency-key"), "sub_test_create_123");
      assert.equal(headers.get("x-request-id"), payload.external_reference);

      return new Response(
        JSON.stringify({
          id: "pre_123",
          status: "pending",
          reason: payload.reason,
          payer_id: 77,
          external_reference: payload.external_reference,
          init_point: "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=pre_123",
          preapproval_plan_id: "plan_pro",
          auto_recurring: {
            frequency: 1,
            frequency_type: "months",
            transaction_amount: 29,
            currency_id: "BRL",
            start_date: new Date().toISOString(),
            end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          },
          last_modified: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    const result = await mpSubscriptionService.createSubscription({
      userId: 7,
      userEmail: "real-user@example.com",
      userName: "Teste",
      planId: "pro",
      cardTokenId: "card_tok_123",
      idempotencyKey: "sub_test_create_123",
      backUrl: "https://fechou.cloud/pagamento/confirmacao",
    });

    assert.equal(result.preapprovalId, "pre_123");
    assert.equal(result.planId, "pro");
    assert.match(result.externalReference, /^subscription:v2:user:7:plan:pro:nonce:[a-f0-9]{32}:sig:[a-f0-9]{32}$/i);
    assert.equal(
      result.providerInitPoint,
      "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=pre_123",
    );
  } finally {
    (globalThis as any).fetch = originalFetch;

    if (previousToken === undefined) {
      delete process.env.MP_SUBSCRIPTIONS_ACCESS_TOKEN;
    } else {
      process.env.MP_SUBSCRIPTIONS_ACCESS_TOKEN = previousToken;
    }

    if (previousPlan === undefined) {
      delete process.env.MP_SUBSCRIPTIONS_PLAN_PRO_ID;
    } else {
      process.env.MP_SUBSCRIPTIONS_PLAN_PRO_ID = previousPlan;
    }

    if (previousBackUrl === undefined) {
      delete process.env.MP_SUBSCRIPTIONS_BACK_URL;
    } else {
      process.env.MP_SUBSCRIPTIONS_BACK_URL = previousBackUrl;
    }

    if (previousBuyerEmail === undefined) {
      delete process.env.MP_SUBSCRIPTIONS_TEST_PAYER_EMAIL;
    } else {
      process.env.MP_SUBSCRIPTIONS_TEST_PAYER_EMAIL = previousBuyerEmail;
    }
  }
});

test("assinatura bloqueia pagador igual ao coletor do Mercado Pago antes de criar o preapproval", async () => {
  const originalFetch = globalThis.fetch;
  const previousToken = process.env.MP_SUBSCRIPTIONS_ACCESS_TOKEN;
  const previousPlan = process.env.MP_SUBSCRIPTIONS_PLAN_PRO_ID;
  const previousBackUrl = process.env.MP_SUBSCRIPTIONS_BACK_URL;
  const previousBypass = process.env.MP_SUBSCRIPTIONS_SKIP_COLLECTOR_READINESS_CHECK;

  try {
    process.env.MP_SUBSCRIPTIONS_ACCESS_TOKEN = "TEST-123";
    process.env.MP_SUBSCRIPTIONS_PLAN_PRO_ID = "plan_pro";
    process.env.MP_SUBSCRIPTIONS_BACK_URL = "https://fechou.cloud/pagamento/confirmacao";
    process.env.MP_SUBSCRIPTIONS_SKIP_COLLECTOR_READINESS_CHECK = "false";

    (globalThis as any).fetch = async (input: any) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : String(input?.url ?? "");

      assert.equal(url, "https://api.mercadopago.com/users/me");

      return new Response(
        JSON.stringify({
          id: 3202812261,
          email: "same-user@example.com",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    await assert.rejects(
      () =>
        mpSubscriptionService.createSubscription({
          userId: 7,
          userEmail: "same-user@example.com",
          userName: "Teste",
          planId: "pro",
          cardTokenId: "card_tok_123",
          idempotencyKey: "sub_same_user_123",
          backUrl: "https://fechou.cloud/pagamento/confirmacao",
        }),
      /mesmo da conta que recebe/i,
    );
  } finally {
    (globalThis as any).fetch = originalFetch;

    if (previousToken === undefined) {
      delete process.env.MP_SUBSCRIPTIONS_ACCESS_TOKEN;
    } else {
      process.env.MP_SUBSCRIPTIONS_ACCESS_TOKEN = previousToken;
    }

    if (previousPlan === undefined) {
      delete process.env.MP_SUBSCRIPTIONS_PLAN_PRO_ID;
    } else {
      process.env.MP_SUBSCRIPTIONS_PLAN_PRO_ID = previousPlan;
    }

    if (previousBackUrl === undefined) {
      delete process.env.MP_SUBSCRIPTIONS_BACK_URL;
    } else {
      process.env.MP_SUBSCRIPTIONS_BACK_URL = previousBackUrl;
    }

    if (previousBypass === undefined) {
      delete process.env.MP_SUBSCRIPTIONS_SKIP_COLLECTOR_READINESS_CHECK;
    } else {
      process.env.MP_SUBSCRIPTIONS_SKIP_COLLECTOR_READINESS_CHECK = previousBypass;
    }
  }
});

test("assinatura falha cedo quando a conta vendedora do Mercado Pago ainda esta com endereco pendente", async () => {
  const originalFetch = globalThis.fetch;
  const previousToken = process.env.MP_SUBSCRIPTIONS_ACCESS_TOKEN;
  const previousPlan = process.env.MP_SUBSCRIPTIONS_PLAN_PRO_ID;
  const previousBackUrl = process.env.MP_SUBSCRIPTIONS_BACK_URL;
  const previousBypass = process.env.MP_SUBSCRIPTIONS_SKIP_COLLECTOR_READINESS_CHECK;

  try {
    process.env.MP_SUBSCRIPTIONS_ACCESS_TOKEN = "TEST-123";
    process.env.MP_SUBSCRIPTIONS_PLAN_PRO_ID = "plan_pro";
    process.env.MP_SUBSCRIPTIONS_BACK_URL = "https://fechou.cloud/pagamento/confirmacao";
    process.env.MP_SUBSCRIPTIONS_SKIP_COLLECTOR_READINESS_CHECK = "false";

    (globalThis as any).fetch = async (input: any) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : String(input?.url ?? "");

      assert.equal(url, "https://api.mercadopago.com/users/me");

      return new Response(
        JSON.stringify({
          id: 3202812261,
          email: "collector@example.com",
          status: {
            site_status: "active",
            billing: {
              allow: false,
              codes: ["address_pending"],
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    await assert.rejects(
      () =>
        mpSubscriptionService.createSubscription({
          userId: 7,
          userEmail: "buyer@example.com",
          userName: "Teste",
          planId: "pro",
          cardTokenId: "card_tok_123",
          idempotencyKey: "sub_address_pending_123",
          backUrl: "https://fechou.cloud/pagamento/confirmacao",
        }),
      /endereco pendente/i,
    );
  } finally {
    (globalThis as any).fetch = originalFetch;

    if (previousToken === undefined) {
      delete process.env.MP_SUBSCRIPTIONS_ACCESS_TOKEN;
    } else {
      process.env.MP_SUBSCRIPTIONS_ACCESS_TOKEN = previousToken;
    }

    if (previousPlan === undefined) {
      delete process.env.MP_SUBSCRIPTIONS_PLAN_PRO_ID;
    } else {
      process.env.MP_SUBSCRIPTIONS_PLAN_PRO_ID = previousPlan;
    }

    if (previousBackUrl === undefined) {
      delete process.env.MP_SUBSCRIPTIONS_BACK_URL;
    } else {
      process.env.MP_SUBSCRIPTIONS_BACK_URL = previousBackUrl;
    }

    if (previousBypass === undefined) {
      delete process.env.MP_SUBSCRIPTIONS_SKIP_COLLECTOR_READINESS_CHECK;
    } else {
      process.env.MP_SUBSCRIPTIONS_SKIP_COLLECTOR_READINESS_CHECK = previousBypass;
    }
  }
});

test("assinatura pode ignorar a trava de readiness do coletor em desenvolvimento quando o bypass estiver ativo", async () => {
  const originalFetch = globalThis.fetch;
  const previousToken = process.env.MP_SUBSCRIPTIONS_ACCESS_TOKEN;
  const previousPlan = process.env.MP_SUBSCRIPTIONS_PLAN_PRO_ID;
  const previousBackUrl = process.env.MP_SUBSCRIPTIONS_BACK_URL;
  const previousBypass = process.env.MP_SUBSCRIPTIONS_SKIP_COLLECTOR_READINESS_CHECK;

  try {
    process.env.MP_SUBSCRIPTIONS_ACCESS_TOKEN = "TEST-123";
    process.env.MP_SUBSCRIPTIONS_PLAN_PRO_ID = "plan_pro";
    process.env.MP_SUBSCRIPTIONS_BACK_URL = "https://fechou.cloud/pagamento/confirmacao";
    process.env.MP_SUBSCRIPTIONS_SKIP_COLLECTOR_READINESS_CHECK = "true";

    (globalThis as any).fetch = async (input: any, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : String(input?.url ?? "");

      if (url === "https://api.mercadopago.com/users/me") {
        return new Response(
          JSON.stringify({
            id: 3202812261,
            email: "collector@example.com",
            status: {
              site_status: "active",
              billing: {
                allow: false,
                codes: ["address_pending"],
              },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url === "https://api.mercadopago.com/preapproval_plan/plan_pro") {
        return new Response(
          JSON.stringify({
            id: "plan_pro",
            status: "active",
            reason: "Assinatura Pro",
            auto_recurring: {
              frequency: 1,
              frequency_type: "months",
              transaction_amount: 29,
              currency_id: "BRL",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url === "https://api.mercadopago.com/preapproval") {
        const payload = JSON.parse(String(init?.body ?? "{}"));
        return new Response(
          JSON.stringify({
            id: "pre_123",
            status: "pending",
            reason: payload.reason,
            payer_id: 77,
            external_reference: payload.external_reference,
            init_point: "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=pre_123",
            preapproval_plan_id: "plan_pro",
            auto_recurring: {
              frequency: 1,
              frequency_type: "months",
              transaction_amount: 29,
              currency_id: "BRL",
              start_date: new Date().toISOString(),
              end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            },
            last_modified: new Date().toISOString(),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      throw new Error(`Unexpected fetch in test: ${url}`);
    };

    const result = await mpSubscriptionService.createSubscription({
      userId: 7,
      userEmail: "buyer@example.com",
      userName: "Teste",
      planId: "pro",
      cardTokenId: "card_tok_123",
      idempotencyKey: "sub_bypass_123",
      backUrl: "https://fechou.cloud/pagamento/confirmacao",
    });

    assert.equal(result.preapprovalId, "pre_123");
  } finally {
    (globalThis as any).fetch = originalFetch;

    if (previousToken === undefined) {
      delete process.env.MP_SUBSCRIPTIONS_ACCESS_TOKEN;
    } else {
      process.env.MP_SUBSCRIPTIONS_ACCESS_TOKEN = previousToken;
    }

    if (previousPlan === undefined) {
      delete process.env.MP_SUBSCRIPTIONS_PLAN_PRO_ID;
    } else {
      process.env.MP_SUBSCRIPTIONS_PLAN_PRO_ID = previousPlan;
    }

    if (previousBackUrl === undefined) {
      delete process.env.MP_SUBSCRIPTIONS_BACK_URL;
    } else {
      process.env.MP_SUBSCRIPTIONS_BACK_URL = previousBackUrl;
    }

    if (previousBypass === undefined) {
      delete process.env.MP_SUBSCRIPTIONS_SKIP_COLLECTOR_READINESS_CHECK;
    } else {
      process.env.MP_SUBSCRIPTIONS_SKIP_COLLECTOR_READINESS_CHECK = previousBypass;
    }
  }
});

test("assinatura falha cedo sem email válido do usuário autenticado", async () => {
  const previousToken = process.env.MP_SUBSCRIPTIONS_ACCESS_TOKEN;
  const previousPlan = process.env.MP_SUBSCRIPTIONS_PLAN_PRO_ID;
  const previousBackUrl = process.env.MP_SUBSCRIPTIONS_BACK_URL;
  const previousBuyerEmail = process.env.MP_SUBSCRIPTIONS_TEST_PAYER_EMAIL;

  try {
    process.env.MP_SUBSCRIPTIONS_ACCESS_TOKEN = "TEST-123";
    process.env.MP_SUBSCRIPTIONS_PLAN_PRO_ID = "plan_pro";
    process.env.MP_SUBSCRIPTIONS_BACK_URL = "https://fechou.cloud/pagamento/confirmacao";
    await assert.rejects(
      () =>
        mpSubscriptionService.createSubscription({
          userId: 7,
          userEmail: "",
          userName: "Teste",
          planId: "pro",
          cardTokenId: "card_tok_123",
          idempotencyKey: "sub_missing_email_123",
          backUrl: "https://fechou.cloud/pagamento/confirmacao",
        }),
      /email valido/i,
    );
  } finally {
    if (previousToken === undefined) {
      delete process.env.MP_SUBSCRIPTIONS_ACCESS_TOKEN;
    } else {
      process.env.MP_SUBSCRIPTIONS_ACCESS_TOKEN = previousToken;
    }

    if (previousPlan === undefined) {
      delete process.env.MP_SUBSCRIPTIONS_PLAN_PRO_ID;
    } else {
      process.env.MP_SUBSCRIPTIONS_PLAN_PRO_ID = previousPlan;
    }

    if (previousBackUrl === undefined) {
      delete process.env.MP_SUBSCRIPTIONS_BACK_URL;
    } else {
      process.env.MP_SUBSCRIPTIONS_BACK_URL = previousBackUrl;
    }

    if (previousBuyerEmail === undefined) {
      delete process.env.MP_SUBSCRIPTIONS_TEST_PAYER_EMAIL;
    } else {
      process.env.MP_SUBSCRIPTIONS_TEST_PAYER_EMAIL = previousBuyerEmail;
    }
  }
});

test("checkout de assinatura exige cardTokenId no payload", async () => {
  const accessToken = signAccessToken({ id: 8, email: "assinatura@test.local" });

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/payments/subscriptions/checkout`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        planId: "pro",
        backUrl: "https://fechou.cloud/pagamento/confirmacao",
      }),
    });

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.message, /Dados inv.*lidos\./i);
    assert.ok(body.errors?.fieldErrors?.cardTokenId?.length);
  });
});

test("erro de assinatura do Mercado Pago preserva causa especifica de validacao do cartao", () => {
  const normalized = buildMercadoPagoSubscriptionProviderError(
    new MercadoPagoSubscriptionApiError({
      status: 400,
      path: "/preapproval",
      message: "Falha na API de assinaturas do Mercado Pago (400) em /preapproval.",
      providerMessage: "bad_request | CC_VAL_433 | Credit card validation has failed",
      providerCode: "CC_VAL_433",
      providerRequestId: "req_123",
      providerData: {
        message: "bad_request",
        cause: [{ code: "CC_VAL_433", description: "Credit card validation has failed" }],
      },
    }),
  );

  assert.equal(normalized.status, 400);
  assert.equal(normalized.body.code, "mp_subscription_card_validation_failed");
  assert.equal(normalized.body.message, "Confira os dados do cartão e tente novamente.");
  assert.equal(normalized.body.providerCode, "CC_VAL_433");
  assert.equal(normalized.body.providerStatus, 400);
  assert.equal(normalized.body.providerPath, "/preapproval");
  assert.match(normalized.body.providerMessage, /CC_VAL_433/);
});

test("erro de assinatura do Mercado Pago classifica cartao de debito em recorrencia", () => {
  const normalized = buildMercadoPagoSubscriptionProviderError(
    new MercadoPagoSubscriptionApiError({
      status: 400,
      path: "/preapproval",
      message: "Falha na API de assinaturas do Mercado Pago (400) em /preapproval.",
      providerMessage: "payment method not allowed: debit card recurring payment unsupported",
    }),
  );

  assert.equal(normalized.status, 400);
  assert.equal(normalized.body.code, "mp_subscription_debit_card_not_allowed");
  assert.equal(normalized.body.message, "Este checkout aceita somente cartão de crédito.");
  assert.equal(normalized.body.providerHint, "Use um cartão de crédito válido para ativar a assinatura.");
});

test("validacao de assinatura rejeita external_reference sem HMAC valido", async () => {
  await assert.rejects(
    () =>
      mpSubscriptionService.validatePreapprovalForSubscription(
        {
          id: "pre_unsafe",
          status: "authorized",
          reason: "Assinatura Fechou Pro",
          payer_id: 77,
          external_reference: "subscription:v2:user:7:plan:pro:nonce:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:sig:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          init_point: "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=pre_unsafe",
          preapproval_plan_id: "plan_pro",
          auto_recurring: {
            frequency: 1,
            frequency_type: "months",
            transaction_amount: 29,
            currency_id: "BRL",
            start_date: new Date().toISOString(),
            end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          },
          last_modified: new Date().toISOString(),
        },
        { expectedUserId: 7, requireActive: true },
      ),
    (error: any) => error?.code === "mp_subscription_invalid_external_reference",
  );
});

test("validacao de assinatura aceita somente referencia assinada e termos comerciais esperados", async () => {
  const externalReference = mpSubscriptionService.buildExternalReferenceForSubscription({
    userId: 7,
    planId: "pro",
    idempotencyKey: "sub_validation_123",
  });
  const preapprovalId = `local_mp_sub_u_7_p_pro_ts_${Date.now()}`;

  const validation = await mpSubscriptionService.validatePreapprovalForSubscription(
    mpSubscriptionService.buildLocalTestPreapproval({
      preapprovalId,
      externalReference,
      userId: 7,
      planId: "pro",
    }),
    { expectedUserId: 7, requireActive: true },
  );

  assert.equal(validation.userId, 7);
  assert.equal(validation.planId, "pro");
  assert.equal(validation.amount, 29);
  assert.equal(validation.currency, "BRL");
});

test("dashboard premium exige plano premium no backend", async () => {
  const originalGetActiveSubscriptionByUser = storage.getActiveSubscriptionByUser;
  const accessToken = signAccessToken({ id: 8, email: "free-user@test.local" });

  try {
    (storage as any).getActiveSubscriptionByUser = async () => null;

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/metrics/premium-dashboard`, {
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      assert.equal(response.status, 403);
      const body = await response.json();
      assert.equal(body.planId, "free");
    });
  } finally {
    (storage as any).getActiveSubscriptionByUser = originalGetActiveSubscriptionByUser;
  }
});

test("referência pública de pagamento suporta proposal e contract", () => {
  const proposalReference = buildPublicPaymentExternalReference("proposal", 10, 20, "a".repeat(64));
  assert.deepEqual(parsePublicPaymentExternalReference(proposalReference), {
    kind: "proposal",
    resourceId: 10,
    ownerId: 20,
    tokenPrefix: "a".repeat(20),
  });

  const contractReference = buildPublicPaymentExternalReference("contract", 30, 40, "b".repeat(64));
  assert.deepEqual(parsePublicPaymentExternalReference(contractReference), {
    kind: "contract",
    resourceId: 30,
    ownerId: 40,
    tokenPrefix: "b".repeat(20),
  });

  assert.equal(parsePublicPaymentExternalReference("fechou:10"), null);
});

test("preview token de assinatura expira e valida contrato, usuário e tipo", () => {
  const nowMs = Date.now();
  const expiresAt = nowMs + 60_000;
  const nonce = "a".repeat(32);
  const token = createContractSignaturePreviewToken({
    contractId: 21,
    userId: 8,
    kind: "client",
    expiresAt,
    nonce,
  });

  assert.equal(verifyContractSignaturePreviewToken({
    contractId: 21,
    userId: 8,
    kind: "client",
    expiresAt,
    nonce,
    token,
    nowMs,
  }), true);

  assert.equal(verifyContractSignaturePreviewToken({
    contractId: 21,
    userId: 9,
    kind: "client",
    expiresAt,
    nonce,
    token,
    nowMs,
  }), false);

  assert.equal(verifyContractSignaturePreviewToken({
    contractId: 21,
    userId: 8,
    kind: "provider",
    expiresAt,
    nonce,
    token,
    nowMs,
  }), false);

  const previewPath = buildContractSignaturePreviewPath({
    contractId: 21,
    kind: "client",
    expiresAt,
    nonce,
    token,
  });

  assert.match(previewPath, /\/api\/contracts\/21\/signature\?/);
  assert.match(previewPath, /preview=1/);
  assert.match(previewPath, /preview_token=/);
  assert.match(previewPath, /preview_nonce=/);
});

test("preview autenticado usa asset opaco e cacheavel sem expor dados do contrato", () => {
  const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const asset = createAuthenticatedContractSignaturePreviewAsset({
    contractId: 21,
    userId: 8,
    kind: "client",
    expiresAt: Date.now() + 60_000,
    pngBuffer,
  });

  assert.match(asset.previewToken, /^[a-f0-9]{64}$/);
  assert.match(asset.previewUrl, /^\/api\/contracts\/preview-assets\/[a-f0-9]{64}$/);
  assert.equal(asset.previewUrl.includes("preview_exp"), false);
  assert.equal(asset.previewUrl.includes("preview_nonce"), false);

  const cached = getAuthenticatedContractSignaturePreviewAsset(asset.previewToken);
  assert.equal(cached?.contractId, 21);
  assert.equal(cached?.userId, 8);
  assert.equal(cached?.kind, "client");
  assert.deepEqual(cached?.pngBuffer, pngBuffer);
});

test("helper de preview asset aceita apenas subrequest de imagem vindo do preview document", () => {
  const trustedReq = {
    protocol: "http",
    get(name: string) {
      return name.toLowerCase() === "host" ? "127.0.0.1:3001" : undefined;
    },
    header(name: string) {
      const normalized = name.toLowerCase();
      if (normalized === "sec-fetch-dest") return "image";
      if (normalized === "referer") return "http://127.0.0.1:3001/api/contracts/21/preview-document";
      return undefined;
    },
  } as any;

  const directReq = {
    protocol: "http",
    get(name: string) {
      return name.toLowerCase() === "host" ? "127.0.0.1:3001" : undefined;
    },
    header(name: string) {
      const normalized = name.toLowerCase();
      if (normalized === "sec-fetch-dest") return "document";
      if (normalized === "referer") return "http://127.0.0.1:3001/qualquer";
      return undefined;
    },
  } as any;

  assert.equal(isTrustedPreviewAssetRequest(trustedReq, 21), true);
  assert.equal(isTrustedPreviewAssetRequest(directReq, 21), false);
});

test("asset autenticado bloqueia abertura direta e permite carga pelo preview document", async () => {
  const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const asset = createAuthenticatedContractSignaturePreviewAsset({
    contractId: 21,
    userId: 8,
    kind: "client",
    expiresAt: Date.now() + 60_000,
    pngBuffer,
  });
  const accessToken = signAccessToken({ id: 8, email: "preview@test.local" });

  await withServer(async (baseUrl) => {
    const directResponse = await fetch(`${baseUrl}${asset.previewUrl}`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });

    assert.equal(directResponse.status, 403);

    const nestedResponse = await fetch(`${baseUrl}${asset.previewUrl}`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        referer: `${baseUrl}/api/contracts/21/preview-document`,
        "sec-fetch-dest": "image",
      },
    });

    assert.equal(nestedResponse.status, 200);
    assert.match(nestedResponse.headers.get("content-type") ?? "", /^image\/png/i);
  });
});

test("checkout público rejeita token fora do padrão 64-hex", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/payments/public/${"z".repeat(64)}/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        successUrl: "http://127.0.0.1:5173/public/ok",
        failureUrl: "http://127.0.0.1:5173/public/fail",
        pendingUrl: "http://127.0.0.1:5173/public/pending",
      }),
    });

    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /token inv[aá]lido/i);
  });
});

test("assinatura pública rejeita signerName e signerDocument maliciosos", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/proposals/public/${"a".repeat(64)}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        signerName: "<script>alert(1)</script>",
        signerDocument: "12345<script>",
        signatureDataUrl: `data:image/png;base64,${"A".repeat(64)}`,
      }),
    });

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.message, "Dados inválidos.");
    assert.ok(body.errors?.fieldErrors?.signerName?.length);
    assert.ok(body.errors?.fieldErrors?.signerDocument?.length);
  });
});

test("checkout público aceita token de contrato e aplica trava antes do pagamento", async () => {
  const originalGetProposalByShareTokenHash = storage.getProposalByShareTokenHash;
  const originalGetContractByShareTokenHash = contractService.getContractByShareTokenHash;

  try {
    (storage as any).getProposalByShareTokenHash = async () => null;
    (contractService as any).getContractByShareTokenHash = async () => ({
      id: 77,
      userId: 9,
      title: "Contrato de design",
      contractType: "Contrato de design",
      clientName: "Cliente Teste",
      description: "Criacao de identidade visual",
      serviceScope: "Criacao de identidade visual",
      value: "199.90",
      contractValue: "199.90",
      status: "finalizado",
      lifecycleStatus: "ACCEPTED",
      paymentConfirmedAt: null,
      shareTokenExpiresAt: new Date(Date.now() + 60_000),
      contract: {
        signed: false,
        signedAt: null,
        signerName: null,
        canPay: false,
      },
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/payments/public/${"a".repeat(64)}/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          successUrl: buildTrustedFrontendUrlForTests("/public/ok"),
          failureUrl: buildTrustedFrontendUrlForTests("/public/fail"),
          pendingUrl: buildTrustedFrontendUrlForTests("/public/pending"),
        }),
      });

      assert.equal(response.status, 409);
      assert.match((await response.json()).message, /assinatura do contrato/i);
    });
  } finally {
    (storage as any).getProposalByShareTokenHash = originalGetProposalByShareTokenHash;
    (contractService as any).getContractByShareTokenHash = originalGetContractByShareTokenHash;
  }
});

test("webhook público confirma pagamento de contrato por external_reference", async () => {
  const originalFetch = globalThis.fetch;
  const previousMpAccessToken = process.env.MP_ACCESS_TOKEN;
  const previousWebhookSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  const originalValidateWebhookSignature = mpSubscriptionService.validateWebhookSignature;
  const originalGetContract = contractService.getContract;
  const originalMarkContractPaid = contractService.markContractPaid;
  const originalFindLatestPendingContractPaymentSession = storage.findLatestPendingContractPaymentSession;
  const originalMarkMercadoPagoPayment = storage.markMercadoPagoPayment;

  let markedContractPaid = false;
  let markedSessionStatus: { sessionId: number; paymentId: string; status: string } | null = null;

  try {
    process.env.MP_ACCESS_TOKEN = "TEST-123";
    process.env.MERCADO_PAGO_WEBHOOK_SECRET = "test_webhook_secret";
    (mpSubscriptionService as any).validateWebhookSignature = () => true;
    (contractService as any).getContract = async () => ({
      id: 42,
      userId: 7,
      shareTokenHash: `abc123${"0".repeat(58)}`,
      lifecycleStatus: "ACCEPTED",
      paymentConfirmedAt: null,
    });
    (contractService as any).markContractPaid = async () => {
      markedContractPaid = true;
      return { id: 42 };
    };
    (storage as any).findLatestPendingContractPaymentSession = async () => ({ id: 11 });
    (storage as any).markMercadoPagoPayment = async (sessionId: number, paymentId: string, status: string) => {
      markedSessionStatus = { sessionId, paymentId, status };
      return { id: sessionId };
    };

    await withServer(async (baseUrl) => {
      (globalThis as any).fetch = async (input: any, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : String(input?.url ?? "");

        if (url.startsWith(baseUrl)) {
          return originalFetch(input, init);
        }

        if (url.includes("/v1/payments/123")) {
          return new Response(
            JSON.stringify({
              id: 123,
              status: "approved",
              external_reference: "contract:42:owner:7:token:abc123",
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        throw new Error(`Unexpected fetch in test: ${url}`);
      };

      const response = await originalFetch(`${baseUrl}/api/payments/webhook?topic=payment&data.id=123`, {
        method: "POST",
        headers: buildMercadoPagoWebhookHeaders("123", "test_webhook_secret"),
        body: JSON.stringify({ data: { id: "123" }, type: "payment" }),
      });

      assert.equal(response.status, 201);
      assert.equal((await response.json()).queued, true);
      for (let attempt = 0; attempt < 40 && !markedContractPaid; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    });

    assert.equal(markedContractPaid, true);
    assert.deepEqual(markedSessionStatus, {
      sessionId: 11,
      paymentId: "123",
      status: "paid",
    });
  } finally {
    if (previousMpAccessToken === undefined) {
      delete process.env.MP_ACCESS_TOKEN;
    } else {
      process.env.MP_ACCESS_TOKEN = previousMpAccessToken;
    }

    if (previousWebhookSecret === undefined) {
      delete process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    } else {
      process.env.MERCADO_PAGO_WEBHOOK_SECRET = previousWebhookSecret;
    }

    (globalThis as any).fetch = originalFetch;
    (mpSubscriptionService as any).validateWebhookSignature = originalValidateWebhookSignature;
    (contractService as any).getContract = originalGetContract;
    (contractService as any).markContractPaid = originalMarkContractPaid;
    (storage as any).findLatestPendingContractPaymentSession = originalFindLatestPendingContractPaymentSession;
    (storage as any).markMercadoPagoPayment = originalMarkMercadoPagoPayment;
  }
});

test("smoke: rotas públicas e sensíveis respondem com proteções esperadas", async () => {
  await withServer(async (baseUrl) => {
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);

    const refresh = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(refresh.status, 401);

    const publicContract = await fetch(`${baseUrl}/api/contracts/review/${"a".repeat(64)}`);
    assert.notEqual(publicContract.status, 401);
    assert.equal([404, 410].includes(publicContract.status), true);

    const mpCallback = await fetch(`${baseUrl}/api/mercadopago/callback?code=fake&state=fake`);
    assert.equal(mpCallback.status, 400);

    const paymentsWebhook = await fetch(`${baseUrl}/api/payments/webhook?topic=payment&data.id=123`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(paymentsWebhook.status, 401);

    const legacyWebhook = await fetch(`${baseUrl}/api/webhooks/mercadopago?topic=payment&data.id=123`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(legacyWebhook.status, 401);
  });
});
