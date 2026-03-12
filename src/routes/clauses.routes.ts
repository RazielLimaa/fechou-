import { Router } from 'express';
import { z } from 'zod';
import { authenticateOrMvp } from '../middleware/auth.js';
import { clauseService } from '../services/contracts/clause.service.js';

const router = Router();
router.use(authenticateOrMvp);

const querySchema = z.object({
  search: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  profession: z.string().trim().min(1).optional()
});

router.get('/', async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: 'Filtro inválido.', errors: parsed.error.flatten() });

  const result = await clauseService.searchClauses(parsed.data.search, parsed.data.category, parsed.data.profession);
  return res.json(result);
});

export default router;
