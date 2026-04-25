import { Router } from "express";
import { z } from "zod";
import { authenticateOrMvp, type AuthenticatedRequest } from "../middleware/auth.js";
import { storage } from "../storage.js";
import { requireStepUp } from "../middleware/step-up.js";
import { normalizeCnpj, normalizeCpf, isValidCnpj, isValidCpf } from "../lib/brDocument.js";

const router = Router();

const pixSchema = z
  .object({
    pixKey: z.string().trim().min(3).max(200),
    pixKeyType: z.enum(["cpf", "cnpj", "email", "phone", "random"]),
  })
  .superRefine((data, ctx) => {
    if (data.pixKeyType === "cpf" && !isValidCpf(data.pixKey)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pixKey"], message: "CPF invalido." });
    }

    if (data.pixKeyType === "cnpj" && !isValidCnpj(data.pixKey)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pixKey"], message: "CNPJ invalido." });
    }
  })
  .transform((data) => {
    if (data.pixKeyType === "cpf") {
      return { ...data, pixKey: normalizeCpf(data.pixKey) ?? data.pixKey };
    }

    if (data.pixKeyType === "cnpj") {
      return { ...data, pixKey: normalizeCnpj(data.pixKey) ?? data.pixKey };
    }

    return data;
  });

router.get("/pix-key", authenticateOrMvp, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const user = await storage.getUserByIdForPix(userId);

  return res.json({
    pixKey: user?.pixKey ?? null,
    pixKeyType: user?.pixKeyType ?? null,
  });
});

router.post("/pix-key", authenticateOrMvp, requireStepUp("user.pix.update", () => ({})), async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  const parsed = pixSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados inválidos.", errors: parsed.error.flatten() });
  }

  const updated = await storage.updateUserPixKey(
    userId,
    parsed.data.pixKey,
    parsed.data.pixKeyType
  );

  return res.status(200).json({
    pixKey: updated?.pixKey ?? null,
    pixKeyType: updated?.pixKeyType ?? null,
  });
});

router.delete("/pix-key", authenticateOrMvp, requireStepUp("user.pix.delete", () => ({})), async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Não autenticado." });

  await storage.updateUserPixKey(userId, null, null);
  return res.status(204).send();
});

export default router;
