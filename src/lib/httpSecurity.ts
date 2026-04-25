import crypto from "node:crypto";

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function defaultPortForProtocol(protocol: string): string {
  if (protocol === "https:") return "443";
  if (protocol === "http:") return "80";
  return "";
}

function isAllowedHttpUrl(url: URL): boolean {
  return url.protocol === "https:" || (
    process.env.NODE_ENV !== "production" &&
    url.protocol === "http:" &&
    isLoopbackHost(url.hostname)
  );
}

function parseConfiguredUrl(raw: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} inválida.`);
  }

  if (!isAllowedHttpUrl(url)) {
    throw new Error(`${label} deve usar HTTPS em produção.`);
  }

  return url;
}

function normalizeOriginForComparison(url: URL): string {
  const port = url.port || defaultPortForProtocol(url.protocol);

  if (process.env.NODE_ENV !== "production" && isLoopbackHost(url.hostname)) {
    return `${url.protocol}//loopback:${port}`;
  }

  return `${url.protocol}//${url.hostname}:${port}`;
}

function getTrustedFrontendUrl(): URL {
  const raw = String(process.env.FRONTEND_URL ?? "").trim();
  if (!raw) {
    throw new Error("FRONTEND_URL não configurado.");
  }

  return parseConfiguredUrl(raw, "FRONTEND_URL");
}

export function getTrustedFrontendOrigin(): string {
  return getTrustedFrontendUrl().origin;
}

export function resolveTrustedFrontendOrigin(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;

  let candidate: URL;
  try {
    candidate = parseConfiguredUrl(value, "Origin");
  } catch {
    return null;
  }

  if (
    normalizeOriginForComparison(candidate) !==
    normalizeOriginForComparison(getTrustedFrontendUrl())
  ) {
    return null;
  }

  return candidate.origin;
}

export function buildTrustedFrontendUrl(path: string, preferredOrigin?: string | null): string {
  const normalizedPath = `/${String(path ?? "").replace(/^\/+/, "")}`;
  const trustedOrigin = resolveTrustedFrontendOrigin(preferredOrigin) ?? getTrustedFrontendOrigin();
  return `${trustedOrigin}${normalizedPath}`;
}

export function isTrustedOriginAllowed(originRaw: string, allowedOrigins: readonly string[]): boolean {
  let candidate: URL;
  try {
    candidate = parseConfiguredUrl(String(originRaw ?? "").trim(), "Origin");
  } catch {
    return false;
  }

  const normalizedCandidate = normalizeOriginForComparison(candidate);

  return allowedOrigins.some((allowedOrigin) => {
    try {
      const allowedUrl = parseConfiguredUrl(String(allowedOrigin ?? "").trim(), "allowed origin");
      return normalizeOriginForComparison(allowedUrl) === normalizedCandidate;
    } catch {
      return false;
    }
  });
}

export function ensureTrustedFrontendRedirectUrl(raw: string): string {
  const frontendUrl = getTrustedFrontendUrl();
  const url = parseConfiguredUrl(String(raw ?? "").trim(), "URL de retorno");

  if (normalizeOriginForComparison(url) !== normalizeOriginForComparison(frontendUrl)) {
    throw new Error("URL de retorno não permitida.");
  }

  return url.toString();
}

export function getPublicAppBaseUrl(): string {
  const explicit = String(process.env.APP_URL ?? "").trim();
  if (explicit) {
    return parseConfiguredUrl(explicit, "APP_URL").origin;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_URL é obrigatório em produção.");
  }

  const port = Number(process.env.PORT ?? 3001);
  return `http://localhost:${Number.isFinite(port) && port > 0 ? port : 3001}`;
}

export function normalizeHexToken(raw: unknown, expectedLength = 64): string | null {
  const token = String(raw ?? "").trim().toLowerCase();
  if (token.length !== expectedLength) return null;
  if (!/^[a-f0-9]+$/i.test(token)) return null;
  return token;
}

export function timingSafeEqualText(a: string, b: string): boolean {
  const left = Buffer.from(String(a ?? ""), "utf8");
  const right = Buffer.from(String(b ?? ""), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function sha256Text(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}
