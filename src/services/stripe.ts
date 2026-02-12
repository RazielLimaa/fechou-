import Stripe from 'stripe';

const secretKey = process.env.STRIPE_SECRET_KEY;

if (!secretKey) {
  throw new Error('STRIPE_SECRET_KEY não definido no ambiente.');
}

export const stripe = new Stripe(secretKey, {
  apiVersion: '2024-06-20'
});

export const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export const defaultCurrency = (process.env.STRIPE_CURRENCY ?? 'brl').toLowerCase();

export function decimalToCents(value: number) {
  return Math.round(value * 100);
}

export function centsToDecimal(value: number) {
  return (value / 100).toFixed(2);
}

export function getMonthlyPlanPriceId() {
  const priceId = process.env.STRIPE_MONTHLY_PLAN_PRICE_ID;

  if (!priceId) {
    throw new Error('STRIPE_MONTHLY_PLAN_PRICE_ID não definido no ambiente.');
  }

  return priceId;
}
