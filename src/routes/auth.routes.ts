import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { authRateLimiter } from '../middleware/security.js';
import { authenticate, signAccessToken, type AuthenticatedRequest } from '../middleware/auth.js';
import { storage } from '../storage.js';

const router = Router();

const passwordSchema = z
  .string()
  .min(12, 'Senha precisa ter no mínimo 12 caracteres.')
  .max(72, 'Senha pode ter no máximo 72 caracteres.')
  .regex(/[A-Z]/, 'Senha deve ter ao menos uma letra maiúscula.')
  .regex(/[a-z]/, 'Senha deve ter ao menos uma letra minúscula.')
  .regex(/[0-9]/, 'Senha deve ter ao menos um número.')
  .regex(/[^A-Za-z0-9]/, 'Senha deve ter ao menos um caractere especial.');

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(180),
  password: passwordSchema
});

const loginSchema = z.object({
  email: z.string().trim().email().max(180),
  password: z.string().min(1).max(72)
});

router.use(authRateLimiter);

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
    passwordHash
  });

  const token = signAccessToken({ id: user.id, email: user.email });

  return res.status(201).json({ user, token });
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Dados inválidos.', errors: parsed.error.flatten() });
  }

  const normalizedEmail = parsed.data.email.toLowerCase();
  const user = await storage.findUserByEmail(normalizedEmail);

  if (!user) {
    return res.status(401).json({ message: 'Credenciais inválidas.' });
  }

  const passwordMatches = await bcrypt.compare(parsed.data.password, user.passwordHash);

  if (!passwordMatches) {
    return res.status(401).json({ message: 'Credenciais inválidas.' });
  }

  const token = signAccessToken({ id: user.id, email: user.email });

  return res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt
    }
  });
});

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
