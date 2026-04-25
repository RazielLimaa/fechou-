import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import crypto from "node:crypto";
import { rateLimit } from "express-rate-limit";
import { authenticateOrMvp, type AuthenticatedRequest } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { contractRatings, contracts } from "../db/schema.js";
import { scoreService } from "../services/score.sevice.js";
import { distributedRateLimit } from "../middleware/distributed-security.js";

const router = Router();

const publicRatingLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_PUBLIC_RATING_MAX ?? 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Muitas requisições. Tente novamente em alguns instantes." },
});

const distributedPublicRatingLimiter = distributedRateLimit({
  scope: "public-rating",
  limit: Number(process.env.RATE_LIMIT_PUBLIC_RATING_MAX ?? 10),
  windowMs: 10 * 60 * 1000,
  key: (req) => `${req.ip}:${String(req.body?.contractId ?? req.body?.proposalId ?? "")}`,
});

const publicRatingReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_PUBLIC_RATING_READ_MAX ?? 180),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Muitas consultas de avaliação. Tente novamente em alguns instantes." },
});

const distributedPublicRatingReadLimiter = distributedRateLimit({
  scope: "public-rating-read",
  limit: Number(process.env.RATE_LIMIT_PUBLIC_RATING_READ_MAX ?? 180),
  windowMs: 15 * 60 * 1000,
  key: (req) => `${req.ip}:${String(req.params.proposalId ?? "")}:${String(req.query?.publicToken ?? "")}`,
});

const submitRatingSchema = z.object({
  proposalId: z.coerce.number().int().positive().optional(),
  contractId: z.coerce.number().int().positive().optional(),
  publicToken: z
    .string()
    .trim()
    .toLowerCase()
    .length(64)
    .regex(/^[a-f0-9]{64}$/),
  raterName: z
    .string()
    .trim()
    .min(2, "Nome muito curto.")
    .max(120, "Nome muito longo."),
  stars: z.coerce.number().int().min(1).max(5),
  comment: z
    .string()
    .trim()
    .max(500, "Comentário muito longo.")
    .optional()
    .nullable(),
}).superRefine((data, ctx) => {
  if (!data.contractId && !data.proposalId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contractId"],
      message: "ID do contrato é obrigatório.",
    });
  }
});

const publicRatingLookupSchema = z.object({
  publicToken: z
    .string()
    .trim()
    .toLowerCase()
    .length(64)
    .regex(/^[a-f0-9]{64}$/),
});

function hashPublicToken(token: string) {
  return crypto
    .createHash("sha256")
    .update(token.trim().toLowerCase())
    .digest("hex");
}

function normalizeComment(comment?: string | null) {
  if (!comment) return null;
  const trimmed = comment.trim();
  return trimmed || null;
}

router.post("/", publicRatingLimiter, distributedPublicRatingLimiter, async (req: Request, res: Response) => {
  const parsed = submitRatingSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "Dados inválidos.",
      errors: parsed.error.flatten(),
    });
  }

  const { proposalId, contractId: providedContractId, publicToken, raterName, stars, comment } = parsed.data;
  const contractId = providedContractId ?? proposalId;
  const tokenHash = hashPublicToken(publicToken);

  try {
    let [contract] = await db
      .select({
        id: contracts.id,
        userId: contracts.userId,
        signedAt: contracts.signedAt,
        shareTokenHash: contracts.shareTokenHash,
        shareTokenExpiresAt: contracts.shareTokenExpiresAt,
      })
      .from(contracts)
      .where(eq(contracts.id, contractId!));

    if (!contract) {
      [contract] = await db
        .select({
          id: contracts.id,
          userId: contracts.userId,
          signedAt: contracts.signedAt,
          shareTokenHash: contracts.shareTokenHash,
          shareTokenExpiresAt: contracts.shareTokenExpiresAt,
        })
        .from(contracts)
        .where(eq(contracts.shareTokenHash, tokenHash));
    }

    if (!contract) {
      return res.status(404).json({
        message: "Contrato não encontrado.",
      });
    }

    if (!contract.signedAt) {
      return res.status(422).json({
        message: "O contrato precisa estar assinado para receber avaliação.",
      });
    }

    if (
      !contract.shareTokenExpiresAt ||
      contract.shareTokenExpiresAt.getTime() < Date.now()
    ) {
      return res.status(403).json({
        message: "Este link de avaliação expirou.",
      });
    }

    if (!contract.shareTokenHash) {
      return res.status(403).json({
        message: "Token público inválido para avaliação.",
      });
    }

    if (contract.shareTokenHash !== tokenHash) {
      return res.status(403).json({
        message: "Token público inválido para avaliação.",
      });
    }

    const [existing] = await db
      .select({ id: contractRatings.id })
      .from(contractRatings)
      .where(eq(contractRatings.contractId, contractId!));

    if (existing) {
      return res.status(409).json({
        message: "Este contrato já foi avaliado.",
        ratingId: existing.id,
      });
    }

    const [inserted] = await db
      .insert(contractRatings)
      .values({
        contractId: contractId!,
        userId: contract.userId,
        raterName: raterName.trim(),
        stars,
        comment: normalizeComment(comment),
        createdAt: new Date(),
      })
      .returning({ id: contractRatings.id });

    scoreService.recalculateScore(contract.userId).catch((err: unknown) => {
      console.error("[ratings] erro ao recalcular score:", err);
    });

    return res.status(201).json({
      ok: true,
      ratingId: inserted.id,
      message: "Avaliação enviada com sucesso.",
    });
  } catch (err: unknown) {
    console.error("[ratings POST /]", err instanceof Error ? err.message : err);

    return res.status(500).json({
      message: "Erro ao registrar avaliação.",
    });
  }
});

router.get("/contract/:proposalId", publicRatingReadLimiter, distributedPublicRatingReadLimiter, async (req: Request, res: Response) => {
  const contractId = Number(req.params.proposalId);
  const parsedQuery = publicRatingLookupSchema.safeParse(req.query);

  if (!Number.isInteger(contractId) || contractId <= 0) {
    return res.status(400).json({ message: "ID inválido." });
  }

  if (!parsedQuery.success) {
    return res.status(400).json({ message: "Token público inválido." });
  }

  try {
    const tokenHash = hashPublicToken(parsedQuery.data.publicToken);
    const [contract] = await db
      .select({
        id: contracts.id,
        shareTokenHash: contracts.shareTokenHash,
        shareTokenExpiresAt: contracts.shareTokenExpiresAt,
      })
      .from(contracts)
      .where(eq(contracts.id, contractId));

    if (!contract) {
      return res.status(404).json({ message: "Contrato não encontrado." });
    }

    if (!contract.shareTokenHash || contract.shareTokenHash !== tokenHash) {
      return res.status(403).json({ message: "Token público inválido para avaliação." });
    }

    if (!contract.shareTokenExpiresAt || contract.shareTokenExpiresAt.getTime() < Date.now()) {
      return res.status(403).json({ message: "Este link de avaliação expirou." });
    }

    const [rating] = await db
      .select({
        id: contractRatings.id,
        stars: contractRatings.stars,
        comment: contractRatings.comment,
        raterName: contractRatings.raterName,
        createdAt: contractRatings.createdAt,
      })
      .from(contractRatings)
      .where(eq(contractRatings.contractId, contractId));

    if (!rating) {
      return res.json({ rated: false });
    }

    return res.json({
      rated: true,
      ...rating,
    });
  } catch (err: unknown) {
    console.error(
      "[ratings GET /contract/:proposalId]",
      err instanceof Error ? err.message : err
    );

    return res.status(500).json({
      message: "Erro ao buscar avaliação.",
    });
  }
});

router.get(
  "/me",
  authenticateOrMvp,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Não autenticado." });
    }

    try {
      const rows = await db
        .select({
          id: contractRatings.id,
          contractId: contractRatings.contractId,
          raterName: contractRatings.raterName,
          stars: contractRatings.stars,
          comment: contractRatings.comment,
          createdAt: contractRatings.createdAt,
        })
        .from(contractRatings)
        .where(eq(contractRatings.userId, userId))
        .orderBy(desc(contractRatings.createdAt));

      const total = rows.length;
      const avgStars =
        total > 0
          ? rows.reduce((sum, row) => sum + row.stars, 0) / total
          : 0;

      return res.json({
        avgStars: Math.round(avgStars * 10) / 10,
        totalRatings: total,
        ratings: rows,
      });
    } catch (err: unknown) {
      console.error("[ratings GET /me]", err instanceof Error ? err.message : err);

      return res.status(500).json({
        message: "Erro ao buscar avaliações.",
      });
    }
  }
);

export default router;
