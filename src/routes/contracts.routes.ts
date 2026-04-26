import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import crypto from "crypto";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import {
  authenticateOrMvp,
  type AuthenticatedRequest,
} from "../middleware/auth.js";

import { clauseService } from "../services/contracts/clause.service.js";
import { contractAutomationService } from "../services/contracts/contract-automation.service.js";
import { contractRenderService } from "../services/contracts/contract-render.service.js";
import { contractService } from "../services/contracts/contract.service.js";
import { templateService } from "../services/contracts/template.service.js";
import {
  handleLogoMulter,
  validateLogoUpload,
  bufferToDataUrl,
} from "../middleware/logo-upload.middleware.js";
import { contractCreationRateLimiter, uploadRateLimiter } from "../middleware/security.js";
import {
  decryptSignature,
  deserializeEncryptedSignature,
  encryptSignature,
  extractPngBufferFromDataUrl,
} from "../lib/signatureCrypto.js";
import { db } from "../db/index.js";
import { contracts, users } from "../db/schema.js";
import { requireStepUp } from "../middleware/step-up.js";
import { distributedRateLimit } from "../middleware/distributed-security.js";
import { normalizeHexToken } from "../lib/httpSecurity.js";
import { optionalCpfCnpjSchema } from "../lib/brDocument.js";
import {
  getAuthenticatedContractSignaturePreviewAsset,
  getContractSignaturePreviewImageCache,
  setContractSignaturePreviewImageCache,
  verifyContractSignaturePreviewToken,
} from "../lib/signaturePreview.js";

const router = Router();

function setPublicNoCache(res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
}

function setProtectedPreviewHeaders(res: Response) {
  setPublicNoCache(res);
  res.setHeader("Expires", "0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("X-Robots-Tag", "noindex, noarchive, nosnippet, noimageindex");
}

function setAuthenticatedPreviewAssetHeaders(res: Response, maxAgeSeconds: number) {
  const safeMaxAge = Math.max(1, Math.min(maxAgeSeconds, 30 * 60));
  res.setHeader("Cache-Control", `private, max-age=${safeMaxAge}, immutable`);
  res.setHeader("Vary", "Cookie, Authorization, Referer, Sec-Fetch-Dest");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("X-Robots-Tag", "noindex, noarchive, nosnippet, noimageindex");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
}

function setPreviewDocumentHeaders(res: Response, etag: string) {
  res.setHeader("Cache-Control", "private, no-cache, max-age=0, must-revalidate");
  res.setHeader("Vary", "Cookie, Authorization");
  res.setHeader("ETag", `"${etag}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-Robots-Tag", "noindex, noarchive, nosnippet, noimageindex");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; connect-src 'none'",
  );
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

function sanitizePublicLayoutConfig(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const clone = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  delete clone.preview;
  delete clone.customVariables;
  delete clone.contractContext;

  return clone;
}

function normalizePreviewStateTag(value: unknown) {
  const tag = String(value ?? "").trim().replace(/^W\//i, "").replaceAll('"', "");
  return /^[a-f0-9]{64}$/i.test(tag) ? tag.toLowerCase() : null;
}

async function renderOfficialPublicContractPreviewByTokenHash(
  tokenHash: string,
  knownStateHash?: string | null
) {
  const contract = await contractService.getContractByShareTokenHash(tokenHash);
  if (!contract) return null;
  if (contract.shareTokenExpiresAt && new Date(contract.shareTokenExpiresAt) < new Date()) return null;

  const rendered = await contractRenderService.renderContract(contract.id, contract.userId, knownStateHash, {
    publicPreview: true,
  });

  if (!rendered) return null;

  return {
    contract,
    rendered,
  };
}

function hasProtectedSignatureMaterial(ciphertext: unknown, iv: unknown, authTag: unknown) {
  return [ciphertext, iv, authTag].every((value) => String(value ?? "").trim().length > 0);
}

function setProtectedSignatureMetadataHeaders(res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}

function sendProtectedSignatureMetadata(
  res: Response,
  payload: {
    hasSignature: boolean;
    scope: "contract" | "profile";
    kind: "client" | "provider";
    updatedAt?: Date | string | null;
  }
) {
  setProtectedSignatureMetadataHeaders(res);
  return res.status(200).json({
    hasSignature: payload.hasSignature,
    scope: payload.scope,
    kind: payload.kind,
    protected: true,
    previewOnly: true,
    updatedAt: payload.updatedAt ?? null,
    message: "A assinatura permanece protegida e so pode ser exibida dentro do preview autenticado do documento.",
  });
}

function buildRequestOrigin(req: Request) {
  const host = req.get("host");
  if (!host) return null;
  return `${req.protocol}://${host}`;
}

function buildPublicContractUrl(token: string) {
  const frontendOrigin = String(process.env.FRONTEND_URL || process.env.APP_URL || "https://fechou.cloud")
    .trim()
    .replace(/\/+$/, "");

  return `${frontendOrigin}/c/${token}`;
}

export function isTrustedPreviewAssetRequest(req: Request, contractId: number) {
  const fetchDest = String(req.header("sec-fetch-dest") ?? "").trim().toLowerCase();
  if (fetchDest && fetchDest !== "image") {
    return false;
  }

  const referer = String(req.header("referer") ?? "").trim();
  if (!referer) {
    return false;
  }

  const requestOrigin = buildRequestOrigin(req);
  if (!requestOrigin) {
    return false;
  }

  try {
    const refererUrl = new URL(referer);
    if (refererUrl.origin !== requestOrigin) {
      return false;
    }

    return refererUrl.pathname === `/api/contracts/${contractId}/preview-document`;
  } catch {
    return false;
  }
}

function isSignaturePreviewRequest(req: Request) {
  return String(req.query.preview ?? "").trim() === "1";
}

async function contractOwnedByUser(contractId: number, userId: number) {
  const [row] = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(and(eq(contracts.id, contractId), eq(contracts.userId, userId)))
    .limit(1);

  return Boolean(row);
}

async function getContractOwnerId(contractId: number) {
  const [row] = await db
    .select({ userId: contracts.userId })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1);

  return row?.userId ?? null;
}

function ensureValidSignaturePreviewAccess(
  req: Request,
  res: Response,
  contractId: number,
  userId: number,
  kind: "client" | "provider"
) {
  if (!isSignaturePreviewRequest(req)) {
    return true;
  }

  const previewExp = Number(req.query.preview_exp ?? NaN);
  const previewNonce = String(req.query.preview_nonce ?? "").trim();
  const previewToken = String(req.query.preview_token ?? "").trim();

  const valid = verifyContractSignaturePreviewToken({
    contractId,
    userId,
    kind,
    expiresAt: previewExp,
    nonce: previewNonce,
    token: previewToken,
  });

  if (!valid) {
    res.status(403).json({ message: "Preview de assinatura inválido ou expirado." });
    return false;
  }

  return true;
}

function getPreviewQueryTuple(req: Request) {
  return {
    previewExp: Number(req.query.preview_exp ?? NaN),
    previewNonce: String(req.query.preview_nonce ?? "").trim(),
    previewToken: String(req.query.preview_token ?? "").trim(),
  };
}

const publicContractLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_PUBLIC_CONTRACT_MAX),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Muitas requisições. Tente novamente em alguns instantes." },
});

const distributedPublicContractLimiter = distributedRateLimit({
  scope: "public-contract",
  limit: Number(process.env.RATE_LIMIT_PUBLIC_CONTRACT_MAX),
  windowMs: 60 * 1000,
});

/*
|--------------------------------------------------------------------------
| SCHEMAS
|--------------------------------------------------------------------------
*/

const contractIdSchema = z.coerce.number().int().positive();

const clauseIdSchema = z.union([
  z.string().uuid(),
  z.coerce.number().int().positive(),
]);

const createContractSchema = z.object({
  client_name:     z.string().trim().min(2).max(140),
  profession:      z.string().trim().min(2).max(80),
  contract_type:   z.string().trim().min(2).max(120),
  execution_date:  z.coerce.date(),
  contract_value:  z.coerce.number().positive().max(9_999_999_999.99),
  payment_method:  z.string().trim().min(2).max(120),
  service_scope:   z.string().trim().min(5).max(15_000),
  auto_apply_suggestions: z.boolean().optional().default(false),
});

const addClauseSchema = z.object({
  clause_id: z.union([z.string().uuid(), z.coerce.number().int().positive()]),
});

const updateClauseSchema = z.object({
  custom_content: z.string().trim().min(1).max(30_000),
});

const reorderSchema = z.object({
  startIndex: z.coerce.number().int().min(0),
  endIndex:   z.coerce.number().int().min(0),
});

const layoutConfigPayloadSchema = z.record(z.unknown());

const layoutSchema = z.union([
  z.object({
    layout_config: layoutConfigPayloadSchema,
  }),
  z.object({
    layoutConfig: layoutConfigPayloadSchema,
  }),
  layoutConfigPayloadSchema,
]);

function extractLayoutConfigPayload(input: z.infer<typeof layoutSchema>) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    if ("layout_config" in input) {
      return input.layout_config as Record<string, unknown>;
    }
    if ("layoutConfig" in input) {
      return input.layoutConfig as Record<string, unknown>;
    }
  }

  return input as Record<string, unknown>;
}

const shareLinkSchema = z.object({
  expiresInHours: z.coerce.number().int().min(1).max(24 * 30).default(72),
});

const markPaidSchema = z.object({
  note:          z.string().trim().max(500).optional(),
  payerName:     z.string().trim().max(140).optional(),
  payerDocument: optionalCpfCnpjSchema("Documento do pagador invalido."),
});

const autoGenerateSchema = z.object({
  audience: z.enum(["b2b", "b2c"]).optional(),
  contractModels: z.array(z.enum(["saas", "projeto", "servico_continuado"])).max(3).optional(),
  riskLevel: z.enum(["baixo", "medio", "alto"]).optional(),
  providerName: z.string().trim().min(2).max(160).optional(),
  providerDocument: optionalCpfCnpjSchema("Documento do prestador invalido."),
  providerAddress: z.string().trim().min(5).max(240).optional(),
  clientName: z.string().trim().min(2).max(160).optional(),
  clientDocument: optionalCpfCnpjSchema("Documento do cliente invalido."),
  clientAddress: z.string().trim().min(5).max(240).optional(),
  contratadaNome: z.string().trim().min(2).max(160).optional(),
  contratadaDocumento: optionalCpfCnpjSchema("Documento da contratada invalido."),
  contratadaEndereco: z.string().trim().min(5).max(240).optional(),
  contratanteDocumento: optionalCpfCnpjSchema("Documento do contratante invalido."),
  contratanteEndereco: z.string().trim().min(5).max(240).optional(),
  provider_document: optionalCpfCnpjSchema("Documento do prestador invalido."),
  provider_address: z.string().trim().min(5).max(240).optional(),
  client_document: optionalCpfCnpjSchema("Documento do cliente invalido."),
  client_address: z.string().trim().min(5).max(240).optional(),
  customerDocument: optionalCpfCnpjSchema("Documento do cliente invalido."),
  customerAddress: z.string().trim().min(5).max(240).optional(),
  clauseMode: z.enum(["essential", "balanced", "complete", "robust", "custom"]).optional(),
  targetClauseCount: z.coerce.number().int().min(1).max(60).optional(),
  maxAutomaticClauses: z.coerce.number().int().min(1).max(60).optional(),
  automaticClauseCount: z.coerce.number().int().min(1).max(60).optional(),
  autoClauseCount: z.coerce.number().int().min(1).max(60).optional(),
  clauseCount: z.coerce.number().int().min(1).max(60).optional(),
  clauseLimit: z.coerce.number().int().min(1).max(60).optional(),
  personalData: z.boolean().optional(),
  sensitiveData: z.boolean().optional(),
  sourceCodeDelivery: z.boolean().optional(),
  ipMode: z.enum(["licenca", "cessao", "titularidade_prestador"]).optional(),
  supportLevel: z.enum(["none", "horario_comercial", "estendido"]).optional(),
  subscription: z.boolean().optional(),
  milestoneBilling: z.boolean().optional(),
  includeArbitration: z.boolean().optional(),
  includeEscrow: z.boolean().optional(),
  includePortfolioUse: z.boolean().optional(),
  includeChargebackRule: z.boolean().optional(),
  includeHandOver: z.boolean().optional(),
  authenticationMethods: z.array(z.string().trim().min(2).max(40)).max(6).optional(),
  forumCityUf: z.string().trim().max(120).optional(),
  forumConnection: z.string().trim().max(180).optional(),
  supportSummary: z.string().trim().max(500).optional(),
  subprocessorSummary: z.string().trim().max(500).optional(),
  securitySummary: z.string().trim().max(500).optional(),
  replaceExisting: z.boolean().default(true),
});

/*
|--------------------------------------------------------------------------
| ROTA PÚBLICA — REVIEW POR SHARE TOKEN
| GET /api/contracts/review/:token/preview-document
| GET /api/contracts/review/:token
|--------------------------------------------------------------------------
*/

router.get("/review/:token([a-fA-F0-9]{64})/preview-document", publicContractLimiter, distributedPublicContractLimiter, async (req: Request, res: Response) => {
  setPublicNoCache(res);

  const token = normalizeHexToken(req.params.token);
  if (!token) return res.status(400).json({ message: "Token inválido." });

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const knownStateHash = normalizePreviewStateTag(req.header("if-none-match"));
  const result = await renderOfficialPublicContractPreviewByTokenHash(tokenHash, knownStateHash);

  if (!result) {
    return res.status(404).json({ message: "Preview público não encontrado." });
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
});

/*
|--------------------------------------------------------------------------
| ROTA PÚBLICA — REVIEW POR SHARE TOKEN
| GET /api/contracts/review/:token
|
| ATENÇÃO: deve vir ANTES do router.use(authenticateOrMvp) para não exigir
|          autenticação. O cliente que recebe o link não está logado.
|--------------------------------------------------------------------------
*/

router.get("/review/:token([a-fA-F0-9]{64})", publicContractLimiter, distributedPublicContractLimiter, async (req: Request, res: Response) => {
  setPublicNoCache(res);

  const token = normalizeHexToken(req.params.token);
  if (!token) return res.status(400).json({ message: "Token inválido." });

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const contract = await contractService.getContractByShareTokenHash(tokenHash);
  if (!contract) {
    return res.status(404).json({ message: "Contrato não encontrado." });
  }

  if (contract.shareTokenExpiresAt && new Date(contract.shareTokenExpiresAt) < new Date()) {
    return res.status(410).json({ message: "Link expirado." });
  }

  const rendered = await contractRenderService.renderContract(contract.id, contract.userId, undefined, {
    publicPreview: true,
  });

  return res.json({
    id: contract.id,
    title: contract.title,
    clientName: contract.clientName,
    description: contract.description,
    value: contract.value,
    status: contract.status,
    contract: contract.contract,
    previewHtml: rendered?.html ?? undefined,
    previewDocumentUrl: `/api/contracts/review/${token}/preview-document`,
    previewExpiresAt: (rendered as any)?.previewExpiresAt ?? null,
  });
});

/*
|--------------------------------------------------------------------------
| ROTA PÚBLICA — TOKEN HEX DE 64 CHARS (share link legado)
| GET /api/contracts/:token/preview-document
| GET /api/contracts/:token
|
| ATENÇÃO: deve vir ANTES do router.use(authenticateOrMvp)
|--------------------------------------------------------------------------
*/

router.get("/:token([a-fA-F0-9]{64})/preview-document", publicContractLimiter, distributedPublicContractLimiter, async (req: Request, res: Response) => {
  const token = normalizeHexToken(req.params.token);
  setPublicNoCache(res);

  if (!token) {
    return res.status(400).json({ message: "Token inválido." });
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const knownStateHash = normalizePreviewStateTag(req.header("if-none-match"));
  const result = await renderOfficialPublicContractPreviewByTokenHash(tokenHash, knownStateHash);

  if (!result) {
    return res.status(404).json({ message: "Preview público não encontrado ou link expirado." });
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
});

router.get("/:token([a-fA-F0-9]{64})", publicContractLimiter, distributedPublicContractLimiter, async (req: Request, res: Response, next: NextFunction) => {
  const token = normalizeHexToken(req.params.token);
  setPublicNoCache(res);

  // Só intercepta tokens hex de 64 chars — deixa IDs numéricos passarem
  if (!token) {
    return next();
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const [contract] = await db
    .select()
    .from(contracts)
    .where(
      and(
        eq((contracts as any).shareTokenHash, tokenHash),
        gt((contracts as any).shareTokenExpiresAt, new Date())
      )
    )
    .limit(1);

  if (!contract) {
    return res.status(404).json({ message: "Contrato não encontrado ou link expirado." });
  }

  const c = contract as any;
  const contractId = c.id as number;
  const userId     = c.userId as number;

  // ── Cláusulas ─────────────────────────────────────────────────────────────
  // ── Plano do freelancer ───────────────────────────────────────────────────
  let planId: "free" | "pro" | "premium" = "free";
  try {
    const plan = await templateService.checkUserPlan(userId);
    if (plan === "pro" || plan === "premium") planId = plan;
  } catch {
    planId = "free";
  }

  const logoUrl: string | null = c.logoUrl ?? null;
  const layoutConfig = sanitizePublicLayoutConfig(c.layoutConfig ?? null);
  const hasClientSignature = hasProtectedSignatureMaterial(
    c.signatureCiphertext ?? null,
    c.signatureIv ?? null,
    c.signatureAuthTag ?? null
  );
  const hasProviderSignature = hasProtectedSignatureMaterial(
    c.providerContractCiphertext ?? null,
    c.providerContractIv ?? null,
    c.providerContractAuthTag ?? null
  );

  // ── Assinatura do contratante ─────────────────────────────────────────────

  // ── Assinatura do prestador ───────────────────────────────────────────────

  // ── Nome do freelancer ────────────────────────────────────────────────────
  let freelancerName = "Freelancer";
  try {
    const [userRow] = await db.select().from(users).where(eq(users.id, userId));
    if (userRow) {
      const u = userRow as any;
      freelancerName =
        u.name ?? u.fullName ?? u.full_name ?? u.displayName ?? u.email ?? "Freelancer";
    }
  } catch {
    freelancerName = "Freelancer";
  }

  const rendered = await contractRenderService.renderContract(contractId, userId, undefined, {
    publicPreview: true,
  });

  const response = {
    id:             contractId,
    title:          c.title ?? c.contractType ?? "",
    clientName:     c.clientName ?? c.client_name ?? "",
    contractType:   c.contractType ?? c.contract_type ?? "",
    executionDate:  c.executionDate ?? c.execution_date ?? "",
    value:          c.value ?? c.contractValue ?? c.contract_value ?? 0,
    paymentForm:    c.paymentForm ?? c.paymentMethod ?? c.payment_method ?? "",
    scope:          c.scope ?? c.serviceScope ?? c.service_scope ?? "",
    status:         c.status ?? "rascunho",
    isSigned:       !!(c.signedAt ?? c.signed_at),
    isPaid:         c.lifecycleStatus === "PAID" || c.isPaid === true,
    freelancerName,
    planId,
    layoutConfig,
    logoUrl,
    clauses: ((rendered as any)?.clauses ?? []).map((cl: any, index: number) => ({
      clauseId: cl.clauseId ?? cl.id ?? `preview-${index + 1}`,
      title: cl.title ?? "",
      content: cl.content ?? "",
      orderIndex: index,
    })),
    hasClientSignature,
    hasProviderSignature,
    signaturePreviewProtected: true,
    previewHtml: rendered?.html ?? undefined,
    previewDocumentUrl: `/api/contracts/${token}/preview-document`,
    previewExpiresAt: (rendered as any)?.previewExpiresAt ?? null,
  };

  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.json(response);
});

/*
|--------------------------------------------------------------------------
| PREVIEW DE ASSINATURA (PÚBLICO COM TOKEN EFÊMERO ASSINADO)
| GET /api/contracts/:id/signature?preview=1...
| GET /api/contracts/:id/provider-signature?preview=1...
|---------------------------------------------------------------------------
*/

router.get("/:id/signature", async (req: Request, res: Response, next: NextFunction) => {
  if (!isSignaturePreviewRequest(req)) return next();
  setProtectedPreviewHeaders(res);
  return res.status(410).json({
    message: "Preview legado de assinatura descontinuado. Use o preview autenticado do documento.",
  });

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const ownerId = await getContractOwnerId(parsedId.data!);
  if (!ownerId) return res.status(404).json({ message: "Contrato não encontrado." });

  if (!ensureValidSignaturePreviewAccess(req, res, parsedId.data!, ownerId, "client")) {
    return;
  }

  const signatureRecord = await contractService.getContractSignature(parsedId.data!, ownerId);
  if (!signatureRecord) {
    setProtectedPreviewHeaders(res);
    return res.status(204).end();
  }

  let cryptoBuffers: { ciphertext: Buffer; iv: Buffer; authTag: Buffer };
  try {
    cryptoBuffers = deserializeEncryptedSignature({
      ciphertextB64: signatureRecord!.ciphertextB64,
      ivB64: signatureRecord!.ivB64,
      authTagB64: signatureRecord!.authTagB64,
    });
  } catch {
    setProtectedPreviewHeaders(res);
    return res.status(204).end();
  }

  let pngBuffer: Buffer;
  try {
    pngBuffer = decryptSignature(cryptoBuffers, {
      proposalId: signatureRecord!.proposalId,
      signerName: signatureRecord!.signerName,
      signerDocument: signatureRecord!.signerDocument,
    });
  } catch {
    setProtectedPreviewHeaders(res);
    return res.status(204).end();
  }

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", pngBuffer.length);
  res.setHeader("Content-Disposition", "inline");
  setProtectedPreviewHeaders(res);
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  return res.send(pngBuffer);
});

router.get("/:id/provider-signature", async (req: Request, res: Response, next: NextFunction) => {
  if (!isSignaturePreviewRequest(req)) return next();
  setProtectedPreviewHeaders(res);
  return res.status(410).json({
    message: "Preview legado de assinatura descontinuado. Use o preview autenticado do documento.",
  });

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const ownerId = await getContractOwnerId(parsedId.data!);
  if (!ownerId) return res.status(404).json({ message: "Contrato não encontrado." });

  if (!ensureValidSignaturePreviewAccess(req, res, parsedId.data!, ownerId, "provider")) {
    return;
  }

  const [contractRow] = await db
    .select({
      providerContractCiphertext: contracts.providerContractCiphertext,
      providerContractIv: contracts.providerContractIv,
      providerContractAuthTag: contracts.providerContractAuthTag,
    })
    .from(contracts)
    .where(and(eq(contracts.id, parsedId.data!), eq(contracts.userId, ownerId)))
    .limit(1);

  const c = contractRow as any;
  const ciphertext = c?.providerContractCiphertext ?? null;
  const iv = c?.providerContractIv ?? null;
  const authTag = c?.providerContractAuthTag ?? null;
  if (!ciphertext || !iv || !authTag) {
    setProtectedPreviewHeaders(res);
    return res.status(204).end();
  }

  let cryptoBuffers: { ciphertext: Buffer; iv: Buffer; authTag: Buffer };
  try {
    cryptoBuffers = deserializeEncryptedSignature({
      ciphertextB64: ciphertext,
      ivB64: iv,
      authTagB64: authTag,
    });
  } catch {
    setProtectedPreviewHeaders(res);
    return res.status(204).end();
  }

  let pngBuffer: Buffer;
  try {
    pngBuffer = decryptSignature(cryptoBuffers, {
      proposalId: parsedId.data!,
      signerName: `provider:${ownerId}`,
      signerDocument: `uid-${String(ownerId).padStart(5, "0")}`,
    });
  } catch {
    setProtectedPreviewHeaders(res);
    return res.status(204).end();
  }

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", pngBuffer.length);
  res.setHeader("Content-Disposition", "inline");
  setProtectedPreviewHeaders(res);
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  return res.send(pngBuffer);
});

/*
|--------------------------------------------------------------------------
| MIDDLEWARE DE AUTENTICAÇÃO
| Todas as rotas abaixo deste ponto exigem autenticação.
|--------------------------------------------------------------------------
*/

router.use(authenticateOrMvp);

/*
|--------------------------------------------------------------------------
| PREVIEW ASSETS AUTENTICADOS
| GET /api/contracts/preview-assets/:token
|--------------------------------------------------------------------------
*/

router.get("/preview-assets/:token([a-fA-F0-9]{64})", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Nao autenticado." });

  const asset = getAuthenticatedContractSignaturePreviewAsset(String(req.params.token ?? ""));
  if (!asset || asset.userId !== userId) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(404).json({ message: "Preview nao encontrado ou expirado." });
  }
  if (!isTrustedPreviewAssetRequest(req, asset.contractId)) {
    setProtectedPreviewHeaders(res);
    return res.status(403).json({
      message: "Asset de preview protegido. Abra a assinatura somente dentro do preview autenticado do contrato.",
    });
  }

  const maxAgeSeconds = Math.floor((asset.expiresAt - Date.now()) / 1000);
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", asset.pngBuffer.length);
  res.setHeader("Content-Disposition", "inline");
  setAuthenticatedPreviewAssetHeaders(res, maxAgeSeconds);
  return res.send(asset.pngBuffer);
});

/*
|--------------------------------------------------------------------------
| CREATE CONTRACT
| POST /api/contracts
|--------------------------------------------------------------------------
*/

router.post("/", contractCreationRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsed = createContractSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ message: "Dados inválidos.", errors: parsed.error.flatten() });

  const contract = await contractService.createContract({
    userId,
    clientName:    parsed.data.client_name,
    profession:    parsed.data.profession,
    contractType:  parsed.data.contract_type,
    executionDate: parsed.data.execution_date,
    contractValue: parsed.data.contract_value.toFixed(2),
    paymentMethod: parsed.data.payment_method,
    serviceScope:  parsed.data.service_scope,
    autoApplySuggestedClauses: parsed.data.auto_apply_suggestions,
  });

  return res.status(201).json(contract);
});

/*
|--------------------------------------------------------------------------
| AUTO GENERATE CONTRACT CLAUSES
| POST /api/contracts/:id/auto-generate
|--------------------------------------------------------------------------
*/

router.post("/:id/auto-generate", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "NÃ£o autenticado." });

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID invÃ¡lido." });

  const parsedBody = autoGenerateSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({
      message: "Dados invÃ¡lidos.",
      errors: parsedBody.error.flatten(),
    });
  }

  const generated = await contractAutomationService.autoGenerate(userId, parsedId.data, parsedBody.data);
  if (!generated) return res.status(404).json({ message: "Contrato nÃ£o encontrado." });

  return res.json(generated);
});

/*
|--------------------------------------------------------------------------
| RENDER CONTRACT
| POST /api/contracts/render
|--------------------------------------------------------------------------
*/

router.post("/render", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const schema = z.object({
    contractId: z.coerce.number().int().positive(),
    knownStateHash: z.string().trim().regex(/^[a-f0-9]{64}$/i).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados inválidos.", errors: parsed.error.flatten() });
  }

  const rendered = await contractRenderService.renderContract(parsed.data.contractId, userId, parsed.data.knownStateHash);
  if (!rendered) return res.status(404).json({ message: "Contrato não encontrado." });

  setProtectedPreviewHeaders(res);
  return res.json({
    html: rendered.html,
    notModified: (rendered as any).notModified ?? false,
    stateHash: (rendered as any).stateHash ?? null,
    previewExpiresAt: (rendered as any).previewExpiresAt ?? null,
    previewDocumentUrl: `/api/contracts/${parsed.data.contractId}/preview-document`,
  });
});

/*
|--------------------------------------------------------------------------
| PREVIEW DOCUMENT ESTAVEL PARA IFRAME
| GET /api/contracts/:id/preview-document
|--------------------------------------------------------------------------
*/

router.get("/:id/preview-document", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Nao autenticado." });

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID invalido." });

  const knownStateHash = normalizePreviewStateTag(req.header("if-none-match"));
  const rendered = await contractRenderService.renderContract(parsedId.data, userId, knownStateHash);
  if (!rendered) return res.status(404).json({ message: "Contrato nao encontrado." });

  const stateHash = (rendered as any).stateHash ?? null;
  if (!stateHash) {
    return res.status(500).json({ message: "Preview sem hash de estado." });
  }

  setPreviewDocumentHeaders(res, stateHash);

  if ((rendered as any).notModified) {
    return res.status(304).end();
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(rendered.html ?? "");
});

/*
|--------------------------------------------------------------------------
| SAVE PROVIDER SIGNATURE — perfil do usuário (reutilizável)
| POST /api/contracts/provider-signature
|
| ATENÇÃO: deve vir ANTES das rotas /:id para não ser capturada pelo parâmetro
|--------------------------------------------------------------------------
*/

router.post("/provider-signature", requireStepUp("contracts.provider-signature.save", () => ({})), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const schema = z.object({
    signatureDataUrl: z.string().min(30).max(2_500_000),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados inválidos.", errors: parsed.error.flatten() });
  }

  let rawDataUrl = parsed.data.signatureDataUrl.trim();

  if (!rawDataUrl.startsWith("data:")) {
    if (rawDataUrl.startsWith("image/png;base64,")) {
      rawDataUrl = "data:" + rawDataUrl;
    } else if (rawDataUrl.startsWith("png;base64,")) {
      rawDataUrl = "data:image/" + rawDataUrl;
    } else if (rawDataUrl.startsWith("base64,")) {
      rawDataUrl = "data:image/png;" + rawDataUrl;
    } else if (/^[A-Za-z0-9+/]/.test(rawDataUrl)) {
      rawDataUrl = "data:image/png;base64," + rawDataUrl;
    }
  }

  let signatureBuffer: Buffer;
  try {
    signatureBuffer = extractPngBufferFromDataUrl(rawDataUrl);
  } catch (err: any) {
    return res.status(400).json({ message: err?.message ?? "Assinatura inválida." });
  }

  let encrypted;
  try {
    encrypted = encryptSignature(signatureBuffer, {
      proposalId:     userId!,
      signerName:     `provider:${userId!}`,
      signerDocument: `uid-${String(userId!).padStart(5, '0')}`,
    });
  } catch (err: any) {
    return res.status(500).json({ message: err?.message ?? "Falha ao proteger assinatura." });
  }

  await db
    .update(users)
    .set({
      providerSignatureCiphertext: encrypted.ciphertext.toString("base64"),
      providerSignatureIv:         encrypted.iv.toString("base64"),
      providerSignatureAuthTag:    encrypted.authTag.toString("base64"),
      providerSignatureUpdatedAt:  new Date(),
    } as any)
    .where(eq(users.id, userId));

  return res.status(201).json({ ok: true });
});

/*
|--------------------------------------------------------------------------
| GET PROVIDER SIGNATURE — perfil do usuário
| GET /api/contracts/provider-signature
|--------------------------------------------------------------------------
*/

router.get("/provider-signature", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const [row] = await db.select().from(users).where(eq(users.id, userId));
  if (!row) return res.status(404).json({ message: "Usuário não encontrado." });

  const u = row as any;
  const ciphertext = u.providerSignatureCiphertext ?? u.provider_signature_ciphertext ?? null;
  const iv         = u.providerSignatureIv         ?? u.provider_signature_iv         ?? null;
  const authTag    = u.providerSignatureAuthTag     ?? u.provider_signature_auth_tag   ?? null;
  return sendProtectedSignatureMetadata(res, {
    hasSignature: hasProtectedSignatureMaterial(ciphertext, iv, authTag),
    scope: "profile",
    kind: "provider",
    updatedAt: u.providerSignatureUpdatedAt ?? u.provider_signature_updated_at ?? null,
  });

  if (!ciphertext || !iv || !authTag) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(204).end();
  }

  let cryptoBuffers: { ciphertext: Buffer; iv: Buffer; authTag: Buffer };
  try {
    cryptoBuffers = deserializeEncryptedSignature({ ciphertextB64: ciphertext, ivB64: iv, authTagB64: authTag });
  } catch {
    return res.status(500).json({ message: "Dados de assinatura corrompidos." });
  }

  let pngBuffer: Buffer;
  try {
    pngBuffer = decryptSignature(cryptoBuffers, {
      proposalId:     userId!,
      signerName:     `provider:${userId!}`,
      signerDocument: `uid-${String(userId!).padStart(5, '0')}`,
    });
  } catch {
    return res.status(422).json({ message: "Assinatura não pôde ser verificada." });
  }

  res.setHeader("Content-Type",                 "image/png");
  res.setHeader("Content-Length",               pngBuffer.length);
  res.setHeader("Content-Disposition",          "inline");
  res.setHeader("Cache-Control",                "no-store, no-cache, must-revalidate");
  res.setHeader("X-Content-Type-Options",       "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  return res.send(pngBuffer);
});

/*
|--------------------------------------------------------------------------
| DELETE PROVIDER SIGNATURE — perfil do usuário
| DELETE /api/contracts/provider-signature
|--------------------------------------------------------------------------
*/

router.delete("/provider-signature", requireStepUp("contracts.provider-signature.delete", () => ({})), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  await db
    .update(users)
    .set({
      providerSignatureCiphertext: null,
      providerSignatureIv:         null,
      providerSignatureAuthTag:    null,
      providerSignatureUpdatedAt:  null,
    } as any)
    .where(eq(users.id, userId));

  return res.json({ ok: true });
});

/*
|--------------------------------------------------------------------------
| LIST CONTRACTS
| GET /api/contracts
|--------------------------------------------------------------------------
*/

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const contracts = await contractService.listContracts(userId);
  return res.json(contracts);
});

/*
|--------------------------------------------------------------------------
| GET CONTRACT
| GET /api/contracts/:id
|--------------------------------------------------------------------------
*/

router.get("/:id", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const contract = await contractService.getContract(parsedId.data, userId);
  if (!contract) return res.status(404).json({ message: "Contrato não encontrado." });

  return res.json(contract);
});

/*
|--------------------------------------------------------------------------
| ADD CLAUSE
| POST /api/contracts/:id/clauses
|--------------------------------------------------------------------------
*/

router.post("/:id/clauses", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedContractId = contractIdSchema.safeParse(req.params.id);
  if (!parsedContractId.success) return res.status(400).json({ message: "ID inválido." });

  const parsedBody = addClauseSchema.safeParse(req.body);
  if (!parsedBody.success)
    return res.status(400).json({ message: "Dados inválidos.", errors: parsedBody.error.flatten() });

  const result = await clauseService.addClauseToContractOwned(
    userId,
    parsedContractId.data,
    String(parsedBody.data.clause_id)
  );
  if (!result) return res.status(404).json({ message: "Contrato ou cláusula não encontrado." });

  return res.status(201).json(result);
});

/*
|--------------------------------------------------------------------------
| REORDER CLAUSES
| PATCH /api/contracts/:id/clauses/reorder
| ATENÇÃO: deve vir ANTES de /:id/clauses/:clauseId
|--------------------------------------------------------------------------
*/

router.patch("/:id/clauses/reorder", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const parsedBody = reorderSchema.safeParse(req.body);
  if (!parsedBody.success)
    return res.status(400).json({ message: "Dados inválidos.", errors: parsedBody.error.flatten() });

  const reordered = await clauseService.reorderClausesOwned(
    userId,
    parsedId.data,
    parsedBody.data.startIndex,
    parsedBody.data.endIndex
  );
  if (!reordered) return res.status(400).json({ message: "Índices inválidos para reordenação." });

  return res.json(reordered);
});

/*
|--------------------------------------------------------------------------
| UPDATE CLAUSE CONTENT
| PATCH /api/contracts/:id/clauses/:clauseId
|--------------------------------------------------------------------------
*/

router.patch("/:id/clauses/:clauseId", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedContractId = contractIdSchema.safeParse(req.params.id);
  const parsedClauseId   = clauseIdSchema.safeParse(req.params.clauseId);
  if (!parsedContractId.success || !parsedClauseId.success)
    return res.status(400).json({ message: "IDs inválidos." });

  const parsedBody = updateClauseSchema.safeParse(req.body);
  if (!parsedBody.success)
    return res.status(400).json({ message: "Dados inválidos.", errors: parsedBody.error.flatten() });

  const updated = await clauseService.updateClauseContentOwned(
    userId,
    parsedContractId.data,
    parsedClauseId.data.toString(),
    parsedBody.data.custom_content
  );
  if (!updated) return res.status(404).json({ message: "Cláusula associada não encontrada." });

  return res.json(updated);
});

/*
|--------------------------------------------------------------------------
| REMOVE CLAUSE
| DELETE /api/contracts/:id/clauses/:clauseId
|--------------------------------------------------------------------------
*/

router.delete("/:id/clauses/:clauseId", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedContractId = contractIdSchema.safeParse(req.params.id);
  const parsedClauseId   = clauseIdSchema.safeParse(req.params.clauseId);
  if (!parsedContractId.success || !parsedClauseId.success)
    return res.status(400).json({ message: "IDs inválidos." });

  const removed = await clauseService.removeClauseFromContractOwned(
    userId,
    parsedContractId.data,
    parsedClauseId.data.toString()
  );
  if (!removed) return res.status(404).json({ message: "Cláusula associada não encontrada." });

  return res.json({ ok: true });
});

/*
|--------------------------------------------------------------------------
| UPDATE LAYOUT
| PATCH /api/contracts/:id/layout
|--------------------------------------------------------------------------
*/

router.patch("/:id/layout", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const parsedBody = layoutSchema.safeParse(req.body);
  if (!parsedBody.success)
    return res.status(400).json({ message: "Dados inválidos.", errors: parsedBody.error.flatten() });

  let plan = "free";
  try {
    plan = await templateService.checkUserPlan(userId) ?? "free";
  } catch {
    plan = "free";
  }

  const lc = extractLayoutConfigPayload(parsedBody.data);

  if (plan === "free") {
    const updated = await contractService.updateContractLayout(parsedId.data, userId, {}, { replace: true });
    if (!updated) return res.status(404).json({ message: "Contrato não encontrado." });
    return res.json(updated);
  }

  if (plan === "pro") {
    const { logoUrl: _logo, ...proLayout } = lc as any;
    const updated = await contractService.updateContractLayout(parsedId.data, userId, proLayout, { replace: false });
    if (!updated) return res.status(404).json({ message: "Contrato não encontrado." });
    return res.json(updated);
  }

  const updated = await contractService.updateContractLayout(parsedId.data, userId, lc, { replace: false });
  if (!updated) return res.status(404).json({ message: "Contrato não encontrado." });

  return res.json(updated);
});

/*
|--------------------------------------------------------------------------
| GENERATE PDF
| POST /api/contracts/:id/pdf
|--------------------------------------------------------------------------
*/

router.post("/:id/pdf", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const contract = await contractService.getContract(parsedId.data, userId);
  if (!contract) return res.status(404).json({ message: "Contrato não encontrado." });

  const pdfBundle = await contractRenderService.generateContractPDF(parsedId.data, userId);
  if (!pdfBundle) return res.status(500).json({ message: "Erro ao gerar PDF. Verifique se o Puppeteer está instalado." });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=contrato-${parsedId.data}.pdf`);
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Plan", pdfBundle.userPlan);
  return res.send(pdfBundle.pdfBuffer);
});

/*
|--------------------------------------------------------------------------
| UPLOAD LOGO
| POST /api/contracts/:id/logo
|--------------------------------------------------------------------------
*/

router.post(
  "/:id/logo",
  uploadRateLimiter,
  handleLogoMulter,
  validateLogoUpload,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Não autenticado." });

    const parsedId = contractIdSchema.safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

    const plan = await templateService.checkUserPlan(userId);
    if (plan === "free")
      return res.status(403).json({ message: "Upload de logo disponível apenas nos planos Pro e Premium." });

    const contract = await contractService.getContract(parsedId.data, userId);
    if (!contract) return res.status(404).json({ message: "Contrato não encontrado." });

    const dataUrl = bufferToDataUrl(req.file!);
    const updated = await contractService.updateContractLogo(parsedId.data, userId, dataUrl);
    if (!updated) return res.status(404).json({ message: "Contrato não encontrado." });

    return res.json({ logoUrl: updated.logoUrl });
  }
);

/*
|--------------------------------------------------------------------------
| REMOVE LOGO
| DELETE /api/contracts/:id/logo
|--------------------------------------------------------------------------
*/

router.delete("/:id/logo", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const updated = await contractService.updateContractLogo(parsedId.data, userId, null);
  if (!updated) return res.status(404).json({ message: "Contrato não encontrado." });

  return res.json({ ok: true });
});

/*
|--------------------------------------------------------------------------
| GET SIGNATURE IMAGE (contratante)
| GET /api/contracts/:id/signature
|--------------------------------------------------------------------------
*/

router.get("/:id/signature", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });
  const previewRequest = isSignaturePreviewRequest(req);
  if (!previewRequest) {
    const parsedId = contractIdSchema.safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "ID invÃ¡lido." });

    const signatureRecord = await contractService.getContractSignature(parsedId.data, userId);
    const contractExists = signatureRecord ? true : await contractOwnedByUser(parsedId.data, userId);
    if (!contractExists) return res.status(404).json({ message: "Contrato nÃ£o encontrado." });

    return sendProtectedSignatureMetadata(res, {
      hasSignature: Boolean(signatureRecord),
      scope: "contract",
      kind: "client",
    });
  }

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  if (!ensureValidSignaturePreviewAccess(req, res, parsedId.data, userId, "client")) {
    return;
  }

  if (previewRequest) {
    const { previewExp, previewNonce, previewToken } = getPreviewQueryTuple(req);
    const cachedPng = getContractSignaturePreviewImageCache({
      token: previewToken,
      contractId: parsedId.data,
      userId,
      kind: "client",
      expiresAt: previewExp,
      nonce: previewNonce,
    });
    if (cachedPng) {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", cachedPng.length);
      res.setHeader("Content-Disposition", "inline");
      setProtectedPreviewHeaders(res);
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      return res.send(cachedPng);
    }
  }

  const signatureRecord = await contractService.getContractSignature(parsedId.data, userId);
  if (!signatureRecord) {
    const contractExists = await contractOwnedByUser(parsedId.data, userId);
    if (!contractExists) return res.status(404).json({ message: "Contrato não encontrado." });

    if (previewRequest) {
      setProtectedPreviewHeaders(res);
    } else {
      res.setHeader("Cache-Control", "no-store");
    }
    return res.status(204).end();
  }

  let cryptoBuffers: { ciphertext: Buffer; iv: Buffer; authTag: Buffer };
  try {
    cryptoBuffers = deserializeEncryptedSignature({
      ciphertextB64: signatureRecord.ciphertextB64,
      ivB64:         signatureRecord.ivB64,
      authTagB64:    signatureRecord.authTagB64,
    });
  } catch {
    if (previewRequest) {
      setProtectedPreviewHeaders(res);
      return res.status(204).end();
    }
    return res.status(500).json({ message: "Dados de assinatura corrompidos." });
  }

  let pngBuffer: Buffer;
  try {
    pngBuffer = decryptSignature(cryptoBuffers, {
      proposalId:     signatureRecord.proposalId,
      signerName:     signatureRecord.signerName,
      signerDocument: signatureRecord.signerDocument,
    });
  } catch {
    if (previewRequest) {
      setProtectedPreviewHeaders(res);
      return res.status(204).end();
    }
    return res.status(422).json({ message: "Assinatura não pôde ser verificada." });
  }

  if (previewRequest) {
    const { previewExp, previewNonce, previewToken } = getPreviewQueryTuple(req);
    setContractSignaturePreviewImageCache({
      token: previewToken,
      contractId: parsedId.data,
      userId,
      kind: "client",
      expiresAt: previewExp,
      nonce: previewNonce,
      pngBuffer,
    });
  }

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", pngBuffer.length);
  res.setHeader("Content-Disposition", "inline");
  setProtectedPreviewHeaders(res);
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  return res.send(pngBuffer);
});

/*
|--------------------------------------------------------------------------
| APPLY PROVIDER SIGNATURE TO CONTRACT
| POST /api/contracts/:id/provider-signature
|--------------------------------------------------------------------------
*/

router.post("/:id/provider-signature", requireStepUp("contracts.provider-signature.apply", () => ({})), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const contract = await contractService.getContract(parsedId.data, userId);
  if (!contract) return res.status(404).json({ message: "Contrato não encontrado." });

  const [row] = await db.select().from(users).where(eq(users.id, userId));
  if (!row) return res.status(404).json({ message: "Usuário não encontrado." });

  const u = row as any;
  const ciphertext = u.providerSignatureCiphertext ?? u.provider_signature_ciphertext ?? null;
  const iv         = u.providerSignatureIv         ?? u.provider_signature_iv         ?? null;
  const authTag    = u.providerSignatureAuthTag     ?? u.provider_signature_auth_tag   ?? null;

  if (!ciphertext || !iv || !authTag)
    return res.status(404).json({ message: "Nenhuma assinatura salva no perfil. Desenhe e salve primeiro." });

  let pngBuffer: Buffer;
  try {
    const cryptoBuffers = deserializeEncryptedSignature({ ciphertextB64: ciphertext, ivB64: iv, authTagB64: authTag });
    pngBuffer = decryptSignature(cryptoBuffers, {
      proposalId:     userId,
      signerName:     `provider:${userId}`,
      signerDocument: `uid-${String(userId).padStart(5, '0')}`,
    });
  } catch {
    return res.status(422).json({ message: "Assinatura do perfil não pôde ser verificada." });
  }

  let reEncrypted;
  try {
    reEncrypted = encryptSignature(pngBuffer, {
      proposalId:     parsedId.data,
      signerName:     `provider:${userId}`,
      signerDocument: `uid-${String(userId).padStart(5, '0')}`,
    });
  } catch (err: any) {
    return res.status(500).json({ message: err?.message ?? "Falha ao proteger assinatura." });
  }

  const now = new Date();

  await db
    .update(contracts)
    .set({
      providerSignedAt:           now,
      providerContractCiphertext: reEncrypted.ciphertext.toString("base64"),
      providerContractIv:         reEncrypted.iv.toString("base64"),
      providerContractAuthTag:    reEncrypted.authTag.toString("base64"),
      updatedAt:                  now,
    } as any)
    .where(and(eq(contracts.id, parsedId.data), eq(contracts.userId, userId)));

  return res.status(201).json({ ok: true, providerSignedAt: now });
});

/*
|--------------------------------------------------------------------------
| GET PROVIDER SIGNATURE FOR CONTRACT (contratado)
| GET /api/contracts/:id/provider-signature
|--------------------------------------------------------------------------
*/

router.get("/:id/provider-signature", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });
  const previewRequest = isSignaturePreviewRequest(req);
  if (!previewRequest) {
    const parsedId = contractIdSchema.safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "ID invÃ¡lido." });

    const [contractRow] = await db
      .select({
        id: contracts.id,
        providerSignedAt: contracts.providerSignedAt,
        providerContractCiphertext: contracts.providerContractCiphertext,
        providerContractIv: contracts.providerContractIv,
        providerContractAuthTag: contracts.providerContractAuthTag,
      })
      .from(contracts)
      .where(and(eq(contracts.id, parsedId.data), eq(contracts.userId, userId)))
      .limit(1);

    if (!contractRow) return res.status(404).json({ message: "Contrato nÃ£o encontrado." });

    const c = contractRow as any;
    return sendProtectedSignatureMetadata(res, {
      hasSignature: hasProtectedSignatureMaterial(
        c.providerContractCiphertext ?? null,
        c.providerContractIv ?? null,
        c.providerContractAuthTag ?? null
      ),
      scope: "contract",
      kind: "provider",
      updatedAt: c.providerSignedAt ?? null,
    });
  }

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  if (!ensureValidSignaturePreviewAccess(req, res, parsedId.data, userId, "provider")) {
    return;
  }

  if (previewRequest) {
    const { previewExp, previewNonce, previewToken } = getPreviewQueryTuple(req);
    const cachedPng = getContractSignaturePreviewImageCache({
      token: previewToken,
      contractId: parsedId.data,
      userId,
      kind: "provider",
      expiresAt: previewExp,
      nonce: previewNonce,
    });
    if (cachedPng) {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", cachedPng.length);
      res.setHeader("Content-Disposition", "inline");
      setProtectedPreviewHeaders(res);
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      return res.send(cachedPng);
    }
  }

  const [contractRow] = await db
    .select({
      id: contracts.id,
      providerContractCiphertext: contracts.providerContractCiphertext,
      providerContractIv: contracts.providerContractIv,
      providerContractAuthTag: contracts.providerContractAuthTag,
    })
    .from(contracts)
    .where(and(eq(contracts.id, parsedId.data), eq(contracts.userId, userId)))
    .limit(1);

  if (!contractRow) return res.status(404).json({ message: "Contrato não encontrado." });

  const c = contractRow as any;
  const ciphertext = c.providerContractCiphertext ?? null;
  const iv         = c.providerContractIv         ?? null;
  const authTag    = c.providerContractAuthTag     ?? null;

  if (!ciphertext || !iv || !authTag) {
    if (previewRequest) {
      setProtectedPreviewHeaders(res);
    } else {
      res.setHeader("Cache-Control", "no-store");
    }
    return res.status(204).end();
  }

  let cryptoBuffers: { ciphertext: Buffer; iv: Buffer; authTag: Buffer };
  try {
    cryptoBuffers = deserializeEncryptedSignature({ ciphertextB64: ciphertext, ivB64: iv, authTagB64: authTag });
  } catch {
    if (previewRequest) {
      setProtectedPreviewHeaders(res);
      return res.status(204).end();
    }
    return res.status(500).json({ message: "Dados de assinatura corrompidos." });
  }

  let pngBuffer: Buffer;
  try {
    pngBuffer = decryptSignature(cryptoBuffers, {
      proposalId:     parsedId.data,
      signerName:     `provider:${userId}`,
      signerDocument: `uid-${String(userId).padStart(5, '0')}`,
    });
  } catch {
    if (previewRequest) {
      setProtectedPreviewHeaders(res);
      return res.status(204).end();
    }
    return res.status(422).json({ message: "Assinatura não pôde ser verificada." });
  }

  if (previewRequest) {
    const { previewExp, previewNonce, previewToken } = getPreviewQueryTuple(req);
    setContractSignaturePreviewImageCache({
      token: previewToken,
      contractId: parsedId.data,
      userId,
      kind: "provider",
      expiresAt: previewExp,
      nonce: previewNonce,
      pngBuffer,
    });
  }

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", pngBuffer.length);
  res.setHeader("Content-Disposition", "inline");
  setProtectedPreviewHeaders(res);
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  return res.send(pngBuffer);
});

/*
|--------------------------------------------------------------------------
| GENERATE SHARE LINK
| POST /api/contracts/:id/share-link
|--------------------------------------------------------------------------
*/

router.post("/:id/share-link", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const parsedBody = shareLinkSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({
      message: "Dados inválidos.",
      errors: parsedBody.error.flatten(),
    });
  }

  const contract = await contractService.getContract(parsedId.data, userId);
  if (!contract) return res.status(404).json({ message: "Contrato não encontrado." });

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + parsedBody.data.expiresInHours * 60 * 60 * 1000);

  await contractService.setContractShareToken(parsedId.data, userId, tokenHash, expiresAt);
  setPublicNoCache(res);

  return res.status(201).json({
    shareToken: rawToken,
    expiresAt,
    publicUrl: buildPublicContractUrl(rawToken),
    publicUrlPath: `/c/${rawToken}`,
  });
});

/*
|--------------------------------------------------------------------------
| CONFIRM MANUAL PAYMENT (PIX)
| POST /api/contracts/:id/mark-paid
|--------------------------------------------------------------------------
*/

router.post(
  "/:id/mark-paid",
  requireStepUp("contracts.mark-paid", (req) => ({ contractId: req.params.id, ...(req.body ?? {}) })),
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Não autenticado." });

    const parsedId = contractIdSchema.safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

    const parsedBody = markPaidSchema.safeParse(req.body ?? {});
    if (!parsedBody.success)
      return res.status(400).json({ message: "Dados inválidos.", errors: parsedBody.error.flatten() });

    const contract = await contractService.getContract(parsedId.data, userId);
    if (!contract) return res.status(404).json({ message: "Contrato não encontrado." });

    const c = contract as any;

    if (!c.signedAt)
      return res.status(409).json({ message: "O contrato precisa estar assinado antes de confirmar pagamento." });

    if (c.lifecycleStatus === "PAID")
      return res.status(200).json({ ok: true, message: "Pagamento já confirmado." });

    if (c.lifecycleStatus === "CANCELLED")
      return res.status(409).json({ message: "Contrato cancelado. Não é possível confirmar pagamento." });

    const updated = await contractService.markContractPaid(parsedId.data, userId, {
      note:          parsedBody.data.note,
      payerName:     parsedBody.data.payerName,
      payerDocument: parsedBody.data.payerDocument,
    });
    if (!updated) return res.status(404).json({ message: "Contrato não encontrado." });

    return res.status(201).json({ ok: true, contractId: parsedId.data });
  }
);

/*
|--------------------------------------------------------------------------
| CANCEL CONTRACT
| PATCH /api/contracts/:id/cancel
|--------------------------------------------------------------------------
*/

router.patch("/:id/cancel", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const contract = await contractService.getContract(parsedId.data, userId);
  if (!contract) return res.status(404).json({ message: "Contrato não encontrado." });

  const cc = contract as any;

  if (cc.lifecycleStatus === "PAID")
    return res.status(409).json({ message: "Não é possível cancelar um contrato já pago." });

  if (cc.lifecycleStatus === "CANCELLED" || cc.status === "cancelled" || cc.status === "cancelado")
    return res.status(409).json({ message: "Este contrato já está cancelado." });

  const updated = await contractService.cancelContract(parsedId.data, userId);
  if (!updated) return res.status(404).json({ message: "Contrato não encontrado." });

  return res.json({ ok: true, contractId: parsedId.data });
});

export default router;
