import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { authenticate, type AuthenticatedRequest } from "../middleware/auth.js";
import { storage } from "../storage.js";
import {
  MercadoPagoSubscriptionApiError,
  MercadoPagoSubscriptionConfigError,
  MercadoPagoSubscriptionValidationError,
  getSubscriptionPublicKeyMode,
  getSubscriptionCredentialMode,
  getSubscriptionPublicKey,
  getSubscriptionPlanSecurityProfile,
  hasAssociatedSubscriptionPlansConfigured,
  mpSubscriptionService,
  type MpPlanId,
} from "../services/Mercadopago subscriptions.service.js";
import { requirePlan } from "../middleware/requirePlan.js";
import { distributedRateLimit } from "../middleware/distributed-security.js";
import { webhookRateLimiter } from "../middleware/security.js";
import {
  buildTrustedFrontendUrl,
  ensureTrustedFrontendRedirectUrl,
  getPublicAppBaseUrl,
  normalizeHexToken,
  resolveTrustedFrontendOrigin,
} from "../lib/httpSecurity.js";
import {
  buildPublicPaymentExternalReference,
  parsePublicPaymentExternalReference,
} from "../services/payments/mercadoPagoReferences.js";
import {
  createPublicCheckoutProPayment,
  PaymentSecurityError,
  persistMercadoPagoWebhookEvent,
} from "../services/payments/mercadoPagoSecure.js";
import { scheduleMercadoPagoWebhookEventProcessing } from "../services/payments/mercadoPagoWebhookQueue.js";
import {
  normalizeOrGenerateIdempotencyKey,
  verifyMercadoPagoWebhookSignatureDetailed,
} from "../services/payments/mercadoPagoSecurity.js";
import {
  incrementPaymentMetric,
  logPaymentEvent,
  observePaymentLatency,
} from "../services/payments/mercadoPagoObservability.js";

export {
  buildPublicPaymentExternalReference,
  parsePublicPaymentExternalReference,
};

const router = Router();

// â”€â”€â”€ Schemas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const subscriptionCheckoutSchema = z.object({
  planId:   z.enum(["pro", "premium"]),
  cardTokenId: z.string().trim().min(6).max(300),
  backUrl:  z.string().url().optional(),
});

const confirmSubscriptionSchema = z.object({
  preapprovalId: z.string().trim().min(4).max(120).optional(),
  externalReference: z.string().trim().min(4).max(200).optional(),
});

const publicMercadoPagoCheckoutSchema = z.object({
  successUrl: z.string().url(),
  failureUrl: z.string().url(),
  pendingUrl: z.string().url(),
  payerEmail: z.string().email().max(180).optional(),
});

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function hashSha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function planFromPreapprovalStatus(status: string, planId: MpPlanId): MpPlanId | "free" {
  return mpSubscriptionService.isActiveStatus(status) ? planId : "free";
}

function resolveSubscriptionBackUrl(req: AuthenticatedRequest, explicitBackUrl?: string): string {
  if (mpSubscriptionService.isLocalTestModeEnabled()) {
    if (explicitBackUrl) {
      const raw = String(explicitBackUrl).trim();
      try {
        const url = new URL(raw);
        const isLoopback =
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase());

        if (isLoopback || url.protocol === "https:") {
          return url.toString();
        }
      } catch {
        throw new Error("URL de retorno invalida.");
      }
    }

    const fallbackOrigin =
      req.header("origin") ??
      req.header("referer") ??
      "http://localhost:5173";

    try {
      const originUrl = new URL(fallbackOrigin);
      return `${originUrl.origin}/pagamento/confirmacao`;
    } catch {
      return "http://localhost:5173/pagamento/confirmacao";
    }
  }

  if (explicitBackUrl) {
    return ensureTrustedFrontendRedirectUrl(explicitBackUrl);
  }

  const preferredOrigin =
    resolveTrustedFrontendOrigin(req.header("origin")) ??
    resolveTrustedFrontendOrigin(req.header("referer"));

  return buildTrustedFrontendUrl("/pagamento/confirmacao", preferredOrigin);
}

function getPublicPaymentsWebhookUrl() {
  const explicit = String(process.env.MERCADO_PAGO_PAYMENT_WEBHOOK_URL ?? "").trim();
  if (explicit) {
    return explicit;
  }

  const sharedWebhookUrl = String(process.env.MERCADO_PAGO_WEBHOOK_URL ?? "").trim();
  if (sharedWebhookUrl.endsWith("/api/payments/webhook")) {
    return sharedWebhookUrl;
  }

  return `${getPublicAppBaseUrl()}/api/payments/webhook`;
}

function isDatabaseConnectionError(error: unknown): boolean {
  const message = String((error as any)?.message ?? "").toLowerCase();
  const causeMessage = String((error as any)?.cause?.message ?? "").toLowerCase();

  return [
    "connection timeout",
    "connection terminated",
    "connection terminated unexpectedly",
    "terminating connection",
    "timeout expired",
    "failed to connect",
    "econnrefused",
    "the database system is starting up",
    "remaining connection slots are reserved",
  ].some((pattern) => message.includes(pattern) || causeMessage.includes(pattern));
}

function isMissingDatabaseObjectError(error: unknown): boolean {
  const message = String((error as any)?.message ?? "").toLowerCase();
  const causeMessage = String((error as any)?.cause?.message ?? "").toLowerCase();
  const combined = `${message} ${causeMessage}`;

  return (
    combined.includes("does not exist") ||
    combined.includes("não existe") ||
    combined.includes("nao existe") ||
    combined.includes("undefined table") ||
    combined.includes("undefined column")
  );
}

function freePlanPayload() {
  return {
    payments: [],
    subscription: null,
    plan: {
      planId: "free" as const,
      status: null,
      isSubscribed: false,
    },
  };
}

function extractMercadoPagoProviderCode(providerMessage: string): string | undefined {
  const match = String(providerMessage ?? "")
    .trim()
    .match(/\b([A-Z0-9]+(?:_[A-Z0-9]+)+)\b/);

  return match?.[1];
}

function normalizeComparableText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function buildMercadoPagoStructuredError(input: {
  code: string;
  message: string;
  providerHint: string;
  providerMessage?: string;
  providerCode?: string;
  providerStatus?: number | null;
  providerPath?: string | null;
  providerRequestId?: string | null;
}) {
  return {
    code: input.code,
    message: input.message,
    providerMessage: input.providerMessage ?? "",
    providerHint: input.providerHint,
    providerCode: input.providerCode ?? undefined,
    providerStatus: input.providerStatus ?? null,
    providerPath: input.providerPath ?? null,
    providerRequestId: input.providerRequestId ?? null,
  };
}

function redactMercadoPagoLogValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactMercadoPagoLogValue);
  }

  if (value && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase();
      if (
        normalizedKey.includes("token") ||
        normalizedKey.includes("card") ||
        normalizedKey.includes("cvv") ||
        normalizedKey.includes("security_code") ||
        normalizedKey.includes("document") ||
        normalizedKey.includes("identification")
      ) {
        redacted[key] = "[REDACTED]";
        continue;
      }

      if (normalizedKey.includes("email")) {
        const raw = String(nested ?? "");
        const [name, domain] = raw.split("@");
        redacted[key] = name && domain ? `${name.slice(0, 2)}***@${domain}` : "[REDACTED]";
        continue;
      }

      redacted[key] = redactMercadoPagoLogValue(nested);
    }
    return redacted;
  }

  return value;
}

function statusForMercadoPagoProviderError(providerStatus: number): number {
  if (providerStatus === 401) return 401;
  if (providerStatus === 403) return 403;
  if (providerStatus >= 500) return providerStatus === 503 ? 503 : 502;
  return 400;
}

function amountToCents(value: unknown): number {
  return Math.round(Number(value) * 100);
}

function assertSubscriptionSessionIntegrity(
  session: { metadata?: Record<string, string> | null },
  validation: {
    planId: MpPlanId;
    providerPlanId: string;
    amount: number;
    currency: string;
    collectorId?: number;
  },
) {
  const metadata = session.metadata ?? {};
  const expected = getSubscriptionPlanSecurityProfile(validation.planId);

  if (metadata.kind !== "mp_subscription_checkout") {
    throw new MercadoPagoSubscriptionValidationError(
      "Sessao de assinatura invalida para confirmacao.",
      "mp_subscription_session_invalid",
      403,
    );
  }

  if (metadata.planId !== validation.planId || metadata.providerPlanId !== validation.providerPlanId) {
    throw new MercadoPagoSubscriptionValidationError(
      "Sessao de assinatura nao corresponde ao plano confirmado.",
      "mp_subscription_session_plan_mismatch",
      409,
    );
  }

  const metadataAmountCents = amountToCents(metadata.amount ?? expected.amount);
  if (metadataAmountCents !== amountToCents(validation.amount)) {
    throw new MercadoPagoSubscriptionValidationError(
      "Sessao de assinatura nao corresponde ao valor confirmado.",
      "mp_subscription_session_amount_mismatch",
      409,
    );
  }

  if (String(metadata.currency ?? "").trim().toUpperCase() !== validation.currency) {
    throw new MercadoPagoSubscriptionValidationError(
      "Sessao de assinatura nao corresponde a moeda confirmada.",
      "mp_subscription_session_currency_mismatch",
      409,
    );
  }

  if (
    validation.collectorId &&
    String(metadata.collectorId ?? "").trim() &&
    Number(metadata.collectorId) !== validation.collectorId
  ) {
    throw new MercadoPagoSubscriptionValidationError(
      "Sessao de assinatura nao corresponde a conta recebedora confirmada.",
      "mp_subscription_session_collector_mismatch",
      403,
    );
  }
}

export function buildMercadoPagoSubscriptionProviderError(err: MercadoPagoSubscriptionApiError) {
  const providerMessage = String(err.providerMessage ?? "").trim();
  const normalizedProviderMessage = normalizeComparableText(providerMessage);
  const providerCode = extractMercadoPagoProviderCode(providerMessage) ?? err.providerCode;
  const baseBody = {
    providerStatus: err.status,
    providerPath: err.path,
    providerMessage,
    providerCode,
    providerRequestId: err.providerRequestId ?? null,
  };

  if (
    providerCode === "INVALID_USERS" ||
    normalizedProviderMessage.includes("invalid users") ||
    normalizedProviderMessage.includes("same user") ||
    (normalizedProviderMessage.includes("payer") && normalizedProviderMessage.includes("collector"))
  ) {
    return {
      status: 409,
      body: buildMercadoPagoStructuredError({
        code: "mp_subscription_same_payer_as_collector",
        message: "Não é possível assinar usando a mesma conta que recebe os pagamentos.",
        providerHint:
          "Use uma conta compradora diferente da conta vendedora.",
        ...baseBody,
      }),
    };
  }

  if (
    normalizedProviderMessage.includes("card token service not found") ||
    normalizedProviderMessage.includes("invalid card token") ||
    normalizedProviderMessage.includes("expired card token") ||
    normalizedProviderMessage.includes("used card token") ||
    normalizedProviderMessage.includes("token") && (
      normalizedProviderMessage.includes("expired") ||
      normalizedProviderMessage.includes("invalid") ||
      normalizedProviderMessage.includes("already used") ||
      normalizedProviderMessage.includes("not found")
    )
  ) {
    return {
      status: 400,
      body: buildMercadoPagoStructuredError({
        code: "mp_subscription_card_token_service_not_found",
        message: "O token do cartão não pôde ser usado.",
        providerHint: "Preencha os dados novamente para gerar um novo token.",
        ...baseBody,
      }),
    };
  }

  if (
    normalizedProviderMessage.includes("debit") ||
    normalizedProviderMessage.includes("debito") ||
    normalizedProviderMessage.includes("debit card") ||
    normalizedProviderMessage.includes("credit card") && normalizedProviderMessage.includes("required") ||
    normalizedProviderMessage.includes("recurring payment unsupported") ||
    normalizedProviderMessage.includes("recurring payments unsupported") ||
    normalizedProviderMessage.includes("payment method not allowed") ||
    normalizedProviderMessage.includes("payment method") && normalizedProviderMessage.includes("not allowed")
  ) {
    return {
      status: 400,
      body: buildMercadoPagoStructuredError({
        code: "mp_subscription_debit_card_not_allowed",
        message: "Este checkout aceita somente cartão de crédito.",
        providerHint: "Use um cartão de crédito válido para ativar a assinatura.",
        ...baseBody,
      }),
    };
  }

  if (
    err.status === 401 ||
    err.status === 403 ||
    normalizedProviderMessage.includes("invalid credentials") ||
    normalizedProviderMessage.includes("invalid access token") ||
    normalizedProviderMessage.includes("unauthorized") ||
    normalizedProviderMessage.includes("forbidden") ||
    normalizedProviderMessage.includes("invalid application") ||
    normalizedProviderMessage.includes("collector") && normalizedProviderMessage.includes("credential") ||
    normalizedProviderMessage.includes("public key") && normalizedProviderMessage.includes("access token")
  ) {
    return {
      status: err.status === 403 ? 403 : 401,
      body: buildMercadoPagoStructuredError({
        code: "mp_subscription_invalid_credentials",
        message: "As credenciais do Mercado Pago estão inválidas ou incompatíveis.",
        providerHint:
          "Confira MP_ACCESS_TOKEN, Public Key e se ambas pertencem ao mesmo ambiente e aplicação.",
        ...baseBody,
      }),
    };
  }

  if (
    providerCode === "CC_VAL_433" ||
    normalizedProviderMessage.includes("credit card validation has failed") ||
    normalizedProviderMessage.includes("card validation") ||
    normalizedProviderMessage.includes("invalid card") ||
    normalizedProviderMessage.includes("card data") ||
    normalizedProviderMessage.includes("security code") ||
    normalizedProviderMessage.includes("cvv") ||
    normalizedProviderMessage.includes("expiration") ||
    normalizedProviderMessage.includes("holder") ||
    normalizedProviderMessage.includes("identification") ||
    normalizedProviderMessage.includes("document")
  ) {
    return {
      status: 400,
      body: buildMercadoPagoStructuredError({
        code: "mp_subscription_card_validation_failed",
        message: "Confira os dados do cartão e tente novamente.",
        providerHint: "Verifique número, validade, CVV, nome do titular, documento e email.",
        ...baseBody,
      }),
    };
  }

  if (
    err.status >= 500 ||
    normalizedProviderMessage.includes("internal server error") ||
    normalizedProviderMessage.includes("temporarily unavailable") ||
    normalizedProviderMessage.includes("service unavailable") ||
    normalizedProviderMessage.includes("timeout")
  ) {
    return {
      status: err.status === 503 ? 503 : 502,
      body: buildMercadoPagoStructuredError({
        code: "mp_subscription_provider_temporarily_unavailable",
        message: "Mercado Pago indisponível no momento.",
        providerHint: "Tente novamente em alguns instantes.",
        ...baseBody,
      }),
    };
  }

  return {
    status: statusForMercadoPagoProviderError(err.status),
    body: buildMercadoPagoStructuredError({
      code: "mp_subscription_provider_error",
      message: err.status >= 500
        ? "Mercado Pago indisponível no momento."
        : "Não foi possível criar a assinatura no Mercado Pago.",
      providerHint: err.status >= 500
        ? "Tente novamente em alguns instantes."
        : "Revise os dados enviados e tente novamente.",
      ...baseBody,
    }),
  };
}

function buildMercadoPagoSubscriptionLocalError(err: MercadoPagoSubscriptionConfigError | MercadoPagoSubscriptionValidationError) {
  const code = err.code;
  const validationStatus = err instanceof MercadoPagoSubscriptionValidationError ? err.status : undefined;

  if (code === "mp_subscription_same_payer_as_collector") {
    return {
      status: 409,
      body: buildMercadoPagoStructuredError({
        code,
        message: "Não é possível assinar usando a mesma conta que recebe os pagamentos.",
        providerHint: "Use uma conta compradora diferente da conta vendedora.",
        providerMessage: err.message,
        providerStatus: validationStatus ?? 409,
        providerPath: "/preapproval",
      }),
    };
  }

  if (code === "mp_subscription_collector_address_pending") {
    return {
      status: 409,
      body: buildMercadoPagoStructuredError({
        code,
        message: "A conta recebedora precisa completar os dados cadastrais.",
        providerHint: "Conclua endereço e cadastro da conta no Mercado Pago.",
        providerMessage: err.message,
        providerStatus: 409,
        providerPath: "/users/me",
      }),
    };
  }

  if (code === "mp_subscription_collector_billing_blocked") {
    return {
      status: 409,
      body: buildMercadoPagoStructuredError({
        code,
        message: "A cobrança recorrente está indisponível nesta conta.",
        providerHint: "Revise pendências da conta recebedora no painel do Mercado Pago.",
        providerMessage: err.message,
        providerStatus: 409,
        providerPath: "/users/me",
      }),
    };
  }

  if (
    code === "mp_subscription_public_key_mode_mismatch" ||
    code === "mp_subscription_missing_token" ||
    code === "mp_subscription_missing_public_key"
  ) {
    return {
      status: 401,
      body: buildMercadoPagoStructuredError({
        code: "mp_subscription_invalid_credentials",
        message: "As credenciais do Mercado Pago estão inválidas ou incompatíveis.",
        providerHint:
          "Confira MP_ACCESS_TOKEN, Public Key e se ambas pertencem ao mesmo ambiente e aplicação.",
        providerMessage: err.message,
        providerStatus: 401,
        providerPath: "/preapproval",
      }),
    };
  }

  return {
    status: validationStatus ?? 503,
    body: {
      message: err.message,
      code: err.code,
    },
  };
}

const publicCheckoutLimiter = distributedRateLimit({
  scope: "payments-public-checkout",
  limit: Number(process.env.RATE_LIMIT_PUBLIC_PAYMENT_CHECKOUT_MAX ?? 10),
  windowMs: Number(process.env.RATE_LIMIT_PUBLIC_PAYMENT_CHECKOUT_WINDOW_MS ?? 10 * 60 * 1000),
  key: (req) => `${req.ip}:${String(req.params.token ?? "")}`,
});

const publicCheckoutLocalLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_PUBLIC_PAYMENT_CHECKOUT_WINDOW_MS ?? 10 * 60 * 1000),
  max: Number(process.env.RATE_LIMIT_PUBLIC_PAYMENT_CHECKOUT_MAX ?? 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${String(req.params.token ?? "")}`,
  message: { message: "Muitas tentativas de checkout. Tente novamente em alguns instantes." },
});

const paymentsWebhookDistributedLimiter = distributedRateLimit({
  scope: "payments-webhook",
  limit: Number(process.env.RATE_LIMIT_WEBHOOK_MAX ?? 120),
  windowMs: Number(process.env.RATE_LIMIT_WEBHOOK_WINDOW_MS ?? 60 * 1000),
});

// â”€â”€â”€ PAGAMENTO DE PROPOSTA (one-time via MP â€” mantido) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.post("/public/:token/checkout", publicCheckoutLocalLimiter, publicCheckoutLimiter, async (req, res) => {
  const startedAt = performance.now();
  const parsed = publicMercadoPagoCheckoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados invalidos.", errors: parsed.error.flatten() });
  }

  const token = normalizeHexToken(req.params.token);
  if (!token) return res.status(400).json({ message: "Token invalido." });

  let successUrl: string;
  let failureUrl: string;
  let pendingUrl: string;
  try {
    successUrl = ensureTrustedFrontendRedirectUrl(parsed.data.successUrl);
    failureUrl = ensureTrustedFrontendRedirectUrl(parsed.data.failureUrl);
    pendingUrl = ensureTrustedFrontendRedirectUrl(parsed.data.pendingUrl);
  } catch (err: any) {
    return res.status(400).json({ message: err?.message ?? "URL de retorno invalida." });
  }

  try {
    const result = await createPublicCheckoutProPayment({
      tokenHash: hashSha256(token),
      payerEmail: parsed.data.payerEmail,
      successUrl,
      failureUrl,
      pendingUrl,
      notificationUrl: getPublicPaymentsWebhookUrl(),
      requestId: String((req as any).requestId ?? req.header("x-request-id") ?? ""),
      idempotencyKey: normalizeOrGenerateIdempotencyKey(req.header("x-idempotency-key") ?? undefined),
      ipAddress: req.ip,
      userAgent: String(req.header("user-agent") ?? "").slice(0, 300),
    });

    observePaymentLatency("mercadopago.public_checkout_ack_ms", performance.now() - startedAt);
    return res.status(201).json({
      checkoutIntentId: result.checkoutIntentId,
      checkoutUrl: result.checkoutUrl,
      preferenceId: result.preferenceId,
      idempotencyKey: result.idempotencyKey,
    });
  } catch (error) {
    observePaymentLatency("mercadopago.public_checkout_ack_ms", performance.now() - startedAt);

    if (error instanceof PaymentSecurityError) {
      return res.status(error.status).json({ message: error.message, code: error.code });
    }

    logPaymentEvent({
      level: "error",
      event: "public_checkout.failed",
      outcome: "failed",
      requestId: String((req as any).requestId ?? ""),
      ip: req.ip,
      metadata: {
        message: error instanceof Error ? error.message : String(error),
      },
    });

    return res.status(500).json({ message: "Erro ao criar checkout do Mercado Pago." });
  }
});

// â”€â”€â”€ ASSINATURA DE PLANO via MP Preapproval â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get("/subscriptions/client-config", authenticate, async (_req: AuthenticatedRequest, res) => {
  try {
    return res.json({
      publicKey: getSubscriptionPublicKey(),
      mode: getSubscriptionCredentialMode(),
      publicKeyMode: getSubscriptionPublicKeyMode(),
      hasAssociatedPlansConfigured: hasAssociatedSubscriptionPlansConfigured(),
    });
  } catch (err: any) {
    if (err instanceof MercadoPagoSubscriptionConfigError) {
      return res.status(503).json({ message: err.message, code: err.code });
    }

    return res.status(500).json({ message: err?.message ?? "Erro ao carregar configuracao da assinatura." });
  }
});

/**
 * POST /api/payments/subscriptions/checkout
 * body: { planId: "pro" | "premium", backUrl?: string }
 *
 * Retorna { checkoutUrl } â€” redirecione o usuÃ¡rio para lÃ¡.
 * ApÃ³s assinar, o MP redireciona para backUrl e manda webhook.
 */
router.post("/subscriptions/checkout", authenticate, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "NÃ£o autenticado." });

  const parsed = subscriptionCheckoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados invÃ¡lidos.", errors: parsed.error.flatten() });
  }

  let user: Awaited<ReturnType<typeof storage.findUserById>> | null = null;

  try {
    user = await storage.findUserById(userId);

    if (!user) return res.status(404).json({ message: "Usuario nao encontrado." });
    let trustedBackUrl: string;
    try {
      trustedBackUrl = resolveSubscriptionBackUrl(req, parsed.data.backUrl);
    } catch (err: any) {
      return res.status(400).json({ message: err?.message ?? "URL de retorno invÃ¡lida." });
    }

    const idempotencyKey = normalizeOrGenerateIdempotencyKey(req.header("x-idempotency-key") ?? undefined);
    const result = await mpSubscriptionService.createSubscription({
      userId,
      userEmail: user.email,
      userName:  user.name,
      planId:    parsed.data.planId as MpPlanId,
      cardTokenId: parsed.data.cardTokenId,
      idempotencyKey,
      backUrl:   trustedBackUrl,
      preferredOrigin: req.header("origin") ?? req.header("referer") ?? undefined,
    });

    // Persiste a sessÃ£o para rastreamento
    await storage.createPaymentSession({
      userId,
      mode:           "subscription",
      stripeSessionId: `mp_sub_${userId}_${Date.now()}`,
      stripeSubscriptionId: result.preapprovalId,
      amount:         result.amount.toFixed(2),
      currency:       result.currency.toLowerCase(),
      metadata: {
        kind:             "mp_subscription_checkout",
        planId:           parsed.data.planId,
        externalReference: result.externalReference,
        providerPlanId: result.providerPlanId,
        amount: result.amount.toFixed(2),
        currency: result.currency,
        collectorId: result.collectorId ? String(result.collectorId) : "",
        idempotencyKey,
      },
    });

    return res.status(201).json({
      checkoutUrl:    result.redirectUrl,
      providerCheckoutUrl: result.providerInitPoint ?? null,
      preapprovalId:  result.preapprovalId,
      planId:         result.planId,
      externalReference: result.externalReference,
      simulated: result.simulated ?? false,
    });
  } catch (err: any) {
    if (err instanceof MercadoPagoSubscriptionConfigError) {
      const normalizedLocalError = buildMercadoPagoSubscriptionLocalError(err);
      console.warn("[subscriptions/checkout:config]", err);
      return res.status(normalizedLocalError.status).json(normalizedLocalError.body);
    }
    if (err instanceof MercadoPagoSubscriptionValidationError) {
      const normalizedLocalError = buildMercadoPagoSubscriptionLocalError(err);
      console.warn("[subscriptions/checkout:validation]", err);
      return res.status(normalizedLocalError.status).json(normalizedLocalError.body);
    }
    if (err instanceof MercadoPagoSubscriptionApiError) {
      const normalizedProviderError = buildMercadoPagoSubscriptionProviderError(err);
      console.warn("[subscriptions/checkout:provider]", {
        status: err.status,
        path: err.path,
        providerMessage: err.providerMessage,
        providerCode: err.providerCode ?? null,
        providerRequestId: err.providerRequestId ?? null,
        providerData: redactMercadoPagoLogValue(err.providerData ?? null),
      });
      return res.status(normalizedProviderError.status).json(normalizedProviderError.body);
    }
    if (isDatabaseConnectionError(err)) {
      console.warn("[subscriptions/checkout:db]", err?.message ?? err);
      return res.status(503).json({
        message: "Banco de dados temporariamente indisponivel. Tente novamente em instantes.",
        code: "database_temporarily_unavailable",
      });
    }
    console.error("[subscriptions/checkout]", err?.message);
    return res.status(500).json({ message: err?.message ?? "Erro ao criar assinatura." });
  }
});

/**
 * POST /api/payments/subscriptions/confirm
 * body: { preapprovalId? } ou { externalReference? }
 *
 * O MP pode retornar o preapproval_id na URL de retorno (?preapproval_id=XXX).
 * Se nÃ£o retornar, buscamos pelo externalReference gravado na sessÃ£o de pagamento.
 */
router.post("/subscriptions/confirm", authenticate, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "NÃ£o autenticado." });

  const parsedBody = confirmSubscriptionSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({ message: "Dados invÃ¡lidos.", errors: parsedBody.error.flatten() });
  }

  const { preapprovalId, externalReference } = parsedBody.data;

  try {
    let preapproval: any = null;

    if (!preapprovalId && !externalReference) {
      return res.status(400).json({
        message: "Informe preapprovalId ou externalReference para confirmar a assinatura.",
        code: "mp_subscription_confirmation_reference_required",
      });
    }

    if (mpSubscriptionService.isLocalTestModeEnabled()) {
      const localFromPreapprovalId =
        preapprovalId ? mpSubscriptionService.parseLocalTestPreapprovalId(preapprovalId) : null;
      const localFromExternalReference =
        !localFromPreapprovalId && externalReference
          ? mpSubscriptionService.parsePlanFromExternalReference(externalReference)
          : null;

      if (localFromPreapprovalId && localFromPreapprovalId.userId === userId && externalReference) {
        preapproval = mpSubscriptionService.buildLocalTestPreapproval({
          preapprovalId: preapprovalId!,
          externalReference,
          userId: localFromPreapprovalId.userId,
          planId: localFromPreapprovalId.planId,
        });
      } else if (localFromExternalReference && localFromExternalReference.userId === userId) {
        preapproval = mpSubscriptionService.buildLocalTestPreapproval({
          preapprovalId: `local_mp_sub_u_${userId}_p_${localFromExternalReference.planId}_ts_${Date.now()}`,
          externalReference: externalReference!,
          userId,
          planId: localFromExternalReference.planId,
        });
      }
    }

    if (!preapproval && preapprovalId && String(preapprovalId).trim().length >= 4) {
      const cleanId = String(preapprovalId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
      try {
        preapproval = await mpSubscriptionService.getPreapproval(cleanId);
      } catch {
        // ID invalido - tenta pelo externalReference abaixo.
      }
    }

    if (!preapproval && externalReference) {
      const cleanRef = String(externalReference).replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 200);
      preapproval = await mpSubscriptionService.findPreapprovalByReference(cleanRef);
    }

    if (!preapproval) {
      return res.status(404).json({ message: "Assinatura nÃ£o encontrada. Aguarde alguns instantes e tente novamente." });
    }

    const validation = await mpSubscriptionService.validatePreapprovalForSubscription(preapproval, {
      expectedUserId: userId,
      requireActive: true,
    });

    if (externalReference && externalReference !== validation.externalReference) {
      return res.status(400).json({
        message: "Referencia externa nao corresponde a assinatura confirmada.",
        code: "mp_subscription_external_reference_mismatch",
      });
    }

    const session = await storage.findSubscriptionPaymentSessionByExternalReference(
      validation.externalReference,
      userId,
    );

    if (!session) {
      return res.status(403).json({
        message: "Assinatura nao possui sessao de checkout valida criada por este backend.",
        code: "mp_subscription_session_not_found",
      });
    }

    assertSubscriptionSessionIntegrity(session, validation);

    await storage.upsertUserSubscription({
      userId,
      stripeSubscriptionId: validation.preapprovalId,
      stripeCustomerId:     String(preapproval.payer_id ?? userId),
      stripePriceId:        validation.planId,
      status:               validation.status,
      currentPeriodEnd:     preapproval.next_payment_date ? new Date(preapproval.next_payment_date) : null,
      cancelAtPeriodEnd:    false,
    });

    await storage.markPaymentSessionStatus(session.stripeSessionId, "paid");

    return res.json({
      ok:     true,
      planId: validation.planId,
      status: validation.status,
    });
  } catch (err: any) {
    if (err instanceof MercadoPagoSubscriptionValidationError) {
      console.warn("[subscriptions/confirm:validation]", err.message);
      return res.status(err.status).json({ message: err.message, code: err.code });
    }
    if (err instanceof MercadoPagoSubscriptionConfigError) {
      console.warn("[subscriptions/confirm:config]", err.message);
      return res.status(503).json({ message: err.message, code: err.code });
    }
    if (err instanceof MercadoPagoSubscriptionApiError) {
      const normalizedProviderError = buildMercadoPagoSubscriptionProviderError(err);
      console.warn("[subscriptions/confirm:provider]", {
        status: err.status,
        path: err.path,
        providerMessage: err.providerMessage,
        providerCode: err.providerCode ?? null,
        providerRequestId: err.providerRequestId ?? null,
        providerData: redactMercadoPagoLogValue(err.providerData ?? null),
      });
      return res.status(normalizedProviderError.status).json(normalizedProviderError.body);
    }
    if (isDatabaseConnectionError(err)) {
      console.warn("[subscriptions/confirm:db]", err?.message ?? err);
      return res.status(503).json({
        message: "Banco de dados temporariamente indisponivel. Tente novamente em instantes.",
        code: "database_temporarily_unavailable",
      });
    }
    console.error("[subscriptions/confirm]", err?.message);
    return res.status(500).json({ message: err?.message ?? "Erro ao confirmar assinatura." });
  }
});

/**
 * POST /api/payments/subscriptions/cancel
 * Cancela a assinatura ativa do usuÃ¡rio.
 */
router.post("/subscriptions/cancel", authenticate, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "NÃ£o autenticado." });

  try {
    const sub = await storage.getActiveSubscriptionByUser(userId);
    if (!sub) return res.status(404).json({ message: "Nenhuma assinatura ativa encontrada." });

    if (!mpSubscriptionService.isLocalTestPreapprovalId(sub.stripeSubscriptionId)) {
      await mpSubscriptionService.cancelSubscription(sub.stripeSubscriptionId); // coluna reutilizada p/ preapprovalId
    }

    await storage.upsertUserSubscription({
      userId,
      stripeSubscriptionId: sub.stripeSubscriptionId,
      stripeCustomerId:     sub.stripeCustomerId,
      stripePriceId:        sub.stripePriceId,
      status:               "cancelled",
      currentPeriodEnd:     sub.currentPeriodEnd ?? null,
      cancelAtPeriodEnd:    true,
    });

    return res.json({ ok: true });
  } catch (err: any) {
    if (isDatabaseConnectionError(err)) {
      console.warn("[subscriptions/cancel:db]", err?.message ?? err);
      return res.status(503).json({
        message: "Banco de dados temporariamente indisponivel. Tente novamente em instantes.",
        code: "database_temporarily_unavailable",
      });
    }
    console.error("[subscriptions/cancel]", err?.message);
    return res.status(500).json({ message: err?.message ?? "Erro ao cancelar assinatura." });
  }
});

/**
 * GET /api/payments/me
 * Retorna o plano atual do usuÃ¡rio.
 */
router.get("/me", authenticate, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "NÃ£o autenticado." });

  try {
    const [payments, subscription] = await Promise.all([
      storage.getRecentPaymentsByUser(userId),
      storage.getActiveSubscriptionByUser(userId),
    ]);

    // stripePriceId agora guarda "pro" | "premium" | priceId antigo
    const planId: MpPlanId | "free" = subscription && mpSubscriptionService.isActiveStatus(subscription.status)
      ? (subscription.stripePriceId === "premium" ? "premium" : "pro")
      : "free";

    return res.json({
      payments,
      subscription,
      plan: {
        planId,
        status:       subscription?.status ?? null,
        isSubscribed: planId !== "free",
      },
    });
  } catch (err: any) {
    if (isMissingDatabaseObjectError(err)) {
      console.warn("[payments/me:schema]", err?.message ?? err);
      return res.json(freePlanPayload());
    }

    if (isDatabaseConnectionError(err)) {
      console.warn("[payments/me:db]", err?.message ?? err);
      return res.status(503).json({
        message: "Banco de dados temporariamente indisponivel. Tente novamente em instantes.",
        code: "database_temporarily_unavailable",
      });
    }
    console.error("[payments/me]", err?.message);
    return res.status(500).json({ message: err?.message ?? "Erro ao carregar pagamentos." });
  }
});

// â”€â”€â”€ WEBHOOK DO MERCADO PAGO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.post("/webhook", webhookRateLimiter, paymentsWebhookDistributedLimiter, async (req, res) => {
  const startedAt = performance.now();
  const contentType = String(req.header("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return res.status(415).json({ message: "Webhook deve usar Content-Type application/json." });
  }

  let payloadJson: Record<string, unknown> = {};
  try {
    if (Buffer.isBuffer(req.body)) {
      const raw = req.body.toString("utf8").trim();
      payloadJson = raw ? JSON.parse(raw) : {};
    } else if (req.body && typeof req.body === "object") {
      payloadJson = req.body as Record<string, unknown>;
    }
  } catch {
    return res.status(400).json({ message: "Payload JSON invalido." });
  }

  const xRequestId = String(req.header("x-request-id") ?? "").trim();
  const dataId =
    typeof req.query["data.id"] === "string"
      ? req.query["data.id"]
      : typeof req.query.id === "string"
        ? req.query.id
        : typeof (payloadJson.data as Record<string, unknown> | undefined)?.id === "string"
          ? String((payloadJson.data as Record<string, unknown>).id)
          : undefined;
  const topic = String(req.query.topic ?? req.query.type ?? payloadJson.type ?? "").trim().toLowerCase();
  const action = String(payloadJson.action ?? "").trim().toLowerCase() || null;

  const verification = verifyMercadoPagoWebhookSignatureDetailed({
    xSignature: req.header("x-signature"),
    xRequestId,
    dataId,
  });

  if (!verification.valid) {
    incrementPaymentMetric("mercadopago.webhook.signature_invalid");
    return res.status(401).json({
      message: verification.reason === "stale" ? "Webhook expirado." : "Webhook invalido.",
      code: verification.reason,
    });
  }

  try {
    if (topic === "preapproval" && verification.dataId) {
      const preapproval = await mpSubscriptionService.getPreapproval(verification.dataId);
      const validation = await mpSubscriptionService.validatePreapprovalForSubscription(preapproval, {
        requireActive: false,
      });
      const session = await storage.findSubscriptionPaymentSessionByExternalReference(
        validation.externalReference,
        validation.userId,
      );

      if (session) {
        assertSubscriptionSessionIntegrity(session, validation);
        await storage.upsertUserSubscription({
          userId: validation.userId,
          stripeSubscriptionId: validation.preapprovalId,
          stripeCustomerId: String(preapproval.payer_id ?? validation.userId),
          stripePriceId: validation.planId,
          status: validation.status,
          currentPeriodEnd: preapproval.next_payment_date
            ? new Date(preapproval.next_payment_date)
            : null,
          cancelAtPeriodEnd: preapproval.status === "cancelled",
        });

        await storage.markPaymentSessionStatus(
          session.stripeSessionId,
          mpSubscriptionService.isActiveStatus(validation.status)
            ? "paid"
            : validation.status === "cancelled"
              ? "failed"
              : "pending",
        );
      } else {
        console.warn("[payments/webhook:preapproval-session-missing]", {
          preapprovalId: validation.preapprovalId,
          externalReference: validation.externalReference,
          userId: validation.userId,
        });
      }

      observePaymentLatency("mercadopago.webhook_ack_ms", performance.now() - startedAt);
      return res.status(200).json({ received: true, topic: "preapproval" });
    }

    if (!verification.dataId || !(topic === "payment" || topic === "merchant_order")) {
      observePaymentLatency("mercadopago.webhook_ack_ms", performance.now() - startedAt);
      return res.status(200).json({ received: true, ignored: true });
    }

    const persisted = await persistMercadoPagoWebhookEvent({
      topic,
      action,
      dataId: verification.dataId,
      requestId: xRequestId || null,
      ts: verification.ts ?? String(Date.now()),
      signatureValid: true,
      payloadJson,
      headersJson: {
        xRequestId,
        xSignature: req.header("x-signature") ?? null,
        requestId: (req as any).requestId ?? null,
      },
    });

    if (persisted.created && persisted.event) {
      scheduleMercadoPagoWebhookEventProcessing(persisted.event.id);
    }

    observePaymentLatency("mercadopago.webhook_ack_ms", performance.now() - startedAt);
    logPaymentEvent({
      event: "mercadopago.webhook.ack",
      outcome: persisted.created ? "queued" : "duplicate",
      requestId: xRequestId || String((req as any).requestId ?? ""),
      eventKey: persisted.event?.eventKey ?? null,
      latencyMs: performance.now() - startedAt,
      ip: req.ip,
      metadata: {
        topic,
        action,
        dataId: verification.dataId,
      },
    });

    return res.status(persisted.created ? 201 : 200).json({
      received: true,
      queued: persisted.created,
      eventKey: persisted.event?.eventKey ?? null,
      requestId: xRequestId || null,
    });
  } catch (err: any) {
    if (err instanceof MercadoPagoSubscriptionValidationError) {
      console.warn("[payments/webhook:preapproval-validation]", {
        message: err.message,
        code: err.code,
      });
      return res.status(200).json({ received: true, ignored: true, code: err.code });
    }

    logPaymentEvent({
      level: "error",
      event: "mercadopago.webhook.ack_failed",
      outcome: "failed",
      requestId: xRequestId || String((req as any).requestId ?? ""),
      ip: req.ip,
      metadata: {
        message: err?.message ?? String(err),
      },
    });
    return res.status(500).json({ message: "Falha ao receber webhook." });
  }
});

export default router;
