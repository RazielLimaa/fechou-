import { rateLimit } from 'express-rate-limit';
import type { NextFunction, Request, Response } from 'express';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const MAX_BODY_DEPTH   = 8;
const MAX_ARRAY_LENGTH = 200;
const FORBIDDEN_KEYS   = new Set(['__proto__', 'constructor', 'prototype']);

// Campos de texto livre que permitem HTML/markdown (NÃO escapar, apenas sanitizar)
const RICH_TEXT_FIELDS = new Set([
  'service_scope',
  'custom_content',
  'description',
  'base_content',
  'content',
]);

const RAW_DATA_URL_FIELDS = new Set([
  'avatarUrl',
  'signatureDataUrl',
]);

const STRICT_VALIDATION_FIELDS = new Set([
  'signerName',
  'signerDocument',
]);

// ─────────────────────────────────────────────────────────────────────────────
// HTML STRIP
// ─────────────────────────────────────────────────────────────────────────────

function stripHtmlTags(str: string): string {
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/data\s*:/gi, '')
    .replace(/on\w+\s*=/gi, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// SANITIZE OBJECT
// ─────────────────────────────────────────────────────────────────────────────

function sanitizeObject(
  value: unknown,
  depth = 0,
  fieldName?: string
): unknown {
  if (depth > MAX_BODY_DEPTH) return undefined;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (fieldName && RAW_DATA_URL_FIELDS.has(fieldName) && trimmed.startsWith('data:image/')) {
      return trimmed;
    }
    if (fieldName && STRICT_VALIDATION_FIELDS.has(fieldName)) {
      return trimmed;
    }
    if (fieldName && RICH_TEXT_FIELDS.has(fieldName)) {
      return trimmed
        .replace(/javascript\s*:/gi, '')
        .replace(/data\s*:/gi, '')
        .replace(/on\w+\s*=/gi, '');
    }
    return stripHtmlTags(trimmed);
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((item) => sanitizeObject(item, depth + 1, fieldName));
  }

  if (value && typeof value === 'object') {
    const sanitizedEntries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !FORBIDDEN_KEYS.has(key))
      .map(([key, nestedValue]) => [
        key,
        sanitizeObject(nestedValue, depth + 1, key),
      ]);

    return Object.fromEntries(sanitizedEntries);
  }

  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE — sanitize request body
// ─────────────────────────────────────────────────────────────────────────────

export function sanitizeRequestBody(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  if (req.originalUrl.startsWith('/api/payments/webhook')) return next();
  if (req.originalUrl.startsWith('/api/webhooks/mercadopago')) return next();
  if (Buffer.isBuffer(req.body)) return next();

  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }

  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE — iframe XSS protection
// ─────────────────────────────────────────────────────────────────────────────

export function contractRenderHeaders(
  _req: Request,
  res: Response,
  next: NextFunction
) {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'none';"
  );
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE — upload rate limiter
// ─────────────────────────────────────────────────────────────────────────────

export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_UPLOAD_MAX ?? 60),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    return (req as any).user?.id?.toString() ?? req.ip ?? 'unknown';
  },
  message: {
    message: 'Limite de uploads atingido. Tente novamente em 1 hora.',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE — contract creation rate limiter
// ─────────────────────────────────────────────────────────────────────────────

export const contractCreationRateLimiter = rateLimit({
  windowMs: 120 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_CONTRACT_MAX ?? 200),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    return (req as any).user?.id?.toString() ?? req.ip ?? 'unknown';
  },
  message: {
    message: 'Muitos contratos criados. Tente novamente em 1 hora.',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// RATE LIMITERS
// ─────────────────────────────────────────────────────────────────────────────

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000);

export const authRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: Number(process.env.RATE_LIMIT_AUTH_MAX ?? 150),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  message: {
    message: 'Muitas tentativas de autenticação. Aguarde e tente novamente.',
  },
});

export const apiRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: Number(process.env.RATE_LIMIT_API_MAX ?? 5000),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    if (req.method === 'OPTIONS') return true;
    if (req.originalUrl.startsWith('/api/payments/webhook')) return true;

    // Em desenvolvimento, evita 429 ruidoso em bootstrap do frontend
    // (csrf/me/login/google costumam ser chamados em sequência por HMR/retries).
    if (process.env.NODE_ENV !== 'production' && req.originalUrl.startsWith('/api/auth/')) {
      return true;
    }

    return false;
  },
  message: {
    message: 'Muitas requisições. Tente novamente em instantes.',
  },
});

export const sensitiveRateLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_SENSITIVE_WINDOW_MS ?? 10 * 60 * 1000),
  max: Number(process.env.RATE_LIMIT_SENSITIVE_MAX ?? 400),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  message: {
    message: 'Muitas tentativas em rota sensível. Tente novamente em alguns minutos.',
  },
});

export const webhookRateLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WEBHOOK_WINDOW_MS ?? 60 * 1000),
  max: Number(process.env.RATE_LIMIT_WEBHOOK_MAX ?? 300),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Muitas notificações recebidas temporariamente.',
  },
});
