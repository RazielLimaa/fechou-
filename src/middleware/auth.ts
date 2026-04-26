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
const googleRedirectUri  = process.env.GOOGLE_CALLBACK_URL || process.env.GOOGLE_REDIRECT_URI;
const googleRedirectUriList = String(process.env.GOOGLE_REDIRECT_URI_LIST ?? '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

if (!googleClientId || !googleClientSecret || !googleRedirectUri) {
  throw new Error(
    'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_CALLBACK_URL são obrigatórios.'
  );
}
const requiredGoogleClientId = googleClientId;
const requiredGoogleClientSecret = googleClientSecret;
const primaryGoogleRedirectUri = googleRedirectUri;

function buildGoogleOAuthClient(redirectUri: string) {
  return new OAuth2Client(
    requiredGoogleClientId,
    requiredGoogleClientSecret,
    redirectUri
  );
}

export function getPrimaryGoogleCallbackUrl() {
  return primaryGoogleRedirectUri;
}

export function buildGoogleAuthorizationUrl(state: string) {
  const client = buildGoogleOAuthClient(primaryGoogleRedirectUri);
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'select_account',
    scope: ['openid', 'email', 'profile'],
    state,
  });
}

export async function verifyGoogleCallbackCode(code: string): Promise<GoogleUserPayload> {
  return verifyGoogleCode(code, primaryGoogleRedirectUri);
}

function allowedRedirectUris() {
  return Array.from(new Set([primaryGoogleRedirectUri, 'postmessage', ...googleRedirectUriList]));
}

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
export async function verifyGoogleCode(code: string, requestedRedirectUri?: string): Promise<GoogleUserPayload> {
  // 1. Troca o code por tokens
  let idToken: string;
  const redirects = allowedRedirectUris();

  const preferredRedirect = String(requestedRedirectUri ?? '').trim();
  const canUseRequestedRedirect =
    preferredRedirect.length > 0 &&
    redirects.includes(preferredRedirect);

  const orderedRedirects = canUseRequestedRedirect
    ? [preferredRedirect, ...redirects.filter((item) => item !== preferredRedirect)]
    : redirects;

  let tokenError: unknown = null;
  try {
    let foundToken: string | null = null;
    for (const redirectUri of orderedRedirects) {
      try {
        const client = buildGoogleOAuthClient(redirectUri);
        const { tokens } = await client.getToken(code);
        if (!tokens.id_token) {
          throw new Error('id_token ausente na resposta do Google.');
        }
        foundToken = tokens.id_token;
        break;
      } catch (err) {
        tokenError = err;
      }
    }

    if (!foundToken) {
      throw tokenError ?? new Error('Falha ao obter tokens do Google.');
    }
    idToken = foundToken;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('redirect_uri_mismatch')) {
      console.error('[verifyGoogleCode] getToken falhou: redirect_uri_mismatch. URIs permitidas:', orderedRedirects.join(', '));
      throw new Error('Falha no login Google: redirect_uri_mismatch. Verifique GOOGLE_CALLBACK_URL e Authorized redirect URIs no Google Cloud.');
    }
    console.error('[verifyGoogleCode] getToken falhou:', msg);
    throw new Error('Falha ao verificar autenticação com o Google.');
  }

  // 2. Verifica assinatura e audience do ID token
  let payload: { sub: string; email: string; email_verified?: boolean; name?: string; picture?: string };
  try {
    const client = buildGoogleOAuthClient(orderedRedirects[0]);
    const ticket = await client.verifyIdToken({
      idToken,
      audience: requiredGoogleClientId,
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
  (process.env.JWT_EXPIRES_IN as SignOptions['expiresIn']) ?? '15m';

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
  const cookieToken = (req as any).cookies?.access_token;
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : '';
  const fallbackCookieToken = String(cookieToken ?? '').trim();

  if (!bearerToken && !fallbackCookieToken) {
    return res.status(401).json({ message: 'Token ausente.' });
  }

  const token = bearerToken || fallbackCookieToken;

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
