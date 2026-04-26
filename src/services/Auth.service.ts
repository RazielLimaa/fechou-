// OauthF/authService.ts
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import { eq, and, gt, count, sql } from "drizzle-orm";
import type { Request } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { users } from "../db/schema.js";
import { loginAttempts } from "../db/schema.oauth.js";
import {
  signAccessToken,
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  AuthError,
  type TokenUser,
} from "../services/token.js";

const BCRYPT_ROUNDS = 12;

// ── googleClient agora é uma factory para suportar redirect_uri dinâmico ──────
// O redirect_uri DEVE ser idêntico ao usado no frontend para gerar o code.
// Criar o client uma única vez com process.env causava 400 se houvesse qualquer
// diferença entre o URI do frontend e o do .env.
function makeGoogleClient(redirectUri: string) {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

// ── Tipos públicos ─────────────────────────────────────────────────────────────

export interface SafeUser {
  id: number;
  name: string;
  email: string;
  avatarUrl: string | null;
  emailVerified: boolean;
}

export interface AuthResult {
  accessToken:  string;
  refreshToken: string;
  user:         SafeUser;
}

// ── Helpers internos ───────────────────────────────────────────────────────────

function getMeta(req: Request) {
  return {
    userAgent: req.headers["user-agent"] ?? null,
    ipAddress: (
      (req.headers["x-forwarded-for"] as string) || req.ip || ""
    ).split(",")[0].trim(),
  };
}

function sanitizeUser(user: {
  id: number;
  name: string;
  email: string;
  avatar_url?: string | null;
  avatarUrl?: string | null;
  email_verified?: boolean | null;
  emailVerified?: boolean | null;
}): SafeUser {
  return {
    id:            user.id,
    name:          user.name,
    email:         user.email,
    avatarUrl:     user.avatarUrl ?? user.avatar_url ?? null,
    emailVerified: user.emailVerified ?? user.email_verified ?? false,
  };
}

async function recordAttempt(
  db: NodePgDatabase<any>,
  email: string,
  ipAddress: string,
  success: boolean
): Promise<void> {
  await db
    .insert(loginAttempts)
    .values({ email: email.toLowerCase(), ipAddress, success })
    .catch(() => {});
}

async function checkEmailBruteForce(
  db: NodePgDatabase<any>,
  email: string
): Promise<void> {
  const fifteenAgo = new Date(Date.now() - 15 * 60 * 1000);

  const [{ value }] = await db
    .select({ value: count() })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.email, email.toLowerCase()),
        eq(loginAttempts.success, false),
        gt(loginAttempts.createdAt, fifteenAgo)
      )
    );

  if (Number(value) >= 10) {
    throw new AuthError("Muitas tentativas para este email. Aguarde 15 minutos.", 429);
  }
}

// ── Register ───────────────────────────────────────────────────────────────────

export async function register(
  db: NodePgDatabase<any>,
  req: Request
): Promise<AuthResult> {
  const { name, email, password } = req.body as {
    name: string;
    email: string;
    password: string;
  };
  const meta = getMeta(req);

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));

  if (existing.length > 0) {
    throw new AuthError("Não foi possível criar a conta com esses dados.", 409);
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const [newUser] = await db
    .insert(users)
    .values({
      name,
      email,
      passwordHash,
      ...(({ google_id: undefined, avatar_url: undefined, email_verified: false }) as any),
    })
    .returning({
      id:            users.id,
      name:          users.name,
      email:         users.email,
      avatarUrl:     (users as any).avatarUrl,
      emailVerified: (users as any).emailVerified,
    });

  await recordAttempt(db, email, meta.ipAddress!, true);

  const tokenUser: TokenUser = { id: newUser.id, email: newUser.email, name: newUser.name };
  const accessToken  = signAccessToken(tokenUser);
  const refreshToken = await createRefreshToken(db, tokenUser, null, meta);

  return { accessToken, refreshToken, user: sanitizeUser(newUser) };
}

// ── Login ──────────────────────────────────────────────────────────────────────

export async function login(
  db: NodePgDatabase<any>,
  req: Request
): Promise<AuthResult> {
  const { email, password } = req.body as { email: string; password: string };
  const meta = getMeta(req);

  await checkEmailBruteForce(db, email);

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const user = rows[0];

  const dummyHash = "$2a$12$invalidhashfortimingprotectionxxxxxxxxxxxxxxxx";
  const passwordMatch = await bcrypt.compare(
    password,
    user?.passwordHash ?? dummyHash
  );

  if (!user || !passwordMatch) {
    await recordAttempt(db, email, meta.ipAddress!, false);
    throw new AuthError("Email ou senha incorretos.", 401);
  }

  if ((user as any).isActive === false) {
    throw new AuthError("Conta desativada. Entre em contato com o suporte.", 403);
  }

  if (!user.passwordHash) {
    throw new AuthError("Esta conta usa login social. Entre com Google.", 400);
  }

  await recordAttempt(db, email, meta.ipAddress!, true);

  const tokenUser: TokenUser = { id: user.id, email: user.email, name: user.name };
  const accessToken  = signAccessToken(tokenUser);
  const refreshToken = await createRefreshToken(db, tokenUser, null, meta);

  return { accessToken, refreshToken, user: sanitizeUser(user) };
}

// ── Google OAuth ───────────────────────────────────────────────────────────────

// URI padrão — deve bater com GOOGLE_CALLBACK_URL no .env e no Google Cloud Console.
const DEFAULT_REDIRECT_URI = process.env.GOOGLE_CALLBACK_URL ?? process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3001/auth/google/callback";

// Lista de URIs permitidos para evitar open redirect
const ALLOWED_REDIRECT_URIS = new Set([
  DEFAULT_REDIRECT_URI,
  "http://localhost:3001/auth/google/callback",
  // Adicione aqui a URI de produção quando tiver, ex:
  // "https://api.seudominio.com/auth/google/callback",
]);

export async function googleAuth(
  db: NodePgDatabase<any>,
  req: Request
): Promise<AuthResult> {
  const { code, redirect_uri } = req.body as { code: string; redirect_uri?: string };
  const meta = getMeta(req);

  // SEGURANÇA: valida o redirect_uri recebido contra a lista de URIs permitidos
  // Sem isso um atacante poderia enviar um redirect_uri arbitrário
  const redirectUri = redirect_uri ?? DEFAULT_REDIRECT_URI;
  if (!ALLOWED_REDIRECT_URIS.has(redirectUri)) {
    console.error("[GoogleAuth] redirect_uri não permitido:", redirectUri);
    throw new AuthError("redirect_uri inválido.", 400);
  }

  if (!code || typeof code !== "string" || code.length > 512) {
    throw new AuthError("Código de autorização inválido.", 400);
  }

  // Cria o client com o redirect_uri exato que foi usado no frontend
  // O Google exige que sejam 100% idênticos
  const googleClient = makeGoogleClient(redirectUri);

  // 1. Troca o code por tokens do Google
  let idToken: string;
  try {
    const { tokens } = await googleClient.getToken(code);
    if (!tokens.id_token) throw new Error("id_token ausente");
    idToken = tokens.id_token;
  } catch (err) {
    console.error("[GoogleAuth] getToken falhou:", (err as Error).message);
    throw new AuthError("Falha ao verificar autenticação com o Google.", 400);
  }

  // 2. Verifica e decodifica o ID token
  let payload: {
    sub: string;
    email: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload() as typeof payload;
  } catch (err) {
    console.error("[GoogleAuth] verifyIdToken falhou:", (err as Error).message);
    throw new AuthError("Token do Google inválido ou expirado.", 400);
  }

  if (!payload.email_verified) throw new AuthError("Email do Google não verificado.", 400);
  if (!payload.email || !payload.sub) throw new AuthError("Dados insuficientes do Google.", 400);

  const googleEmail = payload.email.toLowerCase();
  const googleId    = payload.sub;
  const name        = payload.name ?? googleEmail.split("@")[0];
  const avatarUrl   = payload.picture ?? null;

  // 3. Upsert do usuário
  const [upserted] = await db.execute<{
    id: number; name: string; email: string;
    avatar_url: string | null; email_verified: boolean; is_active: boolean;
  }>(
    sql`
      INSERT INTO users (name, email, password_hash, google_id, avatar_url, email_verified)
      VALUES (
        ${name},
        ${googleEmail},
        NULL,
        ${googleId},
        ${avatarUrl},
        TRUE
      )
      ON CONFLICT (email) DO UPDATE
        SET google_id      = EXCLUDED.google_id,
            avatar_url     = EXCLUDED.avatar_url,
            email_verified = TRUE,
            updated_at     = NOW()
      RETURNING id, name, email, avatar_url, email_verified, is_active
    `
  ) as any;

  const row = Array.isArray(upserted) ? upserted[0] : upserted;

  if (!row) throw new AuthError("Erro ao criar ou recuperar usuário.", 500);
  if (row.is_active === false) {
    throw new AuthError("Conta desativada. Entre em contato com o suporte.", 403);
  }

  const tokenUser: TokenUser = { id: row.id, email: row.email, name: row.name };
  const accessToken  = signAccessToken(tokenUser);
  const refreshToken = await createRefreshToken(db, tokenUser, null, meta);

  return {
    accessToken,
    refreshToken,
    user: {
      id:            row.id,
      name:          row.name,
      email:         row.email,
      avatarUrl:     row.avatar_url,
      emailVerified: row.email_verified,
    },
  };
}

// ── Refresh ────────────────────────────────────────────────────────────────────

export async function refreshTokens(
  db: NodePgDatabase<any>,
  req: Request
): Promise<{ accessToken: string; newRefreshToken: string; user: SafeUser }> {
  const rawToken = req.cookies?.refreshToken as string | undefined;
  if (!rawToken) throw new AuthError("Refresh token ausente.", 401);

  const meta = getMeta(req);
  const { userId, newRawToken } = await rotateRefreshToken(db, rawToken, meta);

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const user = rows[0];
  if (!user) throw new AuthError("Usuário não encontrado.", 401);

  const tokenUser: TokenUser = { id: user.id, email: user.email, name: user.name };
  const accessToken = signAccessToken(tokenUser);

  return { accessToken, newRefreshToken: newRawToken, user: sanitizeUser(user) };
}

// ── Logout ─────────────────────────────────────────────────────────────────────

export async function logout(
  db: NodePgDatabase<any>,
  req: Request
): Promise<void> {
  const rawToken = req.cookies?.refreshToken as string | undefined;
  if (rawToken) await revokeRefreshToken(db, rawToken).catch(() => {});
}

export async function logoutAll(
  db: NodePgDatabase<any>,
  userId: number
): Promise<void> {
  await revokeAllUserTokens(db, userId);
}
