import { Router, type Response } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { and, eq } from "drizzle-orm";

import {
  authenticateOrMvp,
  type AuthenticatedRequest,
} from "../middleware/auth.js";

import { clauseService } from "../services/contracts/clause.service.js";
import { contractRenderService } from "../services/contracts/contract-render.service.js";
import { contractService } from "../services/contracts/contract.service.js";
import { templateService } from "../services/contracts/template.service.js";
import {
  handleLogoMulter,
  validateLogoUpload,
  bufferToDataUrl,
} from "../middleware/logo-upload.middleware.js";
import { uploadRateLimiter } from "../middleware/security.js";
import {
  decryptSignature,
  deserializeEncryptedSignature,
  encryptSignature,
  extractPngBufferFromDataUrl,
} from "../lib/signatureCrypto.js";
import { db } from "../db/index.js";
import { contracts, users } from "../db/schema.js";

const router = Router();

router.use(authenticateOrMvp);

/*
|--------------------------------------------------------------------------
| SCHEMAS
|--------------------------------------------------------------------------
*/

const contractIdSchema = z.coerce.number().int().positive();

const clauseIdSchema = z.union([
  z.string().uuid(),
  z.coerce.number().int().positive(),
]);

const createContractSchema = z.object({
  client_name:     z.string().trim().min(2).max(140),
  profession:      z.string().trim().min(2).max(80),
  contract_type:   z.string().trim().min(2).max(120),
  execution_date:  z.coerce.date(),
  contract_value:  z.coerce.number().positive().max(9_999_999_999.99),
  payment_method:  z.string().trim().min(2).max(120),
  service_scope:   z.string().trim().min(5).max(15_000),
});

const addClauseSchema = z.object({
  clause_id: z.union([z.string().uuid(), z.coerce.number().int().positive()]),
});

const updateClauseSchema = z.object({
  custom_content: z.string().trim().min(1).max(30_000),
});

const reorderSchema = z.object({
  startIndex: z.coerce.number().int().min(0),
  endIndex:   z.coerce.number().int().min(0),
});

const layoutSchema = z.object({
  layout_config: z.record(z.unknown()),
});

const shareLinkSchema = z.object({
  expiresInHours: z.coerce.number().int().min(1).max(24 * 30).default(72),
});

const markPaidSchema = z.object({
  note:          z.string().trim().max(500).optional(),
  payerName:     z.string().trim().max(140).optional(),
  payerDocument: z.string().trim().max(40).optional(),
});

/*
|--------------------------------------------------------------------------
| CREATE CONTRACT
| POST /api/contracts
|--------------------------------------------------------------------------
*/

router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsed = createContractSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ message: "Dados inválidos.", errors: parsed.error.flatten() });

  const contract = await contractService.createContract({
    userId,
    clientName:    parsed.data.client_name,
    profession:    parsed.data.profession,
    contractType:  parsed.data.contract_type,
    executionDate: parsed.data.execution_date,
    contractValue: parsed.data.contract_value.toFixed(2),
    paymentMethod: parsed.data.payment_method,
    serviceScope:  parsed.data.service_scope,
  });

  return res.status(201).json(contract);
});

/*
|--------------------------------------------------------------------------
| RENDER CONTRACT
| POST /api/contracts/render
|--------------------------------------------------------------------------
*/

router.post("/render", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const schema = z.object({ contractId: z.coerce.number().int().positive() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados inválidos.", errors: parsed.error.flatten() });
  }

  const rendered = await contractRenderService.renderContract(parsed.data.contractId, userId);
  if (!rendered) return res.status(404).json({ message: "Contrato não encontrado." });

  return res.json({ html: rendered.html });
});

/*
|--------------------------------------------------------------------------
| SAVE PROVIDER SIGNATURE — perfil do usuário (reutilizável)
| POST /api/contracts/provider-signature
|
| ATENÇÃO: deve vir ANTES das rotas /:id para não ser capturada pelo parâmetro
|--------------------------------------------------------------------------
*/

router.post("/provider-signature", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const schema = z.object({
    // Não usar .trim() — pode truncar o prefixo "data:image/png;base64,"
    signatureDataUrl: z.string().min(30).max(2_500_000),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados inválidos.", errors: parsed.error.flatten() });
  }

  // Normaliza e garante prefixo correto independente de truncamento no proxy
  let rawDataUrl = parsed.data.signatureDataUrl.trim();

  if (!rawDataUrl.startsWith("data:")) {
    // Reconstrói prefixo — suporta variações de truncamento
    if (rawDataUrl.startsWith("image/png;base64,")) {
      rawDataUrl = "data:" + rawDataUrl;
    } else if (rawDataUrl.startsWith("png;base64,")) {
      rawDataUrl = "data:image/" + rawDataUrl;
    } else if (rawDataUrl.startsWith("base64,")) {
      rawDataUrl = "data:image/png;" + rawDataUrl;
    } else if (/^[A-Za-z0-9+/]/.test(rawDataUrl)) {
      // Só o payload base64 puro — adiciona prefixo completo
      rawDataUrl = "data:image/png;base64," + rawDataUrl;
    }
  }

  let signatureBuffer: Buffer;
  try {
    signatureBuffer = extractPngBufferFromDataUrl(rawDataUrl);
  } catch (err: any) {
    return res.status(400).json({ message: err?.message ?? "Assinatura inválida." });
  }

  let encrypted;
  try {
    encrypted = encryptSignature(signatureBuffer, {
      proposalId:     userId,
      signerName:     `provider:${userId}`,
      signerDocument: `uid-${String(userId).padStart(5, '0')}`,
    });
  } catch (err: any) {
    return res.status(500).json({ message: err?.message ?? "Falha ao proteger assinatura." });
  }

  await db
    .update(users)
    .set({
      providerSignatureCiphertext: encrypted.ciphertext.toString("base64"),
      providerSignatureIv:         encrypted.iv.toString("base64"),
      providerSignatureAuthTag:    encrypted.authTag.toString("base64"),
      providerSignatureUpdatedAt:  new Date(),
    } as any)
    .where(eq(users.id, userId));

  return res.status(201).json({ ok: true });
});

/*
|--------------------------------------------------------------------------
| GET PROVIDER SIGNATURE — perfil do usuário
| GET /api/contracts/provider-signature
|--------------------------------------------------------------------------
*/

router.get("/provider-signature", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const [row] = await db.select().from(users).where(eq(users.id, userId));
  if (!row) return res.status(404).json({ message: "Usuário não encontrado." });

  const u = row as any;
  const ciphertext = u.providerSignatureCiphertext ?? u.provider_signature_ciphertext ?? null;
  const iv         = u.providerSignatureIv         ?? u.provider_signature_iv         ?? null;
  const authTag    = u.providerSignatureAuthTag     ?? u.provider_signature_auth_tag   ?? null;

  if (!ciphertext || !iv || !authTag) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(204).end();
  }

  let cryptoBuffers: { ciphertext: Buffer; iv: Buffer; authTag: Buffer };
  try {
    cryptoBuffers = deserializeEncryptedSignature({ ciphertextB64: ciphertext, ivB64: iv, authTagB64: authTag });
  } catch {
    return res.status(500).json({ message: "Dados de assinatura corrompidos." });
  }

  let pngBuffer: Buffer;
  try {
    pngBuffer = decryptSignature(cryptoBuffers, {
      proposalId:     userId,
      signerName:     `provider:${userId}`,
      signerDocument: `uid-${String(userId).padStart(5, '0')}`,
    });
  } catch {
    return res.status(422).json({ message: "Assinatura não pôde ser verificada." });
  }

  res.setHeader("Content-Type",                 "image/png");
  res.setHeader("Content-Length",               pngBuffer.length);
  res.setHeader("Content-Disposition",          "inline");
  res.setHeader("Cache-Control",                "private, max-age=300");
  res.setHeader("X-Content-Type-Options",       "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  return res.send(pngBuffer);
});

/*
|--------------------------------------------------------------------------
| DELETE PROVIDER SIGNATURE — perfil do usuário
| DELETE /api/contracts/provider-signature
|--------------------------------------------------------------------------
*/

router.delete("/provider-signature", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  await db
    .update(users)
    .set({
      providerSignatureCiphertext: null,
      providerSignatureIv:         null,
      providerSignatureAuthTag:    null,
      providerSignatureUpdatedAt:  null,
    } as any)
    .where(eq(users.id, userId));

  return res.json({ ok: true });
});

/*
|--------------------------------------------------------------------------
| LIST CONTRACTS
| GET /api/contracts
|--------------------------------------------------------------------------
*/

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const contracts = await contractService.listContracts(userId);
  return res.json(contracts);
});

/*
|--------------------------------------------------------------------------
| GET CONTRACT
| GET /api/contracts/:id
|--------------------------------------------------------------------------
*/

router.get("/:id", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const contract = await contractService.getContract(parsedId.data, userId);
  if (!contract) return res.status(404).json({ message: "Contrato não encontrado." });

  return res.json(contract);
});

/*
|--------------------------------------------------------------------------
| ADD CLAUSE
| POST /api/contracts/:id/clauses
|--------------------------------------------------------------------------
*/

router.post("/:id/clauses", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedContractId = contractIdSchema.safeParse(req.params.id);
  if (!parsedContractId.success) return res.status(400).json({ message: "ID inválido." });

  const parsedBody = addClauseSchema.safeParse(req.body);
  if (!parsedBody.success)
    return res.status(400).json({ message: "Dados inválidos.", errors: parsedBody.error.flatten() });

  const result = await clauseService.addClauseToContractOwned(
    userId,
    parsedContractId.data,
    String(parsedBody.data.clause_id)
  );
  if (!result) return res.status(404).json({ message: "Contrato ou cláusula não encontrado." });

  return res.status(201).json(result);
});

/*
|--------------------------------------------------------------------------
| REORDER CLAUSES
| PATCH /api/contracts/:id/clauses/reorder
| ATENÇÃO: deve vir ANTES de /:id/clauses/:clauseId
|--------------------------------------------------------------------------
*/

router.patch("/:id/clauses/reorder", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const parsedBody = reorderSchema.safeParse(req.body);
  if (!parsedBody.success)
    return res.status(400).json({ message: "Dados inválidos.", errors: parsedBody.error.flatten() });

  const reordered = await clauseService.reorderClausesOwned(
    userId,
    parsedId.data,
    parsedBody.data.startIndex,
    parsedBody.data.endIndex
  );
  if (!reordered) return res.status(400).json({ message: "Índices inválidos para reordenação." });

  return res.json(reordered);
});

/*
|--------------------------------------------------------------------------
| UPDATE CLAUSE CONTENT
| PATCH /api/contracts/:id/clauses/:clauseId
|--------------------------------------------------------------------------
*/

router.patch("/:id/clauses/:clauseId", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedContractId = contractIdSchema.safeParse(req.params.id);
  const parsedClauseId   = clauseIdSchema.safeParse(req.params.clauseId);
  if (!parsedContractId.success || !parsedClauseId.success)
    return res.status(400).json({ message: "IDs inválidos." });

  const parsedBody = updateClauseSchema.safeParse(req.body);
  if (!parsedBody.success)
    return res.status(400).json({ message: "Dados inválidos.", errors: parsedBody.error.flatten() });

  const updated = await clauseService.updateClauseContentOwned(
    userId,
    parsedContractId.data,
    parsedClauseId.data.toString(),
    parsedBody.data.custom_content
  );
  if (!updated) return res.status(404).json({ message: "Cláusula associada não encontrada." });

  return res.json(updated);
});

/*
|--------------------------------------------------------------------------
| REMOVE CLAUSE
| DELETE /api/contracts/:id/clauses/:clauseId
|--------------------------------------------------------------------------
*/

router.delete("/:id/clauses/:clauseId", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedContractId = contractIdSchema.safeParse(req.params.id);
  const parsedClauseId   = clauseIdSchema.safeParse(req.params.clauseId);
  if (!parsedContractId.success || !parsedClauseId.success)
    return res.status(400).json({ message: "IDs inválidos." });

  const removed = await clauseService.removeClauseFromContractOwned(
    userId,
    parsedContractId.data,
    parsedClauseId.data.toString()
  );
  if (!removed) return res.status(404).json({ message: "Cláusula associada não encontrada." });

  return res.json({ ok: true });
});

/*
|--------------------------------------------------------------------------
| UPDATE LAYOUT
| PATCH /api/contracts/:id/layout
|--------------------------------------------------------------------------
*/

router.patch("/:id/layout", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const parsedBody = layoutSchema.safeParse(req.body);
  if (!parsedBody.success)
    return res.status(400).json({ message: "Dados inválidos.", errors: parsedBody.error.flatten() });

  // Busca plano com fallback — não deixa 500 se checkUserPlan falhar
  let plan = "free";
  try {
    plan = await templateService.checkUserPlan(userId) ?? "free";
  } catch {
    plan = "free";
  }

  const lc = parsedBody.data.layout_config as Record<string, unknown>;

  // free: não salva nenhuma customização visual
  // pro: pode salvar cor, fonte, branding, blocos, customTextBlocks
  // premium: pode salvar tudo incluindo logo
  if (plan === "free") {
    // Free não personaliza — salva layoutConfig vazio para não quebrar o contrato
    const updated = await contractService.updateContractLayout(parsedId.data, userId, {});
    if (!updated) return res.status(404).json({ message: "Contrato não encontrado." });
    return res.json(updated);
  }

  if (plan === "pro") {
    // Pro pode salvar tudo exceto logoUrl (logo é premium)
    const { logoUrl: _logo, ...proLayout } = lc as any;
    const updated = await contractService.updateContractLayout(parsedId.data, userId, proLayout);
    if (!updated) return res.status(404).json({ message: "Contrato não encontrado." });
    return res.json(updated);
  }

  // Premium: salva tudo
  const updated = await contractService.updateContractLayout(
    parsedId.data,
    userId,
    lc
  );
  if (!updated) return res.status(404).json({ message: "Contrato não encontrado." });

  return res.json(updated);
});

/*
|--------------------------------------------------------------------------
| GENERATE PDF
| POST /api/contracts/:id/pdf
|--------------------------------------------------------------------------
*/

router.post("/:id/pdf", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  // Verifica ownership do contrato antes de gerar — evita geração para contratos de outros usuários
  const contract = await contractService.getContract(parsedId.data, userId);
  if (!contract) return res.status(404).json({ message: "Contrato não encontrado." });

  // Busca plano aqui também — defesa em profundidade
  // O generateContractPDF faz a mesma verificação internamente,
  // mas ter aqui garante que mesmo se o service for alterado, a rota protege
  let plan = 'free';
  try { plan = await templateService.checkUserPlan(userId) ?? 'free'; } catch { plan = 'free'; }

  const pdfBuffer = await contractRenderService.generateContractPDF(parsedId.data, userId);
  if (!pdfBuffer) return res.status(500).json({ message: "Erro ao gerar PDF. Verifique se o Puppeteer está instalado." });

  // Força nome do arquivo e impede cache do browser
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=contrato-${parsedId.data}.pdf`);
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  // Header informativo do plano (não afeta segurança, útil para debug)
  res.setHeader("X-Plan", plan);
  return res.send(pdfBuffer);
});

/*
|--------------------------------------------------------------------------
| UPLOAD LOGO
| POST /api/contracts/:id/logo
|--------------------------------------------------------------------------
*/

router.post(
  "/:id/logo",
  uploadRateLimiter,
  handleLogoMulter,
  validateLogoUpload,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Não autenticado." });

    const parsedId = contractIdSchema.safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

    const plan = await templateService.checkUserPlan(userId);
    if (plan === "free")
      return res.status(403).json({ message: "Upload de logo disponível apenas nos planos Pro e Premium." });

    const contract = await contractService.getContract(parsedId.data, userId);
    if (!contract) return res.status(404).json({ message: "Contrato não encontrado." });

    const dataUrl = bufferToDataUrl(req.file!);
    const updated = await contractService.updateContractLogo(parsedId.data, userId, dataUrl);
    if (!updated) return res.status(404).json({ message: "Contrato não encontrado." });

    return res.json({ logoUrl: updated.logoUrl });
  }
);

/*
|--------------------------------------------------------------------------
| REMOVE LOGO
| DELETE /api/contracts/:id/logo
|--------------------------------------------------------------------------
*/

router.delete("/:id/logo", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const updated = await contractService.updateContractLogo(parsedId.data, userId, null);
  if (!updated) return res.status(404).json({ message: "Contrato não encontrado." });

  return res.json({ ok: true });
});

/*
|--------------------------------------------------------------------------
| GET SIGNATURE IMAGE (contratante)
| GET /api/contracts/:id/signature
|--------------------------------------------------------------------------
*/

router.get("/:id/signature", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const contract = await contractService.getContract(parsedId.data, userId);
  if (!contract) return res.status(404).json({ message: "Contrato não encontrado." });

  const signatureRecord = await contractService.getContractSignature(parsedId.data, userId);
  if (!signatureRecord) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(204).end();
  }

  let cryptoBuffers: { ciphertext: Buffer; iv: Buffer; authTag: Buffer };
  try {
    cryptoBuffers = deserializeEncryptedSignature({
      ciphertextB64: signatureRecord.ciphertextB64,
      ivB64:         signatureRecord.ivB64,
      authTagB64:    signatureRecord.authTagB64,
    });
  } catch {
    return res.status(500).json({ message: "Dados de assinatura corrompidos." });
  }

  let pngBuffer: Buffer;
  try {
    pngBuffer = decryptSignature(cryptoBuffers, {
      proposalId:     signatureRecord.proposalId,
      signerName:     signatureRecord.signerName,
      signerDocument: signatureRecord.signerDocument,
    });
  } catch {
    return res.status(422).json({ message: "Assinatura não pôde ser verificada." });
  }

  res.setHeader("Content-Type",                 "image/png");
  res.setHeader("Content-Length",               pngBuffer.length);
  res.setHeader("Content-Disposition",          "inline");
  res.setHeader("Cache-Control",                "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma",                       "no-cache");
  res.setHeader("X-Content-Type-Options",       "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  return res.send(pngBuffer);
});

/*
|--------------------------------------------------------------------------
| APPLY PROVIDER SIGNATURE TO CONTRACT
| POST /api/contracts/:id/provider-signature
|--------------------------------------------------------------------------
*/

router.post("/:id/provider-signature", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const contract = await contractService.getContract(parsedId.data, userId);
  if (!contract) return res.status(404).json({ message: "Contrato não encontrado." });

  const [row] = await db.select().from(users).where(eq(users.id, userId));
  if (!row) return res.status(404).json({ message: "Usuário não encontrado." });

  const u = row as any;
  const ciphertext = u.providerSignatureCiphertext ?? u.provider_signature_ciphertext ?? null;
  const iv         = u.providerSignatureIv         ?? u.provider_signature_iv         ?? null;
  const authTag    = u.providerSignatureAuthTag     ?? u.provider_signature_auth_tag   ?? null;

  if (!ciphertext || !iv || !authTag)
    return res.status(404).json({ message: "Nenhuma assinatura salva no perfil. Desenhe e salve primeiro." });

  // Descriptografa com AAD do perfil
  let pngBuffer: Buffer;
  try {
    const cryptoBuffers = deserializeEncryptedSignature({ ciphertextB64: ciphertext, ivB64: iv, authTagB64: authTag });
    pngBuffer = decryptSignature(cryptoBuffers, {
      proposalId:     userId,
      signerName:     `provider:${userId}`,
      signerDocument: `uid-${String(userId).padStart(5, '0')}`,
    });
  } catch {
    return res.status(422).json({ message: "Assinatura do perfil não pôde ser verificada." });
  }

  // Re-criptografa com AAD específico do contrato (rastreabilidade)
  let reEncrypted;
  try {
    reEncrypted = encryptSignature(pngBuffer, {
      proposalId:     parsedId.data,
      signerName:     `provider:${userId}`,
      signerDocument: `uid-${String(userId).padStart(5, '0')}`,
    });
  } catch (err: any) {
    return res.status(500).json({ message: err?.message ?? "Falha ao proteger assinatura." });
  }

  const now = new Date();

  await db
    .update(contracts)
    .set({
      providerSignedAt:           now,
      providerContractCiphertext: reEncrypted.ciphertext.toString("base64"),
      providerContractIv:         reEncrypted.iv.toString("base64"),
      providerContractAuthTag:    reEncrypted.authTag.toString("base64"),
      updatedAt:                  now,
    } as any)
    .where(and(eq(contracts.id, parsedId.data), eq(contracts.userId, userId)));

  return res.status(201).json({ ok: true, providerSignedAt: now });
});

/*
|--------------------------------------------------------------------------
| GET PROVIDER SIGNATURE FOR CONTRACT (contratado)
| GET /api/contracts/:id/provider-signature
|--------------------------------------------------------------------------
*/

router.get("/:id/provider-signature", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const contract = await contractService.getContract(parsedId.data, userId);
  if (!contract) return res.status(404).json({ message: "Contrato não encontrado." });

  const c = contract as any;
  const ciphertext = c.providerContractCiphertext ?? null;
  const iv         = c.providerContractIv         ?? null;
  const authTag    = c.providerContractAuthTag     ?? null;

  if (!ciphertext || !iv || !authTag) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(204).end();
  }

  let cryptoBuffers: { ciphertext: Buffer; iv: Buffer; authTag: Buffer };
  try {
    cryptoBuffers = deserializeEncryptedSignature({ ciphertextB64: ciphertext, ivB64: iv, authTagB64: authTag });
  } catch {
    return res.status(500).json({ message: "Dados de assinatura corrompidos." });
  }

  let pngBuffer: Buffer;
  try {
    pngBuffer = decryptSignature(cryptoBuffers, {
      proposalId:     parsedId.data,
      signerName:     `provider:${userId}`,
      signerDocument: `uid-${String(userId).padStart(5, '0')}`,
    });
  } catch {
    return res.status(422).json({ message: "Assinatura não pôde ser verificada." });
  }

  res.setHeader("Content-Type",                 "image/png");
  res.setHeader("Content-Length",               pngBuffer.length);
  res.setHeader("Content-Disposition",          "inline");
  res.setHeader("Cache-Control",                "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma",                       "no-cache");
  res.setHeader("X-Content-Type-Options",       "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  return res.send(pngBuffer);
});

/*
|--------------------------------------------------------------------------
| GENERATE SHARE LINK
| POST /api/contracts/:id/share-link
|--------------------------------------------------------------------------
*/

router.post("/:id/share-link", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const parsedBody = shareLinkSchema.safeParse(req.body ?? {});
  if (!parsedBody.success)
    return res.status(400).json({ message: "Dados inválidos.", errors: parsedBody.error.flatten() });

  const contract = await contractService.getContract(parsedId.data, userId);
  if (!contract) return res.status(404).json({ message: "Contrato não encontrado." });

  const rawToken  = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + parsedBody.data.expiresInHours * 60 * 60 * 1000);

  await contractService.setContractShareToken(parsedId.data, userId, tokenHash, expiresAt);

  return res.status(201).json({
    shareToken:    rawToken,
    expiresAt,
    publicUrlPath: `/c/${rawToken}`,
  });
});

/*
|--------------------------------------------------------------------------
| CONFIRM MANUAL PAYMENT (PIX)
| POST /api/contracts/:id/mark-paid
|--------------------------------------------------------------------------
*/

router.post("/:id/mark-paid", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const parsedBody = markPaidSchema.safeParse(req.body ?? {});
  if (!parsedBody.success)
    return res.status(400).json({ message: "Dados inválidos.", errors: parsedBody.error.flatten() });

  const contract = await contractService.getContract(parsedId.data, userId);
  if (!contract) return res.status(404).json({ message: "Contrato não encontrado." });

  const c = contract as any;

  if (!c.signedAt)
    return res.status(409).json({ message: "O contrato precisa estar assinado antes de confirmar pagamento." });

  if (c.lifecycleStatus === "PAID")
    return res.status(200).json({ ok: true, message: "Pagamento já confirmado." });

  if (c.lifecycleStatus === "CANCELLED")
    return res.status(409).json({ message: "Contrato cancelado. Não é possível confirmar pagamento." });

  const updated = await contractService.markContractPaid(parsedId.data, userId, {
    note:          parsedBody.data.note,
    payerName:     parsedBody.data.payerName,
    payerDocument: parsedBody.data.payerDocument,
  });
  if (!updated) return res.status(404).json({ message: "Contrato não encontrado." });

  return res.status(201).json({ ok: true, contractId: parsedId.data });
});

/*
|--------------------------------------------------------------------------
| CANCEL CONTRACT
| PATCH /api/contracts/:id/cancel
|--------------------------------------------------------------------------
*/

router.patch("/:id/cancel", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsedId = contractIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "ID inválido." });

  const contract = await contractService.getContract(parsedId.data, userId);
  if (!contract) return res.status(404).json({ message: "Contrato não encontrado." });

  const cc = contract as any;

  if (cc.lifecycleStatus === "PAID")
    return res.status(409).json({ message: "Não é possível cancelar um contrato já pago." });

  if (cc.lifecycleStatus === "CANCELLED" || cc.status === "cancelled" || cc.status === "cancelado")
    return res.status(409).json({ message: "Este contrato já está cancelado." });

  const updated = await contractService.cancelContract(parsedId.data, userId);
  if (!updated) return res.status(404).json({ message: "Contrato não encontrado." });

  return res.json({ ok: true, contractId: parsedId.data });
});

export default router;
