import type { NextFunction, Request, Response } from 'express';
import jwt, { type Algorithm } from 'jsonwebtoken';

interface TokenPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    email: string;
  };
}

const jwtSecret = process.env.JWT_SECRET;
const jwtIssuer = process.env.JWT_ISSUER ?? 'fechou-api';
const jwtAudience = process.env.JWT_AUDIENCE ?? 'fechou-client';
const jwtAlgorithm: Algorithm = 'HS256';

if (!jwtSecret) {
  throw new Error('JWT_SECRET não definido. Configure no .env');
}

if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET precisa ter ao menos 32 caracteres para segurança adequada.');
}

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token ausente.' });
  }

  const token = authHeader.replace('Bearer ', '').trim();

  try {
    const payload = jwt.verify(token, jwtSecret, {
      algorithms: [jwtAlgorithm],
      issuer: jwtIssuer,
      audience: jwtAudience
    }) as TokenPayload;

    req.user = {
      id: Number(payload.sub),
      email: payload.email
    };

    next();
  } catch {
    return res.status(401).json({ message: 'Token inválido ou expirado.' });
  }
}

export function signAccessToken(user: { id: number; email: string }) {
  return jwt.sign({ email: user.email }, jwtSecret, {
    subject: String(user.id),
    expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    issuer: jwtIssuer,
    audience: jwtAudience,
    algorithm: jwtAlgorithm
  });
}


export function resolveAuthenticatedUserId(req: Request) {
  const maybeReq = req as AuthenticatedRequest;
  if (maybeReq.user?.id) return maybeReq.user.id;

  const fromHeader = Number(req.header('x-user-id'));
  if (Number.isInteger(fromHeader) && fromHeader > 0) return fromHeader;

  const fallback = Number(process.env.MVP_USER_ID ?? 1);
  if (Number.isInteger(fallback) && fallback > 0) return fallback;

  return null;
}

export function authenticateOrMvp(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '').trim();

    try {
      const payload = jwt.verify(token, jwtSecret, {
        algorithms: [jwtAlgorithm],
        issuer: jwtIssuer,
        audience: jwtAudience
      }) as TokenPayload;

      req.user = {
        id: Number(payload.sub),
        email: payload.email
      };

      return next();
    } catch {
      // fallback MVP user
    }
  }

  const fallback = resolveAuthenticatedUserId(req);
  if (!fallback) {
    return _res.status(401).json({ message: 'Não autenticado.' });
  }

  req.user = { id: fallback, email: 'mvp@local.dev' };
  return next();
}
