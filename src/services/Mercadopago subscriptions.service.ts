// ─── Tipos ────────────────────────────────────────────────────────────────────

export type MpPlanId = "pro" | "premium";

export interface MpPreapprovalPlan {
  id: string;
  status: string;
  reason: string;
  auto_recurring: {
    frequency: number;
    frequency_type: "months" | "days";
    transaction_amount: number;
    currency_id: string;
  };
}

export interface MpPreapproval {
  id: string;
  status: "pending" | "authorized" | "paused" | "cancelled";
  reason: string;
  payer_id: number;
  external_reference: string;
  init_point: string;             // URL para o usuário assinar
  preapproval_plan_id: string;
  auto_recurring: {
    frequency: number;
    frequency_type: string;
    transaction_amount: number;
    currency_id: string;
    start_date: string;
    end_date: string;
  };
  next_payment_date?: string;
  last_modified: string;
}

export interface CreateSubscriptionResult {
  preapprovalId: string;
  initPoint: string;       // redirecionar o usuário para cá
  planId: MpPlanId;
  externalReference: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BASE_URL = "https://api.mercadopago.com";

function getAccessToken(): string {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error("MP_ACCESS_TOKEN não configurado.");
  return token;
}

function getPlanId(planId: MpPlanId): string {
  const map: Record<MpPlanId, string | undefined> = {
    pro:     process.env.MP_PLAN_PRO_ID,
    premium: process.env.MP_PLAN_PREMIUM_ID,
  };
  const id = map[planId];
  if (!id || id.trim().length === 0) {
    throw new Error(
      `Plano "${planId}" não configurado. ` +
      `Adicione MP_PLAN_${planId.toUpperCase()}_ID no .env e rode scripts/create-mp-plans.cjs para criar o plano no MP.`
    );
  }
  return id.trim();
}

async function mpFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${getAccessToken()}`,
      ...(options.headers ?? {}),
    },
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};

  if (!res.ok) {
    throw new Error(data?.message ?? data?.error ?? `MP API erro ${res.status}: ${text.slice(0, 200)}`);
  }

  return data as T;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class MercadoPagoSubscriptionService {

  /**
   * Retorna a URL de checkout do plano (init_point do preapproval_plan).
   * O usuário é redirecionado para lá e o MP cria o preapproval internamente.
   * Não precisamos criar o preapproval manualmente — o MP faz isso após o pagamento.
   */
  async createSubscription(params: {
    userId:   number;
    userEmail: string;
    userName:  string;
    planId:   MpPlanId;
    backUrl?: string;
  }): Promise<CreateSubscriptionResult> {

    const preapprovalPlanId = getPlanId(params.planId);
    const appUrl = (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, "");
    const backUrl = params.backUrl ?? `${appUrl}/pagamento/confirmacao`;

    // Busca o plano para obter o init_point e atualiza o back_url
    const plan = await mpFetch<any>(`/preapproval_plan/${preapprovalPlanId}`);

    if (!plan?.init_point) {
      throw new Error(`Plano "${params.planId}" não tem init_point. Verifique se o ID está correto e se o plano está ativo.`);
    }

    // Adiciona back_url e external_reference como query params no init_point
    const externalReference = `subscription:user:${params.userId}:plan:${params.planId}:ts:${Date.now()}`;
    const checkoutUrl = new URL(plan.init_point);
    checkoutUrl.searchParams.set("back_url", backUrl);
    checkoutUrl.searchParams.set("external_reference", externalReference);
    checkoutUrl.searchParams.set("payer_email", params.userEmail);

    return {
      preapprovalId:     preapprovalPlanId, // será substituído pelo ID real via webhook
      initPoint:         checkoutUrl.toString(),
      planId:            params.planId,
      externalReference,
    };
  }

  /**
   * Busca e confirma a assinatura após o usuário voltar do MP.
   * O MP pode mandar o preapproval_id na URL de retorno — se não mandar,
   * buscamos pelo external_reference que gravamos na sessão.
   */
  async getPreapproval(preapprovalId: string): Promise<MpPreapproval> {
    return mpFetch<MpPreapproval>(`/preapproval/${preapprovalId}`);
  }

  /**
   * Busca preapproval pelo external_reference (userId + planId).
   * Usado quando o MP não retorna o preapproval_id na URL.
   */
  async findPreapprovalByReference(externalReference: string): Promise<MpPreapproval | null> {
    const res = await mpFetch<{ results: MpPreapproval[] }>(
      `/preapproval/search?external_reference=${encodeURIComponent(externalReference)}&limit=1`
    );
    return res?.results?.[0] ?? null;
  }

  /**
   * Cancela uma assinatura.
   */
  async cancelSubscription(preapprovalId: string): Promise<void> {
    await mpFetch(`/preapproval/${preapprovalId}`, {
      method: "PUT",
      body: JSON.stringify({ status: "cancelled" }),
    });
  }

  /**
   * Pausa uma assinatura.
   */
  async pauseSubscription(preapprovalId: string): Promise<void> {
    await mpFetch(`/preapproval/${preapprovalId}`, {
      method: "PUT",
      body: JSON.stringify({ status: "paused" }),
    });
  }

  /**
   * Reativa uma assinatura pausada.
   */
  async reactivateSubscription(preapprovalId: string): Promise<void> {
    await mpFetch(`/preapproval/${preapprovalId}`, {
      method: "PUT",
      body: JSON.stringify({ status: "authorized" }),
    });
  }

  /**
   * Valida a assinatura do webhook do MP.
   * MP envia: x-signature: ts=...,v1=...
   */
  validateWebhookSignature(params: {
    xSignature:  string | undefined;
    xRequestId:  string | undefined;
    dataId:      string | undefined;
  }): boolean {
    const secret = process.env.MP_WEBHOOK_SECRET;
    if (!secret) return false;

    const { xSignature, xRequestId, dataId } = params;
    if (!xSignature) return false;

    // Extrai ts e v1 do header
    const parts: Record<string, string> = {};
    xSignature.split(",").forEach((part) => {
      const [k, v] = part.trim().split("=");
      if (k && v) parts[k] = v;
    });

    const { ts, v1 } = parts;
    if (!ts || !v1) return false;

    // Monta o manifest: id:{dataId};request-id:{xRequestId};ts:{ts};
    const manifest = [
      dataId     ? `id:${dataId};`             : "",
      xRequestId ? `request-id:${xRequestId};` : "",
      `ts:${ts};`,
    ].join("");

    const crypto = require("crypto");
    const expected = crypto
      .createHmac("sha256", secret)
      .update(manifest)
      .digest("hex");
    const expectedBuf = Buffer.from(expected, "hex");
    const providedBuf = Buffer.from(v1, "hex");
    if (expectedBuf.length !== providedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, providedBuf);
  }

  /**
   * Extrai planId do externalReference
   * Formato: subscription:user:{userId}:plan:{planId}:ts:{timestamp}
   */
  parsePlanFromExternalReference(ref: string): { userId: number; planId: MpPlanId } | null {
    const match = ref.match(/^subscription:user:(\d+):plan:(pro|premium):ts:\d+$/);
    if (!match) return null;
    return { userId: Number(match[1]), planId: match[2] as MpPlanId };
  }

  /**
   * Status do MP → status interno
   */
  isActiveStatus(status: string): boolean {
    return status === "authorized" || status === "active";
  }

  planLabel(planId: MpPlanId): string {
    return planId === "premium" ? "Premium" : "Pro";
  }
}

export const mpSubscriptionService = new MercadoPagoSubscriptionService();
