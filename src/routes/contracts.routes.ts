import { Router, type Response } from "express";
import { z } from "zod";
import { authenticateOrMvp, type AuthenticatedRequest } from "../middleware/auth.js";
import { clauseService } from "../services/contracts/clause.service.js";
import { contractRenderService } from "../services/contracts/contract-render.service.js";
import { contractService } from "../services/contracts/contract.service.js";
import { templateService } from "../services/contracts/template.service.js";

const router = Router();

router.use(authenticateOrMvp);

/* ---------------- SCHEMAS ---------------- */

const contractIdSchema = z.coerce.number().int().positive();

const clauseIdSchema = z.string().uuid();

const createContractSchema = z.object({
  client_name: z.string().trim().min(2).max(140),
  profession: z.string().trim().min(2).max(80).optional(),
  contract_type: z.string().trim().min(2).max(120),
  execution_date: z.coerce.date(),
  contract_value: z.coerce.number().positive().max(9999999999.99),
  payment_method: z.string().trim().min(2).max(120),
  service_scope: z.string().trim().min(5).max(15000)
});

const addClauseSchema = z.object({
  clause_id: z.string().uuid()
});

const updateClauseSchema = z.object({
  custom_content: z.string().trim().min(1).max(30000)
});

const reorderSchema = z.object({
  startIndex: z.coerce.number().int().min(0),
  endIndex: z.coerce.number().int().min(0)
});

const layoutSchema = z.object({
  layout_config: z.record(z.unknown())
});

/* ---------------- CREATE CONTRACT ---------------- */

router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: "Não autenticado." });
  }

  const parsed = createContractSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "Dados inválidos.",
      errors: parsed.error.flatten()
    });
  }

  const contract = await contractService.createContract({
    userId,
    clientName: parsed.data.client_name,
    profession: parsed.data.profession || "",
    contractType: parsed.data.contract_type,
    executionDate: parsed.data.execution_date,
    contractValue: parsed.data.contract_value.toFixed(2),
    paymentMethod: parsed.data.payment_method,
    serviceScope: parsed.data.service_scope
  });

  return res
    .status(201)
    .location(`/contracts/${contract.contractId}`)
    .json(contract);
});

/* ---------------- RENDER HTML (estática — deve vir antes de /:id) ---------------- */

router.post("/render", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: "Não autenticado." });
  }

  const bodySchema = z.object({
    contractId: z.coerce.number().int().positive()
  });

  const parsedBody = bodySchema.safeParse(req.body);

  if (!parsedBody.success) {
    return res.status(400).json({
      message: "Dados inválidos.",
      errors: parsedBody.error.flatten()
    });
  }

  const rendered = await contractRenderService.renderContract(
    parsedBody.data.contractId,
    userId
  );

  if (!rendered) {
    return res.status(404).json({ message: "Contrato não encontrado." });
  }

  return res.json({ html: rendered.html });
});

/* ---------------- GET CONTRACT ---------------- */

router.get("/:id", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: "Não autenticado." });
  }

  const parsedId = contractIdSchema.safeParse(req.params.id);

  if (!parsedId.success) {
    return res.status(400).json({ message: "ID inválido." });
  }

  const contract = await contractService.getContract(parsedId.data, userId);

  if (!contract) {
    return res.status(404).json({ message: "Contrato não encontrado." });
  }

  return res.json(contract);
});

/* ---------------- ADD CLAUSE ---------------- */

router.post("/:id/clauses", async (req: AuthenticatedRequest, res: Response) => {
  const parsedId = contractIdSchema.safeParse(req.params.id);

  if (!parsedId.success) {
    return res.status(400).json({ message: "ID inválido." });
  }

  const parsed = addClauseSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "Dados inválidos.",
      errors: parsed.error.flatten()
    });
  }

  const row = await clauseService.addClauseToContract(
    parsedId.data,
    parsed.data.clause_id
  );

  if (!row) {
    return res.status(404).json({
      message: "Contrato ou cláusula não encontrado."
    });
  }

  return res.status(201).json(row);
});

/* ---------------- REMOVE CLAUSE ---------------- */

router.delete("/:id/clauses/:clauseId", async (req: AuthenticatedRequest, res: Response) => {
  const parsedId = contractIdSchema.safeParse(req.params.id);
  const parsedClauseId = clauseIdSchema.safeParse(req.params.clauseId);

  if (!parsedId.success || !parsedClauseId.success) {
    return res.status(400).json({ message: "IDs inválidos." });
  }

  const removed = await clauseService.removeClauseFromContract(
    parsedId.data,
    parsedClauseId.data
  );

  if (!removed) {
    return res.status(404).json({
      message: "Cláusula associada não encontrada."
    });
  }

  return res.json({ ok: true });
});

/* ---------------- UPDATE CLAUSE ---------------- */

router.patch("/:id/clauses/:clauseId", async (req: AuthenticatedRequest, res: Response) => {
  const parsedId = contractIdSchema.safeParse(req.params.id);
  const parsedClauseId = clauseIdSchema.safeParse(req.params.clauseId);

  if (!parsedId.success || !parsedClauseId.success) {
    return res.status(400).json({ message: "IDs inválidos." });
  }

  const parsedBody = updateClauseSchema.safeParse(req.body);

  if (!parsedBody.success) {
    return res.status(400).json({
      message: "Dados inválidos.",
      errors: parsedBody.error.flatten()
    });
  }

  const updated = await clauseService.updateClauseContent(
    parsedId.data,
    parsedClauseId.data,
    parsedBody.data.custom_content
  );

  if (!updated) {
    return res.status(404).json({
      message: "Cláusula associada não encontrada."
    });
  }

  return res.json(updated);
});

/* ---------------- REORDER CLAUSES ---------------- */

router.patch("/:id/clauses/reorder", async (req: AuthenticatedRequest, res: Response) => {
  const parsedId = contractIdSchema.safeParse(req.params.id);

  if (!parsedId.success) {
    return res.status(400).json({ message: "ID inválido." });
  }

  const parsedBody = reorderSchema.safeParse(req.body);

  if (!parsedBody.success) {
    return res.status(400).json({
      message: "Dados inválidos.",
      errors: parsedBody.error.flatten()
    });
  }

  if (parsedBody.data.startIndex === parsedBody.data.endIndex) {
    return res.json({ ok: true });
  }

  const reordered = await clauseService.reorderClauses(
    parsedId.data,
    parsedBody.data.startIndex,
    parsedBody.data.endIndex
  );

  if (!reordered) {
    return res.status(400).json({
      message: "Índices inválidos para reordenação."
    });
  }

  return res.json({ ok: true });
});

/* ---------------- UPDATE LAYOUT ---------------- */

router.patch("/:id/layout", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: "Não autenticado." });
  }

  const parsedId = contractIdSchema.safeParse(req.params.id);

  if (!parsedId.success) {
    return res.status(400).json({ message: "ID inválido." });
  }

  const parsedBody = layoutSchema.safeParse(req.body);

  if (!parsedBody.success) {
    return res.status(400).json({
      message: "Dados inválidos.",
      errors: parsedBody.error.flatten()
    });
  }

  const plan = await templateService.checkUserPlan(userId);

  if (plan !== "premium" && Object.keys(parsedBody.data.layout_config).length > 0) {
    return res.status(403).json({
      message: "Personalização completa disponível apenas no plano premium."
    });
  }

  const updated = await contractService.updateContractLayout(
    parsedId.data,
    userId,
    parsedBody.data.layout_config
  );

  if (!updated) {
    return res.status(404).json({ message: "Contrato não encontrado." });
  }

  return res.json(updated);
});

/* ---------------- GENERATE PDF ---------------- */

router.post("/:id/pdf", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: "Não autenticado." });
  }

  const parsedId = contractIdSchema.safeParse(req.params.id);

  if (!parsedId.success) {
    return res.status(400).json({ message: "ID inválido." });
  }

  const pdfBuffer = await contractRenderService.generateContractPDF(
    parsedId.data,
    userId
  );

  if (!pdfBuffer) {
    return res.status(404).json({ message: "Contrato não encontrado." });
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=contrato-${parsedId.data}.pdf`
  );

  return res.send(pdfBuffer);
});

export default router;