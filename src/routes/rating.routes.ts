import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import crypto from "node:crypto";
import { authenticateOrMvp, type AuthenticatedRequest } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { contractRatings, proposals } from "../db/schema.js";
import { scoreService } from "../services/score.sevice.js";

const router = Router();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const submitRatingSchema = z.object({
  contractId: z.number().int().positive(),
  publicToken: z.string().trim().length(64).regex(/^[a-f0-9]{64}$/i),
  raterName:  z.string().trim().min(2).max(120),
  stars:      z.number().int().min(1).max(5),
  comment:    z.string().trim().max(500).optional().nullable(),
});

// ─── POST /api/ratings ────────────────────────────────────────────────────────
// Pública — chamada pelo cliente ao concluir assinatura ou pagamento.

router.post("/", async (req: Request, res: Response) => {
  const parsed = submitRatingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados inválidos.", errors: parsed.error.flatten() });
  }

  const { contractId, publicToken, raterName, stars, comment } = parsed.data;

  try {
    // Verifica se contrato existe e foi assinado
    // Uses `contractSignedAt` (non-null means signed) and `lifecycleStatus` as fallback check
    const [proposal] = await db
      .select({
        id:              proposals.id,
        contractSignedAt: proposals.contractSignedAt,
        userId:          proposals.userId,
        shareTokenHash:  proposals.shareTokenHash,
        shareTokenExpiresAt: proposals.shareTokenExpiresAt,
      })
      .from(proposals)
      .where(eq(proposals.id, contractId));

    if (!proposal) {
      return res.status(404).json({ message: "Contrato não encontrado." });
    }
    if (!proposal.contractSignedAt) {
      return res.status(422).json({ message: "O contrato precisa estar assinado para receber avaliação." });
    }
    const tokenHash = crypto.createHash("sha256").update(publicToken.toLowerCase()).digest("hex");
    if (!proposal.shareTokenHash || proposal.shareTokenHash !== tokenHash) {
      return res.status(403).json({ message: "Token público inválido para avaliação." });
    }
    if (!proposal.shareTokenExpiresAt || proposal.shareTokenExpiresAt.getTime() < Date.now()) {
      return res.status(403).json({ message: "Token público expirado para avaliação." });
    }

    // Idempotência — evita avaliação duplicada
    const [existing] = await db
      .select({ id: contractRatings.id })
      .from(contractRatings)
      .where(eq(contractRatings.contractId, contractId));

    if (existing) {
      return res.status(409).json({ message: "Este contrato já foi avaliado.", ratingId: existing.id });
    }

    // Insere avaliação
    const [inserted] = await db
      .insert(contractRatings)
      .values({
        contractId,
        userId: proposal.userId,
        raterName: raterName.trim(),
        stars,
        comment: comment?.trim() ?? null,
        createdAt: new Date(),
      })
      .returning({ id: contractRatings.id });

    // Recalcula score do freelancer em background
    // Call whichever method your ScoreService exposes (e.g. recalculateForUser, update, etc.)
  // Recalcula score do freelancer em background
scoreService.recalculateScore(proposal.userId).catch((err: unknown) =>
  console.error("[ratings] Erro ao recalcular score:", err)
);

    return res.status(201).json({ ok: true, ratingId: inserted.id });
  } catch (err: unknown) {
    console.error("[ratings POST /]", err instanceof Error ? err.message : err);
    return res.status(500).json({ message: "Erro ao registrar avaliação." });
  }
});

// ─── GET /api/ratings/contract/:contractId ────────────────────────────────────
// Pública — verifica se contrato já foi avaliado e retorna a nota.

router.get("/contract/:contractId", async (req: Request, res: Response) => {
  const id = Number(req.params.contractId);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "ID inválido." });
  }

  try {
    const [rating] = await db
      .select({
        id:        contractRatings.id,
        stars:     contractRatings.stars,
        comment:   contractRatings.comment,
        raterName: contractRatings.raterName,
        createdAt: contractRatings.createdAt,
      })
      .from(contractRatings)
      .where(eq(contractRatings.contractId, id));

    if (!rating) {
      return res.json({ rated: false });
    }
    return res.json({ rated: true, ...rating });
  } catch (err: unknown) {
    console.error("[ratings GET /contract]", err instanceof Error ? err.message : err);
    return res.status(500).json({ message: "Erro ao buscar avaliação." });
  }
});

// ─── GET /api/ratings/me ─────────────────────────────────────────────────────
// Autenticada — freelancer vê todas as suas avaliações.

router.get("/me", authenticateOrMvp, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  try {
    const rows = await db
      .select({
        id:         contractRatings.id,
        contractId: contractRatings.contractId,
        raterName:  contractRatings.raterName,
        stars:      contractRatings.stars,
        comment:    contractRatings.comment,
        createdAt:  contractRatings.createdAt,
      })
      .from(contractRatings)
      .where(eq(contractRatings.userId, userId))
      .orderBy(desc(contractRatings.createdAt));

    const total = rows.length;
    const avgStars = total > 0
      ? rows.reduce((sum, r) => sum + r.stars, 0) / total
      : 0;

    return res.json({
      avgStars: Math.round(avgStars * 10) / 10,
      totalRatings: total,
      ratings: rows,
    });
  } catch (err: unknown) {
    console.error("[ratings GET /me]", err instanceof Error ? err.message : err);
    return res.status(500).json({ message: "Erro ao buscar avaliações." });
  }
});

export default router;
