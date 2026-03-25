import "dotenv/config";

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
if (!MP_ACCESS_TOKEN) {
  console.error("❌ MP_ACCESS_TOKEN não encontrado no .env");
  process.exit(1);
}

async function createPlan(plan: {
  reason: string;
  amount: number;
  currencyId: string;
  backUrl: string;
}) {
  const res = await fetch("https://api.mercadopago.com/preapproval_plan", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      reason:        plan.reason,
      auto_recurring: {
        frequency:          1,
        frequency_type:     "months",
        transaction_amount: plan.amount,
        currency_id:        plan.currencyId,
      },
      back_url:      plan.backUrl,
      status:        "active",
    }),
  });

  const data = await res.json() as any;
  if (!res.ok) {
    throw new Error(`Erro ao criar plano: ${JSON.stringify(data)}`);
  }
  return data;
}

async function main() {
  const appUrl = (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, "");
  const backUrl = `${appUrl}/pagamento/confirmacao`;

  console.log("🚀 Criando planos no Mercado Pago...\n");

  // ── Plano Pro ──────────────────────────────────────────────────────────────
  const pro = await createPlan({
    reason:     "Fechou! — Plano Pro",
    amount:     29,        // ← altere para o valor real do seu plano Pro
    currencyId: "BRL",
    backUrl,
  });
  console.log("✅ Plano PRO criado:");
  console.log(`   MP_PLAN_PRO_ID=${pro.id}\n`);

  // ── Plano Premium ──────────────────────────────────────────────────────────
  const premium = await createPlan({
    reason:     "Fechou! — Plano Premium",
    amount:     59,        // ← altere para o valor real do seu plano Premium
    currencyId: "BRL",
    backUrl,
  });
  console.log("✅ Plano PREMIUM criado:");
  console.log(`   MP_PLAN_PREMIUM_ID=${premium.id}\n`);

  console.log("─────────────────────────────────────────");
  console.log("Adicione estas linhas ao seu .env:");
  console.log(`MP_PLAN_PRO_ID=${pro.id}`);
  console.log(`MP_PLAN_PREMIUM_ID=${premium.id}`);
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});