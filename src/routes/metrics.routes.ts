import { Router } from 'express';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import { storage } from '../storage.js';

const router = Router();

router.use(authenticate);

router.get('/sales', async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }

  const metrics = await storage.getSalesMetrics(userId);
  return res.json(metrics);
});

export default router;
