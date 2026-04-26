import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
const explicitSsl = process.env.DATABASE_SSL;

if (!connectionString) {
  throw new Error('DATABASE_URL não definido. Configure no arquivo .env.');
}
const databaseUrl = connectionString;

function isLocalDatabase(url: string) {
  try {
    const parsed = new URL(url);
    return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function resolveSslConfig() {
  const useSsl =
    explicitSsl === 'true' ||
    (explicitSsl !== 'false' && process.env.NODE_ENV === 'production' && !isLocalDatabase(databaseUrl));

  if (!useSsl) return undefined;

  return {
    rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
  };
}

export const pool = new Pool({
  connectionString: databaseUrl,
  ssl: resolveSslConfig(),
  max: Number(process.env.DB_POOL_MAX ?? 8),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30_000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 5_000),
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 8_000),
  query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS ?? 10_000),
});

pool.on('error', (err: Error) => {
  console.error('[db] erro inesperado em conexão ociosa do pool:', err.message);
});

export async function testDatabaseConnection() {
  try {
    await pool.query('SELECT 1');
    console.log('[db] conexão com Postgres OK (SELECT 1)');
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[db] falha no teste de conexão (SELECT 1):', msg);
    return false;
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function testDatabaseConnectionWithRetry(input?: {
  maxAttempts?: number;
  retryDelayMs?: number;
}) {
  const maxAttempts = Math.max(1, Number(input?.maxAttempts ?? 5));
  const retryDelayMs = Math.max(0, Number(input?.retryDelayMs ?? 2_000));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const ok = await testDatabaseConnection();
    if (ok) return true;

    if (attempt < maxAttempts) {
      console.warn(
        `[db] tentativa ${attempt}/${maxAttempts} falhou. Nova tentativa em ${retryDelayMs}ms...`,
      );
      await sleep(retryDelayMs);
    }
  }

  return false;
}

export async function closeDatabasePool() {
  try {
    await pool.end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[db] erro ao encerrar pool:', msg);
  }
}

export const db = drizzle(pool);
