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

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id                   serial PRIMARY KEY,
  user_id              integer      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash           varchar(128) NOT NULL UNIQUE,
  expires_at           timestamptz  NOT NULL,
  used_at              timestamptz,
  requested_ip         varchar(80),
  requested_user_agent text,
  used_ip              varchar(80),
  used_user_agent      text,
  created_at           timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS password_reset_challenges (
  id                   serial PRIMARY KEY,
  user_id              integer      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash            varchar(128) NOT NULL,
  expires_at           timestamptz  NOT NULL,
  verified_at          timestamptz,
  consumed_at          timestamptz,
  requested_ip         varchar(80),
  requested_user_agent text,
  verified_ip          varchar(80),
  verified_user_agent  text,
  attempts             integer      NOT NULL DEFAULT 0,
  max_attempts         integer      NOT NULL DEFAULT 5,
  created_at           timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_ratings_user ON contract_ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_slug    ON user_profiles(slug);
CREATE INDEX IF NOT EXISTS idx_prt_user_id           ON password_reset_tokens(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_prt_token_hash        ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_prt_expires_at        ON password_reset_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_prc_user_id           ON password_reset_challenges(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_prc_code_hash         ON password_reset_challenges(code_hash);
CREATE INDEX IF NOT EXISTS idx_prc_expires_at        ON password_reset_challenges(expires_at);
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
    console.log("   • password_reset_tokens");
    console.log("   • password_reset_challenges");
  } catch (err) {
    console.error("❌ Erro:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
