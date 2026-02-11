import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

interface TokenPayload {
  sub: number;
  email: string;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    email: string;
  };
}

const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
  throw new Error('JWT_SECRET não definido. Configure no .env');
}

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token ausente.' });
  }

  const token = authHeader.replace('Bearer ', '').trim();

  try {
    const payload = jwt.verify(token, jwtSecret) as TokenPayload;

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
    expiresIn: process.env.JWT_EXPIRES_IN ?? '1d'
  });
}
