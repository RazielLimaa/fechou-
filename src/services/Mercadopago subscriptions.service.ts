import crypto from "crypto";
import { buildTrustedFrontendUrl, ensureTrustedFrontendRedirectUrl } from "../lib/httpSecurity.js";

export type MpPlanId = "pro" | "premium";

export interface MpPreapprovalPlan {
  id: string;
  status: string;
  reason: string;
  auto_recurring: {
    frequency: number;
    frequency_type: "months" | "days";
    transaction_amount: number;
    currency_id: string;
    start_date?: string;
    end_date?: string;
  };
}

interface MpCollectorAccount {
  id: number;
  email?: string;
  nickname?: string;
  status?: {
    site_status?: string;
    confirmed_email?: boolean;
    mercadopago_account_type?: string;
    billing?: {
      allow?: boolean;
      codes?: string[];
    };
    sell?: {
      allow?: boolean;
      codes?: string[];
    };
  };
  identification?: {
    number?: string;
    type?: string;
  };
  address?: {
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip_code?: string | null;
  };
}

export interface MpPreapproval {
  id: string;
  status: "pending" | "authorized" | "paused" | "cancelled";
  reason: string;
  payer_id: number;
  collector_id?: number;
  external_reference: string;
  init_point: string;
  preapproval_plan_id: string;
  auto_recurring: {
    frequency: number;
    frequency_type: string;
    transaction_amount: number;
    currency_id: string;
    start_date: string;
    end_date: string;
  };
  next_payment_date?: string;
  last_modified: string;
}

export interface CreateSubscriptionResult {
  preapprovalId: string;
  redirectUrl: string;
  providerInitPoint?: string;
  planId: MpPlanId;
  externalReference: string;
  collectorId?: number;
  amount: number;
  currency: "BRL";
  providerPlanId: string;
  simulated?: boolean;
}

export interface ValidatedSubscriptionPreapproval {
  preapprovalId: string;
  userId: number;
  planId: MpPlanId;
  externalReference: string;
  providerPlanId: string;
  amount: number;
  currency: "BRL";
  status: string;
  collectorId?: number;
}

interface CreatePreapprovalResponse extends Omit<MpPreapproval, "init_point"> {
  init_point?: string;
}

function buildSubscriptionRedirectUrl(
  backUrl: string,
  preapprovalId: string,
  externalReference: string,
): string {
  const url = new URL(backUrl);
  url.searchParams.set("preapproval_id", preapprovalId);
  url.searchParams.set("external_reference", externalReference);
  return url.toString();
}

function isLocalSubscriptionTestModeEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    String(process.env.MP_SUBSCRIPTIONS_LOCAL_TEST_MODE ?? "").trim().toLowerCase() === "true"
  );
}

function resolveLocalTestBackUrl(preferredOrigin?: string | null): string {
  const normalizedPath = "/pagamento/confirmacao";
  const rawOrigin = String(preferredOrigin ?? "").trim();

  if (rawOrigin) {
    try {
      const originUrl = new URL(rawOrigin);
      const isAllowedProtocol =
        originUrl.protocol === "https:" ||
        (process.env.NODE_ENV !== "production" &&
          originUrl.protocol === "http:" &&
          (originUrl.hostname === "localhost" || originUrl.hostname === "127.0.0.1" || originUrl.hostname === "::1"));

      if (isAllowedProtocol) {
        return `${originUrl.origin}${normalizedPath}`;
      }
    } catch {
      // fallback abaixo
    }
  }

  return buildTrustedFrontendUrl(normalizedPath, preferredOrigin);
}

function buildLocalTestPreapprovalId(userId: number, planId: MpPlanId): string {
  return `local_mp_sub_u_${userId}_p_${planId}_ts_${Date.now()}`;
}

function parseLocalTestPreapprovalId(preapprovalId: string): { userId: number; planId: MpPlanId } | null {
  const match = String(preapprovalId ?? "")
    .trim()
    .match(/^local_mp_sub_u_(\d+)_p_(pro|premium)_ts_(\d+)$/);

  if (!match) return null;

  return {
    userId: Number(match[1]),
    planId: match[2] as MpPlanId,
  };
}

const DEFAULT_BASE_URL = "https://api.mercadopago.com";
const COLLECTOR_ACCOUNT_CACHE_TTL_MS = 10 * 60 * 1000;
const SUBSCRIPTION_EXTERNAL_REFERENCE_VERSION = "v2";
const SUBSCRIPTION_REFERENCE_SIGNATURE_HEX_LENGTH = 32;

const SUBSCRIPTION_PLAN_SECURITY: Record<MpPlanId, {
  amount: number;
  currency: "BRL";
  frequency: number;
  frequencyType: "months";
}> = {
  pro: {
    amount: 29,
    currency: "BRL",
    frequency: 1,
    frequencyType: "months",
  },
  premium: {
    amount: 59,
    currency: "BRL",
    frequency: 1,
    frequencyType: "months",
  },
};

let collectorAccountCache:
  | {
      cacheKey: string;
      value: MpCollectorAccount;
      expiresAt: number;
    }
  | null = null;

export class MercadoPagoSubscriptionConfigError extends Error {
  readonly code: string;

  constructor(message: string, code = "mp_subscription_config_error") {
    super(message);
    this.name = "MercadoPagoSubscriptionConfigError";
    this.code = code;
  }
}

export class MercadoPagoSubscriptionApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly providerMessage: string;
  readonly providerCode?: string;
  readonly providerRequestId?: string;
  readonly providerData?: unknown;

  constructor(params: {
    status: number;
    path: string;
    message: string;
    providerMessage: string;
    providerCode?: string;
    providerRequestId?: string;
    providerData?: unknown;
  }) {
    super(params.message);
    this.name = "MercadoPagoSubscriptionApiError";
    this.status = params.status;
    this.path = params.path;
    this.providerMessage = params.providerMessage;
    this.providerCode = params.providerCode;
    this.providerRequestId = params.providerRequestId;
    this.providerData = params.providerData;
  }
}

export class MercadoPagoSubscriptionValidationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = "mp_subscription_validation_error", status = 400) {
    super(message);
    this.name = "MercadoPagoSubscriptionValidationError";
    this.code = code;
    this.status = status;
  }
}

function getSubscriptionApiBaseUrl(): string {
  const baseUrl = String(
    process.env.MP_SUBSCRIPTIONS_API_BASE_URL ??
    process.env.MP_API_BASE_URL ??
    DEFAULT_BASE_URL
  ).trim();

  return baseUrl || DEFAULT_BASE_URL;
}

function isTestAccessToken(token: string): boolean {
  return token.trim().toUpperCase().startsWith("TEST-");
}

function isProductionAccessToken(token: string): boolean {
  return token.trim().toUpperCase().startsWith("APP_USR-");
}

function isTestPublicKey(key: string): boolean {
  return key.trim().toUpperCase().startsWith("TEST-");
}

function isProductionPublicKey(key: string): boolean {
  return key.trim().toUpperCase().startsWith("APP_USR-");
}

function hasConfiguredValue(value: string | undefined | null): boolean {
  return String(value ?? "").trim().length > 0;
}

function normalizeEmail(value: string | undefined | null): string {
  return String(value ?? "").trim().toLowerCase();
}

function hashSha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function timingSafeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function amountToCents(value: unknown): number {
  return Math.round(Number(value) * 100);
}

function getSubscriptionReferenceSecret(): string {
  const secret = String(
    process.env.MP_SUBSCRIPTIONS_REFERENCE_SECRET ??
    process.env.JWT_SECRET ??
    "",
  ).trim();

  if (secret) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new MercadoPagoSubscriptionConfigError(
      "MP_SUBSCRIPTIONS_REFERENCE_SECRET ou JWT_SECRET precisa estar configurado para assinar referencias de assinatura.",
      "mp_subscription_reference_secret_missing",
    );
  }

  return getAccessToken();
}

function getSubscriptionReferenceSignature(payload: string): string {
  return crypto
    .createHmac("sha256", getSubscriptionReferenceSecret())
    .update(payload)
    .digest("hex")
    .slice(0, SUBSCRIPTION_REFERENCE_SIGNATURE_HEX_LENGTH);
}

function buildSubscriptionExternalReference(input: {
  userId: number;
  planId: MpPlanId;
  idempotencyKey: string;
}): string {
  const nonce = hashSha256(`${input.idempotencyKey}:${input.userId}:${input.planId}`).slice(0, 32);
  const payload = `subscription:${SUBSCRIPTION_EXTERNAL_REFERENCE_VERSION}:user:${input.userId}:plan:${input.planId}:nonce:${nonce}`;
  const signature = getSubscriptionReferenceSignature(payload);
  return `${payload}:sig:${signature}`;
}

function parseSignedSubscriptionExternalReference(ref: string): { userId: number; planId: MpPlanId; nonce: string } | null {
  const normalized = String(ref ?? "").trim();
  const match = normalized.match(
    /^subscription:v2:user:(\d+):plan:(pro|premium):nonce:([a-f0-9]{32}):sig:([a-f0-9]{32})$/i,
  );

  if (!match) return null;

  const payload = `subscription:${SUBSCRIPTION_EXTERNAL_REFERENCE_VERSION}:user:${match[1]}:plan:${match[2]}:nonce:${match[3].toLowerCase()}`;
  const expected = getSubscriptionReferenceSignature(payload);
  const provided = match[4].toLowerCase();

  if (!timingSafeEqualString(expected, provided)) return null;

  return {
    userId: Number(match[1]),
    planId: match[2] as MpPlanId,
    nonce: match[3].toLowerCase(),
  };
}

function parseLegacySubscriptionExternalReference(ref: string): { userId: number; planId: MpPlanId } | null {
  const match = String(ref ?? "").trim().match(/^subscription:user:(\d+):plan:(pro|premium):ts:\d+$/);
  if (!match) return null;
  return { userId: Number(match[1]), planId: match[2] as MpPlanId };
}

function getCredentialModeFromAccessToken(token: string): "production" | "test" {
  return isProductionAccessToken(token) ? "production" : "test";
}

function isLoopbackSubscriptionBackUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  } catch {
    return false;
  }
}

function getAccessToken(): string {
  const token = String(
    process.env.MP_ACCESS_TOKEN ??
    process.env.MP_SUBSCRIPTIONS_ACCESS_TOKEN ??
    ""
  ).trim();

  if (!token) {
    throw new MercadoPagoSubscriptionConfigError(
      "Credencial de assinatura do Mercado Pago nao configurada.",
      "mp_subscription_missing_token"
    );
  }

  return token;
}

export function getSubscriptionPublicKey(): string {
  const publicKey = String(
    process.env.MP_SUBSCRIPTIONS_PUBLIC_KEY ??
    process.env.MP_PUBLIC_KEY ??
    "",
  ).trim();

  if (!publicKey) {
    throw new MercadoPagoSubscriptionConfigError(
      "Public Key de assinatura nao configurada. Defina MP_SUBSCRIPTIONS_PUBLIC_KEY com a mesma aplicacao do MP_ACCESS_TOKEN.",
      "mp_subscription_missing_public_key",
    );
  }

  const accessToken = getAccessToken();
  const mode = getCredentialModeFromAccessToken(accessToken);
  const publicKeyMatchesMode =
    (mode === "production" && isProductionPublicKey(publicKey)) ||
    (mode === "test" && isTestPublicKey(publicKey));

  if (!publicKeyMatchesMode) {
    throw new MercadoPagoSubscriptionConfigError(
      `A Public Key de assinatura precisa usar o mesmo ambiente do MP_ACCESS_TOKEN (${mode === "production" ? "APP_USR-" : "TEST-"}). Atualize MP_SUBSCRIPTIONS_PUBLIC_KEY com a mesma aplicacao.`,
      "mp_subscription_public_key_mode_mismatch",
    );
  }

  return publicKey;
}

export function getSubscriptionCredentialMode(): "production" | "test" {
  const accessToken = getAccessToken();
  return getCredentialModeFromAccessToken(accessToken);
}

export function getSubscriptionPublicKeyMode(): "production" | "test" {
  const publicKey = getSubscriptionPublicKey();
  return isProductionPublicKey(publicKey) ? "production" : "test";
}

export function hasAssociatedSubscriptionPlansConfigured(): boolean {
  return (
    hasConfiguredValue(process.env.MP_SUBSCRIPTIONS_PLAN_PRO_ID ?? process.env.MP_PLAN_PRO_ID) ||
    hasConfiguredValue(process.env.MP_SUBSCRIPTIONS_PLAN_PREMIUM_ID ?? process.env.MP_PLAN_PREMIUM_ID)
  );
}

export function getSubscriptionPlanSecurityProfile(planId: MpPlanId) {
  return SUBSCRIPTION_PLAN_SECURITY[planId];
}

function resolvePlanEnv(planId: MpPlanId): string | undefined {
  const scopedKey =
    planId === "pro"
      ? process.env.MP_SUBSCRIPTIONS_PLAN_PRO_ID
      : process.env.MP_SUBSCRIPTIONS_PLAN_PREMIUM_ID;
  const legacyKey =
    planId === "pro"
      ? process.env.MP_PLAN_PRO_ID
      : process.env.MP_PLAN_PREMIUM_ID;

  const scoped = String(scopedKey ?? "").trim();
  const legacy = String(legacyKey ?? "").trim();

  if (scoped && legacy && scoped !== legacy) {
    throw new MercadoPagoSubscriptionConfigError(
      `Conflito na configuracao do plano "${planId}": MP_SUBSCRIPTIONS_PLAN_${planId.toUpperCase()}_ID e MP_PLAN_${planId.toUpperCase()}_ID possuem valores diferentes. Mantenha apenas um valor ou alinhe ambos para o mesmo Plan ID.`,
      "mp_subscription_conflicting_plan_ids",
    );
  }

  return scoped || legacy || undefined;
}

function getPlanId(planId: MpPlanId): string {
  const id = resolvePlanEnv(planId);
  if (!id || id.trim().length === 0) {
    throw new MercadoPagoSubscriptionConfigError(
      `Plano "${planId}" nao configurado. Adicione MP_SUBSCRIPTIONS_PLAN_${planId.toUpperCase()}_ID no .env e rode scripts/create-mp-plans.cjs para criar o plano no Mercado Pago.`,
      "mp_subscription_missing_plan"
    );
  }

  return id.trim();
}

export function getSubscriptionProviderPlanId(planId: MpPlanId): string {
  return getPlanId(planId);
}

function shouldBypassCollectorReadinessCheck(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    String(process.env.MP_SUBSCRIPTIONS_SKIP_COLLECTOR_READINESS_CHECK ?? "").trim().toLowerCase() === "true"
  );
}

function extractProviderMessages(data: any): string[] {
  const messages = new Set<string>();

  const push = (value: unknown) => {
    const normalized = String(value ?? "").trim();
    if (normalized) messages.add(normalized);
  };

  push(data?.message);
  push(data?.error);
  push(data?.details);

  if (Array.isArray(data?.cause)) {
    for (const cause of data.cause) {
      push(cause?.code);
      push(cause?.description);
      push(cause?.message);
      push(cause?.detail);
    }
  }

  if (Array.isArray(data?.errors)) {
    for (const error of data.errors) {
      push(error?.code);
      push(error?.message);
      push(error?.description);
    }
  }

  if (data?.raw) {
    push(data.raw);
  }

  return [...messages];
}

function extractProviderCode(data: any): string | undefined {
  const candidates: unknown[] = [];

  if (Array.isArray(data?.cause)) {
    for (const cause of data.cause) {
      candidates.push(cause?.code, cause?.status, cause?.error);
    }
  }

  if (Array.isArray(data?.errors)) {
    for (const error of data.errors) {
      candidates.push(error?.code, error?.status, error?.error);
    }
  }

  candidates.push(data?.code, data?.error, data?.status, data?.status_code);

  for (const candidate of candidates) {
    const normalized = String(candidate ?? "").trim();
    if (normalized) return normalized.slice(0, 120);
  }

  return undefined;
}

interface MpRequestOptions extends RequestInit {
  idempotencyKey?: string;
  requestId?: string;
}

async function mpFetch<T>(path: string, options: MpRequestOptions = {}): Promise<T> {
  const { idempotencyKey, requestId, ...requestInit } = options;
  const res = await fetch(`${getSubscriptionApiBaseUrl()}${path}`, {
    ...requestInit,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAccessToken()}`,
      ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
      ...(requestId ? { "X-Request-Id": requestId } : {}),
      ...(requestInit.headers ?? {}),
    },
  });

  const text = await res.text();
  let data: any = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    const providerMessage = (
      extractProviderMessages(data).join(" | ") ||
      `MP API erro ${res.status}`
    ).slice(0, 400);
    const providerCode = extractProviderCode(data);

    throw new MercadoPagoSubscriptionApiError({
      status: res.status,
      path,
      message: `Falha na API de assinaturas do Mercado Pago (${res.status}) em ${path}.`,
      providerMessage,
      providerCode,
      providerRequestId: res.headers.get("x-request-id") ?? undefined,
      providerData: data,
    });
  }

  return data as T;
}

async function getCollectorAccount(): Promise<MpCollectorAccount> {
  const now = Date.now();
  const cacheKey = hashSha256(`${getSubscriptionApiBaseUrl()}|${getAccessToken()}|${String(globalThis.fetch)}`);

  if (
    collectorAccountCache &&
    collectorAccountCache.cacheKey === cacheKey &&
    collectorAccountCache.expiresAt > now
  ) {
    return collectorAccountCache.value;
  }

  const account = await mpFetch<MpCollectorAccount>("/users/me");
  collectorAccountCache = {
    cacheKey,
    value: account,
    expiresAt: now + COLLECTOR_ACCOUNT_CACHE_TTL_MS,
  };

  return account;
}

export class MercadoPagoSubscriptionService {
  private async getCollectorAccountOrThrow(): Promise<MpCollectorAccount> {
    return getCollectorAccount();
  }

  private assertCollectorAccountReadyForSubscriptions(collector: MpCollectorAccount): void {
    const siteStatus = String(collector.status?.site_status ?? "").trim().toLowerCase();
    const billingAllowed = collector.status?.billing?.allow;
    const billingCodes = collector.status?.billing?.codes ?? [];

    if (siteStatus && siteStatus !== "active") {
      throw new MercadoPagoSubscriptionConfigError(
        "A conta que recebe pelo Mercado Pago nao esta ativa para operacoes de assinatura. Revise o status da conta no painel do Mercado Pago antes de tentar novamente.",
        "mp_subscription_collector_account_inactive",
      );
    }

    if (billingAllowed === false && billingCodes.includes("address_pending")) {
      throw new MercadoPagoSubscriptionConfigError(
        "A conta vendedora do Mercado Pago ainda esta com endereco pendente. Complete endereco e dados cadastrais no painel do Mercado Pago antes de criar assinaturas.",
        "mp_subscription_collector_address_pending",
      );
    }

    if (billingAllowed === false) {
      throw new MercadoPagoSubscriptionConfigError(
        "A conta vendedora do Mercado Pago ainda nao esta liberada para cobrancas recorrentes. Revise as pendencias cadastrais e de faturamento no painel do Mercado Pago.",
        "mp_subscription_collector_billing_blocked",
      );
    }
  }

  private async assertPayerEmailIsDifferentFromCollector(payerEmail: string): Promise<void> {
    try {
      const collector = await this.getCollectorAccountOrThrow();
      const normalizedPayerEmail = normalizeEmail(payerEmail);
      const normalizedCollectorEmail = normalizeEmail(collector.email);

      if (
        normalizedPayerEmail &&
        normalizedCollectorEmail &&
        normalizedPayerEmail === normalizedCollectorEmail
      ) {
        throw new MercadoPagoSubscriptionValidationError(
          "O email do comprador nao pode ser o mesmo da conta que recebe pelo Mercado Pago. Entre com outro usuario pagador no app para concluir a assinatura.",
          "mp_subscription_same_payer_as_collector",
        );
      }
    } catch (error) {
      if (error instanceof MercadoPagoSubscriptionValidationError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      console.warn("[mp-subscriptions:collector-check]", message);
    }
  }

  private assertRecurringMatchesExpected(
    recurring: MpPreapproval["auto_recurring"] | MpPreapprovalPlan["auto_recurring"] | undefined,
    planId: MpPlanId,
  ): void {
    const expected = getSubscriptionPlanSecurityProfile(planId);
    const amountMatches = amountToCents(recurring?.transaction_amount) === amountToCents(expected.amount);
    const currencyMatches = String(recurring?.currency_id ?? "").trim().toUpperCase() === expected.currency;
    const frequencyMatches =
      Number(recurring?.frequency) === expected.frequency &&
      String(recurring?.frequency_type ?? "").trim().toLowerCase() === expected.frequencyType;

    if (!amountMatches || !currencyMatches || !frequencyMatches) {
      throw new MercadoPagoSubscriptionValidationError(
        "A assinatura retornada pelo Mercado Pago nao corresponde ao plano contratado.",
        "mp_subscription_commercial_terms_mismatch",
        409,
      );
    }
  }

  private async assertCollectorMatches(preapproval: MpPreapproval): Promise<number | undefined> {
    if (this.isLocalTestPreapprovalId(preapproval.id)) {
      return undefined;
    }

    const collector = await this.getCollectorAccountOrThrow();
    const providerCollectorId = Number(
      (preapproval as any)?.collector_id ??
      (preapproval as any)?.collector?.id ??
      (preapproval as any)?.collector?.collector_id ??
      0,
    );

    if (!Number.isFinite(providerCollectorId) || providerCollectorId <= 0) {
      if (
        process.env.NODE_ENV === "production" &&
        String(process.env.MP_SUBSCRIPTIONS_ALLOW_MISSING_COLLECTOR_ID ?? "").trim().toLowerCase() !== "true"
      ) {
        throw new MercadoPagoSubscriptionValidationError(
          "O Mercado Pago nao retornou o collector_id da assinatura para validacao.",
          "mp_subscription_collector_not_verifiable",
          502,
        );
      }

      return undefined;
    }

    if (providerCollectorId !== Number(collector.id)) {
      throw new MercadoPagoSubscriptionValidationError(
        "A assinatura pertence a uma conta recebedora diferente da configurada.",
        "mp_subscription_collector_mismatch",
        403,
      );
    }

    return providerCollectorId;
  }

  isLocalTestModeEnabled(): boolean {
    return isLocalSubscriptionTestModeEnabled();
  }

  buildExternalReferenceForSubscription(input: {
    userId: number;
    planId: MpPlanId;
    idempotencyKey: string;
  }): string {
    return buildSubscriptionExternalReference(input);
  }

  isLocalTestPreapprovalId(preapprovalId: string): boolean {
    return Boolean(parseLocalTestPreapprovalId(preapprovalId));
  }

  parseLocalTestPreapprovalId(preapprovalId: string): { userId: number; planId: MpPlanId } | null {
    return parseLocalTestPreapprovalId(preapprovalId);
  }

  buildLocalTestPreapproval(input: {
    preapprovalId: string;
    externalReference: string;
    userId: number;
    planId: MpPlanId;
  }): MpPreapproval {
    const now = new Date();
    const nextPaymentDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    return {
      id: input.preapprovalId,
      status: "authorized",
      reason: `Assinatura Fechou ${this.planLabel(input.planId)} (simulada)`,
      payer_id: input.userId,
      external_reference: input.externalReference,
      init_point: buildSubscriptionRedirectUrl(
        String(process.env.MP_SUBSCRIPTIONS_BACK_URL ?? "https://fechou.cloud/pagamento/confirmacao").trim(),
        input.preapprovalId,
        input.externalReference,
      ),
      preapproval_plan_id: `local-plan-${input.planId}`,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: input.planId === "premium" ? 59 : 29,
        currency_id: "BRL",
        start_date: now.toISOString(),
        end_date: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      },
      next_payment_date: nextPaymentDate.toISOString(),
      last_modified: now.toISOString(),
    };
  }

  async createSubscription(params: {
    userId: number;
    userEmail: string;
    userName: string;
    planId: MpPlanId;
    cardTokenId: string;
    idempotencyKey: string;
    backUrl?: string;
    preferredOrigin?: string;
  }): Promise<CreateSubscriptionResult> {
    const localTestMode = this.isLocalTestModeEnabled();
    const configuredBackUrl = String(process.env.MP_SUBSCRIPTIONS_BACK_URL ?? "").trim();
    const backUrl = localTestMode
      ? resolveLocalTestBackUrl(params.preferredOrigin)
      : (
          params.backUrl ??
          (configuredBackUrl ? ensureTrustedFrontendRedirectUrl(configuredBackUrl) : undefined) ??
          buildTrustedFrontendUrl("/pagamento/confirmacao", params.preferredOrigin)
        );

    if (!localTestMode && isLoopbackSubscriptionBackUrl(backUrl)) {
      throw new MercadoPagoSubscriptionConfigError(
        "O checkout de assinatura do Mercado Pago nao aceita back_url em localhost/127.0.0.1. Configure MP_SUBSCRIPTIONS_BACK_URL com uma URL publica HTTPS para continuar o teste.",
        "mp_subscription_invalid_back_url"
      );
    }

    const externalReference = buildSubscriptionExternalReference({
      userId: params.userId,
      planId: params.planId,
      idempotencyKey: params.idempotencyKey,
    });
    const expectedPlan = getSubscriptionPlanSecurityProfile(params.planId);

    if (localTestMode) {
      const preapprovalId = buildLocalTestPreapprovalId(params.userId, params.planId);
      return {
        preapprovalId,
        redirectUrl: buildSubscriptionRedirectUrl(backUrl, preapprovalId, externalReference),
        planId: params.planId,
        externalReference,
        amount: expectedPlan.amount,
        currency: expectedPlan.currency,
        providerPlanId: `local-plan-${params.planId}`,
        simulated: true,
      };
    }

    const preapprovalPlanId = getPlanId(params.planId);
    const accessToken = getAccessToken();
    const payerEmail = String(params.userEmail ?? "").trim();

    if (!payerEmail) {
      throw new MercadoPagoSubscriptionConfigError(
        "O usuario autenticado precisa ter um email valido para criar a assinatura do Mercado Pago.",
        "mp_subscription_missing_payer_email"
      );
    }

    await this.assertPayerEmailIsDifferentFromCollector(payerEmail);
    const collector = await this.getCollectorAccountOrThrow();

    if (shouldBypassCollectorReadinessCheck()) {
      console.warn("[mp-subscriptions:collector-readiness-bypass]", {
        collectorId: collector.id,
        collectorEmail: collector.email ?? null,
        billing: collector.status?.billing ?? null,
      });
    } else {
      this.assertCollectorAccountReadyForSubscriptions(collector);
    }

    const plan = await mpFetch<MpPreapprovalPlan>(`/preapproval_plan/${preapprovalPlanId}`);
    if (String(plan.id ?? "").trim() && String(plan.id).trim() !== preapprovalPlanId) {
      throw new MercadoPagoSubscriptionValidationError(
        "O plano retornado pelo Mercado Pago nao corresponde ao plano configurado.",
        "mp_subscription_plan_id_mismatch",
        409,
      );
    }
    this.assertRecurringMatchesExpected(plan.auto_recurring, params.planId);

    const preapproval = await mpFetch<CreatePreapprovalResponse>("/preapproval", {
      method: "POST",
      idempotencyKey: params.idempotencyKey,
      requestId: externalReference,
      body: JSON.stringify({
        preapproval_plan_id: preapprovalPlanId,
        reason: `Assinatura Fechou ${this.planLabel(params.planId)}`,
        external_reference: externalReference,
        payer_email: payerEmail,
        card_token_id: params.cardTokenId,
        auto_recurring: {
          frequency: expectedPlan.frequency,
          frequency_type: expectedPlan.frequencyType,
          transaction_amount: expectedPlan.amount,
          currency_id: expectedPlan.currency,
          start_date: plan.auto_recurring.start_date ?? new Date().toISOString(),
          ...(plan.auto_recurring.end_date ? { end_date: plan.auto_recurring.end_date } : {}),
        },
        back_url: backUrl,
        status: "authorized",
      }),
    });

    if (!preapproval?.id) {
      throw new Error(
        `Mercado Pago nao retornou a assinatura criada para o plano "${params.planId}".`
      );
    }

    return {
      preapprovalId: preapproval.id,
      redirectUrl: buildSubscriptionRedirectUrl(backUrl, preapproval.id, externalReference),
      providerInitPoint: preapproval.init_point,
      planId: params.planId,
      externalReference,
      collectorId: collector.id,
      amount: expectedPlan.amount,
      currency: expectedPlan.currency,
      providerPlanId: preapprovalPlanId,
    };
  }

  async validatePreapprovalForSubscription(
    preapproval: MpPreapproval,
    options: {
      expectedUserId?: number;
      requireActive?: boolean;
    } = {},
  ): Promise<ValidatedSubscriptionPreapproval> {
    const info = this.parsePlanFromExternalReference(preapproval.external_reference ?? "");

    if (!info) {
      throw new MercadoPagoSubscriptionValidationError(
        "Referencia externa da assinatura invalida ou sem assinatura criptografica.",
        "mp_subscription_invalid_external_reference",
        403,
      );
    }

    if (options.expectedUserId !== undefined && info.userId !== options.expectedUserId) {
      throw new MercadoPagoSubscriptionValidationError(
        "Assinatura nao pertence a este usuario.",
        "mp_subscription_owner_mismatch",
        403,
      );
    }

    if (options.requireActive && !this.isActiveStatus(preapproval.status)) {
      throw new MercadoPagoSubscriptionValidationError(
        "Assinatura ainda nao esta autorizada pelo Mercado Pago.",
        "mp_subscription_not_authorized",
        409,
      );
    }

    const expectedProviderPlanId = this.isLocalTestPreapprovalId(preapproval.id)
      ? `local-plan-${info.planId}`
      : getSubscriptionProviderPlanId(info.planId);

    if (String(preapproval.preapproval_plan_id ?? "").trim() !== expectedProviderPlanId) {
      throw new MercadoPagoSubscriptionValidationError(
        "Assinatura retornada pelo Mercado Pago usa um plano diferente do esperado.",
        "mp_subscription_plan_id_mismatch",
        409,
      );
    }

    this.assertRecurringMatchesExpected(preapproval.auto_recurring, info.planId);
    const collectorId = await this.assertCollectorMatches(preapproval);
    const expected = getSubscriptionPlanSecurityProfile(info.planId);

    return {
      preapprovalId: preapproval.id,
      userId: info.userId,
      planId: info.planId,
      externalReference: preapproval.external_reference,
      providerPlanId: expectedProviderPlanId,
      amount: expected.amount,
      currency: expected.currency,
      status: preapproval.status,
      collectorId,
    };
  }

  async getPreapproval(preapprovalId: string): Promise<MpPreapproval> {
    return mpFetch<MpPreapproval>(`/preapproval/${preapprovalId}`);
  }

  async findPreapprovalByReference(externalReference: string): Promise<MpPreapproval | null> {
    const res = await mpFetch<{ results: MpPreapproval[] }>(
      `/preapproval/search?external_reference=${encodeURIComponent(externalReference)}&limit=1`
    );
    return res?.results?.[0] ?? null;
  }

  async cancelSubscription(preapprovalId: string): Promise<void> {
    await mpFetch(`/preapproval/${preapprovalId}`, {
      method: "PUT",
      body: JSON.stringify({ status: "cancelled" }),
    });
  }

  async pauseSubscription(preapprovalId: string): Promise<void> {
    await mpFetch(`/preapproval/${preapprovalId}`, {
      method: "PUT",
      body: JSON.stringify({ status: "paused" }),
    });
  }

  async reactivateSubscription(preapprovalId: string): Promise<void> {
    await mpFetch(`/preapproval/${preapprovalId}`, {
      method: "PUT",
      body: JSON.stringify({ status: "authorized" }),
    });
  }

  validateWebhookSignature(params: {
    xSignature: string | undefined;
    xRequestId: string | undefined;
    dataId: string | undefined;
  }): boolean {
    const secret = process.env.MP_WEBHOOK_SECRET;
    if (!secret) return false;

    const { xSignature, xRequestId, dataId } = params;
    if (!xSignature) return false;

    const parts: Record<string, string> = {};
    xSignature.split(",").forEach((part) => {
      const [k, v] = part.trim().split("=");
      if (k && v) parts[k] = v;
    });

    const { ts, v1 } = parts;
    if (!ts || !v1) return false;

    const manifest = [
      dataId ? `id:${dataId};` : "",
      xRequestId ? `request-id:${xRequestId};` : "",
      `ts:${ts};`,
    ].join("");

    const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
    const expectedBuf = Buffer.from(expected, "hex");
    const providedBuf = Buffer.from(v1, "hex");
    if (expectedBuf.length !== providedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, providedBuf);
  }

  parsePlanFromExternalReference(ref: string): { userId: number; planId: MpPlanId } | null {
    const signed = parseSignedSubscriptionExternalReference(ref);
    if (signed) {
      return {
        userId: signed.userId,
        planId: signed.planId,
      };
    }

    if (process.env.NODE_ENV !== "production") {
      return parseLegacySubscriptionExternalReference(ref);
    }

    return null;
  }

  isActiveStatus(status: string): boolean {
    return status === "authorized" || status === "active";
  }

  planLabel(planId: MpPlanId): string {
    return planId === "premium" ? "Premium" : "Pro";
  }
}

export const mpSubscriptionService = new MercadoPagoSubscriptionService();
