/**
 * score.service.ts
 *
 * Engine de cálculo de score do freelancer.
 *
 * REGRAS:
 *  +50 pts  por contrato/proposta PAGO (vendido)
 *  -30 pts  por contrato/proposta CANCELADO
 *  -10 pts  por contrato PENDENTE a cada 15 dias de pendência (cobrado na recalculação)
 *  Score mínimo: 0 (nunca negativo)
 *
 * O score é recalculado do zero a cada chamada de recalculateScore()
 * para garantir consistência. Para produção com alta escala, considere
 * calcular incrementalmente nos webhooks de status.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { contracts, proposals, userScores, contractRatings } from "../db/schema.js";

// ─── Constantes ───────────────────────────────────────────────────────────────

const PTS_SOLD      =  50;  // por contrato vendido/pago
const PTS_CANCELLED = -30;  // por cancelamento
const PTS_PENDING   = -10;  // por 15 dias de pendência
const PENDING_WINDOW_DAYS = 15;

// ─── ScoreService ─────────────────────────────────────────────────────────────

export class ScoreService {

  /**
   * Recalcula o score completo de um usuário a partir do zero.
   * Persiste o resultado em user_scores e retorna o novo score.
   */
  async recalculateScore(userId: number): Promise<number> {

    const now = new Date();

    // ── 1. Contratos (tabela contracts) ───────────────────────────────────────

    const contractRows = await db
      .select({
        lifecycleStatus: contracts.lifecycleStatus,
        createdAt:       contracts.createdAt,
        status:          contracts.status,
      })
      .from(contracts)
      .where(eq(contracts.userId, userId));

    // ── 2. Propostas (tabela proposals) ───────────────────────────────────────

    const proposalRows = await db
      .select({
        status:      proposals.status,
        lifecycleStatus: proposals.lifecycleStatus,
        createdAt:   proposals.createdAt,
      })
      .from(proposals)
      .where(eq(proposals.userId, userId));

    // ── 3. Calcular pontos ────────────────────────────────────────────────────

    let pts = 0;
    let totalSold      = 0;
    let totalCancelled = 0;
    let totalPending   = 0;

    // Contratos
    for (const c of contractRows) {
      const ls = (c.lifecycleStatus ?? "").toUpperCase();
      const st = (c.status ?? "").toLowerCase();

      if (ls === "PAID" || st === "finalized" || st === "assinado") {
        pts += PTS_SOLD;
        totalSold++;
      } else if (ls === "CANCELLED" || st === "cancelled" || st === "cancelado") {
        pts += PTS_CANCELLED;
        totalCancelled++;
      } else {
        // Pendente — penalidade por tempo
        const daysPending = this._daysBetween(c.createdAt, now);
        const periods = Math.floor(daysPending / PENDING_WINDOW_DAYS);
        if (periods > 0) {
          pts += PTS_PENDING * periods;
        }
        totalPending++;
      }
    }

    // Propostas
    for (const p of proposalRows) {
      const ls = (p.lifecycleStatus ?? "").toUpperCase();
      const st = (p.status ?? "").toLowerCase();

      if (ls === "PAID" || st === "vendida") {
        pts += PTS_SOLD;
        totalSold++;
      } else if (ls === "CANCELLED" || st === "cancelada") {
        pts += PTS_CANCELLED;
        totalCancelled++;
      } else {
        const daysPending = this._daysBetween(p.createdAt, now);
        const periods = Math.floor(daysPending / PENDING_WINDOW_DAYS);
        if (periods > 0) {
          pts += PTS_PENDING * periods;
        }
        totalPending++;
      }
    }

    // Score nunca negativo
    const score = Math.max(0, pts);

    // ── 4. Persistir ─────────────────────────────────────────────────────────

    await db
      .insert(userScores)
      .values({ userId, score, totalSold, totalCancelled, totalPending, updatedAt: now })
      .onConflictDoUpdate({
        target: userScores.userId,
        set:    { score, totalSold, totalCancelled, totalPending, updatedAt: now },
      });

    return score;
  }

  /**
   * Retorna o score atual do usuário (sem recalcular).
   * Se não existir, recalcula e retorna.
   */
  async getScore(userId: number): Promise<{
    score: number;
    totalSold: number;
    totalCancelled: number;
    totalPending: number;
    updatedAt: Date;
  }> {
    const [row] = await db
      .select()
      .from(userScores)
      .where(eq(userScores.userId, userId));

    if (row) {
      return {
        score:          row.score,
        totalSold:      row.totalSold,
        totalCancelled: row.totalCancelled,
        totalPending:   row.totalPending,
        updatedAt:      row.updatedAt,
      };
    }

    // Primeira vez — calcula e retorna
    const score = await this.recalculateScore(userId);
    return {
      score,
      totalSold:      0,
      totalCancelled: 0,
      totalPending:   0,
      updatedAt:      new Date(),
    };
  }

  /**
   * Retorna as avaliações (estrelas) de um usuário com média.
   */
  async getRatings(userId: number): Promise<{
    avgStars: number;
    totalRatings: number;
    ratings: Array<{
      id: number;
      contractId: number;
      raterName: string;
      stars: number;
      comment: string | null;
      createdAt: Date;
    }>;
  }> {
    const rows = await db
      .select()
      .from(contractRatings)
      .where(eq(contractRatings.userId, userId))
      .orderBy(sql`${contractRatings.createdAt} DESC`);

    const totalRatings = rows.length;
    const avgStars =
      totalRatings > 0
        ? rows.reduce((acc: any, r: { stars: any; }) => acc + r.stars, 0) / totalRatings
        : 0;

    return {
      avgStars: Math.round(avgStars * 10) / 10, // 1 casa decimal
      totalRatings,
      ratings: rows.map((r: { id: any; contractId: any; raterName: any; stars: any; comment: any; createdAt: any; }) => ({
        id:         r.id,
        contractId: r.contractId,
        raterName:  r.raterName,
        stars:      r.stars,
        comment:    r.comment ?? null,
        createdAt:  r.createdAt,
      })),
    };
  }

  /**
   * Adiciona ou atualiza avaliação de um contrato.
   * Só pode ser feito se o contrato está pago (lifecycleStatus = PAID).
   */
  async rateContract(params: {
    contractId: number;
    userId: number; // dono do contrato (freelancer)
    raterName: string;
    stars: number;  // 1–5
    comment?: string;
  }): Promise<{ ok: boolean; ratingId: number }> {

    if (params.stars < 1 || params.stars > 5) {
      throw new Error("Avaliação deve ser entre 1 e 5 estrelas.");
    }

    // Verifica que o contrato existe, pertence ao userId e está pago
    const [contract] = await db
      .select({ id: contracts.id, lifecycleStatus: contracts.lifecycleStatus })
      .from(contracts)
      .where(and(eq(contracts.id, params.contractId), eq(contracts.userId, params.userId)));

    if (!contract) {
      throw new Error("Contrato não encontrado.");
    }

    const ls = (contract.lifecycleStatus ?? "").toUpperCase();
    if (ls !== "PAID") {
      throw new Error("Só é possível avaliar contratos finalizados e pagos.");
    }

    const [existing] = await db
      .select({ id: contractRatings.id })
      .from(contractRatings)
      .where(eq(contractRatings.contractId, params.contractId));

    let ratingId: number;

    if (existing) {
      // Atualiza avaliação existente
      await db
        .update(contractRatings)
        .set({
          stars:     params.stars,
          comment:   params.comment ?? null,
          raterName: params.raterName,
        })
        .where(eq(contractRatings.id, existing.id));
      ratingId = existing.id;
    } else {
      const [inserted] = await db
        .insert(contractRatings)
        .values({
          contractId: params.contractId,
          userId:     params.userId,
          raterName:  params.raterName,
          stars:      params.stars,
          comment:    params.comment ?? null,
        })
        .returning({ id: contractRatings.id });
      ratingId = inserted.id;
    }

    // Recalcula score após nova avaliação
    await this.recalculateScore(params.userId);

    return { ok: true, ratingId };
  }

  /**
   * Verifica se um contrato específico já foi avaliado
   * e retorna a avaliação se existir.
   */
  async getRatingByContract(contractId: number): Promise<{
    stars: number;
    comment: string | null;
    raterName: string;
    createdAt: Date;
  } | null> {
    const [row] = await db
      .select()
      .from(contractRatings)
      .where(eq(contractRatings.contractId, contractId));

    if (!row) return null;

    return {
      stars:     row.stars,
      comment:   row.comment ?? null,
      raterName: row.raterName,
      createdAt: row.createdAt,
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private _daysBetween(from: Date, to: Date): number {
    return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
  }

  /**
   * Utilitário para descrever o nível do score em texto.
   */
  static scoreLevel(score: number): {
    label: string;
    color: string;
    emoji: string;
  } {
    if (score >= 500) return { label: "Lendário",    color: "#f59e0b", emoji: "👑" };
    if (score >= 300) return { label: "Expert",      color: "#6366f1", emoji: "💎" };
    if (score >= 150) return { label: "Profissional",color: "#22c55e", emoji: "⭐" };
    if (score >= 50)  return { label: "Ativo",       color: "#3b82f6", emoji: "🔥" };
    return                   { label: "Iniciante",   color: "#71717a", emoji: "🌱" };
  }
}

export const scoreService = new ScoreService();