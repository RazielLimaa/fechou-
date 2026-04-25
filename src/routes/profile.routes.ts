/**
 * profile_routes.ts
 *
 * Rotas para gerenciamento e visualização de perfis.
 *
 * Monte no seu server.ts / app.ts:
 *   import profileRouter from "./routes/profile_routes.js";
 *   app.use("/api/profile", profileRouter);
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { authenticateOrMvp, type AuthenticatedRequest } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { users, userProfiles, userScores } from "../db/schema.js";
import { scoreService, ScoreService } from "../services/score.sevice.js";
import { normalizeProfileAvatarInput } from "../lib/imageDataUrl.js";

const router = Router();

// ─── Schemas ─────────────────────────────────────────────────────────────────

const slugRegex = /^[a-z0-9_-]{3,60}$/;

const urlOrNull = z
  .string()
  .max(500)
  .transform(v => (v.trim() === "" ? null : v.trim()))
  .pipe(z.string().url().nullable())
  .optional()
  .nullable();

const updateProfileSchema = z.object({
  displayName:   z.string().trim().max(120).optional(),
  bio:           z.string().trim().max(500).optional(),
  avatarUrl:     z.string().max(8_000_000).optional().nullable(),
  profession:    z.string().trim().max(80).optional(),
  location:      z.string().trim().max(80).optional(),
  slug: z.string().trim().optional().transform(v => {
    if (v === undefined || v === "") return undefined;
    if (!slugRegex.test(v)) throw new Error("Slug inválido (use letras, números, - ou _)");
    return v;
  }),
  isPublic:      z.boolean().optional(),
  linkWebsite:   urlOrNull,
  linkLinkedin:  urlOrNull,
  linkInstagram: urlOrNull,
  linkGithub:    urlOrNull,
  linkBehance:   urlOrNull,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function buildPublicProfile(userId: number) {
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      createdAt: users.createdAt,
      avatarUrl: sql<string | null>`avatar_url`,
    })
    .from(users)
    .where(eq(users.id, userId));

  if (!user) return null;

  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId));

  const scoreData = await scoreService.getScore(userId);
  const ratingsData = await scoreService.getRatings(userId);
  const level = ScoreService.scoreLevel(scoreData.score);

  return {
    userId:      user.id,
    name:        profile?.displayName ?? user.name,
    bio:         profile?.bio ?? null,
    avatarUrl:   profile?.avatarUrl ?? user.avatarUrl ?? null,
    profession:  profile?.profession ?? null,
    location:    profile?.location ?? null,
    slug:        profile?.slug ?? null,
    isPublic:    profile?.isPublic ?? true,
    memberSince: user.createdAt,

    links: {
      website:   profile?.linkWebsite   ?? null,
      linkedin:  profile?.linkLinkedin  ?? null,
      instagram: profile?.linkInstagram ?? null,
      github:    profile?.linkGithub    ?? null,
      behance:   profile?.linkBehance   ?? null,
    },

    score: {
      value:          scoreData.score,
      totalSold:      scoreData.totalSold,
      totalCancelled: scoreData.totalCancelled,
      totalPending:   scoreData.totalPending,
      level,
    },

    ratings: {
      avgStars:     ratingsData.avgStars,
      totalRatings: ratingsData.totalRatings,
      recent:       ratingsData.ratings.slice(0, 5), 
    },
  };
}

/*
|--------------------------------------------------------------------------
| GET /api/profile/me
| Retorna o perfil completo do usuário autenticado
|--------------------------------------------------------------------------
*/
router.get("/me", authenticateOrMvp, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  try {
    const profile = await buildPublicProfile(userId);
    if (!profile) return res.status(404).json({ message: "Usuário não encontrado." });
    return res.json({ ...profile, email: req.user?.email });
  } catch (err: any) {
    console.error("[profile GET /me]", err?.message ?? err);
    return res.status(500).json({ message: "Erro ao carregar perfil." });
  }
});

/*
|--------------------------------------------------------------------------
| PATCH /api/profile/me
| Atualiza o perfil do usuário autenticado
|--------------------------------------------------------------------------
*/
router.patch("/me", authenticateOrMvp, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados inválidos.", errors: parsed.error.flatten() });
  }

  const data = parsed.data;

  try {
    let normalizedAvatarUrl = data.avatarUrl;
    try {
      normalizedAvatarUrl = normalizeProfileAvatarInput(data.avatarUrl);
    } catch (err: any) {
      return res.status(422).json({
        message: err?.message ?? "Avatar inválido.",
      });
    }

    if (data.slug) {
      const [existing] = await db
        .select({ userId: userProfiles.userId })
        .from(userProfiles)
        .where(eq(userProfiles.slug, data.slug));
      if (existing && existing.userId !== userId) {
        return res.status(409).json({ message: "Este slug já está em uso. Escolha outro." });
      }
    }

    const now = new Date();

    await db
      .insert(userProfiles)
      .values({
        userId,
        displayName:   data.displayName   ?? null,
        bio:           data.bio           ?? null,
        avatarUrl:     normalizedAvatarUrl ?? null,
        profession:    data.profession    ?? null,
        location:      data.location      ?? null,
        slug:          data.slug          ?? null,
        isPublic:      data.isPublic      ?? true,
        linkWebsite:   data.linkWebsite   ?? null,
        linkLinkedin:  data.linkLinkedin  ?? null,
        linkInstagram: data.linkInstagram ?? null,
        linkGithub:    data.linkGithub    ?? null,
        linkBehance:   data.linkBehance   ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: {
          ...(data.displayName   !== undefined && { displayName:   data.displayName   }),
          ...(data.bio           !== undefined && { bio:           data.bio           }),
          ...(data.avatarUrl     !== undefined && { avatarUrl:     normalizedAvatarUrl }),
          ...(data.profession    !== undefined && { profession:    data.profession    }),
          ...(data.location      !== undefined && { location:      data.location      }),
          ...(data.slug          !== undefined && { slug:          data.slug          }),
          ...(data.isPublic      !== undefined && { isPublic:      data.isPublic      }),
          ...(data.linkWebsite   !== undefined && { linkWebsite:   data.linkWebsite   }),
          ...(data.linkLinkedin  !== undefined && { linkLinkedin:  data.linkLinkedin  }),
          ...(data.linkInstagram !== undefined && { linkInstagram: data.linkInstagram }),
          ...(data.linkGithub    !== undefined && { linkGithub:    data.linkGithub    }),
          ...(data.linkBehance   !== undefined && { linkBehance:   data.linkBehance   }),
          updatedAt: now,
        },
      });

    const updated = await buildPublicProfile(userId);
    return res.json({ ...updated, email: req.user?.email });
  } catch (err: any) {
    console.error("[profile PATCH /me]", err?.message ?? err);
    return res.status(500).json({ message: "Erro ao salvar perfil." });
  }
});

/*
|--------------------------------------------------------------------------
| GET /api/profile/public/:slugOrId
| Retorna perfil público pelo slug ou ID numérico
|--------------------------------------------------------------------------
*/
router.get("/public/:slugOrId", async (req: Request, res: Response) => {
  const param = req.params.slugOrId;

  try {
    let userId: number | null = null;

    const asNumber = Number(param);
    if (Number.isInteger(asNumber) && asNumber > 0) {
      userId = asNumber;
    } else {
      const cleanSlug = param.trim().toLowerCase();

      if (slugRegex.test(cleanSlug)) {
        const [profileRow] = await db
          .select({ userId: userProfiles.userId })
          .from(userProfiles)
          .where(eq(userProfiles.slug, cleanSlug));

        if (profileRow) {
          userId = profileRow.userId;
        }
      }

    }

    if (!userId) return res.status(404).json({ message: "Perfil não encontrado." });

    const profile = await buildPublicProfile(userId);
    if (!profile) return res.status(404).json({ message: "Perfil não encontrado." });

    if (!profile.isPublic) {
      return res.status(404).json({ message: "Perfil não encontrado." });
    }

    return res.json(profile);
  } catch (err: any) {
    console.error("[profile GET /public]", err?.message ?? err);
    return res.status(500).json({ message: "Erro ao carregar perfil." });
  }
});

export default router;
