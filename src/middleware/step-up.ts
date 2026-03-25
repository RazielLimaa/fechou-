import type { Request, Response, NextFunction } from 'express';
import { consumeStepUpToken, buildStepUpPayloadHash } from '../services/stepUp.js';
import type { AuthenticatedRequest } from './auth.js';
import { logSecurityEvent } from '../services/securityEvents.js';

export function requireStepUp(scope: string, payload: (req: Request) => unknown) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Não autenticado.' });

    const token = String(req.header('x-step-up-token') ?? '').trim();
    if (!token) {
      logSecurityEvent({
        eventName: 'sensitive_action_requires_stepup',
        severity: 'warning',
        actorId: userId,
        requestId: (req as any).requestId ?? null,
        ip: req.ip,
        route: req.originalUrl,
        reason: scope,
      });
      return res.status(403).json({ message: 'Step-up auth required.' });
    }

    const payloadHash = buildStepUpPayloadHash(payload(req));
    const ok = await consumeStepUpToken({
      token,
      userId,
      scope,
      payloadHash,
    });

    if (!ok) {
      logSecurityEvent({
        eventName: 'stepup_invalid_or_replay',
        severity: 'high',
        actorId: userId,
        requestId: (req as any).requestId ?? null,
        ip: req.ip,
        route: req.originalUrl,
        reason: scope,
      });
      return res.status(403).json({ message: 'Step-up token inválido, expirado ou reutilizado.' });
    }

    next();
  };
}
