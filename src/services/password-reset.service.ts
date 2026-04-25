import crypto from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { passwordResetChallenges, passwordResetTokens, refreshTokens } from "../db/schema.oauth.js";

function hashResetToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function generateResetToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function generateVerificationCode(length: number): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.randomBytes(length);
  let output = "";

  for (let i = 0; i < length; i += 1) {
    output += alphabet[bytes[i] % alphabet.length];
  }

  return output;
}

function getTokenTtlMinutes(): number {
  const parsed = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES ?? 20);
  if (!Number.isFinite(parsed) || parsed < 5 || parsed > 60) return 20;
  return Math.floor(parsed);
}

function getChallengeTtlMinutes(): number {
  const parsed = Number(process.env.PASSWORD_RESET_CODE_TTL_MINUTES ?? 10);
  if (!Number.isFinite(parsed) || parsed < 3 || parsed > 30) return 10;
  return Math.floor(parsed);
}

function getChallengeCodeLength(): number {
  const parsed = Number(process.env.PASSWORD_RESET_CODE_LENGTH ?? 6);
  if (!Number.isFinite(parsed) || parsed < 6 || parsed > 8) return 6;
  return Math.floor(parsed);
}

function getChallengeMaxAttempts(): number {
  const parsed = Number(process.env.PASSWORD_RESET_CODE_MAX_ATTEMPTS ?? 5);
  if (!Number.isFinite(parsed) || parsed < 3 || parsed > 10) return 5;
  return Math.floor(parsed);
}

function getResetUrlBase(): string {
  const explicit = String(process.env.PASSWORD_RESET_URL_BASE ?? "").trim();
  if (explicit) return explicit;

  const frontendUrl = String(process.env.FRONTEND_URL ?? "").trim().replace(/\/+$/, "");
  const resetPath = String(process.env.PASSWORD_RESET_PATH ?? "/reset-password").trim();
  if (!frontendUrl) {
    throw new Error("FRONTEND_URL ou PASSWORD_RESET_URL_BASE não configurado.");
  }

  return `${frontendUrl}${resetPath.startsWith("/") ? resetPath : `/${resetPath}`}`;
}

export function buildPasswordResetUrl(rawToken: string): string {
  const url = new URL(getResetUrlBase());
  url.searchParams.set("token", rawToken);
  return url.toString();
}

export function getPasswordResetTtlMinutes(): number {
  return getTokenTtlMinutes();
}

export function getPasswordResetCodeTtlMinutes(): number {
  return getChallengeTtlMinutes();
}

export function buildPasswordResetVerifyUrl(email: string): string {
  const frontendUrl = String(process.env.FRONTEND_URL ?? "").trim().replace(/\/+$/, "");
  const verifyPath = String(process.env.PASSWORD_RESET_VERIFY_PATH ?? "/reset-password/verify").trim();
  if (!frontendUrl) {
    throw new Error("FRONTEND_URL não configurado.");
  }

  const url = new URL(`${frontendUrl}${verifyPath.startsWith("/") ? verifyPath : `/${verifyPath}`}`);
  url.searchParams.set("email", email);
  return url.toString();
}

export function maskEmailAddress(email: string): string {
  const [localPart, domainPart] = email.split("@");
  if (!localPart || !domainPart) return "email informado";

  const safeLocal = localPart.length <= 2
    ? `${localPart[0] ?? "*"}*`
    : `${localPart.slice(0, 2)}${"*".repeat(Math.max(localPart.length - 2, 1))}`;

  const domainSegments = domainPart.split(".");
  const firstDomain = domainSegments[0] ?? "";
  const safeDomain = firstDomain.length <= 2
    ? `${firstDomain[0] ?? "*"}*`
    : `${firstDomain.slice(0, 2)}${"*".repeat(Math.max(firstDomain.length - 2, 1))}`;

  return `${safeLocal}@${[safeDomain, ...domainSegments.slice(1)].join(".")}`;
}

export async function issuePasswordResetChallenge(input: {
  userId: number;
  requestedIp?: string | null;
  requestedUserAgent?: string | null;
}): Promise<{ code: string; expiresAt: Date }> {
  const code = generateVerificationCode(getChallengeCodeLength());
  const codeHash = hashResetToken(code);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + getChallengeTtlMinutes() * 60 * 1000);
  const maxAttempts = getChallengeMaxAttempts();

  await db.transaction(async (tx) => {
    await tx
      .update(passwordResetChallenges)
      .set({ consumedAt: now })
      .where(
        and(
          eq(passwordResetChallenges.userId, input.userId),
          isNull(passwordResetChallenges.consumedAt),
          gt(passwordResetChallenges.expiresAt, now)
        )
      );

    await tx.insert(passwordResetChallenges).values({
      userId: input.userId,
      codeHash,
      expiresAt,
      requestedIp: input.requestedIp?.slice(0, 80) ?? null,
      requestedUserAgent: input.requestedUserAgent?.slice(0, 512) ?? null,
      maxAttempts,
    });
  });

  return { code, expiresAt };
}

export async function verifyPasswordResetChallenge(input: {
  userId: number;
  code: string;
  verifiedIp?: string | null;
  verifiedUserAgent?: string | null;
}): Promise<{ ok: boolean; reason?: "invalid" | "expired" | "too_many_attempts"; rawToken?: string; expiresAt?: Date }> {
  const now = new Date();
  const codeHash = hashResetToken(input.code.trim().toUpperCase());

  return db.transaction(async (tx) => {
    const [challenge] = await tx
      .select({
        id: passwordResetChallenges.id,
        codeHash: passwordResetChallenges.codeHash,
        expiresAt: passwordResetChallenges.expiresAt,
        consumedAt: passwordResetChallenges.consumedAt,
        attempts: passwordResetChallenges.attempts,
        maxAttempts: passwordResetChallenges.maxAttempts,
      })
      .from(passwordResetChallenges)
      .where(eq(passwordResetChallenges.userId, input.userId))
      .orderBy(desc(passwordResetChallenges.createdAt))
      .limit(1);

    if (!challenge) {
      return { ok: false, reason: "invalid" };
    }

    if (challenge.consumedAt || challenge.expiresAt <= now) {
      return { ok: false, reason: "expired" };
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      await tx
        .update(passwordResetChallenges)
        .set({ consumedAt: now })
        .where(eq(passwordResetChallenges.id, challenge.id));
      return { ok: false, reason: "too_many_attempts" };
    }

    if (challenge.codeHash !== codeHash) {
      const nextAttempts = challenge.attempts + 1;
      await tx
        .update(passwordResetChallenges)
        .set({
          attempts: nextAttempts,
          ...(nextAttempts >= challenge.maxAttempts ? { consumedAt: now } : {}),
        })
        .where(eq(passwordResetChallenges.id, challenge.id));

      return {
        ok: false,
        reason: nextAttempts >= challenge.maxAttempts ? "too_many_attempts" : "invalid",
      };
    }

    await tx
      .update(passwordResetChallenges)
      .set({
        attempts: challenge.attempts + 1,
        verifiedAt: now,
        consumedAt: now,
        verifiedIp: input.verifiedIp?.slice(0, 80) ?? null,
        verifiedUserAgent: input.verifiedUserAgent?.slice(0, 512) ?? null,
      })
      .where(eq(passwordResetChallenges.id, challenge.id));

    await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(passwordResetTokens.userId, input.userId),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, now)
        )
      );

    const rawToken = generateResetToken();
    const expiresAt = new Date(now.getTime() + getTokenTtlMinutes() * 60 * 1000);

    await tx.insert(passwordResetTokens).values({
      userId: input.userId,
      tokenHash: hashResetToken(rawToken),
      expiresAt,
      requestedIp: input.verifiedIp?.slice(0, 80) ?? null,
      requestedUserAgent: input.verifiedUserAgent?.slice(0, 512) ?? null,
    });

    return { ok: true, rawToken, expiresAt };
  });
}

export async function issuePasswordResetToken(input: {
  userId: number;
  requestedIp?: string | null;
  requestedUserAgent?: string | null;
}): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generateResetToken();
  const tokenHash = hashResetToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + getTokenTtlMinutes() * 60 * 1000);

  await db.transaction(async (tx) => {
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(passwordResetTokens.userId, input.userId),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, now)
        )
      );

    await tx.insert(passwordResetTokens).values({
      userId: input.userId,
      tokenHash,
      expiresAt,
      requestedIp: input.requestedIp?.slice(0, 80) ?? null,
      requestedUserAgent: input.requestedUserAgent?.slice(0, 512) ?? null,
    });
  });

  return { rawToken, expiresAt };
}

export async function consumePasswordResetToken(input: {
  rawToken: string;
  newPasswordHash: string;
  usedIp?: string | null;
  usedUserAgent?: string | null;
}): Promise<{ ok: boolean; userId?: number }> {
  const now = new Date();
  const tokenHash = hashResetToken(input.rawToken.trim());

  return db.transaction(async (tx) => {
    const [token] = await tx
      .select({
        id: passwordResetTokens.id,
        userId: passwordResetTokens.userId,
        expiresAt: passwordResetTokens.expiresAt,
        usedAt: passwordResetTokens.usedAt,
      })
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash))
      .limit(1);

    if (!token || token.usedAt || token.expiresAt <= now) {
      return { ok: false };
    }

    const [claimed] = await tx
      .update(passwordResetTokens)
      .set({
        usedAt: now,
        usedIp: input.usedIp?.slice(0, 80) ?? null,
        usedUserAgent: input.usedUserAgent?.slice(0, 512) ?? null,
      })
      .where(
        and(
          eq(passwordResetTokens.id, token.id),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, now)
        )
      )
      .returning({
        userId: passwordResetTokens.userId,
      });

    if (!claimed) {
      return { ok: false };
    }

    await tx
      .update(users)
      .set({ passwordHash: input.newPasswordHash } as any)
      .where(eq(users.id, claimed.userId));

    await tx
      .update(refreshTokens)
      .set({ revoked: true })
      .where(and(eq(refreshTokens.userId, claimed.userId), eq(refreshTokens.revoked, false)));

    await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(and(eq(passwordResetTokens.userId, claimed.userId), isNull(passwordResetTokens.usedAt)));

    return { ok: true, userId: claimed.userId };
  });
}
