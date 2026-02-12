import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
const forceSsl = process.env.DATABASE_SSL === 'true';

if (!connectionString) {
  throw new Error('DATABASE_URL não definido. Configure no arquivo .env.');
}

const pool = new Pool({
  connectionString,
  ssl: forceSsl ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined,
  max: Number(process.env.DB_POOL_MAX ?? 20),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30_000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 5_000)
});

export const db = drizzle(pool);
