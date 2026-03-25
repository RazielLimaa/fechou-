// scripts/create-mp-plans.cjs
// Rode: node scripts/create-mp-plans.cjs

require("dotenv").config();

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

if (!MP_ACCESS_TOKEN) {
  console.error("❌ MP_ACCESS_TOKEN não encontrado no .env");
  process.exit(1);
}

async function createPlan(reason, amount) {
  const res = await fetch("https://api.mercadopago.com/preapproval_plan", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      reason,
      auto_recurring: {
        frequency:          1,
        frequency_type:     "months",
        transaction_amount: amount,
        currency_id:        "BRL",
      },
      back_url: process.env.APP_URL
        ? process.env.APP_URL.replace(/\/$/, "") + "/pagamento/confirmacao"
        : "https://www.mercadopago.com.br",
      status:   "active",
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Erro ao criar plano: ${JSON.stringify(data)}`);
  }

  return data;
}

async function main() {
  console.log("\n🚀 Criando planos no Mercado Pago...\n");

  const pro = await createPlan("Fechou! — Plano Pro", 29);
  console.log("✅ Plano PRO criado:");
  console.log(`   MP_PLAN_PRO_ID=${pro.id}\n`);

  const premium = await createPlan("Fechou! — Plano Premium", 59);
  console.log("✅ Plano PREMIUM criado:");
  console.log(`   MP_PLAN_PREMIUM_ID=${premium.id}\n`);

  console.log("─────────────────────────────────────────");
  console.log("Adicione ao seu .env:");
  console.log(`MP_PLAN_PRO_ID=${pro.id}`);
  console.log(`MP_PLAN_PREMIUM_ID=${premium.id}`);
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
