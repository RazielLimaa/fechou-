/**
 * FECHOU! — Middleware de upload seguro de logo
 * ═══════════════════════════════════════════════
 * Camadas de segurança (em ordem de execução):
 *
 *  1. Multer: limita tamanho (2 MB) e armazena em memória (nunca toca o disco)
 *  2. validateLogoUpload: valida mimetype declarado, extensão e magic bytes reais
 *     do buffer — impedindo que arquivos mascarados (ex: shell.php.png) passem
 *  3. O base64 resultante é salvo no banco como texto — sem path traversal possível
 */

import multer from "multer";
import type { Request, Response, NextFunction } from "express";

// ─── Constantes ───────────────────────────────────────────────────────────────

const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

/** Mimetypes aceitos — nada além disso entra */
const ALLOWED_MIMETYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Extensões permitidas por mimetype */
const MIME_TO_EXTENSIONS: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png":  [".png"],
  "image/webp": [".webp"],
};

/**
 * Magic bytes de cada formato.
 * Verificamos os primeiros N bytes do buffer real —
 * não confiamos no mimetype nem na extensão declarados pelo cliente.
 */
const MAGIC_BYTES: Array<{
  mime: string;
  offset: number;
  bytes: number[];
}> = [
  // JPEG: FF D8 FF
  { mime: "image/jpeg", offset: 0, bytes: [0xff, 0xd8, 0xff] },
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  { mime: "image/png",  offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // WebP: RIFF????WEBP  (bytes 0-3 = RIFF, bytes 8-11 = WEBP)
  { mime: "image/webp", offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF
];

// ─── Multer (memória, sem disco) ──────────────────────────────────────────────

const storage = multer.memoryStorage();

const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  // Rejeita imediatamente se o mimetype declarado não for permitido
  if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
    return cb(new Error("INVALID_MIMETYPE"));
  }
  cb(null, true);
};

export const logoMulter = multer({
  storage,
  limits: {
    fileSize:  MAX_SIZE_BYTES,
    files:     1,        // apenas 1 arquivo por request
    fields:    0,        // nenhum campo extra além do arquivo
    fieldSize: 0,        // tamanho de campos de texto = 0 (não aceita)
  },
  fileFilter,
}).single("logo");

// ─── Validação pós-multer ─────────────────────────────────────────────────────

/**
 * Verifica se o buffer começa com os magic bytes esperados para o mime declarado.
 * Para WebP também checa os bytes 8-11 ("WEBP").
 */
function hasValidMagicBytes(buffer: Buffer, mime: string): boolean {
  const entry = MAGIC_BYTES.find(m => m.mime === mime);
  if (!entry) return false;

  // Checa sequência principal
  for (let i = 0; i < entry.bytes.length; i++) {
    if (buffer[entry.offset + i] !== entry.bytes[i]) return false;
  }

  // WebP precisa de check extra: bytes 8-11 devem ser "WEBP"
  if (mime === "image/webp") {
    const webp = [0x57, 0x45, 0x42, 0x50]; // "WEBP"
    for (let i = 0; i < 4; i++) {
      if (buffer[8 + i] !== webp[i]) return false;
    }
  }

  return true;
}

/**
 * Valida extensão do arquivo original contra o mimetype declarado.
 * Impede nomes como "malware.php.png" onde a extensão final é .png
 * mas há extensões adicionais perigosas antes.
 */
function hasValidExtension(originalname: string, mime: string): boolean {
  // Normaliza e pega TODAS as "extensões" do nome
  const lower = originalname.toLowerCase().trim();

  // Rejeita se o nome contiver extensões de executáveis, scripts ou arquivos perigosos
  const dangerousPatterns = [
    /\.(php|php\d?|phtml|phar|asp|aspx|jsp|cgi|pl|py|rb|sh|bash|exe|bat|cmd|msi|dll|so|elf|bin|jar|war|ear|svg)(\.|$)/i,
    /\.\./,       // path traversal
    /[/\\]/,      // separadores de path
    /[\x00-\x1f]/ // caracteres de controle
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(lower)) return false;
  }

  // Pega a extensão final
  const lastDot = lower.lastIndexOf(".");
  if (lastDot === -1) return false;
  const ext = lower.slice(lastDot);

  const allowed = MIME_TO_EXTENSIONS[mime];
  if (!allowed) return false;

  return allowed.includes(ext);
}

/**
 * Middleware que roda APÓS o multer.
 * Faz as validações profundas: magic bytes + extensão.
 */
export function validateLogoUpload(req: Request, res: Response, next: NextFunction) {
  const file = req.file;

  if (!file) {
    return res.status(400).json({ message: "Nenhum arquivo enviado." });
  }

  // 1. Mimetype declarado (já filtrado pelo multer, mas reconfirma)
  if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
    return res.status(422).json({ message: "Tipo de arquivo não permitido." });
  }

  // 2. Extensão do nome original
  if (!hasValidExtension(file.originalname, file.mimetype)) {
    return res.status(422).json({ message: "Nome ou extensão do arquivo inválidos." });
  }

  // 3. Magic bytes — verifica o conteúdo REAL do buffer
  if (!hasValidMagicBytes(file.buffer, file.mimetype)) {
    return res.status(422).json({
      message: "Conteúdo do arquivo não corresponde ao tipo declarado.",
    });
  }

  // 4. Tamanho mínimo — rejeita buffers trivialmente pequenos (< 100 bytes)
  if (file.buffer.length < 100) {
    return res.status(422).json({ message: "Arquivo muito pequeno ou corrompido." });
  }

  next();
}

/**
 * Wrapper que encapsula o multer + tratamento de erros dele.
 * Usar como middleware antes de validateLogoUpload.
 */
export function handleLogoMulter(req: Request, res: Response, next: NextFunction) {
  logoMulter(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ message: "Arquivo muito grande. Limite: 2 MB." });
      }
      if (err.code === "LIMIT_UNEXPECTED_FILE") {
        return res.status(400).json({ message: "Campo de arquivo inesperado." });
      }
      return res.status(400).json({ message: "Erro no upload do arquivo." });
    }

    if (err instanceof Error && err.message === "INVALID_MIMETYPE") {
      return res.status(422).json({ message: "Tipo de arquivo não permitido. Use JPEG, PNG ou WebP." });
    }

    next(err);
  });
}

/**
 * Converte o buffer do arquivo para data URL base64 seguro.
 * Usado para salvar no banco sem precisar de storage externo.
 */
export function bufferToDataUrl(file: Express.Multer.File): string {
  return `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
}
