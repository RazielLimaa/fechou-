import type { NextFunction, Request, Response } from 'express';
import jwt, {
  type Algorithm,
  type SignOptions,
  type JwtPayload,
  type Secret
} from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';

// ── Google OAuth client ───────────────────────────────────────────────────────
const googleClientId     = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleRedirectUri  = process.env.GOOGLE_REDIRECT_URI;

if (!googleClientId || !googleClientSecret || !googleRedirectUri) {
  throw new Error(
    'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REDIRECT_URI são obrigatórios.'
  );
}

const googleOAuthClient = new OAuth2Client(
  googleClientId,
  googleClientSecret,
  googleRedirectUri
);

export interface GoogleUserPayload {
  googleId:      string;
  email:         string;
  name:          string;
  avatarUrl:     string | null;
  emailVerified: boolean;
}

/**
 * Troca um authorization code do Google por dados verificados do usuário.
 * O Client Secret nunca sai do servidor.
 * Lança erro descritivo se o code for inválido ou o email não estiver verificado.
 */
export async function verifyGoogleCode(code: string): Promise<GoogleUserPayload> {
  // 1. Troca o code por tokens
  let idToken: string;
  try {
    const { tokens } = await googleOAuthClient.getToken(code);
    if (!tokens.id_token) throw new Error('id_token ausente na resposta do Google.');
    idToken = tokens.id_token;
  } catch (err) {
    // Não vaze detalhes do Google para o cliente
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[verifyGoogleCode] getToken falhou:', msg);
    throw new Error('Falha ao verificar autenticação com o Google.');
  }

  // 2. Verifica assinatura e audience do ID token
  let payload: { sub: string; email: string; email_verified?: boolean; name?: string; picture?: string };
  try {
    const ticket = await googleOAuthClient.verifyIdToken({
      idToken,
      audience: googleClientId,
    });
    payload = ticket.getPayload() as typeof payload;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[verifyGoogleCode] verifyIdToken falhou:', msg);
    throw new Error('Token do Google inválido ou expirado.');
  }

  if (!payload?.email_verified) {
    throw new Error('Email do Google não verificado.');
  }

  if (!payload.email || !payload.sub) {
    throw new Error('Dados insuficientes retornados pelo Google.');
  }

  return {
    googleId:      payload.sub,
    email:         payload.email.toLowerCase(),
    name:          payload.name ?? payload.email.split('@')[0],
    avatarUrl:     payload.picture ?? null,
    emailVerified: true,
  };
}

interface TokenPayload extends JwtPayload {
  sub: string;
  email: string;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    email: string;
  };
}

const jwtSecretRaw = process.env.JWT_SECRET;
if (!jwtSecretRaw) {
  throw new Error('JWT_SECRET não definido. Configure no .env');
}
if (jwtSecretRaw.length < 32) {
  throw new Error('JWT_SECRET precisa ter ao menos 32 caracteres.');
}

const jwtSecret: Secret = jwtSecretRaw;
const jwtIssuer = process.env.JWT_ISSUER ?? 'fechou-api';
const jwtAudience = process.env.JWT_AUDIENCE ?? 'fechou-client';
const jwtAlgorithm: Algorithm = 'HS256';

const expiresIn: SignOptions['expiresIn'] =
  (process.env.JWT_EXPIRES_IN as SignOptions['expiresIn']) ?? '1d';

function isValidPayload(payload: unknown): payload is TokenPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'sub' in payload &&
    'email' in payload &&
    typeof (payload as any).sub === 'string' &&
    typeof (payload as any).email === 'string'
  );
}

export function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token ausente.' });
  }

  const token = authHeader.replace('Bearer ', '').trim();

  let payload: unknown;

  try {
    payload = jwt.verify(token, jwtSecret, {
      algorithms: [jwtAlgorithm],
      issuer: jwtIssuer,
      audience: jwtAudience
    });
  } catch {
    return res.status(401).json({ message: 'Token inválido ou expirado.' });
  }

  if (!isValidPayload(payload)) {
    return res.status(401).json({ message: 'Payload inválido.' });
  }

  req.user = {
    id: Number(payload.sub),
    email: payload.email
  };

  return next();
}

export function signAccessToken(user: { id: number; email: string }) {
  const options: SignOptions = {
    subject: String(user.id),
    expiresIn,
    issuer: jwtIssuer,
    audience: jwtAudience,
    algorithm: jwtAlgorithm
  };

  return jwt.sign(
    { email: user.email },
    jwtSecret,
    options
  );
}

export function resolveAuthenticatedUserId(req: Request) {
  const maybeReq = req as AuthenticatedRequest;
  return maybeReq.user?.id ?? null;
}

export function authenticateOrMvp(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  return authenticate(req, res, next);
}
