import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

const MAX_SIGNATURE_BINARY_SIZE = 1_000_000;
const MAX_SIGNATURE_DATA_URL_LENGTH = 2_500_000;
const EXPECTED_MIME_TYPE = "image/png";
const KEY_VERSION = "v1";

export interface SignatureAadContext {
  proposalId: number | string;
  signerName: string;
  signerDocument: string;
}

export interface EncryptedSignature {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: string;
  mimeType: typeof EXPECTED_MIME_TYPE;
  sha256: string;
}

export interface SerializedEncryptedSignature {
  ciphertextB64: string;
  ivB64: string;
  authTagB64: string;
  keyVersion: string;
  mimeType: typeof EXPECTED_MIME_TYPE;
  sha256: string;
}

export function sha256Hex(input: Buffer | string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const aBuf = Buffer.from(String(a), "utf8");
  const bBuf = Buffer.from(String(b), "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function getMasterKey(): Buffer {
  const raw = process.env.SIGNATURES_MASTER_KEY?.trim();
  if (!raw) throw new Error("SIGNATURES_MASTER_KEY não configurada.");

  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error("SIGNATURES_MASTER_KEY inválida.");
  }

  if (key.length !== KEY_LENGTH) {
    throw new Error("SIGNATURES_MASTER_KEY deve representar exatamente 32 bytes em base64.");
  }

  return key;
}

function normalizeAadText(value: string, maxLength: number): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

export function buildSignatureAad(context: SignatureAadContext): Buffer {
  const proposalId = String(context.proposalId).trim();
  const signerName = normalizeAadText(context.signerName, 140);
  const signerDocument = normalizeAadText(context.signerDocument, 40);

  if (!proposalId) throw new Error("proposalId é obrigatório para AAD.");
  if (signerName.length < 2) throw new Error("signerName inválido para AAD.");
  if (signerDocument.length < 5) throw new Error("signerDocument inválido para AAD.");

  const payload = [
    "sigctx:v1",
    `proposal:${proposalId}`,
    `name:${signerName}`,
    `document:${signerDocument}`,
  ].join("|");

  return Buffer.from(payload, "utf8");
}

export function assertPngSignature(buffer: Buffer): void {
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < pngMagic.length) {
    throw new Error("Arquivo PNG inválido ou truncado.");
  }
  const fileHeader = buffer.subarray(0, pngMagic.length);
  if (!crypto.timingSafeEqual(fileHeader, pngMagic)) {
    throw new Error("O conteúdo não corresponde a um PNG válido.");
  }
}

/**
 * Faz parsing defensivo do data URL.
 *
 * Segurança:
 * - Prefixo validado de forma estrita: só "data:image/png;base64,"
 * - Payload: remove apenas whitespace (\s) antes de validar
 *   (browsers inserem \n no base64 por RFC 2045 — é comportamento padrão e seguro)
 * - Após normalização: valida que só existem chars base64 válidos [A-Za-z0-9+/=]
 * - Adiciona padding se omitido (alguns browsers omitem o "=")
 * - Magic bytes PNG verificados no buffer decodificado
 */
export function parseSignatureDataUrl(dataUrl: string): {
  mimeType: typeof EXPECTED_MIME_TYPE;
  base64Payload: string;
} {
  const raw = String(dataUrl ?? "").trim();

  if (!raw) throw new Error("Assinatura não informada.");

  if (raw.length > MAX_SIGNATURE_DATA_URL_LENGTH) {
    throw new Error("Assinatura excede o tamanho máximo permitido.");
  }

  // Encontra a vírgula que separa header do payload
  const commaIdx = raw.indexOf(",");
  if (commaIdx === -1) {
    throw new Error("Formato de assinatura inválido. Use apenas PNG em base64.");
  }

  // Valida o header de forma estrita
  const header = raw.substring(0, commaIdx);
  if (header !== "data:image/png;base64") {
    throw new Error("Formato de assinatura inválido. Use apenas PNG em base64.");
  }

  // Extrai payload e remove apenas whitespace (espaço, \t, \r, \n)
  // Qualquer outro caractere fora do alfabeto base64 é rejeitado abaixo
  const base64Payload = raw.substring(commaIdx + 1).replace(/\s/g, "");

  if (!base64Payload) {
    throw new Error("Payload da assinatura está vazio.");
  }

  // Valida que só existem caracteres base64 válidos (sem padding ainda)
  if (!/^[A-Za-z0-9+/]+=*$/.test(base64Payload)) {
    throw new Error("Payload da assinatura contém caracteres inválidos.");
  }

  // Corrige padding se necessário (alguns browsers omitem o "=")
  const remainder = base64Payload.length % 4;
  const padded = remainder === 0
    ? base64Payload
    : base64Payload + "=".repeat(4 - remainder);

  return { mimeType: EXPECTED_MIME_TYPE, base64Payload: padded };
}

export function extractPngBufferFromDataUrl(dataUrl: string): Buffer {
  const { base64Payload } = parseSignatureDataUrl(dataUrl);

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Payload, "base64");
  } catch {
    throw new Error("Não foi possível decodificar a assinatura em base64.");
  }

  if (!buffer.length) throw new Error("Assinatura vazia.");

  if (buffer.length > MAX_SIGNATURE_BINARY_SIZE) {
    throw new Error("Assinatura excede o tamanho máximo permitido.");
  }

  // Verifica magic bytes PNG — garante que o conteúdo é realmente PNG
  assertPngSignature(buffer);

  return buffer;
}

export function fingerprintSignature(buffer: Buffer): string {
  return sha256Hex(buffer);
}

export function encryptSignature(
  signatureBuffer: Buffer,
  context: SignatureAadContext
): EncryptedSignature {
  if (!Buffer.isBuffer(signatureBuffer)) throw new Error("signatureBuffer deve ser um Buffer.");
  if (!signatureBuffer.length) throw new Error("signatureBuffer vazio.");
  if (signatureBuffer.length > MAX_SIGNATURE_BINARY_SIZE) {
    throw new Error("signatureBuffer excede o tamanho permitido.");
  }

  assertPngSignature(signatureBuffer);

  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const aad = buildSignatureAad(context);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  cipher.setAAD(aad);

  const ciphertext = Buffer.concat([
    cipher.update(signatureBuffer),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Auth tag inválida gerada na criptografia.");
  }

  return {
    ciphertext,
    iv,
    authTag,
    keyVersion: KEY_VERSION,
    mimeType: EXPECTED_MIME_TYPE,
    sha256: fingerprintSignature(signatureBuffer),
  };
}

export function decryptSignature(
  input: {
    ciphertext: Buffer;
    iv: Buffer;
    authTag: Buffer;
  },
  context: SignatureAadContext
): Buffer {
  if (!Buffer.isBuffer(input.ciphertext) || input.ciphertext.length === 0) {
    throw new Error("Ciphertext inválido.");
  }
  if (!Buffer.isBuffer(input.iv) || input.iv.length !== IV_LENGTH) {
    throw new Error("IV inválido.");
  }
  if (!Buffer.isBuffer(input.authTag) || input.authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Auth tag inválida.");
  }

  const key = getMasterKey();
  const aad = buildSignatureAad(context);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, input.iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  decipher.setAAD(aad);
  decipher.setAuthTag(input.authTag);

  const plaintext = Buffer.concat([
    decipher.update(input.ciphertext),
    decipher.final(),
  ]);

  if (!plaintext.length) throw new Error("Falha ao descriptografar assinatura.");

  assertPngSignature(plaintext);

  return plaintext;
}

export function serializeEncryptedSignature(
  input: EncryptedSignature
): SerializedEncryptedSignature {
  return {
    ciphertextB64: input.ciphertext.toString("base64"),
    ivB64: input.iv.toString("base64"),
    authTagB64: input.authTag.toString("base64"),
    keyVersion: input.keyVersion,
    mimeType: input.mimeType,
    sha256: input.sha256,
  };
}

export function deserializeEncryptedSignature(input: {
  ciphertextB64: string;
  ivB64: string;
  authTagB64: string;
}) {
  const ciphertext = Buffer.from(String(input.ciphertextB64 ?? ""), "base64");
  const iv = Buffer.from(String(input.ivB64 ?? ""), "base64");
  const authTag = Buffer.from(String(input.authTagB64 ?? ""), "base64");

  if (!ciphertext.length) throw new Error("Ciphertext serializado inválido.");
  if (iv.length !== IV_LENGTH) throw new Error("IV serializado inválido.");
  if (authTag.length !== AUTH_TAG_LENGTH) throw new Error("Auth tag serializada inválida.");

  return { ciphertext, iv, authTag };
}

export function encryptSignatureFromDataUrl(
  dataUrl: string,
  context: SignatureAadContext
): EncryptedSignature {
  const buffer = extractPngBufferFromDataUrl(dataUrl);
  return encryptSignature(buffer, context);
}

export function generateBase64MasterKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString("base64");
}