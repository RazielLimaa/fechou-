import { Router } from 'express';
import { z } from 'zod';
import { authenticateOrMvp } from '../middleware/auth.js';
import { clauseService } from '../services/contracts/clause.service.js';

const router = Router();

router.use(authenticateOrMvp);

/**
 * Normaliza valores vazios vindos da query
 * "" -> undefined
 */
const optionalQuery = z
  .string()
  .trim()
  .transform((val) => (val === '' ? undefined : val))
  .optional();

const querySchema = z.object({
  search: optionalQuery,
  category: optionalQuery,
  profession: optionalQuery
});

router.get('/', async (req, res) => {
  try {
    const parsed = querySchema.safeParse(req.query);

    if (!parsed.success) {
      return res.status(400).json({
        message: 'Filtro inválido.',
        errors: parsed.error.flatten()
      });
    }
    const { search, category, profession } = parsed.data;

    const result = await clauseService.searchClauses(
      search,
      category,
      profession
    );

    return res.json(result);
  } catch (error) {
    console.error('Erro ao buscar cláusulas:', error);

    return res.status(500).json({
      message: 'Erro interno ao buscar cláusulas.'
    });
  }
});

export default router;