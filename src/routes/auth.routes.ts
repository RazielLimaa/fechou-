import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { authenticate, signAccessToken, type AuthenticatedRequest } from '../middleware/auth.js';
import { storage } from '../storage.js';

const router = Router();

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Dados inválidos.', errors: parsed.error.flatten() });
  }

  const existing = await storage.findUserByEmail(parsed.data.email);

  if (existing) {
    return res.status(409).json({ message: 'E-mail já cadastrado.' });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const user = await storage.createUser({
    name: parsed.data.name,
    email: parsed.data.email,
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

  const user = await storage.findUserByEmail(parsed.data.email);

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
