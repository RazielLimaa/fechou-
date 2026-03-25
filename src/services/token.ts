// OauthF/tokens.ts
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { eq, and, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { refreshTokens } from "../db/schema.oauth.js"; // ajuste o caminho para o seu schema.oauth.ts
import { db } from "../db/index.js"; 

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface TokenUser {
  id: number;       // serial integer, igual ao seu schema
  email: string;
  name: string;
}

export interface TokenMeta {
  userAgent?: string | null;
  ipAddress?: string | null;
}

export class AuthError extends Error {
  constructor(message: string, public readonly status: number = 401) {
    super(message);
    this.name = "AuthError";
  }
}

// ── Helpers internos ──────────────────────────────────────────────────────────

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function generateSecureToken(bytes = 48): string {
  return crypto.randomBytes(bytes).toString("hex");
}

function parseDurationMs(str: string): number {
  const map: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const match = str.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Duração inválida: ${str}`);
  return parseInt(match[1]) * map[match[2]];
}

// ── Access Token (JWT, curta duração, stateless) ──────────────────────────────

export function signAccessToken(user: TokenUser): string {
  return jwt.sign(
    { sub: user.id.toString(), email: user.email, name: user.name },
    process.env.JWT_SECRET!,
    {
      expiresIn: (process.env.JWT_EXPIRES_IN ?? "15m") as jwt.SignOptions["expiresIn"],
      issuer:   "fechou-api",
      audience: "fechou-app",
    }
  );
}

export function verifyAccessToken(token: string): jwt.JwtPayload {
  return jwt.verify(token, process.env.JWT_SECRET!, {
    issuer:   "fechou-api",
    audience: "fechou-app",
  }) as jwt.JwtPayload;
}

// ── Refresh Token (stateful, rotação, detecção de roubo) ─────────────────────

export async function createRefreshToken(
  db: NodePgDatabase<any>,
  user: TokenUser,
  family: string | null,
  meta: TokenMeta = {}
): Promise<string> {
  const rawToken    = generateSecureToken(48);
  const tokenHash   = hashToken(rawToken);
  const tokenFamily = family ?? uuidv4();
  const expiresAt   = new Date(
    Date.now() + parseDurationMs(process.env.JWT_REFRESH_EXPIRES_IN ?? "7d")
  );

  await db.insert(refreshTokens).values({
    userId:    user.id,
    tokenHash,
    family:    tokenFamily,
    expiresAt,
    userAgent: meta.userAgent?.slice(0, 512) ?? null,
    ipAddress: meta.ipAddress?.slice(0, 80)  ?? null,
  });

  return rawToken;
}

/**
 * Rotaciona um refresh token:
 * 1. Valida no banco (não revogado, não expirado).
 * 2. Reuso detectado → revoga a família toda (token theft).
 * 3. Revoga o atual e emite novo da mesma família.
 */
export async function rotateRefreshToken(
  db: NodePgDatabase<any>,
  rawToken: string,
  meta: TokenMeta = {}
): Promise<{ userId: number; newRawToken: string }> {
  const tokenHash = hashToken(rawToken);

  // Busca o token armazenado
  const stored = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1)
    .then(rows => rows[0]);

  if (!stored) throw new AuthError("Refresh token inválido.", 401);

  // ── Detecção de roubo ─────────────────────────────────────────────────────
  if (stored.revoked) {
    // Token já foi usado → revoga família toda
    await db
      .update(refreshTokens)
      .set({ revoked: true })
      .where(eq(refreshTokens.family, stored.family));
    throw new AuthError("Token comprometido detectado. Faça login novamente.", 401);
  }

  if (stored.expiresAt < new Date()) {
    throw new AuthError("Sessão expirada. Faça login novamente.", 401);
  }

  // ── Revoga o atual ────────────────────────────────────────────────────────
  await db
    .update(refreshTokens)
    .set({ revoked: true })
    .where(eq(refreshTokens.id, stored.id));

  // ── Emite novo da mesma família ───────────────────────────────────────────
  const newRaw      = generateSecureToken(48);
  const newHash     = hashToken(newRaw);
  const expiresAt   = new Date(
    Date.now() + parseDurationMs(process.env.JWT_REFRESH_EXPIRES_IN ?? "7d")
  );

  await db.insert(refreshTokens).values({
    userId:    stored.userId,
    tokenHash: newHash,
    family:    stored.family,
    expiresAt,
    userAgent: meta.userAgent?.slice(0, 512) ?? null,
    ipAddress: meta.ipAddress?.slice(0, 80)  ?? null,
  });

  return { userId: stored.userId, newRawToken: newRaw };
}

export async function revokeRefreshToken(
  db: NodePgDatabase<any>,
  rawToken: string
): Promise<void> {
  const tokenHash = hashToken(rawToken);
  await db
    .update(refreshTokens)
    .set({ revoked: true })
    .where(eq(refreshTokens.tokenHash, tokenHash));
}

export async function revokeAllUserTokens(
  db: NodePgDatabase<any>,
  userId: number
): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revoked: true })
    .where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.revoked, false)));
}

// ── Cookie seguro ─────────────────────────────────────────────────────────────

export function refreshCookieOptions(): Record<string, unknown> {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure:   isProd,
    sameSite: isProd ? "strict" : "lax",
    maxAge:   7 * 24 * 60 * 60 * 1000,   // 7 dias em ms
    path:     "/api/auth",                // cookie só vai para rotas /api/auth
  };
}