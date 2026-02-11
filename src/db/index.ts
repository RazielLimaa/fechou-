import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL não definido. Configure no arquivo .env.');
}

const pool = new Pool({ connectionString });

export const db = drizzle(pool);
