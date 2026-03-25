import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { authRateLimiter } from '../middleware/security.js';
import { authenticate, signAccessToken, type AuthenticatedRequest } from '../middleware/auth.js';
import { storage } from '../storage.js';

const router = Router();

// ── Google OAuth ──────────────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

if (!GOOGLE_CLIENT_ID) {
  throw new Error('GOOGLE_CLIENT_ID é obrigatório no .env');
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
  // flow: "implicit" entrega access_token diretamente — sem redirect_uri_mismatch
  access_token: z.string().trim().min(1).max(2048),
});

// ── POST /register ────────────────────────────────────────────────────────────

router.post('/register', async (req, res) => {
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

  return res.status(201).json({ user, token });
});

// ── POST /login ───────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
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

  return res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt },
  });
});

// ── POST /google ──────────────────────────────────────────────────────────────
// Usa flow "implicit": o frontend envia um access_token (não um code).
// O backend verifica o token diretamente na API do Google — sem redirect_uri.

router.post('/google', async (req, res) => {
  const parsed = googleSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: 'access_token inválido.' });
  }

  const { access_token } = parsed.data;

  // 1. Verifica o access_token na API do Google e obtém o perfil do usuário
  let profile: {
    sub: string;
    email: string;
    email_verified: boolean;
    name?: string;
    picture?: string;
  };

  try {
    const googleRes = await fetch(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    if (!googleRes.ok) {
      throw new Error(`Google userinfo retornou ${googleRes.status}`);
    }

    profile = await googleRes.json();
  } catch (err) {
    console.error('[/google] userinfo falhou:', err instanceof Error ? err.message : err);
    return res.status(400).json({ message: 'Falha ao verificar autenticação com o Google.' });
  }

  // 2. Validações do perfil
  if (!profile.email_verified) {
    return res.status(400).json({ message: 'Email do Google não verificado.' });
  }
  if (!profile.email || !profile.sub) {
    return res.status(400).json({ message: 'Dados insuficientes retornados pelo Google.' });
  }

  // 3. SEGURANÇA: verifica se o token pertence ao nosso app
  // O campo "aud" (audience) não vem no userinfo — verificamos o tokeninfo
  try {
    const tokenInfo = await fetch(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${access_token}`
    );
    const info = await tokenInfo.json();

    // Garante que o token foi emitido para o nosso Client ID
    if (info.aud !== GOOGLE_CLIENT_ID && info.azp !== GOOGLE_CLIENT_ID) {
      console.error('[/google] token não pertence ao app. aud:', info.aud);
      return res.status(401).json({ message: 'Token não autorizado.' });
    }
  } catch (err) {
    console.error('[/google] tokeninfo falhou:', err instanceof Error ? err.message : err);
    return res.status(400).json({ message: 'Não foi possível validar o token.' });
  }

  const googleEmail = profile.email.toLowerCase();
  const googleId    = profile.sub;
  const googleName  = profile.name ?? googleEmail.split('@')[0];
  const avatarUrl   = profile.picture ?? null;

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

  return res.status(200).json({
    token,
    user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt },
  });
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