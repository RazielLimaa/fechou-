import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { authRateLimiter } from '../middleware/security.js';
import { distributedRateLimit, issueCsrfToken } from '../middleware/distributed-security.js';
import { authenticate, signAccessToken, type AuthenticatedRequest, verifyGoogleCode } from '../middleware/auth.js';
import { storage } from '../storage.js';
import { db } from '../db/index.js';
import { createRefreshToken, rotateRefreshToken, revokeRefreshToken } from '../services/token.js';
import { buildStepUpPayloadHash, issueStepUpToken } from '../services/stepUp.js';
import { sendPasswordResetVerificationEmail } from '../services/mail.service.js';
import {
  consumePasswordResetToken,
  buildPasswordResetUrl,
  buildPasswordResetVerifyUrl,
  getPasswordResetCodeTtlMinutes,
  getPasswordResetTtlMinutes,
  issuePasswordResetChallenge,
  maskEmailAddress,
  verifyPasswordResetChallenge,
} from '../services/password-reset.service.js';

const strictAuthRateLimits =
  process.env.AUTH_STRICT_RATE_LIMITS === 'true' || process.env.NODE_ENV === 'production';

function optionalAuthLimiter<T extends (req: any, res: any, next: any) => any>(middleware: T): T {
  if (strictAuthRateLimits) return middleware;
  return (((_req: any, _res: any, next: any) => next()) as unknown) as T;
}

const router = Router();
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});

const authDistributedLimiter = distributedRateLimit({
  scope: 'auth',
  limit: Number(process.env.RATE_LIMIT_AUTH_DISTRIBUTED_MAX ?? 50),
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000),
});
const authIdentityLimiter = distributedRateLimit({
  scope: 'auth-identity',
  limit: Number(process.env.RATE_LIMIT_AUTH_IDENTITY_MAX ?? 25),
  windowMs: Number(process.env.RATE_LIMIT_AUTH_IDENTITY_WINDOW_MS ?? 15 * 60 * 1000),
  key: (req) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    return `${req.ip}:${email || 'unknown'}`;
  },
});
const forgotPasswordLimiter = distributedRateLimit({
  scope: 'auth-forgot-password',
  limit: Number(process.env.RATE_LIMIT_FORGOT_PASSWORD_MAX ?? 8),
  windowMs: Number(process.env.RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MS ?? 15 * 60 * 1000),
});
const forgotPasswordIdentityLimiter = distributedRateLimit({
  scope: 'auth-forgot-password-identity',
  limit: Number(process.env.RATE_LIMIT_FORGOT_PASSWORD_IDENTITY_MAX ?? 3),
  windowMs: Number(process.env.RATE_LIMIT_FORGOT_PASSWORD_IDENTITY_WINDOW_MS ?? 60 * 60 * 1000),
  key: (req) => String(req.body?.email ?? '').trim().toLowerCase() || 'unknown',
});
const resetPasswordLimiter = distributedRateLimit({
  scope: 'auth-reset-password',
  limit: Number(process.env.RATE_LIMIT_RESET_PASSWORD_MAX ?? 12),
  windowMs: Number(process.env.RATE_LIMIT_RESET_PASSWORD_WINDOW_MS ?? 15 * 60 * 1000),
});
const forgotPasswordVerifyLimiter = distributedRateLimit({
  scope: 'auth-forgot-password-verify',
  limit: Number(process.env.RATE_LIMIT_FORGOT_PASSWORD_VERIFY_MAX ?? 10),
  windowMs: Number(process.env.RATE_LIMIT_FORGOT_PASSWORD_VERIFY_WINDOW_MS ?? 15 * 60 * 1000),
});
const forgotPasswordVerifyIdentityLimiter = distributedRateLimit({
  scope: 'auth-forgot-password-verify-identity',
  limit: Number(process.env.RATE_LIMIT_FORGOT_PASSWORD_VERIFY_IDENTITY_MAX ?? 5),
  windowMs: Number(process.env.RATE_LIMIT_FORGOT_PASSWORD_VERIFY_IDENTITY_WINDOW_MS ?? 30 * 60 * 1000),
  key: (req) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    return `${req.ip}:${email || 'unknown'}`;
  },
});

const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';
const LOGIN_DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.2IyE8mYkG4T9p7xGX2YeliYg5OtTSnS';

function accessCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? 'strict' : 'lax') as 'strict' | 'lax',
    path: '/',
    maxAge: 15 * 60 * 1000,
  };
}

function refreshCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? 'strict' : 'lax') as 'strict' | 'lax',
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

// ── Tipo mínimo de usuário ────────────────────────────────────────────────────
type MinimalUser = { id: number; name: string; email: string; createdAt: Date };

// ── Schemas de validação ──────────────────────────────────────────────────────

const passwordSchema = z
  .string()
  .min(8,  'Senha precisa ter no mínimo 8 caracteres.')
  .max(72, 'Senha pode ter no máximo 72 caracteres.')
  .regex(/[A-Z]/,        'Senha deve ter ao menos uma letra maiúscula.')
  .regex(/[a-z]/,        'Senha deve ter ao menos uma letra minúscula.')
  .regex(/[0-9]/,        'Senha deve ter ao menos um número.')
  .regex(/[^A-Za-z0-9]/, 'Senha deve ter ao menos um caractere especial.');

const registerSchema = z.object({
  name:     z.string().trim().min(2).max(120),
  email:    z.string().trim().email().max(180),
  password: passwordSchema,
});

const loginSchema = z.object({
  email:    z.string().trim().email().max(180),
  password: z.string().min(1).max(72),
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(180),
});

const verifyForgotPasswordCodeSchema = z.object({
  email: z.string().trim().email().max(180),
  code: z
    .string()
    .trim()
    .min(6)
    .max(8)
    .regex(/^[A-Z0-9]+$/i, 'Codigo invalido.'),
});

const resetPasswordSchema = z.object({
  token: z
    .string()
    .trim()
    .length(64)
    .regex(/^[a-f0-9]{64}$/i, 'Token inválido.'),
  password: passwordSchema,
});

const googleSchema = z.object({
  code: z.string().trim().min(10).max(4096),
  redirectUri: z.string().trim().url().max(2048).optional(),
});

const stepUpSchema = z.object({
  scope: z.enum([
    'user.pix.update',
    'user.pix.delete',
    'payments.mark-paid',
    'contracts.mark-paid',
    'integrations.mp.api-key.register',
    'contracts.provider-signature.save',
    'contracts.provider-signature.delete',
    'contracts.provider-signature.apply',
  ]),
  payload: z.record(z.unknown()).default({}),
  password: z.string().min(1).max(128).optional(),
});

const PAYLOAD_AGNOSTIC_STEPUP_SCOPES = new Set([
  'user.pix.update',
  'user.pix.delete',
  'contracts.provider-signature.save',
  'contracts.provider-signature.delete',
  'contracts.provider-signature.apply',
]);

function getRequestMeta(req: { headers: Record<string, unknown>; ip?: string | null }) {
  return {
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 512),
    ipAddress: String(req.ip ?? '').split(',')[0].trim().slice(0, 80),
  };
}

// ── POST /register ────────────────────────────────────────────────────────────

router.post('/register', authRateLimiter, optionalAuthLimiter(authDistributedLimiter), optionalAuthLimiter(authIdentityLimiter), async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Dados inválidos.', errors: parsed.error.flatten() });
  }

  const normalizedEmail = parsed.data.email.toLowerCase();
  const existing = await storage.findUserByEmail(normalizedEmail);

  if (existing) {
    return res.status(409).json({ message: 'E-mail já cadastrado.' });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const user = await storage.createUser({
    name: parsed.data.name,
    email: normalizedEmail,
    passwordHash,
  });

  const token = signAccessToken({ id: user.id, email: user.email });
  const refreshToken = await createRefreshToken(db as any, {
    id: user.id,
    email: user.email,
    name: user.name,
  }, null, {
    userAgent: String(req.headers['user-agent'] ?? ''),
    ipAddress: req.ip,
  });
  res.cookie(ACCESS_COOKIE, token, accessCookieOptions());
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  const csrfToken = issueCsrfToken(req, res);

  return res.status(201).json({ user, token, csrfToken });
});

// ── POST /login ───────────────────────────────────────────────────────────────

router.post('/login', authRateLimiter, optionalAuthLimiter(authDistributedLimiter), optionalAuthLimiter(authIdentityLimiter), async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Dados inválidos.', errors: parsed.error.flatten() });
  }

  const normalizedEmail = parsed.data.email.toLowerCase();
  const user = await storage.findUserByEmail(normalizedEmail);

  const passwordMatches = await bcrypt.compare(
    parsed.data.password,
    user?.passwordHash ?? LOGIN_DUMMY_HASH
  );

  if (!user || !passwordMatches) {
    return res.status(401).json({ message: 'Credenciais inválidas.' });
  }

  if (!user.passwordHash) {
    return res.status(400).json({
      message: 'Esta conta usa login com Google. Clique em "Entrar com Google".',
    });
  }

  const token = signAccessToken({ id: user.id, email: user.email });
  const refreshToken = await createRefreshToken(db as any, {
    id: user.id,
    email: user.email,
    name: user.name,
  }, null, {
    userAgent: String(req.headers['user-agent'] ?? ''),
    ipAddress: req.ip,
  });
  res.cookie(ACCESS_COOKIE, token, accessCookieOptions());
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  const csrfToken = issueCsrfToken(req, res);

  return res.json({
    token,
    csrfToken,
    user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt },
  });
});

router.post(
  '/forgot-password',
  authRateLimiter,
  optionalAuthLimiter(forgotPasswordLimiter),
  optionalAuthLimiter(forgotPasswordIdentityLimiter),
  async (req, res) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Dados inválidos.' });
    }

    const normalizedEmail = parsed.data.email.toLowerCase();
    const user = await storage.findUserByEmail(normalizedEmail);

    if (user) {
      try {
        const meta = getRequestMeta(req);
        const { code } = await issuePasswordResetChallenge({
          userId: user.id,
          requestedIp: meta.ipAddress,
          requestedUserAgent: meta.userAgent,
        });
        const expiresMinutes = getPasswordResetCodeTtlMinutes();
        const verifyUrl = buildPasswordResetVerifyUrl(user.email);

        void sendPasswordResetVerificationEmail({
          to: user.email,
          name: user.name,
          code,
          verifyUrl,
          expiresMinutes,
        }).catch((err) => {
          console.error('[auth forgot-password] falha ao enviar email:', err instanceof Error ? err.message : err);
        });
      } catch (err) {
        console.error('[auth forgot-password] falha ao preparar reset:', err instanceof Error ? err.message : err);
      }
    }

    return res.status(202).json({
      ok: true,
      message: 'Se o e-mail existir, você receberá instruções para redefinir a senha.',
    });
  }
);

router.post(
  '/forgot-password/verify-code',
  authRateLimiter,
  optionalAuthLimiter(forgotPasswordVerifyLimiter),
  optionalAuthLimiter(forgotPasswordVerifyIdentityLimiter),
  async (req, res) => {
    const parsed = verifyForgotPasswordCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Dados invalidos.', errors: parsed.error.flatten() });
    }

    const normalizedEmail = parsed.data.email.toLowerCase();
    const user = await storage.findUserByEmail(normalizedEmail);

    if (!user) {
      return res.status(400).json({ message: 'Codigo invalido ou expirado.' });
    }

    const meta = getRequestMeta(req);
    const result = await verifyPasswordResetChallenge({
      userId: user.id,
      code: parsed.data.code,
      verifiedIp: meta.ipAddress,
      verifiedUserAgent: meta.userAgent,
    });

    if (!result.ok || !result.rawToken) {
      const message =
        result.reason === 'too_many_attempts'
          ? 'Muitas tentativas invalidas. Solicite um novo codigo.'
          : 'Codigo invalido ou expirado.';
      return res.status(400).json({ message });
    }

    const expiresMinutes = getPasswordResetTtlMinutes();
    const resetUrl = buildPasswordResetUrl(result.rawToken);

    return res.status(200).json({
      ok: true,
      message: 'Codigo validado. Continue para definir a nova senha.',
      resetToken: result.rawToken,
      resetUrl,
      expiresMinutes,
      emailHint: maskEmailAddress(user.email),
    });
  }
);

router.post(
  '/reset-password',
  authRateLimiter,
  optionalAuthLimiter(resetPasswordLimiter),
  async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Dados inválidos.', errors: parsed.error.flatten() });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const meta = getRequestMeta(req);
    const result = await consumePasswordResetToken({
      rawToken: parsed.data.token.toLowerCase(),
      newPasswordHash: passwordHash,
      usedIp: meta.ipAddress,
      usedUserAgent: meta.userAgent,
    });

    if (!result.ok) {
      return res.status(400).json({
        message: 'Link de redefinição inválido ou expirado.',
      });
    }

    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.clearCookie('csrf_token', { path: '/' });

    return res.status(200).json({
      ok: true,
      message: 'Senha redefinida com sucesso. Faça login novamente.',
    });
  }
);

// ── POST /google ──────────────────────────────────────────────────────────────
// Authorization Code flow no backend (sem aceitar access_token do frontend).
router.post('/google', authRateLimiter, optionalAuthLimiter(authDistributedLimiter), async (req, res) => {
  const parsed = googleSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: 'code inválido.' });
  }

  let googleUser: Awaited<ReturnType<typeof verifyGoogleCode>>;
  try {
    googleUser = await verifyGoogleCode(parsed.data.code, parsed.data.redirectUri);
  } catch (err) {
    return res.status(401).json({ message: err instanceof Error ? err.message : 'Falha no login Google.' });
  }

  const googleEmail = googleUser.email.toLowerCase();
  const googleId    = googleUser.googleId;
  const googleName  = googleUser.name ?? googleEmail.split('@')[0];
  const avatarUrl   = googleUser.avatarUrl ?? null;

  // 4. Upsert do usuário
  let user: MinimalUser;

  const existing = await storage.findUserByEmail(googleEmail);

  if (existing) {
    if (!(existing as any).googleId) {
      user = await storage.updateUserGoogleId(existing.id, { googleId, avatarUrl });
    } else {
      user = existing;
    }
  } else {
    user = await storage.createUser({
      name:          googleName,
      email:         googleEmail,
      passwordHash:  null as any,
      googleId,
      avatarUrl,
      emailVerified: true,
    } as any);
  }

  const token = signAccessToken({ id: user.id, email: user.email });
  const refreshToken = await createRefreshToken(db as any, {
    id: user.id,
    email: user.email,
    name: user.name,
  }, null, {
    userAgent: String(req.headers['user-agent'] ?? ''),
    ipAddress: req.ip,
  });
  res.cookie(ACCESS_COOKIE, token, accessCookieOptions());
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  const csrfToken = issueCsrfToken(req, res);

  return res.status(200).json({
    token,
    csrfToken,
    user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt },
  });
});

router.post('/refresh', optionalAuthLimiter(authDistributedLimiter), async (req, res) => {
  const currentRefresh = String(req.cookies?.[REFRESH_COOKIE] ?? '').trim();
  if (!currentRefresh) {
    return res.status(401).json({ message: 'Sessão expirada.' });
  }

  try {
    const rotated = await rotateRefreshToken(db as any, currentRefresh, {
      userAgent: String(req.headers['user-agent'] ?? ''),
      ipAddress: req.ip,
    });

    const user = await storage.findUserById(rotated.userId);
    if (!user) return res.status(401).json({ message: 'Sessão inválida.' });

    const accessToken = signAccessToken({ id: user.id, email: user.email });
    res.cookie(ACCESS_COOKIE, accessToken, accessCookieOptions());
    res.cookie(REFRESH_COOKIE, rotated.newRawToken, refreshCookieOptions());
    const csrfToken = issueCsrfToken(req, res);

    return res.status(200).json({
      token: accessToken,
      csrfToken,
      user,
    });
  } catch {
    return res.status(401).json({ message: 'Sessão inválida ou revogada.' });
  }
});

router.post('/logout', async (req, res) => {
  const currentRefresh = String(req.cookies?.[REFRESH_COOKIE] ?? '').trim();
  if (currentRefresh) {
    await revokeRefreshToken(db as any, currentRefresh);
  }

  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  res.clearCookie('csrf_token', { path: '/' });
  return res.status(200).json({ ok: true });
});

router.get('/csrf', async (req, res) => {
  const csrfToken = issueCsrfToken(req, res);
  return res.status(200).json({ csrfToken });
});

router.post('/step-up/request', authenticate, optionalAuthLimiter(authDistributedLimiter), async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Não autenticado.' });

  const parsed = stepUpSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: 'Dados inválidos.' });

  const userAuth = await storage.findUserAuthById(userId);
  if (!userAuth) return res.status(404).json({ message: 'Usuário não encontrado.' });

  if (!userAuth.passwordHash) {
    return res.status(403).json({ message: 'Operação sensível exige senha local configurada.' });
  }

  const provided = String(parsed.data.password ?? '');
  const ok = await bcrypt.compare(provided, userAuth.passwordHash);
  if (!ok) {
    return res.status(403).json({ message: 'Step-up auth required.' });
  }

  const payloadHash = PAYLOAD_AGNOSTIC_STEPUP_SCOPES.has(parsed.data.scope)
    ? buildStepUpPayloadHash({})
    : buildStepUpPayloadHash(parsed.data.payload);
  const token = await issueStepUpToken({
    userId,
    scope: parsed.data.scope,
    payloadHash,
    ttlMs: 5 * 60 * 1000,
  });

  return res.status(201).json(token);
});

// ── GET /me ───────────────────────────────────────────────────────────────────

router.get('/me', authenticate, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const user = await storage.findUserById(userId);

  if (!user) {
    return res.status(404).json({ message: 'Usuário não encontrado.' });
  }

  return res.json(user);
});

export default router;
