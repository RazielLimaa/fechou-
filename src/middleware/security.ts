import { rateLimit } from 'express-rate-limit';
import type { NextFunction, Request, Response } from 'express';

const MAX_BODY_DEPTH = 8;
const MAX_ARRAY_LENGTH = 200;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function sanitizeObject(value: unknown, depth = 0): unknown {
  if (depth > MAX_BODY_DEPTH) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeObject(item, depth + 1));
  }

  if (value && typeof value === 'object') {
    const sanitizedEntries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !FORBIDDEN_KEYS.has(key))
      .map(([key, nestedValue]) => [key, sanitizeObject(nestedValue, depth + 1)]);

    return Object.fromEntries(sanitizedEntries);
  }

  return value;
}

export function sanitizeRequestBody(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }

  next();
}

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000);

export const authRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: Number(process.env.RATE_LIMIT_AUTH_MAX ?? 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Muitas tentativas de autenticação. Aguarde e tente novamente.'
  }
});

export const apiRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: Number(process.env.RATE_LIMIT_API_MAX ?? 200),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Muitas requisições. Tente novamente em instantes.'
  }
});
