import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

export async function checkDistributedRateLimit(input: {
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
}) {
  const now = new Date();
  const resetThreshold = new Date(now.getTime() - input.windowMs);
  const row = await db.execute(sql`
    INSERT INTO security_rate_limits (key, count, window_start, updated_at)
    VALUES (${`${input.scope}:${input.key}`}, 1, ${now}, ${now})
    ON CONFLICT (key) DO UPDATE
    SET
      count = CASE
        WHEN security_rate_limits.window_start < ${resetThreshold} THEN 1
        ELSE security_rate_limits.count + 1
      END,
      window_start = CASE
        WHEN security_rate_limits.window_start < ${resetThreshold} THEN ${now}
        ELSE security_rate_limits.window_start
      END,
      updated_at = ${now}
    RETURNING count, window_start
  `) as any;

  const data = Array.isArray(row?.rows) ? row.rows[0] : row?.[0] ?? row;
  const count = Number(data?.count ?? 0);
  const windowStart = new Date(data?.window_start ?? now);
  const retryAfterSec = Math.max(1, Math.ceil((windowStart.getTime() + input.windowMs - now.getTime()) / 1000));

  return {
    allowed: count <= input.limit,
    count,
    retryAfterSec,
  };
}

export async function markReplayToken(input: {
  scope: string;
  token: string;
  ttlMs: number;
}) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.ttlMs);
  const tokenHash = crypto
    .createHash('sha256')
    .update(`${input.scope}:${input.token}`)
    .digest('hex');

  await db.execute(sql`DELETE FROM security_replay_tokens WHERE expires_at < ${now}`);

  const result = await db.execute(sql`
    INSERT INTO security_replay_tokens (token_hash, scope, expires_at, created_at)
    VALUES (${tokenHash}, ${input.scope}, ${expiresAt}, ${now})
    ON CONFLICT (token_hash) DO NOTHING
    RETURNING token_hash
  `) as any;

  const inserted = Array.isArray(result?.rows) ? result.rows.length > 0 : Array.isArray(result) ? result.length > 0 : Boolean(result?.token_hash);

  return {
    replay: !inserted,
    tokenHash,
  };
}
