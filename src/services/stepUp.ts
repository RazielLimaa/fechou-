import crypto from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { securityStepUpTokens } from '../db/schema.js';

function sha256(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function buildStepUpPayloadHash(payload: unknown) {
  return sha256(JSON.stringify(payload ?? {}));
}

export async function issueStepUpToken(input: {
  userId: number;
  scope: string;
  payloadHash: string;
  ttlMs?: number;
}) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? 5 * 60 * 1000));

  await db.insert(securityStepUpTokens).values({
    tokenHash,
    userId: input.userId,
    scope: input.scope,
    payloadHash: input.payloadHash,
    expiresAt,
  });

  return {
    stepUpToken: rawToken,
    expiresAt,
  };
}

export async function consumeStepUpToken(input: {
  token: string;
  userId: number;
  scope: string;
  payloadHash: string;
}) {
  const tokenHash = sha256(input.token);
  const now = new Date();

  const [row] = await db
    .select()
    .from(securityStepUpTokens)
    .where(
      and(
        eq(securityStepUpTokens.tokenHash, tokenHash),
        eq(securityStepUpTokens.userId, input.userId),
        eq(securityStepUpTokens.scope, input.scope),
        eq(securityStepUpTokens.payloadHash, input.payloadHash),
        gt(securityStepUpTokens.expiresAt, now),
        isNull(securityStepUpTokens.usedAt)
      )
    );

  if (!row) return false;

  await db
    .update(securityStepUpTokens)
    .set({ usedAt: now })
    .where(eq(securityStepUpTokens.tokenHash, tokenHash));

  return true;
}
