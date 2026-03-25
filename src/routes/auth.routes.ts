import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { authRateLimiter } from '../middleware/security.js';
import { distributedRateLimit, issueCsrfToken } from '../middleware/distributed-security.js';
import { authenticate, signAccessToken, type AuthenticatedRequest, verifyGoogleCode } from '../middleware/auth.js';
import { storage } from '../storage.js';
import { db } from '../db/index.js';
import { createRefreshToken, rotateRefreshToken, revokeRefreshToken } from '../services/token.js';

const router = Router();
const authDistributedLimiter = distributedRateLimit({
  scope: 'auth',
  limit: Number(process.env.RATE_LIMIT_AUTH_MAX ?? 15),
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000),
});

const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';

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

const googleSchema = z.object({
  code: z.string().trim().min(10).max(4096),
});

// ── POST /register ────────────────────────────────────────────────────────────

router.post('/register', authRateLimiter, authDistributedLimiter, async (req, res) => {
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

router.post('/login', authRateLimiter, authDistributedLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Dados inválidos.', errors: parsed.error.flatten() });
  }

  const normalizedEmail = parsed.data.email.toLowerCase();
  const user = await storage.findUserByEmail(normalizedEmail);

  const dummyHash = '$2b$12$invalidhashfortimingprotectionxxxxxxxxxxxxxxxx';
  const passwordMatches = await bcrypt.compare(
    parsed.data.password,
    user?.passwordHash ?? dummyHash
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

// ── POST /google ──────────────────────────────────────────────────────────────
// Authorization Code flow no backend (sem aceitar access_token do frontend).
router.post('/google', authRateLimiter, authDistributedLimiter, async (req, res) => {
  const parsed = googleSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: 'code inválido.' });
  }

  let googleUser: Awaited<ReturnType<typeof verifyGoogleCode>>;
  try {
    googleUser = await verifyGoogleCode(parsed.data.code);
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

router.post('/refresh', authDistributedLimiter, async (req, res) => {
  const currentRefresh = String(req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken ?? '').trim();
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

router.get('/csrf', authenticate, async (req, res) => {
  const csrfToken = issueCsrfToken(req, res);
  return res.status(200).json({ csrfToken });
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
