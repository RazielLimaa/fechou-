import type { Request, Response, NextFunction } from 'express';
import { consumeStepUpToken, buildStepUpPayloadHash } from '../services/stepUp.js';
import type { AuthenticatedRequest } from './auth.js';
import { logSecurityEvent } from '../services/securityEvents.js';

function respondStepUpError(
  res: Response,
  input: {
    scope: string;
    code: 'STEP_UP_REQUIRED' | 'STEP_UP_INVALID_OR_REPLAY';
    message: string;
    title: string;
    detail: string;
  }
) {
  return res.status(403).json({
    message: input.message,
    code: input.code,
    title: input.title,
    detail: input.detail,
    nextAction: {
      type: 'REQUEST_STEP_UP',
      scope: input.scope,
      retryable: true,
    },
  });
}

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
      return respondStepUpError(res, {
        scope,
        code: 'STEP_UP_REQUIRED',
        message: 'Confirmação de segurança necessária.',
        title: 'Confirme sua identidade',
        detail: 'Para concluir esta ação sensível, confirme sua senha novamente.',
      });
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
      return respondStepUpError(res, {
        scope,
        code: 'STEP_UP_INVALID_OR_REPLAY',
        message: 'Sua confirmação expirou ou já foi utilizada.',
        title: 'Confirmação expirada',
        detail: 'Por segurança, gere uma nova confirmação e tente novamente.',
      });
    }

    next();
  };
}
