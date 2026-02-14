import { planFromPriceId, isActiveSubscriptionStatus, type PlanId } from "../services/plans.js";
import { storage } from "../storage.js";

export function requirePlan(minPlan: PlanId) {
  const order: Record<PlanId, number> = { free: 0, pro: 1, premium: 2 };

  return async (req: any, res: any, next: any) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Não autenticado." });

    const sub = await storage.getActiveSubscriptionByUser(userId);
    const planId =
      sub && isActiveSubscriptionStatus(sub.status)
        ? planFromPriceId(sub.stripePriceId)
        : "free";

    if (order[planId] < order[minPlan]) {
      return res.status(403).json({ message: `Requer plano ${minPlan}.`, planId });
    }

    return next();
  };
}
