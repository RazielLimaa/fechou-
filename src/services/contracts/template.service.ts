import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { contractTemplates, userSubscriptions, usersPlan } from '../../db/schema.js';

export type UserPlan = 'free' | 'pro' | 'premium';

export class TemplateService {
  async checkUserPlan(userId: number): Promise<UserPlan> {
    const [plan] = await db.select().from(usersPlan).where(eq(usersPlan.userId, userId));
    if (plan) return plan.planType;

    const [subscription] = await db
      .select()
      .from(userSubscriptions)
      .where(and(eq(userSubscriptions.userId, userId), eq(userSubscriptions.status, 'active')));

    if (!subscription) return 'free';

    const premiumPriceId = process.env.STRIPE_MONTHLY_PLAN2_PRICE_ID;
    if (premiumPriceId && subscription.stripePriceId === premiumPriceId) return 'premium';

    return 'pro';
  }

  getTemplateById(templateId: number) {
    return db.select().from(contractTemplates).where(eq(contractTemplates.id, templateId));
  }

  async getDefaultTemplate() {
    const [defaultTemplate] = await db
      .select()
      .from(contractTemplates)
      .where(eq(contractTemplates.isDefault, true));

    return defaultTemplate ?? null;
  }
}

export const templateService = new TemplateService();
