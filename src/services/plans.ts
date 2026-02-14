export type PlanId = "free" | "pro" | "premium";

export function planFromPriceId(priceId: string | null | undefined): PlanId {
  if (!priceId) return "free";

  const pro = process.env.STRIPE_MONTHLY_PLAN_PRICE_ID;    
  const premium = process.env.STRIPE_MONTHLY_PLAN2_PRICE_ID; 
  if (priceId === premium) return "premium";
  if (priceId === pro) return "pro";
  return "free"; 
}

export function isActiveSubscriptionStatus(status: string | null | undefined) {
  // Stripe costuma usar: 'active', 'trialing', 'past_due', 'canceled', etc.
  
  return status === "active" || status === "trialing";
}
