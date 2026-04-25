import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { and, eq, sql } from "drizzle-orm";
import { authenticateOrMvp, type AuthenticatedRequest } from "../middleware/auth.js";
import { distributedRateLimit } from "../middleware/distributed-security.js";
import { storage, type ProposalStatus } from "../storage.js";
import { db } from "../db/index.js";
import { contracts } from "../db/schema.js";
import {
  createCheckoutPreferenceWithFreelancerToken,
  resolveMercadoPagoCheckoutUrl,
} from "../services/mercadoPago.js";
import {
  extractPngBufferFromDataUrl,
  encryptSignature,
  sha256Hex,
} from "../lib/signatureCrypto.js";
import { contractService } from "../services/contracts/contract.service.js";
import { contractRenderService } from "../services/contracts/contract-render.service.js";
import { requireStepUp } from "../middleware/step-up.js";
import { getPublicAppBaseUrl } from "../lib/httpSecurity.js";
import { cpfCnpjSchema, optionalCpfCnpjSchema } from "../lib/brDocument.js";
import {
  createOwnerProposalCheckoutProPayment,
  PaymentSecurityError,
} from "../services/payments/mercadoPagoSecure.js";

const router = Router();

/**
 * =============================
 * Segurança / Utilitários
 * =============================
 */

function hashSha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeAndValidatePublicToken(raw: unknown): string | null {
  const token = String(raw ?? "").trim();
  if (token.length !== 64) return null;
  if (!/^[a-f0-9]{64}$/i.test(token)) return null;
  return token.toLowerCase();
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isSafeSignerName(value: string) {
  return /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .,'-]{1,139}$/u.test(value);
}

function setPublicNoCache(res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
}

function setPublicPreviewDocumentHeaders(res: Response, etag: string) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("ETag", `"${etag}"`);
  res.setHeader("Vary", "Origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("X-Robots-Tag", "noindex, noarchive, nosnippet, noimageindex");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'",
  );
}

function normalizePreviewStateTag(value: unknown) {
  const tag = String(value ?? "").trim().replace(/^W\//i, "").replaceAll('"', "");
  return /^[a-f0-9]{64}$/i.test(tag) ? tag.toLowerCase() : null;
}

function safeUserAgent(req: Request) {
  const ua = String(req.headers["user-agent"] ?? "unknown");
  return ua.length > 300 ? ua.slice(0, 300) : ua;
}

function getBaseUrlFromRequest(_req: Request): string {
  return getPublicAppBaseUrl();
}

async function renderOfficialPublicContractPreviewByTokenHash(
  tokenHash: string,
  knownStateHash?: string | null
) {
  const contract = await contractService.getContractByShareTokenHash(tokenHash);
  if (!contract) return null;
  if (!contract.shareTokenExpiresAt || contract.shareTokenExpiresAt.getTime() < Date.now()) return null;

  const rendered = await contractRenderService.renderContract(
    contract.id,
    contract.userId,
    knownStateHash,
    { publicPreview: true }
  );

  if (!rendered) return null;

  return {
    contract,
    rendered,
  };
}

const publicProposalGetLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_PUBLIC_PROPOSAL_GET_WINDOW_MS ?? 10 * 60 * 1000),
  max: Number(process.env.RATE_LIMIT_PUBLIC_PROPOSAL_GET_MAX ?? 180),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Muitas requisições. Tente novamente em alguns instantes." },
});

const publicProposalSignLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_PUBLIC_PROPOSAL_SIGN_WINDOW_MS ?? 10 * 60 * 1000),
  max: Number(process.env.RATE_LIMIT_PUBLIC_PROPOSAL_SIGN_MAX ?? 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Muitas requisições. Tente novamente em alguns instantes." },
});

const proposalCancelLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_PROPOSAL_CANCEL_WINDOW_MS ?? 10 * 60 * 1000),
  max: Number(process.env.RATE_LIMIT_PROPOSAL_CANCEL_MAX ?? 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Muitas requisições. Tente novamente em alguns instantes." },
});

const distributedPublicGetLimiter = distributedRateLimit({
  scope: 'public-proposal-get',
  limit: Number(process.env.RATE_LIMIT_PUBLIC_PROPOSAL_GET_MAX ?? 180),
  windowMs: Number(process.env.RATE_LIMIT_PUBLIC_PROPOSAL_GET_WINDOW_MS ?? 10 * 60 * 1000),
});

const distributedPublicSignLimiter = distributedRateLimit({
  scope: 'public-proposal-sign',
  limit: Number(process.env.RATE_LIMIT_PUBLIC_PROPOSAL_SIGN_MAX ?? 30),
  windowMs: Number(process.env.RATE_LIMIT_PUBLIC_PROPOSAL_SIGN_WINDOW_MS ?? 10 * 60 * 1000),
});

const distributedCancelLimiter = distributedRateLimit({
  scope: 'proposal-cancel',
  limit: Number(process.env.RATE_LIMIT_PROPOSAL_CANCEL_MAX ?? 30),
  windowMs: Number(process.env.RATE_LIMIT_PROPOSAL_CANCEL_WINDOW_MS ?? 10 * 60 * 1000),
  key: (req) => `${req.ip}:${req.params.id ?? ''}`,
});

/**
 * =============================
 * Schemas
 * =============================
 */

const createProposalSchema = z.object({
  title: z.string().trim().min(2).max(180),
  clientName: z.string().trim().min(2).max(140),
  description: z.string().trim().min(5).max(5000),
  value: z.coerce.number().positive().max(9999999999.99),
});

const statusSchema = z.object({
  status: z.enum(["pendente", "vendida", "cancelada"]),
});

const proposalIdSchema = z.coerce.number().int().positive();

const querySchema = z.object({
  status: z.enum(["pendente", "vendida", "cancelada"]).optional(),
});

const shareLinkSchema = z.object({
  expiresInHours: z.coerce.number().int().min(1).max(24 * 30).default(72),
});

const signContractSchema = z.object({
  signerName: z
    .string()
    .trim()
    .transform(collapseWhitespace)
    .refine((value) => value.length >= 2 && value.length <= 140, "Nome do assinante inválido.")
    .refine(isSafeSignerName, "Nome do assinante inválido."),
  signerDocument: cpfCnpjSchema("Documento do assinante invalido."),
  signatureDataUrl: z.string().trim().min(30).max(2_500_000),
});

const markPaidSchema = z.object({
  note: z.string().trim().max(500).optional(),
  payerName: z.string().trim().max(140).optional(),
  payerDocument: optionalCpfCnpjSchema("Documento do pagador invalido."),
});

/**
 * =============================
 * Rotas públicas (SEM auth)
 * =============================
 */

router.get(
  "/public/:token/preview-document",
  publicProposalGetLimiter,
  distributedPublicGetLimiter,
  async (req: Request, res: Response) => {
    setPublicNoCache(res);

    const token = normalizeAndValidatePublicToken(req.params.token);
    if (!token) return res.status(400).json({ message: "Token inválido." });

    const tokenHash = hashSha256(token);
    const knownStateHash = normalizePreviewStateTag(req.header("if-none-match"));
    const result = await renderOfficialPublicContractPreviewByTokenHash(tokenHash, knownStateHash);

    if (!result) {
      return res.status(404).json({ message: "Preview público não encontrado ou expirado." });
    }

    const stateHash = (result.rendered as any).stateHash ?? null;
    if (!stateHash) {
      return res.status(500).json({ message: "Preview sem hash de estado." });
    }

    setPublicPreviewDocumentHeaders(res, stateHash);

    if ((result.rendered as any).notModified) {
      return res.status(304).end();
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(result.rendered.html ?? "");
  }
);

// ── GET /public/:token ────────────────────────────────────────────────────────

router.get(
  "/public/:token",
  publicProposalGetLimiter,
  distributedPublicGetLimiter,
  async (req: Request, res: Response) => {
    setPublicNoCache(res);

    const token = normalizeAndValidatePublicToken(req.params.token);
    if (!token) return res.status(400).json({ message: "Token inválido." });

    const tokenHash = hashSha256(token);

    // 1. Tenta proposals
    const proposal = await storage.getProposalByShareTokenHash(tokenHash);
    if (
      proposal &&
      proposal.shareTokenExpiresAt &&
      proposal.shareTokenExpiresAt.getTime() >= Date.now()
    ) {
      const freelancer = await storage.getUserByIdForPix(proposal.userId);
      return res.json({
        id: proposal.id,
        userId: proposal.userId,
        title: proposal.title,
        clientName: proposal.clientName,
        description: proposal.description,
        value: proposal.value,
        status: proposal.status,
        pixKey: freelancer?.pixKey ?? null,
        pixKeyType: freelancer?.pixKeyType ?? null,
        contract: {
          signed: Boolean(proposal.contractSignedAt),
          signedAt: proposal.contractSignedAt,
          signerName: proposal.contractSignerName,
          canPay: Boolean(proposal.paymentReleasedAt),
        },
      });
    }

    // 2. Tenta contracts
    const contract = await contractService.getContractByShareTokenHash(tokenHash);
    if (
      contract &&
      contract.shareTokenExpiresAt &&
      contract.shareTokenExpiresAt.getTime() >= Date.now()
    ) {
      const rendered = await contractRenderService.renderContract(contract.id, contract.userId, undefined, {
        publicPreview: true,
      });
      const freelancer = await storage.getUserByIdForPix(contract.userId);
      return res.json({
        id: contract.id,
        userId: contract.userId,
        title: contract.title,
        clientName: contract.clientName,
        description: contract.description,
        value: contract.value,
        status: contract.status,
        pixKey: freelancer?.pixKey ?? null,
        pixKeyType: freelancer?.pixKeyType ?? null,
        contract: contract.contract,
        previewHtml: rendered?.html ?? undefined,
        previewDocumentUrl: `/api/proposals/public/${token}/preview-document`,
        previewExpiresAt: (rendered as any)?.previewExpiresAt ?? null,
      });
    }

    return res.status(404).json({ message: "Link de contrato inválido ou expirado." });
  }
);

// ── POST /public/:token/sign ──────────────────────────────────────────────────

router.post(
  "/public/:token/sign",
  publicProposalSignLimiter,
  distributedPublicSignLimiter,
  async (req: Request, res: Response) => {
    setPublicNoCache(res);

    const token = normalizeAndValidatePublicToken(req.params.token);
    if (!token) return res.status(400).json({ message: "Token inválido." });

    const parsed = signContractSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Dados inválidos.", errors: parsed.error.flatten() });
    }

    const tokenHash = hashSha256(token);
    const { signerName, signerDocument, signatureDataUrl } = parsed.data;
    const signerIp = String(req.ip ?? "unknown");
    const ua = safeUserAgent(req);

    // ── 1. Tenta proposal ─────────────────────────────────────────────────────
    const proposal = await storage.getProposalByShareTokenHash(tokenHash);
    if (
      proposal &&
      proposal.shareTokenExpiresAt &&
      proposal.shareTokenExpiresAt.getTime() >= Date.now()
    ) {
      if (proposal.contractSignedAt) {
        return res.status(409).json({ message: "Contrato já foi assinado." });
      }

      let signatureBuffer: Buffer;
      try {
        signatureBuffer = extractPngBufferFromDataUrl(signatureDataUrl);
      } catch (error: any) {
        return res.status(400).json({ message: error?.message ?? "Assinatura inválida." });
      }

      let encrypted;
      try {
        encrypted = encryptSignature(signatureBuffer, { proposalId: proposal.id, signerName, signerDocument });
      } catch (error: any) {
        return res.status(500).json({ message: error?.message ?? "Falha ao proteger assinatura." });
      }

      const signatureHash = hashSha256(
        [proposal.id, signerName, signerDocument, signerIp, ua, sha256Hex(signatureBuffer)].join("|")
      );

      const signed = await storage.markProposalContractSignedByToken(tokenHash, {
        signerName,
        signerDocument,
        signatureHash,
        signedIp: signerIp,
        signedUserAgent: ua,
        signatureCiphertext: encrypted.ciphertext,
        signatureIv: encrypted.iv,
        signatureAuthTag: encrypted.authTag,
        signatureKeyVersion: encrypted.keyVersion,
        signatureMimeType: encrypted.mimeType,
      });

      if (!signed) {
        return res.status(409).json({ message: "Não foi possível concluir a assinatura." });
      }

      return res.status(201).json({
        ok: true,
        proposalId: signed.id,
        signedAt: signed.contractSignedAt ?? null,
      });
    }

    // ── 2. Tenta contract ─────────────────────────────────────────────────────
    const contract = await contractService.getContractByShareTokenHash(tokenHash);
    if (
      contract &&
      contract.shareTokenExpiresAt &&
      contract.shareTokenExpiresAt.getTime() >= Date.now()
    ) {
      if (contract.contract.signed) {
        return res.status(409).json({ message: "Contrato já foi assinado." });
      }

      let signatureBuffer: Buffer;
      try {
        signatureBuffer = extractPngBufferFromDataUrl(signatureDataUrl);
      } catch (error: any) {
        return res.status(400).json({ message: error?.message ?? "Assinatura inválida." });
      }

      let encrypted;
      try {
        encrypted = encryptSignature(signatureBuffer, {
          proposalId: contract.id,
          signerName,
          signerDocument,
        });
      } catch (error: any) {
        return res.status(500).json({ message: error?.message ?? "Falha ao proteger assinatura." });
      }

      const now = new Date();

      const [signedContract] = await db
        .update(contracts)
        .set({
          signedAt: now,
          signerName,
          signerDocument,
          paymentReleasedAt: now,
          lifecycleStatus: "ACCEPTED",
          status: "finalized",
          signatureCiphertext: encrypted.ciphertext.toString("base64"),
          signatureIv: encrypted.iv.toString("base64"),
          signatureAuthTag: encrypted.authTag.toString("base64"),
          updatedAt: now,
        } as any)
        .where(
          and(
            eq((contracts as any).shareTokenHash, tokenHash),
            sql`${(contracts as any).signedAt} is null`
          )
        )
        .returning({
          id: contracts.id,
          signedAt: contracts.signedAt,
        });

      if (!signedContract) {
        return res.status(409).json({ message: "Não foi possível concluir a assinatura." });
      }

      return res.status(201).json({
        ok: true,
        proposalId: signedContract.id,
        signedAt: signedContract.signedAt ?? now,
      });
    }

    return res.status(404).json({ message: "Link de contrato inválido ou expirado." });
  }
);

/**
 * =============================
 * Rotas autenticadas
 * =============================
 */

router.use(authenticateOrMvp);

router.post("/:id/share-link", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = proposalIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const parsedBody = shareLinkSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({ message: "Dados inválidos.", errors: parsedBody.error.flatten() });
  }

  const proposal = await storage.getProposalById(userId, parsedId.data);
  if (!proposal) return res.status(404).json({ message: "Proposta não encontrada." });

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashSha256(rawToken);
  const expiresAt = new Date(Date.now() + parsedBody.data.expiresInHours * 60 * 60 * 1000);

  await storage.setProposalShareToken(userId, parsedId.data, tokenHash, expiresAt);
  setPublicNoCache(res);

  return res.status(201).json({
    shareToken: rawToken,
    expiresAt,
    publicUrlPath: `/c/${rawToken}`,
  });
});

router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createProposalSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados inválidos.", errors: parsed.error.flatten() });
  }

  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const proposal = await storage.createProposal({
    userId,
    title: parsed.data.title,
    clientName: parsed.data.clientName,
    description: parsed.data.description,
    value: parsed.data.value.toFixed(2),
  });

  return res.status(201).json(proposal);
});

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedQuery = querySchema.safeParse(req.query);
  if (!parsedQuery.success) return res.status(400).json({ message: "Filtro inválido." });

  const status = parsedQuery.data.status as ProposalStatus | undefined;
  const data = await storage.listProposals(userId, status);
  return res.json(data);
});

router.get("/:id", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = proposalIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const proposal = await storage.getProposalById(userId, parsedId.data);
  if (!proposal) return res.status(404).json({ message: "Proposta não encontrada." });

  return res.json(proposal);
});

router.patch(
  "/:id/cancel",
  proposalCancelLimiter,
  distributedCancelLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Não autenticado." });

    const parsedId = proposalIdSchema.safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

    const proposal = await storage.getProposalById(userId, parsedId.data);
    if (!proposal) return res.status(404).json({ message: "Proposta não encontrada." });

    if (proposal.lifecycleStatus === "PAID") {
      return res.status(409).json({ message: "Não é possível cancelar uma proposta já paga." });
    }

    if (proposal.status === "cancelada" || proposal.lifecycleStatus === "CANCELLED") {
      return res.status(409).json({ message: "Esta proposta já está cancelada." });
    }

    if (proposal.status !== "pendente") {
      return res.status(409).json({ message: "Só é possível cancelar propostas com status pendente." });
    }

    await storage.updateProposalStatus(userId, parsedId.data, "cancelada");
    await storage.updateProposalLifecycleStatus(userId, parsedId.data, "CANCELLED");

    return res.json({ ok: true, proposalId: parsedId.data });
  }
);

router.post("/:id/mark-paid", requireStepUp("payments.mark-paid", (req) => ({ proposalId: req.params.id, ...(req.body ?? {}) })), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = proposalIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const parsedBody = markPaidSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({ message: "Dados inválidos.", errors: parsedBody.error.flatten() });
  }

  const proposal = await storage.getProposalById(userId, parsedId.data);
  if (!proposal) return res.status(404).json({ message: "Proposta não encontrada." });

  if (!proposal.contractSignedAt) {
    return res.status(409).json({ message: "O contrato precisa estar assinado antes de confirmar pagamento." });
  }

  if (proposal.lifecycleStatus === "PAID") {
    return res.status(200).json({ ok: true, message: "Pagamento já estava confirmado." });
  }

  if (proposal.lifecycleStatus === "CANCELLED") {
    return res.status(409).json({ message: "Proposta cancelada. Não é possível confirmar pagamento." });
  }

  const amountCents = Math.round(Number(proposal.value) * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return res.status(400).json({ message: "Valor da proposta inválido." });
  }

  const existingPayment = await storage.findPaymentByProposalId(proposal.id);
  if (existingPayment?.status === "CONFIRMED") {
    await storage.updateProposalLifecycleStatus(userId, proposal.id, "PAID");
    await storage.updateProposalStatus(userId, proposal.id, "vendida");
    return res.status(200).json({ ok: true, message: "Pagamento já confirmado anteriormente." });
  }

  const externalPaymentId = `manual_pix_${proposal.id}_${Date.now()}`;
  const paymentUrl = "manual_pix";

  await storage.upsertProposalPayment({
    proposalId: proposal.id,
    status: "CONFIRMED",
    externalPreferenceId: null,
    externalPaymentId,
    paymentUrl,
    amountCents,
  });

  await storage.updateProposalStatus(userId, proposal.id, "vendida");
  await storage.updateProposalLifecycleStatus(userId, proposal.id, "PAID");

  return res.status(201).json({
    ok: true,
    proposalId: proposal.id,
    amountCents,
    externalPaymentId,
  });
});

router.post("/:id/payment-link", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = proposalIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const proposal = await storage.getProposalById(userId, parsedId.data);
  if (!proposal) return res.status(404).json({ message: "Proposta não encontrada." });

  const amountCents = Math.round(Number(proposal.value) * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return res.status(400).json({ message: "Valor da proposta inválido." });
  }

  if (proposal.lifecycleStatus === "PAID" || proposal.lifecycleStatus === "CANCELLED") {
    return res.status(409).json({ message: "A proposta não permite novo pagamento." });
  }

  if (!["SENT", "ACCEPTED"].includes(proposal.lifecycleStatus)) {
    return res.status(409).json({ message: "A proposta precisa estar em SENT ou ACCEPTED para gerar pagamento." });
  }

  const existingPayment = await storage.findPaymentByProposalId(proposal.id);
  if (existingPayment?.status === "PENDING") {
    return res.json({ paymentUrl: existingPayment.paymentUrl });
  }

  const publicHash = proposal.publicHash ?? crypto.randomBytes(18).toString("hex");
  if (!proposal.publicHash) {
    await storage.ensureProposalPublicHash(userId, proposal.id, publicHash);
  }

  try {
    const result = await createOwnerProposalCheckoutProPayment({
      userId,
      proposalId: proposal.id,
      notificationUrl: `${getBaseUrlFromRequest(req)}/api/webhooks/mercadopago`,
      frontendPublicPath: `/p/${publicHash}`,
      requestId: String((req as any).requestId ?? req.header("x-request-id") ?? ""),
      ipAddress: req.ip,
      userAgent: safeUserAgent(req),
    });

    setPublicNoCache(res);
    return res.status(201).json({
      paymentUrl: result.checkoutUrl,
      checkoutIntentId: result.checkoutIntentId,
      preferenceId: result.preferenceId,
      idempotencyKey: result.idempotencyKey,
    });
  } catch (error) {
    if (error instanceof PaymentSecurityError) {
      return res.status(error.status).json({ message: error.message, code: error.code });
    }

    return res.status(500).json({ message: "Falha ao gerar link de pagamento." });
  }

  const freelancerAccessToken = "";
  const __unusedPublicHash = proposal.publicHash ?? crypto.randomBytes(18).toString("hex");
  if (!proposal.publicHash) {
    await storage.ensureProposalPublicHash(proposal.userId, proposal.id, __unusedPublicHash);
  }

  const baseUrl = getBaseUrlFromRequest(req);
  const notificationUrl = `${baseUrl}/api/webhooks/mercadopago`;

  const preference = await createCheckoutPreferenceWithFreelancerToken({
    freelancerAccessToken,
    proposalId: proposal.id,
    title: proposal.title,
    amountCents,
    currency: "BRL",
    notificationUrl,
    frontendPublicPath: `/p/${__unusedPublicHash}`,
  });

  const paymentUrl = resolveMercadoPagoCheckoutUrl(preference, freelancerAccessToken);
  if (!paymentUrl) {
    return res.status(502).json({ message: "Mercado Pago não retornou URL de pagamento." });
  }

  await storage.upsertProposalPayment({
    proposalId: proposal.id,
    status: "PENDING",
    externalPreferenceId: preference.id ?? null,
    externalPaymentId: null,
    paymentUrl: paymentUrl!,
    amountCents,
  });

  setPublicNoCache(res);
  return res.status(201).json({ paymentUrl });
});

router.patch("/:id/status", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = proposalIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados inválidos.", errors: parsed.error.flatten() });
  }

  const updated = await storage.updateProposalStatus(userId, parsedId.data, parsed.data.status);
  if (!updated) return res.status(404).json({ message: "Proposta não encontrada." });

  return res.json(updated);
});

export default router;
