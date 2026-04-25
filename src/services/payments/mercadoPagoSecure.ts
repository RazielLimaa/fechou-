import crypto from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  auditLogs,
  checkoutIntents,
  contracts,
  paymentSessions,
  paymentTransactions,
  payments,
  proposals,
  securityIdempotencyKeys,
  webhookEvents,
} from "../../db/schema.js";
import { contractService } from "../contracts/contract.service.js";
import { storage } from "../../storage.js";
import { getValidFreelancerAccessToken } from "../mercadoPago.js";
import { logPaymentEvent, incrementPaymentMetric, observePaymentLatency } from "./mercadoPagoObservability.js";
import {
  createMercadoPagoCheckoutPreference,
  fetchMercadoPagoMerchantOrderById,
  getMercadoPagoPlatformAccessToken,
  resolveMercadoPagoCheckoutUrl,
  tryFetchMercadoPagoPaymentWithCandidates,
  type MercadoPagoMerchantOrderResource,
  type MercadoPagoPaymentResource,
} from "./mercadoPagoProvider.js";
import {
  buildPublicPaymentExternalReference,
  buildSecureCheckoutIntentExternalReference,
  parseLegacyProposalExternalReference,
  parsePublicPaymentExternalReference,
  parseSecureCheckoutIntentExternalReference,
  type PublicPaymentKind,
} from "./mercadoPagoReferences.js";
import {
  generateSecureIdempotencyKey,
  hashIdempotencyRequestPayload,
} from "./mercadoPagoSecurity.js";

type CheckoutIntentRow = typeof checkoutIntents.$inferSelect;
type PaymentTransactionRow = typeof paymentTransactions.$inferSelect;
type WebhookEventRow = typeof webhookEvents.$inferSelect;
type VolatileWebhookEventRow = WebhookEventRow;

const ACTIVE_INTENT_STATUSES = [
  "requires_payment_method",
  "payment_pending",
  "processing",
] as const;
const volatileWebhookEvents = new Map<string, VolatileWebhookEventRow>();
const volatileWebhookEventsByKey = new Map<string, string>();

class PaymentSecurityError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type PaymentTarget = {
  kind: PublicPaymentKind;
  userId: number;
  resourceId: number;
  proposalId: number | null;
  contractId: number | null;
  amount: number;
  currency: "BRL";
  title: string;
  description: string;
  accessScope: "public_share" | "owner_authenticated";
  shareTokenHash: string | null;
};

function normalizeDescription(value: string) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 250) || "Pagamento Fechou";
}

function amountCents(value: number | string) {
  return Math.round(Number(value) * 100);
}

function isApprovedStatus(status: string | null | undefined) {
  return String(status ?? "").toLowerCase() === "approved";
}

function mapPaymentSessionStatus(status: string) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "approved") return "paid";
  if (normalized === "rejected" || normalized === "cancelled") return "failed";
  return "pending";
}

function buildWebhookEventKey(input: {
  topic: string;
  action?: string | null;
  dataId: string;
  ts: string;
}) {
  return `mercadopago:${input.topic}:${String(input.action ?? "").trim().toLowerCase() || "unknown"}:${input.dataId}:${input.ts}`;
}

function isMissingWebhookEventsTableError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("webhook_events") && (message.includes("does not exist") || message.includes("não existe"));
}

function isMissingAuditLogsTableError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("audit_logs") && (message.includes("does not exist") || message.includes("não existe"));
}

async function reserveIdempotencyKey(input: {
  idempotencyKey: string;
  scope: string;
  userId?: number | null;
  resourceType: string;
  resourceId: string;
  payload: unknown;
}) {
  const requestHash = hashIdempotencyRequestPayload(input.payload);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const lockExpiresAt = new Date(now.getTime() + 30 * 1000);

  const [existing] = await db
    .select()
    .from(securityIdempotencyKeys)
    .where(eq(securityIdempotencyKeys.idempotencyKey, input.idempotencyKey))
    .limit(1);

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new PaymentSecurityError(
        409,
        "idempotency_key_payload_mismatch",
        "A chave de idempotencia ja foi usada com outro payload.",
      );
    }

    if (existing.responseJson) {
      return {
        requestHash,
        replayResponse: existing.responseJson as Record<string, unknown>,
      };
    }

    if (existing.lockExpiresAt && existing.lockExpiresAt.getTime() > now.getTime()) {
      throw new PaymentSecurityError(
        409,
        "idempotency_key_in_progress",
        "Ja existe uma operacao de pagamento em andamento para esta chave de idempotencia.",
      );
    }

    await db
      .update(securityIdempotencyKeys)
      .set({
        lastSeenAt: now,
        lockExpiresAt,
        expiresAt,
      })
      .where(eq(securityIdempotencyKeys.idempotencyKey, input.idempotencyKey));

    return {
      requestHash,
      replayResponse: null,
    };
  }

  await db.insert(securityIdempotencyKeys).values({
    idempotencyKey: input.idempotencyKey,
    scope: input.scope,
    userId: input.userId ?? null,
    requestHash,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    responseJson: null,
    lockExpiresAt,
    expiresAt,
    lastSeenAt: now,
  });

  return {
    requestHash,
    replayResponse: null,
  };
}

async function finalizeIdempotencyKey(idempotencyKey: string, responseJson: Record<string, unknown>) {
  await db
    .update(securityIdempotencyKeys)
    .set({
      responseJson,
      lockExpiresAt: null,
      lastSeenAt: new Date(),
    })
    .where(eq(securityIdempotencyKeys.idempotencyKey, idempotencyKey));
}

async function createAuditLog(input: {
  actorId?: number | null;
  eventType: string;
  resourceType: string;
  resourceId: string | number;
  idempotencyKey?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    await db.insert(auditLogs).values({
      actorId: input.actorId ?? null,
      tenantId: null,
      eventType: input.eventType,
      resourceType: input.resourceType,
      resourceId: String(input.resourceId),
      idempotencyKey: input.idempotencyKey ?? null,
      requestId: input.requestId ?? null,
      correlationId: input.correlationId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadataJson: input.metadata ?? {},
    });
  } catch (error) {
    if (!isMissingAuditLogsTableError(error)) {
      throw error;
    }

    logPaymentEvent({
      level: "warn",
      event: "audit_log.degraded",
      outcome: "skipped",
      requestId: input.requestId ?? null,
      correlationId: input.correlationId ?? null,
      metadata: {
        eventType: input.eventType,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
      },
    });
  }
}

async function resolvePublicPaymentTarget(tokenHash: string): Promise<PaymentTarget> {
  const proposal = await storage.getProposalByShareTokenHash(tokenHash);
  if (proposal && proposal.shareTokenExpiresAt && proposal.shareTokenExpiresAt.getTime() >= Date.now()) {
    if (!proposal.contractSignedAt || !proposal.paymentReleasedAt) {
      throw new PaymentSecurityError(
        409,
        "payment_blocked_until_contract_signed",
        "Pagamento bloqueado ate assinatura do contrato.",
      );
    }

    if (proposal.status === "vendida" || proposal.lifecycleStatus === "PAID") {
      throw new PaymentSecurityError(409, "proposal_already_paid", "Proposta ja paga.");
    }

    if (proposal.status === "cancelada" || proposal.lifecycleStatus === "CANCELLED") {
      throw new PaymentSecurityError(
        409,
        "proposal_does_not_allow_payment",
        "A proposta nao permite novo pagamento.",
      );
    }

    const amount = Number(proposal.value);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new PaymentSecurityError(400, "invalid_amount", "Valor invalido para pagamento.");
    }

    return {
      kind: "proposal",
      userId: proposal.userId,
      resourceId: proposal.id,
      proposalId: proposal.id,
      contractId: null,
      amount,
      currency: "BRL",
      title: `Contrato #${proposal.id} - ${proposal.title}`,
      description: normalizeDescription(proposal.description),
      accessScope: "public_share",
      shareTokenHash: tokenHash,
    };
  }

  const contract = await contractService.getContractByShareTokenHash(tokenHash);
  if (!contract || !contract.shareTokenExpiresAt || contract.shareTokenExpiresAt.getTime() < Date.now()) {
    throw new PaymentSecurityError(404, "public_payment_link_not_found", "Link de contrato invalido ou expirado.");
  }

  if (!contract.contract.signed || !contract.contract.canPay) {
    throw new PaymentSecurityError(
      409,
      "payment_blocked_until_contract_signed",
      "Pagamento bloqueado ate assinatura do contrato.",
    );
  }

  if (contract.lifecycleStatus === "PAID" || contract.paymentConfirmedAt) {
    throw new PaymentSecurityError(409, "contract_already_paid", "Contrato ja pago.");
  }

  if (contract.lifecycleStatus === "CANCELLED" || contract.status === "cancelado") {
    throw new PaymentSecurityError(
      409,
      "contract_does_not_allow_payment",
      "Contrato nao permite novo pagamento.",
    );
  }

  const amount = Number(contract.contractValue ?? contract.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PaymentSecurityError(400, "invalid_amount", "Valor invalido para pagamento.");
  }

  return {
    kind: "contract",
    userId: contract.userId,
    resourceId: contract.id,
    proposalId: null,
    contractId: contract.id,
    amount,
    currency: "BRL",
    title: `Contrato #${contract.id} - ${String(contract.contractType ?? contract.title)}`,
    description: normalizeDescription(String(contract.serviceScope ?? contract.description ?? "")),
    accessScope: "public_share",
    shareTokenHash: tokenHash,
  };
}

async function resolveOwnerProposalPaymentTarget(userId: number, proposalId: number): Promise<PaymentTarget> {
  const proposal = await storage.getProposalById(userId, proposalId);
  if (!proposal) {
    throw new PaymentSecurityError(404, "proposal_not_found", "Proposta nao encontrada.");
  }

  const amount = Number(proposal.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PaymentSecurityError(400, "invalid_amount", "Valor da proposta invalido.");
  }

  if (proposal.lifecycleStatus === "PAID" || proposal.status === "vendida") {
    throw new PaymentSecurityError(409, "proposal_already_paid", "A proposta ja foi paga.");
  }

  if (proposal.lifecycleStatus === "CANCELLED" || proposal.status === "cancelada") {
    throw new PaymentSecurityError(
      409,
      "proposal_does_not_allow_payment",
      "A proposta nao permite novo pagamento.",
    );
  }

  if (!["SENT", "ACCEPTED"].includes(proposal.lifecycleStatus)) {
    throw new PaymentSecurityError(
      409,
      "proposal_invalid_lifecycle",
      "A proposta precisa estar em SENT ou ACCEPTED para gerar pagamento.",
    );
  }

  return {
    kind: "proposal",
    userId,
    resourceId: proposal.id,
    proposalId: proposal.id,
    contractId: null,
    amount,
    currency: "BRL",
    title: proposal.title,
    description: normalizeDescription(proposal.description),
    accessScope: "owner_authenticated",
    shareTokenHash: null,
  };
}

async function findReusableCheckoutIntent(target: PaymentTarget) {
  const [existing] = await db
    .select()
    .from(checkoutIntents)
    .where(
      and(
        eq(checkoutIntents.userId, target.userId),
        eq(checkoutIntents.resourceType, target.kind),
        eq(checkoutIntents.resourceId, target.resourceId),
        eq(checkoutIntents.flow, "checkout_pro"),
        eq(checkoutIntents.accessScope, target.accessScope),
        inArray(checkoutIntents.status, [...ACTIVE_INTENT_STATUSES]),
      ),
    )
    .orderBy(desc(checkoutIntents.updatedAt))
    .limit(1);

  if (!existing) return null;
  if (existing.expiresAt && existing.expiresAt.getTime() < Date.now()) {
    return null;
  }

  return existing;
}

async function ensureCheckoutIntent(target: PaymentTarget) {
  const existing = await findReusableCheckoutIntent(target);
  if (existing) return existing;

  const id = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);

  const [created] = await db
    .insert(checkoutIntents)
    .values({
      id,
      userId: target.userId,
      resourceType: target.kind,
      resourceId: target.resourceId,
      proposalId: target.proposalId,
      contractId: target.contractId,
      accessScope: target.accessScope,
      flow: "checkout_pro",
      provider: "mercadopago",
      status: "requires_payment_method",
      amount: target.amount.toFixed(2),
      currency: target.currency,
      description: target.description,
      externalReference: buildSecureCheckoutIntentExternalReference(id),
      shareTokenHash: target.shareTokenHash,
      correlationId: crypto.randomUUID(),
      providerReferenceId: null,
      lastProviderPaymentId: null,
      metadata: {
        title: target.title,
      },
      expiresAt,
      updatedAt: now,
    })
    .returning();

  return created;
}

async function getLatestTransactionByIntentId(checkoutIntentId: string) {
  const [row] = await db
    .select()
    .from(paymentTransactions)
    .where(eq(paymentTransactions.checkoutIntentId, checkoutIntentId))
    .orderBy(desc(paymentTransactions.createdAt))
    .limit(1);

  return row;
}

async function createCheckoutPreferenceForIntent(input: {
  intent: CheckoutIntentRow;
  payerEmail?: string;
  successUrl: string;
  failureUrl: string;
  pendingUrl: string;
  notificationUrl: string;
  accessToken: string;
  requestId?: string;
  idempotencyKey: string;
}) {
  const replay = await reserveIdempotencyKey({
    idempotencyKey: input.idempotencyKey,
    scope: "mercadopago:checkout_pro",
    userId: input.intent.userId,
    resourceType: input.intent.resourceType,
    resourceId: String(input.intent.resourceId),
    payload: {
      checkoutIntentId: input.intent.id,
      payerEmail: input.payerEmail ?? null,
      successUrl: input.successUrl,
      failureUrl: input.failureUrl,
      pendingUrl: input.pendingUrl,
      notificationUrl: input.notificationUrl,
    },
  });

  if (replay.replayResponse) {
    return replay.replayResponse as {
      checkoutIntentId: string;
      checkoutUrl: string;
      preferenceId: string;
      idempotencyKey: string;
    };
  }

  const startedAt = performance.now();
  const preference = await createMercadoPagoCheckoutPreference({
    accessToken: input.accessToken,
    externalReference: input.intent.externalReference,
    payerEmail: input.payerEmail,
    notificationUrl: input.notificationUrl,
    successUrl: input.successUrl,
    failureUrl: input.failureUrl,
    pendingUrl: input.pendingUrl,
    title: String((input.intent.metadata as Record<string, unknown>)?.title ?? input.intent.description),
    description: input.intent.description,
    amount: Number(input.intent.amount),
    currencyId: "BRL",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
  });
  observePaymentLatency("mercadopago.checkout_preference_ms", performance.now() - startedAt);

  const checkoutUrl = resolveMercadoPagoCheckoutUrl(preference, input.accessToken);
  if (!checkoutUrl) {
    throw new PaymentSecurityError(
      502,
      "provider_checkout_url_missing",
      "Mercado Pago nao retornou URL de pagamento.",
    );
  }

  const now = new Date();
  const [transaction] = await db
    .insert(paymentTransactions)
    .values({
      checkoutIntentId: input.intent.id,
      provider: "mercadopago",
      providerPaymentId: null,
      providerPreferenceId: preference.id,
      providerOrderId: null,
      idempotencyKey: input.idempotencyKey,
      status: "pending",
      statusDetail: null,
      amount: Number(input.intent.amount).toFixed(2),
      currency: input.intent.currency,
      externalReference: input.intent.externalReference,
      requestId: input.requestId ?? null,
      providerPayload: {
        preferenceId: preference.id,
        checkoutUrl,
      },
      updatedAt: now,
    })
    .returning();

  await db
    .update(checkoutIntents)
    .set({
      status: "payment_pending",
      providerReferenceId: preference.id,
      metadata: {
        ...(input.intent.metadata ?? {}),
        lastCheckoutUrl: checkoutUrl,
        lastPreferenceId: preference.id,
      },
      updatedAt: now,
    })
    .where(eq(checkoutIntents.id, input.intent.id));

  const response = {
    checkoutIntentId: input.intent.id,
    checkoutUrl,
    preferenceId: preference.id,
    idempotencyKey: input.idempotencyKey,
    paymentTransactionId: transaction.id,
  };

  await finalizeIdempotencyKey(input.idempotencyKey, response);
  incrementPaymentMetric("mercadopago.checkout.created");

  return response;
}

async function ensureCompatibilityPaymentSession(input: {
  target: PaymentTarget;
  preferenceId: string;
}) {
  const existingSession = await storage.findPaymentSessionByMercadoPagoPreferenceId(input.preferenceId);
  if (existingSession) return existingSession;

  return storage.createPaymentSession({
    userId: input.target.userId,
    proposalId: input.target.proposalId ?? undefined,
    mode: "payment",
    stripeSessionId: `mp_pref_${input.preferenceId}`,
    mercadoPagoPreferenceId: input.preferenceId,
    amount: input.target.amount.toFixed(2),
    currency: "brl",
    metadata:
      input.target.kind === "proposal"
        ? {
            kind: input.target.accessScope === "public_share"
              ? "proposal_payment_mercado_pago"
              : "proposal_payment_owner_mercado_pago",
            proposalId: String(input.target.resourceId),
          }
        : {
            kind: "contract_payment_mercado_pago",
            contractId: String(input.target.resourceId),
          },
  });
}

async function upsertLegacyProposalPayment(input: {
  proposalId: number;
  status: "PENDING" | "CONFIRMED" | "FAILED";
  externalPreferenceId: string | null;
  externalPaymentId: string | null;
  paymentUrl: string;
  amountCents: number;
}) {
  await db
    .insert(payments)
    .values({
      proposalId: input.proposalId,
      provider: "mercadopago",
      status: input.status,
      externalPreferenceId: input.externalPreferenceId,
      externalPaymentId: input.externalPaymentId,
      paymentUrl: input.paymentUrl,
      amountCents: input.amountCents,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: payments.proposalId,
      set: {
        status: input.status,
        externalPreferenceId: input.externalPreferenceId,
        externalPaymentId: input.externalPaymentId,
        paymentUrl: input.paymentUrl,
        amountCents: input.amountCents,
        updatedAt: new Date(),
      },
    });
}

export async function createPublicCheckoutProPayment(input: {
  tokenHash: string;
  payerEmail?: string;
  successUrl: string;
  failureUrl: string;
  pendingUrl: string;
  notificationUrl: string;
  requestId?: string;
  idempotencyKey?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const target = await resolvePublicPaymentTarget(input.tokenHash);
  const intent = await ensureCheckoutIntent(target);
  const idempotencyKey = input.idempotencyKey ?? generateSecureIdempotencyKey();
  const result = await createCheckoutPreferenceForIntent({
    intent,
    payerEmail: input.payerEmail,
    successUrl: input.successUrl,
    failureUrl: input.failureUrl,
    pendingUrl: input.pendingUrl,
    notificationUrl: input.notificationUrl,
    accessToken: getMercadoPagoPlatformAccessToken(),
    requestId: input.requestId,
    idempotencyKey,
  });

  await ensureCompatibilityPaymentSession({
    target,
    preferenceId: result.preferenceId,
  });

  if (target.proposalId) {
    await upsertLegacyProposalPayment({
      proposalId: target.proposalId,
      status: "PENDING",
      externalPreferenceId: result.preferenceId,
      externalPaymentId: null,
      paymentUrl: result.checkoutUrl,
      amountCents: amountCents(target.amount),
    });
  }

  await createAuditLog({
    actorId: null,
    eventType: "checkout_intent.created",
    resourceType: target.kind,
    resourceId: target.resourceId,
    idempotencyKey,
    requestId: input.requestId ?? null,
    correlationId: intent.correlationId,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    metadata: {
      checkoutIntentId: intent.id,
      flow: "checkout_pro",
      accessScope: target.accessScope,
      preferenceId: result.preferenceId,
    },
  });

  logPaymentEvent({
    event: "checkout_intent.created",
    outcome: "created",
    requestId: input.requestId ?? null,
    correlationId: intent.correlationId,
    checkoutIntentId: intent.id,
    idempotencyKey,
    userId: target.userId,
    ip: input.ipAddress ?? null,
    metadata: {
      resourceType: target.kind,
      resourceId: target.resourceId,
      accessScope: target.accessScope,
      preferenceId: result.preferenceId,
    },
  });

  return result;
}

export async function createOwnerProposalCheckoutProPayment(input: {
  userId: number;
  proposalId: number;
  notificationUrl: string;
  frontendPublicPath: string;
  requestId?: string;
  idempotencyKey?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const target = await resolveOwnerProposalPaymentTarget(input.userId, input.proposalId);
  const intent = await ensureCheckoutIntent(target);
  const idempotencyKey = input.idempotencyKey ?? generateSecureIdempotencyKey();
  const accessToken = await getValidFreelancerAccessToken(target.userId);

  const frontendOrigin = String(process.env.FRONTEND_URL ?? "").trim();
  const publicPath = input.frontendPublicPath.replace(/^\//, "");
  const redirectBase = `${frontendOrigin}/${publicPath}`;

  const result = await createCheckoutPreferenceForIntent({
    intent,
    successUrl: `${redirectBase}?status=success`,
    failureUrl: `${redirectBase}?status=failure`,
    pendingUrl: `${redirectBase}?status=pending`,
    notificationUrl: input.notificationUrl,
    accessToken,
    requestId: input.requestId,
    idempotencyKey,
  });

  await ensureCompatibilityPaymentSession({
    target,
    preferenceId: result.preferenceId,
  });

  await upsertLegacyProposalPayment({
    proposalId: input.proposalId,
    status: "PENDING",
    externalPreferenceId: result.preferenceId,
    externalPaymentId: null,
    paymentUrl: result.checkoutUrl,
    amountCents: amountCents(target.amount),
  });

  await createAuditLog({
    actorId: input.userId,
    eventType: "proposal_payment_link.created",
    resourceType: "proposal",
    resourceId: input.proposalId,
    idempotencyKey,
    requestId: input.requestId ?? null,
    correlationId: intent.correlationId,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    metadata: {
      checkoutIntentId: intent.id,
      preferenceId: result.preferenceId,
    },
  });

  return result;
}

export async function persistMercadoPagoWebhookEvent(input: {
  topic: string;
  action?: string | null;
  dataId: string;
  requestId?: string | null;
  ts: string;
  signatureValid: boolean;
  payloadJson: Record<string, unknown>;
  headersJson: Record<string, unknown>;
}) {
  const eventKey = buildWebhookEventKey({
    topic: input.topic,
    action: input.action,
    dataId: input.dataId,
    ts: input.ts,
  });

  try {
    const [created] = await db
      .insert(webhookEvents)
      .values({
        eventKey,
        provider: "mercadopago",
        topic: input.topic,
        action: String(input.action ?? "").trim() || null,
        dataId: input.dataId,
        requestId: input.requestId ?? null,
        ts: input.ts,
        signatureValid: input.signatureValid,
        payloadJson: input.payloadJson,
        headersJson: input.headersJson,
        status: "queued",
        processingAttempts: 0,
        updatedAt: new Date(),
      })
      .onConflictDoNothing({
        target: webhookEvents.eventKey,
      })
      .returning();

    if (created) {
      incrementPaymentMetric("mercadopago.webhook.queued");
      return {
        created: true,
        event: created,
      };
    }

    const [existing] = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.eventKey, eventKey))
      .limit(1);

    return {
      created: false,
      event: existing ?? null,
    };
  } catch (error) {
    if (!isMissingWebhookEventsTableError(error)) {
      throw error;
    }

    const existingId = volatileWebhookEventsByKey.get(eventKey);
    if (existingId) {
      return {
        created: false,
        event: volatileWebhookEvents.get(existingId) ?? null,
      };
    }

    const now = new Date();
    const event: VolatileWebhookEventRow = {
      id: crypto.randomUUID(),
      eventKey,
      provider: "mercadopago",
      topic: input.topic,
      action: String(input.action ?? "").trim() || null,
      dataId: input.dataId,
      requestId: input.requestId ?? null,
      ts: input.ts,
      signatureValid: input.signatureValid,
      payloadJson: input.payloadJson,
      headersJson: input.headersJson,
      status: "queued",
      processingAttempts: 0,
      processingStartedAt: null,
      processedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    volatileWebhookEvents.set(event.id, event);
    volatileWebhookEventsByKey.set(eventKey, event.id);
    incrementPaymentMetric("mercadopago.webhook.queued");

    return {
      created: true,
      event,
    };
  }
}

async function getWebhookEventById(eventId: string) {
  const volatile = volatileWebhookEvents.get(eventId);
  if (volatile) return volatile;

  const [event] = await db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.id, eventId))
    .limit(1);

  return event ?? null;
}

async function claimWebhookEvent(eventId: string) {
  const volatile = volatileWebhookEvents.get(eventId);
  if (volatile) {
    if (volatile.processedAt) return null;
    const claimed: VolatileWebhookEventRow = {
      ...volatile,
      status: "processing",
      processingAttempts: Number(volatile.processingAttempts ?? 0) + 1,
      processingStartedAt: new Date(),
      updatedAt: new Date(),
    };
    volatileWebhookEvents.set(eventId, claimed);
    return claimed;
  }

  const [claimed] = await db
    .update(webhookEvents)
    .set({
      status: "processing",
      processingStartedAt: new Date(),
      processingAttempts: sql`${webhookEvents.processingAttempts} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(webhookEvents.id, eventId),
        isNull(webhookEvents.processedAt),
        inArray(webhookEvents.status, ["queued", "failed", "received"]),
      ),
    )
    .returning();

  return claimed ?? null;
}

async function completeWebhookEvent(eventId: string) {
  const volatile = volatileWebhookEvents.get(eventId);
  if (volatile) {
    const completed: VolatileWebhookEventRow = {
      ...volatile,
      status: "processed",
      processedAt: new Date(),
      updatedAt: new Date(),
    };
    volatileWebhookEvents.set(eventId, completed);
    return;
  }

  await db
    .update(webhookEvents)
    .set({
      status: "processed",
      processedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(webhookEvents.id, eventId));
}

async function failWebhookEvent(eventId: string, message: string) {
  const volatile = volatileWebhookEvents.get(eventId);
  if (volatile) {
    volatileWebhookEvents.set(eventId, {
      ...volatile,
      status: "failed",
      updatedAt: new Date(),
    });
  } else {
  await db
    .update(webhookEvents)
    .set({
      status: "failed",
      updatedAt: new Date(),
    })
    .where(eq(webhookEvents.id, eventId));
  }

  await createAuditLog({
    actorId: null,
    eventType: "webhook.processing_failed",
    resourceType: "webhook_event",
    resourceId: eventId,
    metadata: {
      message,
    },
  });
}

async function getWebhookAccessTokenCandidates(event: WebhookEventRow) {
  const candidates = new Set<string>();

  try {
    candidates.add(getMercadoPagoPlatformAccessToken());
  } catch {
    // ignore
  }

  const payloadUserId = String((event.payloadJson as Record<string, unknown>)?.user_id ?? "").trim();
  if (payloadUserId) {
    const account = await storage.getMercadoPagoAccountByMpUserId(payloadUserId);
    if (account) {
      candidates.add(await getValidFreelancerAccessToken(account.userId));
    }
  }

  return Array.from(candidates).filter(Boolean);
}

async function fetchWebhookResource(event: WebhookEventRow) {
  const accessTokens = await getWebhookAccessTokenCandidates(event);
  if (event.topic === "merchant_order") {
    let lastError: Error | null = null;
    for (const accessToken of accessTokens) {
      try {
        const order = await fetchMercadoPagoMerchantOrderById({
          accessToken,
          merchantOrderId: event.dataId,
          requestId: event.requestId ?? undefined,
        });

        const approvedPayment = order.payments?.find((payment) => isApprovedStatus(payment.status)) ?? order.payments?.[0];
        if (approvedPayment?.id) {
          const payment = await tryFetchMercadoPagoPaymentWithCandidates({
            paymentId: String(approvedPayment.id),
            accessTokens,
            requestId: event.requestId ?? undefined,
          });

          return {
            payment,
            order,
          };
        }

        return {
          payment: null,
          order,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw lastError ?? new Error(`Nao foi possivel consultar a merchant_order ${event.dataId}.`);
  }

  return {
    payment: await tryFetchMercadoPagoPaymentWithCandidates({
      paymentId: event.dataId,
      accessTokens,
      requestId: event.requestId ?? undefined,
    }),
    order: null,
  };
}

function resolveProviderStatus(input: {
  payment: MercadoPagoPaymentResource | null;
  order: MercadoPagoMerchantOrderResource | null;
}) {
  if (input.payment) {
    return {
      status: input.payment.status,
      statusDetail: input.payment.status_detail ?? null,
      amount: Number(input.payment.transaction_amount ?? 0),
      currency: String(input.payment.currency_id ?? "BRL").toUpperCase(),
      externalReference: input.payment.external_reference ?? null,
      providerPaymentId: String(input.payment.id),
      providerOrderId: input.payment.order?.id ? String(input.payment.order.id) : null,
    };
  }

  const approvedPayment = input.order?.payments?.find((payment) => isApprovedStatus(payment.status));
  return {
    status: input.order?.status === "closed" ? "approved" : String(input.order?.status ?? "pending"),
    statusDetail: approvedPayment?.status_detail ?? null,
    amount: Number(approvedPayment?.transaction_amount ?? 0),
    currency: String(approvedPayment?.currency_id ?? "BRL").toUpperCase(),
    externalReference: input.order?.external_reference ?? null,
    providerPaymentId: approvedPayment?.id ? String(approvedPayment.id) : null,
    providerOrderId: input.order?.id ? String(input.order.id) : null,
  };
}

async function reconcileSecureIntent(input: {
  event: WebhookEventRow;
  intent: CheckoutIntentRow;
  latestTransaction: PaymentTransactionRow | null;
  providerStatus: ReturnType<typeof resolveProviderStatus>;
}) {
  const expectedAmountCents = amountCents(Number(input.intent.amount));
  const providerAmountCents = amountCents(input.providerStatus.amount);
  const amountMatches = providerAmountCents === expectedAmountCents;
  const currencyMatches = input.providerStatus.currency === String(input.intent.currency).toUpperCase();
  const approved = isApprovedStatus(input.providerStatus.status);
  const now = new Date();

  await db.transaction(async (tx) => {
    if (input.latestTransaction) {
      await tx
        .update(paymentTransactions)
        .set({
          providerPaymentId: input.providerStatus.providerPaymentId,
          providerOrderId: input.providerStatus.providerOrderId,
          status: approved && amountMatches && currencyMatches
            ? "approved"
            : input.providerStatus.status === "cancelled"
              ? "cancelled"
              : input.providerStatus.status === "rejected"
                ? "rejected"
                : "pending",
          statusDetail: input.providerStatus.statusDetail,
          providerPayload: {
            status: input.providerStatus.status,
            statusDetail: input.providerStatus.statusDetail,
            amount: input.providerStatus.amount,
            currency: input.providerStatus.currency,
            providerPaymentId: input.providerStatus.providerPaymentId,
            providerOrderId: input.providerStatus.providerOrderId,
          },
          updatedAt: now,
        })
        .where(eq(paymentTransactions.id, input.latestTransaction.id));
    }

    await tx
      .update(checkoutIntents)
      .set({
        status:
          approved && amountMatches && currencyMatches
            ? "paid"
            : input.providerStatus.status === "cancelled"
              ? "cancelled"
              : input.providerStatus.status === "rejected"
                ? "failed"
                : "payment_pending",
        lastProviderPaymentId: input.providerStatus.providerPaymentId,
        lastReconciledAt: now,
        paidAt: approved && amountMatches && currencyMatches ? now : null,
        updatedAt: now,
      })
      .where(eq(checkoutIntents.id, input.intent.id));

    if (approved && amountMatches && currencyMatches) {
      if (input.intent.resourceType === "proposal" && input.intent.proposalId) {
        await tx
          .update(proposals)
          .set({
            status: "vendida",
            acceptedAt: now,
            lifecycleStatus: "PAID",
            updatedAt: now,
          })
          .where(
            and(
              eq(proposals.id, input.intent.proposalId),
              eq(proposals.userId, input.intent.userId),
            ),
          );

        await tx
          .insert(payments)
          .values({
            proposalId: input.intent.proposalId,
            provider: "mercadopago",
            status: "CONFIRMED",
            externalPreferenceId: input.intent.providerReferenceId,
            externalPaymentId: input.providerStatus.providerPaymentId,
            paymentUrl: String((input.intent.metadata as Record<string, unknown>)?.lastCheckoutUrl ?? "mercadopago"),
            amountCents: expectedAmountCents,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: payments.proposalId,
            set: {
              status: "CONFIRMED",
              externalPreferenceId: input.intent.providerReferenceId,
              externalPaymentId: input.providerStatus.providerPaymentId,
              amountCents: expectedAmountCents,
              updatedAt: now,
            },
          });
      }

      if (input.intent.resourceType === "contract" && input.intent.contractId) {
        await tx
          .update(contracts)
          .set({
            lifecycleStatus: "PAID",
            status: "finalized",
            paymentConfirmedAt: now,
            paymentNote: "Pagamento reconciliado via Mercado Pago",
            updatedAt: now,
          } as any)
          .where(
            and(
              eq(contracts.id, input.intent.contractId),
              eq(contracts.userId, input.intent.userId),
            ),
          );
      }
    }

    await tx
      .update(paymentSessions)
      .set({
        mercadoPagoPaymentId: input.providerStatus.providerPaymentId,
        status: mapPaymentSessionStatus(input.providerStatus.status),
        updatedAt: now,
      })
      .where(eq(paymentSessions.mercadoPagoPreferenceId, input.intent.providerReferenceId ?? ""));
  });

  await createAuditLog({
    actorId: null,
    eventType: approved && amountMatches && currencyMatches
      ? "payment.reconciled.approved"
      : "payment.reconciled.non_terminal",
    resourceType: input.intent.resourceType,
    resourceId: input.intent.resourceId,
    idempotencyKey: input.latestTransaction?.idempotencyKey ?? null,
    requestId: input.event.requestId ?? null,
    correlationId: input.intent.correlationId,
    metadata: {
      checkoutIntentId: input.intent.id,
      providerPaymentId: input.providerStatus.providerPaymentId,
      providerOrderId: input.providerStatus.providerOrderId,
      providerStatus: input.providerStatus.status,
      amountMatches,
      currencyMatches,
    },
  });
}

async function reconcileLegacyPublicReference(input: {
  reference: ReturnType<typeof parsePublicPaymentExternalReference>;
  providerStatus: ReturnType<typeof resolveProviderStatus>;
}) {
  if (!input.reference) return false;

  if (input.reference.kind === "proposal") {
    const proposal = await storage.getProposalById(input.reference.ownerId, input.reference.resourceId);
    if (!proposal || !proposal.shareTokenHash?.startsWith(input.reference.tokenPrefix)) {
      return false;
    }

    if (isApprovedStatus(input.providerStatus.status)) {
      await storage.updateProposalStatus(input.reference.ownerId, input.reference.resourceId, "vendida");
      await storage.updateProposalLifecycleStatus(input.reference.ownerId, input.reference.resourceId, "PAID");
    }

    const relatedSession = await storage.findLatestPendingPaymentSessionForProposal(
      input.reference.resourceId,
      input.reference.ownerId,
    );
    if (relatedSession && input.providerStatus.providerPaymentId) {
      await storage.markMercadoPagoPayment(
        relatedSession.id,
        input.providerStatus.providerPaymentId,
        mapPaymentSessionStatus(input.providerStatus.status),
      );
    }

    if (proposal.id) {
      await upsertLegacyProposalPayment({
        proposalId: proposal.id,
        status: isApprovedStatus(input.providerStatus.status) ? "CONFIRMED" : "FAILED",
        externalPreferenceId: relatedSession?.mercadoPagoPreferenceId ?? null,
        externalPaymentId: input.providerStatus.providerPaymentId,
        paymentUrl: "mercadopago",
        amountCents: amountCents(Number(proposal.value)),
      });
    }

    return true;
  }

  const contract = await contractService.getContract(input.reference.resourceId, input.reference.ownerId);
  const contractShareTokenHash = String((contract as any)?.shareTokenHash ?? "");
  if (!contract || !contractShareTokenHash.startsWith(input.reference.tokenPrefix)) {
    return false;
  }

  if (isApprovedStatus(input.providerStatus.status)) {
    await contractService.markContractPaid(input.reference.resourceId, input.reference.ownerId, {
      note: "Pagamento reconciliado via Mercado Pago",
    });
  }

  const relatedSession = await storage.findLatestPendingContractPaymentSession(
    input.reference.resourceId,
    input.reference.ownerId,
  );
  if (relatedSession && input.providerStatus.providerPaymentId) {
    await storage.markMercadoPagoPayment(
      relatedSession.id,
      input.providerStatus.providerPaymentId,
      mapPaymentSessionStatus(input.providerStatus.status),
    );
  }

  return true;
}

async function reconcileLegacyProposalReference(input: {
  proposalId: number;
  providerStatus: ReturnType<typeof resolveProviderStatus>;
}) {
  const proposal = await storage.getProposalByIdUnscoped(input.proposalId);
  if (!proposal) return false;

  if (isApprovedStatus(input.providerStatus.status)) {
    await storage.updateProposalStatus(proposal.userId, proposal.id, "vendida");
    await storage.updateProposalLifecycleStatus(proposal.userId, proposal.id, "PAID");
  }

  await upsertLegacyProposalPayment({
    proposalId: proposal.id,
    status: isApprovedStatus(input.providerStatus.status) ? "CONFIRMED" : "FAILED",
    externalPreferenceId: null,
    externalPaymentId: input.providerStatus.providerPaymentId,
    paymentUrl: "mercadopago",
    amountCents: amountCents(Number(proposal.value)),
  });

  return true;
}

export async function processMercadoPagoWebhookEvent(eventId: string) {
  const event = (await claimWebhookEvent(eventId)) ?? (await getWebhookEventById(eventId));
  if (!event || event.processedAt) {
    return { processed: false, reason: "already_processed" as const };
  }

  try {
    const { payment, order } = await fetchWebhookResource(event);
    const providerStatus = resolveProviderStatus({ payment, order });
    const externalReference = providerStatus.externalReference ?? "";
    const secureIntentId = parseSecureCheckoutIntentExternalReference(externalReference);

    if (secureIntentId) {
      const [intent] = await db
        .select()
        .from(checkoutIntents)
        .where(eq(checkoutIntents.id, secureIntentId))
        .limit(1);

      if (intent) {
        const latestTransaction = await getLatestTransactionByIntentId(intent.id);
        await reconcileSecureIntent({
          event,
          intent,
          latestTransaction,
          providerStatus,
        });
        await completeWebhookEvent(event.id);
        incrementPaymentMetric("mercadopago.webhook.processed");
        return { processed: true, reason: "secure_intent" as const };
      }
    }

    const publicReference = parsePublicPaymentExternalReference(externalReference);
    if (await reconcileLegacyPublicReference({ reference: publicReference, providerStatus })) {
      await completeWebhookEvent(event.id);
      return { processed: true, reason: "legacy_public_reference" as const };
    }

    const legacyProposalId = parseLegacyProposalExternalReference(externalReference);
    if (legacyProposalId && await reconcileLegacyProposalReference({
      proposalId: legacyProposalId,
      providerStatus,
    })) {
      await completeWebhookEvent(event.id);
      return { processed: true, reason: "legacy_owner_reference" as const };
    }

    await completeWebhookEvent(event.id);
    return { processed: true, reason: "ignored" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failWebhookEvent(event.id, message);
    logPaymentEvent({
      level: "error",
      event: "mercadopago.webhook.processing_failed",
      outcome: "failed",
      requestId: event.requestId ?? null,
      eventKey: event.eventKey,
      metadata: {
        message,
      },
    });
    throw error;
  }
}

export { PaymentSecurityError };
