import { Router, type Response } from "express";
import { authenticateOrMvp, type AuthenticatedRequest } from "../middleware/auth.js";
import { scoreService, ScoreService } from "../services/score.sevice.js";

const router = Router();

// GET /api/score/me
router.get("/me", authenticateOrMvp, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });
  try {
    const data = await scoreService.getScore(userId);
    const level = ScoreService.scoreLevel(data.score);
    return res.json({ ...data, level });
  } catch (err: any) {
    console.error("[score GET /me]", err?.message);
    return res.status(500).json({ message: "Erro ao carregar score." });
  }
});

// POST /api/score/recalculate
router.post("/recalculate", authenticateOrMvp, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });
  try {
    const score = await scoreService.recalculateScore(userId);
    const level = ScoreService.scoreLevel(score);
    return res.json({ score, level });
  } catch (err: any) {
    console.error("[score POST /recalculate]", err?.message);
    return res.status(500).json({ message: "Erro ao recalcular score." });
  }
});

// GET /api/score/ratings/me
router.get("/ratings/me", authenticateOrMvp, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });
  try {
    const data = await scoreService.getRatings(userId);
    return res.json(data);
  } catch (err: any) {
    console.error("[score GET /ratings/me]", err?.message);
    return res.status(500).json({ message: "Erro ao carregar avaliações." });
  }
});

// GET /api/score/ratings/user/:userId  (público)
router.get("/ratings/user/:userId", async (req, res: Response) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: "ID inválido." });
  }
  try {
    const data = await scoreService.getRatings(userId);
    return res.json(data);
  } catch (err: any) {
    console.error("[score GET /ratings/user]", err?.message);
    return res.status(500).json({ message: "Erro ao carregar avaliações." });
  }
});

export default router;