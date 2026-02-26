import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";
import { z } from "zod";
import { authenticateOrMvp, type AuthenticatedRequest } from "../middleware/auth.js";
import { storage, type ProposalStatus } from "../storage.js";
import {
  createCheckoutPreferenceWithFreelancerToken,
  getValidFreelancerAccessToken,
} from "../services/mercadoPago.js";

const router = Router();

/**
 * =============================
 * Segurança / Utilitários
 * =============================
 */

function hashSha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/**
 * Token público gerado por:
 * crypto.randomBytes(32).toString('hex') => 64 HEX
 */
function normalizeAndValidatePublicToken(raw: unknown): string | null {
  const token = String(raw ?? "").trim();
  if (token.length !== 64) return null;
  if (!/^[a-f0-9]{64}$/i.test(token)) return null;
  return token.toLowerCase();
}

function setPublicNoCache(res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
}

function safeUserAgent(req: Request) {
  const ua = String(req.headers["user-agent"] ?? "unknown");
  return ua.length > 300 ? ua.slice(0, 300) : ua;
}

/**
 * Base URL do app (webhooks/links)
 */
function getBaseUrlFromRequest(req: Request): string {
  const envBase = String(process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
  if (envBase) return envBase;

  const proto = (req.headers["x-forwarded-proto"] ? String(req.headers["x-forwarded-proto"]) : req.protocol)
    .split(",")[0]
    .trim();

  const host = (req.headers["x-forwarded-host"] ? String(req.headers["x-forwarded-host"]) : String(req.headers.host ?? ""))
    .split(",")[0]
    .trim();

  if (!host) return "http://localhost:3001";
  return `${proto}://${host}`;
}

/**
 * Rate limit simples em memória (MVP)
 */
type RateState = { count: number; resetAt: number };
const rateMap = new Map<string, RateState>();

function cleanupRateMap(now: number) {
  if (rateMap.size < 5000) return;
  for (const [k, v] of rateMap.entries()) {
    if (v.resetAt <= now) rateMap.delete(k);
  }
}

function rateLimit(keyPrefix: string, limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    cleanupRateMap(now);

    const ip = String(req.ip ?? "unknown");
    const key = `${keyPrefix}:${ip}`;

    const state = rateMap.get(key);
    if (!state || state.resetAt <= now) {
      rateMap.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (state.count >= limit) {
      const retryAfterSec = Math.max(1, Math.ceil((state.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      return res.status(429).json({ message: "Muitas requisições. Tente novamente em alguns instantes." });
    }

    state.count += 1;
    rateMap.set(key, state);
    return next();
  };
}

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
  signerName: z.string().trim().min(2).max(140),
  signerDocument: z.string().trim().min(5).max(40),
});

/**
 * Confirmação manual PIX (autenticada)
 * - não aceita valor do cliente (evita fraude)
 * - grava pelo valor da proposta
 */
const markPaidSchema = z.object({
  note: z.string().trim().max(500).optional(),
  payerName: z.string().trim().max(140).optional(),
  payerDocument: z.string().trim().max(40).optional(),
});

/**
 * =============================
 * Rotas públicas (SEM auth)
 * =============================
 */

router.get(
  "/public/:token",
  rateLimit("public-proposal-get", 60, 10 * 60 * 1000),
  async (req: Request, res: Response) => {
    setPublicNoCache(res);

    const token = normalizeAndValidatePublicToken(req.params.token);
    if (!token) return res.status(400).json({ message: "Token inválido." });

    const tokenHash = hashSha256(token);
    const proposal = await storage.getProposalByShareTokenHash(tokenHash);

    if (!proposal || !proposal.shareTokenExpiresAt || proposal.shareTokenExpiresAt.getTime() < Date.now()) {
      return res.status(404).json({ message: "Link de contrato inválido ou expirado." });
    }

    // ✅ PIX do dono (freelancer)
    const freelancer = await storage.getUserByIdForPix(proposal.userId);

    return res.json({
      id: proposal.id,
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
);

router.post(
  "/public/:token/sign",
  rateLimit("public-proposal-sign", 5, 10 * 60 * 1000),
  async (req: Request, res: Response) => {
    setPublicNoCache(res);

    const token = normalizeAndValidatePublicToken(req.params.token);
    if (!token) return res.status(400).json({ message: "Token inválido." });

    const parsed = signContractSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Dados inválidos.", errors: parsed.error.flatten() });
    }

    const tokenHash = hashSha256(token);
    const proposal = await storage.getProposalByShareTokenHash(tokenHash);

    if (!proposal || !proposal.shareTokenExpiresAt || proposal.shareTokenExpiresAt.getTime() < Date.now()) {
      return res.status(404).json({ message: "Link de contrato inválido ou expirado." });
    }

    if (proposal.contractSignedAt) {
      return res.status(409).json({ message: "Contrato já foi assinado." });
    }

    const ua = safeUserAgent(req);
    const signatureHash = hashSha256(
      `${proposal.id}|${parsed.data.signerName}|${parsed.data.signerDocument}|${req.ip}|${ua}`
    );

    const signed = await storage.markProposalContractSignedByToken(tokenHash, parsed.data.signerName, signatureHash);

    return res.status(201).json({
      ok: true,
      proposalId: signed?.id,
      signedAt: signed?.contractSignedAt ?? null,
    });
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

  return res.status(201).json({
    shareToken: rawToken,
    expiresAt,
    publicUrlPath: `/c/${rawToken}`,
  });
});

router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createProposalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Dados inválidos.", errors: parsed.error.flatten() });

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

/**
 * ✅ CONFIRMAR PAGAMENTO MANUAL (PIX)
 * POST /api/proposals/:id/mark-paid
 *
 * Regras:
 * - somente dono da proposta pode confirmar
 * - só permite confirmar se contrato já foi assinado (contractSignedAt)
 * - valor vem SEMPRE do proposal.value (anti-fraude)
 * - grava/atualiza payment como CONFIRMED
 * - marca proposal como vendida e lifecycleStatus = PAID
 */
router.post("/:id/mark-paid", async (req: AuthenticatedRequest, res: Response) => {
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

  // exige assinatura antes de confirmar pagamento
  if (!proposal.contractSignedAt) {
    return res.status(409).json({ message: "O contrato precisa estar assinado antes de confirmar pagamento." });
  }

  // se já está pago/cancelado, bloqueia
  if (proposal.lifecycleStatus === "PAID") {
    return res.status(200).json({ ok: true, message: "Pagamento já estava confirmado." });
  }
  if (proposal.lifecycleStatus === "CANCELLED") {
    return res.status(409).json({ message: "Proposta cancelada. Não é possível confirmar pagamento." });
  }

  // valor vem da proposta (anti fraude)
  const amountCents = Math.round(Number(proposal.value) * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return res.status(400).json({ message: "Valor da proposta inválido." });
  }

  // se existir pagamento pendente/confirmado, reaproveita
  const existingPayment = await storage.findPaymentByProposalId(proposal.id);
  if (existingPayment?.status === "CONFIRMED") {
    // garante status da proposta
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

  // marca proposta como vendida + paid
  await storage.updateProposalStatus(userId, proposal.id, "vendida");
  await storage.updateProposalLifecycleStatus(userId, proposal.id, "PAID");

  return res.status(201).json({
    ok: true,
    proposalId: proposal.id,
    amountCents,
    externalPaymentId,
  });
});

/**
 * Checkout MP (dashboard)
 */
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

  const freelancerAccessToken = await getValidFreelancerAccessToken(userId);

  const publicHash = proposal.publicHash ?? crypto.randomBytes(18).toString("hex");
  if (!proposal.publicHash) {
    await storage.ensureProposalPublicHash(userId, proposal.id, publicHash);
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
    frontendPublicPath: `/p/${publicHash}`,
  });

  const paymentUrl = preference.init_point || preference.sandbox_init_point;
  if (!paymentUrl) {
    return res.status(502).json({ message: "Mercado Pago não retornou URL de pagamento." });
  }

  await storage.upsertProposalPayment({
    proposalId: proposal.id,
    status: "PENDING",
    externalPreferenceId: preference.id ?? null,
    externalPaymentId: null,
    paymentUrl,
    amountCents,
  });

  return res.status(201).json({ paymentUrl });
});

router.patch("/:id/status", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = proposalIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Dados inválidos.", errors: parsed.error.flatten() });

  const updated = await storage.updateProposalStatus(userId, parsedId.data, parsed.data.status);
  if (!updated) return res.status(404).json({ message: "Proposta não encontrada." });

  return res.json(updated);
});

export default router;