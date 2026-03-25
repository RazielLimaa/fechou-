// OauthF/middleware.ts
import type { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import validator from "validator";
import { verifyAccessToken, AuthError } from "../services/token.js"; // ajuste o caminho para seu token.js

// ── requireAuth ───────────────────────────────────────────────────────────────

export interface AuthRequest extends Request {
  user?: { id: number; email: string; name: string };
}

export function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ message: "Token de acesso ausente." });
      return;
    }

    const token = header.slice(7).trim();
    if (!token) {
      res.status(401).json({ message: "Token de acesso vazio." });
      return;
    }

    const payload = verifyAccessToken(token);
    req.user = {
      id:    parseInt(payload.sub!, 10),
      email: payload["email"] as string,
      name:  payload["name"]  as string,
    };
    next();
  } catch (err: any) {
    if (err.name === "TokenExpiredError") {
      res.status(401).json({ message: "Sessão expirada.", code: "TOKEN_EXPIRED" });
      return;
    }
    res.status(401).json({ message: "Token inválido." });
  }
}

// ── Rate limiters ─────────────────────────────────────────────────────────────

const makeLimit = (windowMs: number, max: number, message: string) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders:   false,
    keyGenerator:    (req) => req.ip ?? "unknown",
    handler:         (_req, res) => res.status(429).json({ message }),
    skip:            () => process.env.NODE_ENV === "test",
  });

export const loginLimiter    = makeLimit(15 * 60_000, 10,  "Muitas tentativas. Aguarde 15 minutos.");
export const registerLimiter = makeLimit(60 * 60_000,  5,  "Muitos cadastros deste IP. Aguarde 1 hora.");
export const refreshLimiter  = makeLimit(15 * 60_000, 30,  "Muitas renovações de sessão. Aguarde.");
export const oauthLimiter    = makeLimit(15 * 60_000, 20,  "Muitas tentativas OAuth. Aguarde.");

// ── Validadores de input ──────────────────────────────────────────────────────

export function validateRegister(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const { name, email, password } = req.body ?? {};
  const errors: string[] = [];

  if (!name || typeof name !== "string" || !validator.isLength(name.trim(), { min: 2, max: 120 }))
    errors.push("Nome deve ter entre 2 e 120 caracteres.");

  if (!email || typeof email !== "string" || !validator.isEmail(email.trim()) || email.length > 180)
    errors.push("Email inválido.");

  if (!password || typeof password !== "string")
    errors.push("Senha é obrigatória.");
  else if (!validator.isLength(password, { min: 8, max: 128 }))
    errors.push("Senha deve ter entre 8 e 128 caracteres.");
  else if (!/[A-Z]/.test(password)) errors.push("Senha precisa de letra maiúscula.");
  else if (!/[0-9]/.test(password)) errors.push("Senha precisa de número.");
  else if (!/[^A-Za-z0-9]/.test(password)) errors.push("Senha precisa de caractere especial.");

  if (errors.length > 0) {
    res.status(400).json({ message: errors[0], errors });
    return;
  }

  req.body.name  = validator.escape(name.trim());
  req.body.email = email.trim().toLowerCase();
  next();
}

export function validateLogin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const { email, password } = req.body ?? {};

  if (!email || typeof email !== "string" || !validator.isEmail(email.trim())) {
    res.status(400).json({ message: "Email inválido." }); return;
  }
  if (!password || typeof password !== "string" || password.length === 0) {
    res.status(400).json({ message: "Senha é obrigatória." }); return;
  }
  if (password.length > 128) {
    res.status(400).json({ message: "Senha excede o tamanho máximo." }); return;
  }

  req.body.email = email.trim().toLowerCase();
  next();
}

export function validateGoogleCode(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const { code } = req.body ?? {};
  if (!code || typeof code !== "string" || code.trim().length === 0 || code.length > 512) {
    res.status(400).json({ message: "Authorization code inválido." }); return;
  }
  req.body.code = code.trim();
  next();
}