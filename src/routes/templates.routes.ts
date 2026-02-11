import { Router } from 'express';
import { z } from 'zod';
import { storage } from '../storage.js';

const router = Router();

const querySchema = z.object({
  category: z.string().optional()
});

router.get('/', async (req, res) => {
  const parsed = querySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Filtro inválido.' });
  }

  const data = await storage.listTemplates(parsed.data.category);
  return res.json(data);
});

router.get('/:id', async (req, res) => {
  const templateId = Number(req.params.id);

  if (Number.isNaN(templateId)) {
    return res.status(400).json({ message: 'ID inválido.' });
  }

  const template = await storage.getTemplateById(templateId);

  if (!template) {
    return res.status(404).json({ message: 'Template não encontrado.' });
  }

  return res.json(template);
});

export default router;
