import { Router } from 'express';
import { z } from 'zod';
import { authenticateOrMvp } from '../middleware/auth.js';
import { clauseService } from '../services/contracts/clause.service.js';
import { buildLegalBlueprintBundle } from '../services/contracts/legal-blueprint.js';

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

const blueprintQuerySchema = z.object({
  audience: optionalQuery,
  riskLevel: optionalQuery,
  contractModels: optionalQuery,
  personalData: optionalQuery,
  sensitiveData: optionalQuery,
  sourceCodeDelivery: optionalQuery,
});

router.get('/catalog/blueprint', async (req, res) => {
  try {
    const parsed = blueprintQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Filtro invalido.',
        errors: parsed.error.flatten()
      });
    }

    const contractModels = parsed.data.contractModels
      ? parsed.data.contractModels
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : undefined;

    const bundle = buildLegalBlueprintBundle({
      audience: parsed.data.audience === 'b2c' ? 'b2c' : parsed.data.audience === 'b2b' ? 'b2b' : undefined,
      riskLevel:
        parsed.data.riskLevel === 'baixo' || parsed.data.riskLevel === 'medio' || parsed.data.riskLevel === 'alto'
          ? parsed.data.riskLevel
          : undefined,
      contractModels: contractModels as any,
      personalData: parsed.data.personalData === undefined ? undefined : parsed.data.personalData === 'true',
      sensitiveData: parsed.data.sensitiveData === undefined ? undefined : parsed.data.sensitiveData === 'true',
      sourceCodeDelivery:
        parsed.data.sourceCodeDelivery === undefined ? undefined : parsed.data.sourceCodeDelivery === 'true',
    });

    return res.json(bundle);
  } catch (error) {
    console.error('Erro ao montar blueprint juridico:', error);
    return res.status(500).json({
      message: 'Erro interno ao montar o blueprint juridico.'
    });
  }
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
