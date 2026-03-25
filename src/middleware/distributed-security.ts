import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { checkDistributedRateLimit } from '../services/securityStore.js';

function getClientIp(req: Request) {
  return String(req.ip ?? req.headers['x-forwarded-for'] ?? 'unknown').split(',')[0].trim();
}

export function distributedRateLimit(options: {
  scope: string;
  limit: number;
  windowMs: number;
  key?: (req: Request) => string;
}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = options.key ? options.key(req) : getClientIp(req);

    const result = await checkDistributedRateLimit({
      scope: options.scope,
      key,
      limit: options.limit,
      windowMs: options.windowMs,
    });

    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSec));
      return res.status(429).json({ message: 'Muitas requisições. Tente novamente em alguns instantes.' });
    }

    next();
  };
}

export function issueCsrfToken(req: Request, res: Response) {
  const token = crypto.randomBytes(32).toString('hex');
  res.cookie('csrf_token', token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 2 * 60 * 60 * 1000,
  });
  return token;
}

export function csrfProtection(options: { allowedOrigins: string[]; exemptPaths?: string[] }) {
  const methods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const exempt = options.exemptPaths ?? [];

  return (req: Request, res: Response, next: NextFunction) => {
    if (!methods.has(req.method)) return next();
    if (!req.originalUrl.startsWith('/api/')) return next();
    if (exempt.some((p) => req.originalUrl.startsWith(p))) return next();

    const hasBearer = Boolean(req.headers.authorization?.startsWith('Bearer '));
    const hasSessionCookie = Boolean((req as any).cookies?.access_token);
    if (!hasSessionCookie || hasBearer) return next();

    const csrfCookie = String((req as any).cookies?.csrf_token ?? '');
    const csrfHeader = String(req.header('x-csrf-token') ?? '');
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      return res.status(403).json({ message: 'CSRF inválido ou ausente.' });
    }

    if (process.env.NODE_ENV === 'production') {
      const origin = String(req.header('origin') ?? '').trim();
      if (origin && !options.allowedOrigins.includes(origin)) {
        return res.status(403).json({ message: 'Origem não permitida.' });
      }
    }

    next();
  };
}
