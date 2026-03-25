// migrate.js — coloque na raiz do projeto e rode: node migrate.js
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { Client } = require("pg");

const SQL = `
CREATE TABLE IF NOT EXISTS user_scores (
  user_id         integer     PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  score           integer     NOT NULL DEFAULT 0,
  total_sold      integer     NOT NULL DEFAULT 0,
  total_cancelled integer     NOT NULL DEFAULT 0,
  total_pending   integer     NOT NULL DEFAULT 0,
  updated_at      timestamp   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contract_ratings (
  id          serial      PRIMARY KEY,
  contract_id integer     NOT NULL UNIQUE REFERENCES contracts(id) ON DELETE CASCADE,
  user_id     integer     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rater_name  varchar(140) NOT NULL,
  stars       smallint    NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment     text,
  created_at  timestamp   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id         integer     PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  slug            varchar(60) UNIQUE,
  display_name    varchar(120),
  bio             text,
  avatar_url      text,
  profession      varchar(80),
  location        varchar(80),
  link_website    text,
  link_linkedin   text,
  link_instagram  text,
  link_github     text,
  link_behance    text,
  is_public       boolean     NOT NULL DEFAULT true,
  created_at      timestamp   NOT NULL DEFAULT now(),
  updated_at      timestamp   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_ratings_user ON contract_ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_slug    ON user_profiles(slug);
`;

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("❌ DATABASE_URL não encontrado no .env"); process.exit(1); }

  const client = new Client({
    connectionString: url,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    console.log("✅ Conectado ao banco.");
    await client.query(SQL);
    console.log("✅ Tabelas criadas com sucesso:");
    console.log("   • user_scores");
    console.log("   • contract_ratings");
    console.log("   • user_profiles");
  } catch (err) {
    console.error("❌ Erro:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();