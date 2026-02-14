import { Router } from 'express';
import { z } from 'zod';
import { storage } from '../storage.js';
import { requirePlan } from "../middleware/requirePlan.js";
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);
router.use(requirePlan("pro"));

router.get("/advanced", async (req, res) => {
  // ...
});

const querySchema = z.object({
  category: z.string().trim().min(1).max(100).optional()
});

const templateIdSchema = z.coerce.number().int().positive();

router.get('/', async (req, res) => {
  const parsed = querySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Filtro inválido.' });
  }

  const data = await storage.listTemplates(parsed.data.category);
  return res.json(data);
});

router.get('/:id', async (req, res) => {
  const parsedId = templateIdSchema.safeParse(req.params.id);

  if (!parsedId.success) {
    return res.status(400).json({ message: 'ID inválido.' });
  }

  const template = await storage.getTemplateById(parsedId.data);

  if (!template) {
    return res.status(404).json({ message: 'Template não encontrado.' });
  }

  return res.json(template);
});

export default router;
