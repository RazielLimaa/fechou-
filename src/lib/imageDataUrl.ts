const ALLOWED_IMAGE_MIMETYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

const MAGIC_BYTES: Array<{
  mime: string;
  offset: number;
  bytes: number[];
}> = [
  { mime: "image/jpeg", offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/webp", offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
];

function hasValidMagicBytes(buffer: Buffer, mime: string): boolean {
  const entry = MAGIC_BYTES.find((item) => item.mime === mime);
  if (!entry) return false;

  for (let i = 0; i < entry.bytes.length; i++) {
    if (buffer[entry.offset + i] !== entry.bytes[i]) return false;
  }

  if (mime === "image/webp") {
    const webp = [0x57, 0x45, 0x42, 0x50];
    for (let i = 0; i < webp.length; i++) {
      if (buffer[8 + i] !== webp[i]) return false;
    }
  }

  return true;
}

function isStrictBase64(input: string, decoded: Buffer): boolean {
  if (!/^[A-Za-z0-9+/=]+$/.test(input)) return false;
  return decoded.toString("base64").replace(/=+$/g, "") === input.replace(/=+$/g, "");
}

export function normalizeAndValidateImageDataUrl(
  raw: string,
  options?: {
    maxBytes?: number;
    fieldLabel?: string;
  }
): string {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  const fieldLabel = options?.fieldLabel ?? "Imagem";
  const input = raw.trim();

  const match = input.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) {
    throw new Error(`${fieldLabel} inválida. Use PNG, JPEG ou WebP em base64.`);
  }

  const mime = match[1].toLowerCase();
  const base64 = match[2];

  if (!ALLOWED_IMAGE_MIMETYPES.has(mime)) {
    throw new Error(`${fieldLabel} inválida. Tipo não permitido.`);
  }

  const buffer = Buffer.from(base64, "base64");

  if (!buffer.length || !isStrictBase64(base64, buffer)) {
    throw new Error(`${fieldLabel} inválida. Conteúdo base64 corrompido.`);
  }

  if (buffer.length < 100) {
    throw new Error(`${fieldLabel} inválida. Arquivo muito pequeno ou corrompido.`);
  }

  if (buffer.length > maxBytes) {
    throw new Error(`${fieldLabel} muito grande. Limite: ${Math.floor(maxBytes / (1024 * 1024))} MB.`);
  }

  if (!hasValidMagicBytes(buffer, mime)) {
    throw new Error(`${fieldLabel} inválida. O conteúdo não corresponde ao tipo declarado.`);
  }

  return `data:${mime};base64,${buffer.toString("base64")}`;
}

export function normalizeProfileAvatarInput(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") {
    throw new Error("Avatar inválido.");
  }

  const input = raw.trim();
  if (!input) return null;

  if (input.startsWith("data:")) {
    return normalizeAndValidateImageDataUrl(input, {
      maxBytes: 5 * 1024 * 1024,
      fieldLabel: "Imagem de perfil",
    });
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Avatar inválido. Use uma URL HTTPS ou uma imagem PNG, JPEG ou WebP.");
  }

  const isLocalHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");

  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new Error("Avatar inválido. URLs de imagem devem usar HTTPS.");
  }

  return url.toString();
}
