import crypto from "node:crypto";
import { getMasterKey, safeEqualHex } from "./signatureCrypto.js";

export type ContractSignaturePreviewKind = "client" | "provider";

const PREVIEW_CONTEXT = "contract-signature-preview:v1";
const DEFAULT_MAX_TTL_MS = 5 * 60 * 1000; // FIX: 5min — dá tempo pro iframe renderizar e fazer o fetch
const MIN_NONCE_LENGTH = 16;
const MAX_NONCE_LENGTH = 64;
const PREVIEW_IMAGE_CACHE_MAX_ITEMS = Number(process.env.CONTRACT_PREVIEW_IMAGE_CACHE_MAX_ITEMS ?? 400);
const PREVIEW_AUTH_ASSET_CACHE_MAX_ITEMS = Number(process.env.CONTRACT_PREVIEW_AUTH_ASSET_CACHE_MAX_ITEMS ?? 400);

type PreviewImageCacheEntry = {
  token: string;
  contractId: number;
  userId: number;
  kind: ContractSignaturePreviewKind;
  expiresAt: number;
  nonce: string;
  pngBuffer: Buffer;
  createdAt: number;
};

export type PreviewAuthenticatedAssetCacheEntry = {
  token: string;
  contractId: number;
  userId: number;
  kind: ContractSignaturePreviewKind;
  expiresAt: number;
  pngBuffer: Buffer;
  createdAt: number;
};

const previewImageCache = new Map<string, PreviewImageCacheEntry>();
const previewAuthenticatedAssetCache = new Map<string, PreviewAuthenticatedAssetCacheEntry>();

function getPreviewMacKey() {
  return crypto.createHmac("sha256", getMasterKey()).update(PREVIEW_CONTEXT).digest();
}

function normalizePositiveInt(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeNonce(value: unknown) {
  const nonce = String(value ?? "").trim().toLowerCase();
  if (nonce.length < MIN_NONCE_LENGTH || nonce.length > MAX_NONCE_LENGTH) return null;
  if (!/^[a-f0-9]+$/i.test(nonce)) return null;
  return nonce;
}

function normalizeToken(value: unknown) {
  const token = String(value ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/i.test(token)) return null;
  return token;
}

function createOpaquePreviewToken() {
  return crypto.randomBytes(32).toString("hex");
}

function cleanupPreviewImageCache(nowMs = Date.now()) {
  for (const [key, entry] of previewImageCache.entries()) {
    if (entry.expiresAt < nowMs) {
      previewImageCache.delete(key);
    }
  }

  if (previewImageCache.size <= PREVIEW_IMAGE_CACHE_MAX_ITEMS) return;

  const ordered = Array.from(previewImageCache.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt);
  const overflow = previewImageCache.size - PREVIEW_IMAGE_CACHE_MAX_ITEMS;
  for (let i = 0; i < overflow; i += 1) {
    const victim = ordered[i];
    if (victim) previewImageCache.delete(victim[0]);
  }
}

function cleanupPreviewAuthenticatedAssetCache(nowMs = Date.now()) {
  for (const [key, entry] of previewAuthenticatedAssetCache.entries()) {
    if (entry.expiresAt < nowMs) {
      previewAuthenticatedAssetCache.delete(key);
    }
  }

  if (previewAuthenticatedAssetCache.size <= PREVIEW_AUTH_ASSET_CACHE_MAX_ITEMS) return;

  const ordered = Array.from(previewAuthenticatedAssetCache.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt);
  const overflow = previewAuthenticatedAssetCache.size - PREVIEW_AUTH_ASSET_CACHE_MAX_ITEMS;
  for (let i = 0; i < overflow; i += 1) {
    const victim = ordered[i];
    if (victim) previewAuthenticatedAssetCache.delete(victim[0]);
  }
}

function buildPayload(input: {
  contractId: number;
  userId: number;
  kind: ContractSignaturePreviewKind;
  expiresAt: number;
  nonce: string;
}) {
  return [
    PREVIEW_CONTEXT,
    `contract:${input.contractId}`,
    `user:${input.userId}`,
    `kind:${input.kind}`,
    `exp:${input.expiresAt}`,
    `nonce:${input.nonce}`,
  ].join("|");
}

export function createContractSignaturePreviewToken(input: {
  contractId: number;
  userId: number;
  kind: ContractSignaturePreviewKind;
  expiresAt: number;
  nonce: string;
}) {
  const contractId = normalizePositiveInt(input.contractId);
  const userId = normalizePositiveInt(input.userId);
  const nonce = normalizeNonce(input.nonce);
  const expiresAt = normalizePositiveInt(input.expiresAt);

  if (!contractId || !userId || !nonce || !expiresAt) {
    throw new Error("Parâmetros inválidos para token de preview da assinatura.");
  }

  const payload = buildPayload({
    contractId,
    userId,
    kind: input.kind,
    expiresAt,
    nonce,
  });

  return crypto.createHmac("sha256", getPreviewMacKey()).update(payload).digest("hex");
}

export function verifyContractSignaturePreviewToken(input: {
  contractId: number;
  userId: number;
  kind: ContractSignaturePreviewKind;
  expiresAt: number;
  nonce: string;
  token: string;
  nowMs?: number;
}) {
  const contractId = normalizePositiveInt(input.contractId);
  const userId = normalizePositiveInt(input.userId);
  const nonce = normalizeNonce(input.nonce);
  const token = normalizeToken(input.token);
  const expiresAt = normalizePositiveInt(input.expiresAt);
  const nowMs = normalizePositiveInt(input.nowMs ?? Date.now()) ?? Date.now() ;
  const maxTtlMs = Number(process.env.CONTRACT_PREVIEW_SIGNATURE_MAX_TTL_MS ?? DEFAULT_MAX_TTL_MS);

  if (!contractId || !userId || !nonce || !token || !expiresAt) {
    return false;
  }

  if (input.kind !== "client" && input.kind !== "provider") {
    return false;
  }

  // FIX 1: token expirado — mantém a pequena folga de 5s para clock skew
  if (expiresAt < nowMs - 5_000) {
    return false;
  }

  // FIX 2: a checagem original `expiresAt - nowMs > maxTtlMs` rejeitava tokens
  // legítimos porque o renderContract gerava expiresAt = now + TTL e o iframe
  // demorava alguns ms/segundos para fazer o fetch das imagens, fazendo
  // expiresAt - nowMs ficar exatamente igual (ou levemente acima por rounding)
  // ao maxTtlMs configurado.
  //
  // Solução: adicionar uma folga generosa (30s) para absorver o tempo de
  // renderização do iframe + latência de rede local.
  const ISSUANCE_GRACE_MS = 30_000;
  if (expiresAt - nowMs > maxTtlMs + ISSUANCE_GRACE_MS) {
    return false;
  }

  const expected = createContractSignaturePreviewToken({
    contractId,
    userId,
    kind: input.kind,
    expiresAt,
    nonce,
  });

  return safeEqualHex(expected, token);
}

export function buildContractSignaturePreviewPath(input: {
  contractId: number;
  kind: ContractSignaturePreviewKind;
  expiresAt: number;
  nonce: string;
  token: string;
}) {
  const path =
    input.kind === "client"
      ? `/api/contracts/${input.contractId}/signature`
      : `/api/contracts/${input.contractId}/provider-signature`;

  const params = new URLSearchParams({
    preview: "1",
    preview_exp: String(input.expiresAt),
    preview_nonce: input.nonce,
    preview_token: input.token,
  });

  return `${path}?${params.toString()}`;
}

export function buildAuthenticatedContractSignaturePreviewAssetPath(token: string) {
  const normalizedToken = normalizeToken(token);
  if (!normalizedToken) {
    throw new Error("Token de preview autenticado invalido.");
  }

  return `/api/contracts/preview-assets/${normalizedToken}`;
}

export function createContractSignaturePreviewAsset(input: {
  contractId: number;
  userId: number;
  kind: ContractSignaturePreviewKind;
  expiresAt: number;
  nonce: string;
}) {
  const token = createContractSignaturePreviewToken(input);

  return {
    previewToken: token,
    previewUrl: buildContractSignaturePreviewPath({
      contractId: input.contractId,
      kind: input.kind,
      expiresAt: input.expiresAt,
      nonce: input.nonce,
      token,
    }),
    verificationCode: token.slice(0, 12).toUpperCase(),
  };
}

export function setAuthenticatedContractSignaturePreviewAssetCache(input: {
  token: string;
  contractId: number;
  userId: number;
  kind: ContractSignaturePreviewKind;
  expiresAt: number;
  pngBuffer: Buffer;
}) {
  const token = normalizeToken(input.token);
  const contractId = normalizePositiveInt(input.contractId);
  const userId = normalizePositiveInt(input.userId);
  const expiresAt = normalizePositiveInt(input.expiresAt);

  if (!token || !contractId || !userId || !expiresAt) return false;
  if (input.kind !== "client" && input.kind !== "provider") return false;
  if (!Buffer.isBuffer(input.pngBuffer) || input.pngBuffer.length === 0) return false;

  cleanupPreviewAuthenticatedAssetCache();
  previewAuthenticatedAssetCache.set(token, {
    token,
    contractId,
    userId,
    kind: input.kind,
    expiresAt,
    pngBuffer: input.pngBuffer,
    createdAt: Date.now(),
  });
  cleanupPreviewAuthenticatedAssetCache();
  return true;
}

export function createAuthenticatedContractSignaturePreviewAsset(input: {
  contractId: number;
  userId: number;
  kind: ContractSignaturePreviewKind;
  expiresAt: number;
  pngBuffer: Buffer;
}) {
  const token = createOpaquePreviewToken();
  const stored = setAuthenticatedContractSignaturePreviewAssetCache({
    token,
    contractId: input.contractId,
    userId: input.userId,
    kind: input.kind,
    expiresAt: input.expiresAt,
    pngBuffer: input.pngBuffer,
  });

  if (!stored) {
    throw new Error("Nao foi possivel preparar asset autenticado de preview.");
  }

  return {
    previewToken: token,
    previewUrl: buildAuthenticatedContractSignaturePreviewAssetPath(token),
    verificationCode: token.slice(0, 12).toUpperCase(),
  };
}

export function setContractSignaturePreviewImageCache(input: {
  token: string;
  contractId: number;
  userId: number;
  kind: ContractSignaturePreviewKind;
  expiresAt: number;
  nonce: string;
  pngBuffer: Buffer;
}) {
  const token = normalizeToken(input.token);
  const contractId = normalizePositiveInt(input.contractId);
  const userId = normalizePositiveInt(input.userId);
  const nonce = normalizeNonce(input.nonce);
  const expiresAt = normalizePositiveInt(input.expiresAt);

  if (!token || !contractId || !userId || !nonce || !expiresAt) return false;
  if (input.kind !== "client" && input.kind !== "provider") return false;
  if (!Buffer.isBuffer(input.pngBuffer) || input.pngBuffer.length === 0) return false;

  cleanupPreviewImageCache();
  previewImageCache.set(token, {
    token,
    contractId,
    userId,
    kind: input.kind,
    expiresAt,
    nonce,
    pngBuffer: input.pngBuffer,
    createdAt: Date.now(),
  });
  cleanupPreviewImageCache();
  return true;
}

export function getContractSignaturePreviewImageCache(input: {
  token: string;
  contractId: number;
  userId: number;
  kind: ContractSignaturePreviewKind;
  expiresAt: number;
  nonce: string;
  nowMs?: number;
}) {
  const token = normalizeToken(input.token);
  const contractId = normalizePositiveInt(input.contractId);
  const userId = normalizePositiveInt(input.userId);
  const nonce = normalizeNonce(input.nonce);
  const expiresAt = normalizePositiveInt(input.expiresAt);
  const nowMs = normalizePositiveInt(input.nowMs ?? Date.now()) ?? Date.now();

  if (!token || !contractId || !userId || !nonce || !expiresAt) return null;
  cleanupPreviewImageCache(nowMs);

  const cached = previewImageCache.get(token);
  if (!cached) return null;
  if (cached.contractId !== contractId) return null;
  if (cached.userId !== userId) return null;
  if (cached.kind !== input.kind) return null;
  if (cached.nonce !== nonce) return null;
  if (cached.expiresAt !== expiresAt) return null;
  if (cached.expiresAt < nowMs) {
    previewImageCache.delete(token);
    return null;
  }

  return cached.pngBuffer;
}

export function getAuthenticatedContractSignaturePreviewAsset(tokenInput: string, nowMsInput?: number) {
  const token = normalizeToken(tokenInput);
  const nowMs = normalizePositiveInt(nowMsInput ?? Date.now()) ?? Date.now();
  if (!token) return null;

  cleanupPreviewAuthenticatedAssetCache(nowMs);

  const cached = previewAuthenticatedAssetCache.get(token);
  if (!cached) return null;
  if (cached.expiresAt < nowMs) {
    previewAuthenticatedAssetCache.delete(token);
    return null;
  }

  return cached;
}
