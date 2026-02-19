import { Router } from 'express';
import crypto from 'crypto';
import {
  authenticateOrMvp,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import {
  buildOAuthAuthorizationUrl,
  encryptToken,
  exchangeAuthorizationCodeForTokens,
  verifyMercadoPagoApiKey,
} from '../services/mercadoPago.js';
import { storage } from '../storage.js';
import { z } from 'zod';
import { sensitiveRateLimiter } from '../middleware/security.js';

const router = Router();
router.use(sensitiveRateLimiter);

const oauthStateStore = new Map<string, { userId: number; expiresAt: number }>();
const STATE_TTL_MS = 10 * 60 * 1000;
const apiKeySchema = z.object({
  accessToken: z.string().trim().min(20).max(300)
});

function createOAuthState(userId: number) {
  const state = crypto.randomBytes(24).toString('hex');
  oauthStateStore.set(state, { userId, expiresAt: Date.now() + STATE_TTL_MS });
  return state;
}

function consumeOAuthState(state: string) {
  const value = oauthStateStore.get(state);
  oauthStateStore.delete(state);
  if (!value || value.expiresAt < Date.now()) return null;
  return value;
}

router.get('/connect', authenticateOrMvp, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const state = createOAuthState(userId);
  const redirect = buildOAuthAuthorizationUrl(state);
  return res.redirect(302, redirect);
});

router.get('/callback', async (req, res) => {
  const code = String(req.query.code ?? '').trim();
  const state = String(req.query.state ?? '').trim();

  if (!code || !state) {
    return res.status(400).json({ message: 'Parâmetros code/state são obrigatórios.' });
  }

  const statePayload = consumeOAuthState(state);
  if (!statePayload) {
    return res.status(400).json({ message: 'State inválido ou expirado.' });
  }

  try {
    const oauth = await exchangeAuthorizationCodeForTokens(code);
    const expiresAt = new Date(Date.now() + oauth.expires_in * 1000);

    await storage.upsertMercadoPagoAccount({
      userId: statePayload.userId,
      mpUserId: oauth.user_id ? String(oauth.user_id) : null,
      authMethod: 'oauth',
      accessToken: encryptToken(oauth.access_token),
      refreshToken: encryptToken(oauth.refresh_token),
      expiresAt,
    });

    const redirect = `${process.env.FRONTEND_URL}/app/settings?mp=connected`;
    return res.redirect(302, redirect);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Falha ao conectar conta Mercado Pago.' });
  }
});

router.get('/status', authenticateOrMvp, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const account = await storage.getMercadoPagoAccountByUserId(userId);

  return res.json({
    connected: Boolean(account),
    authMethod: account?.authMethod ?? null,
    mpUserId: account?.mpUserId ?? null,
    expiresAt: account?.expiresAt ?? null,
  });
});

router.post('/api-key/verify', authenticateOrMvp, async (req: AuthenticatedRequest, res) => {
  const parsed = apiKeySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Dados inválidos.', errors: parsed.error.flatten() });
  }

  try {
    const data = await verifyMercadoPagoApiKey(parsed.data.accessToken);
    return res.json({
      valid: true,
      mpUserId: String(data.id),
      nickname: data.nickname ?? null,
      email: data.email ?? null,
    });
  } catch {
    return res.status(400).json({ message: 'Chave API inválida.' });
  }
});

router.post('/api-key/register', authenticateOrMvp, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const parsed = apiKeySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Dados inválidos.', errors: parsed.error.flatten() });
  }

  try {
    const data = await verifyMercadoPagoApiKey(parsed.data.accessToken);

    await storage.upsertMercadoPagoAccount({
      userId,
      mpUserId: String(data.id),
      authMethod: 'api_key',
      accessToken: encryptToken(parsed.data.accessToken),
      refreshToken: encryptToken(parsed.data.accessToken),
      expiresAt: new Date('2099-12-31T23:59:59.000Z'),
    });

    return res.status(201).json({
      connected: true,
      authMethod: 'api_key',
      mpUserId: String(data.id),
      nickname: data.nickname ?? null,
    });
  } catch {
    return res.status(400).json({ message: 'Não foi possível cadastrar a chave API do Mercado Pago.' });
  }
});

export default router;
