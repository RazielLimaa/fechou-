import { and, count, desc, eq, sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { paymentSessions, proposals, templates, userSubscriptions, users } from './db/schema.js';

export type ProposalStatus = 'pendente' | 'vendida' | 'cancelada';
export type PaymentSessionMode = 'payment' | 'subscription';
export type PaymentSessionStatus = 'pending' | 'paid' | 'failed' | 'expired';

export interface CreateUserInput {
  name: string;
  email: string;
  passwordHash: string;
}

export interface CreateProposalInput {
  userId: number;
  title: string;
  clientName: string;
  description: string;
  value: string;
}

export interface CreatePaymentSessionInput {
  userId: number;
  proposalId?: number;
  mode: PaymentSessionMode;
  stripeSessionId: string;
  stripePaymentIntentId?: string;
  stripeSubscriptionId?: string;
  amount: string;
  currency: string;
  metadata?: Record<string, string>;
}

export interface SalesMetrics {
  totalProposals: number;
  totalSales: number;
  conversionRate: number;
  totalRevenue: number;
}

export class Storage {
  async createUser(input: CreateUserInput) {
    const [user] = await db
      .insert(users)
      .values(input)
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        createdAt: users.createdAt
      });

    return user;
  }

  async findUserByEmail(email: string) {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async findUserById(id: number) {
    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        stripeCustomerId: users.stripeCustomerId,
        stripeConnectAccountId: users.stripeConnectAccountId,
        createdAt: users.createdAt
      })
      .from(users)
      .where(eq(users.id, id));

    return user;
  }

  async setUserStripeCustomerId(userId: number, stripeCustomerId: string) {
    const [user] = await db
      .update(users)
      .set({ stripeCustomerId })
      .where(eq(users.id, userId))
      .returning({ id: users.id, stripeCustomerId: users.stripeCustomerId });

    return user;
  }

  async createProposal(input: CreateProposalInput) {
    const [proposal] = await db.insert(proposals).values(input).returning();
    return proposal;
  }

  async listProposals(userId: number, status?: ProposalStatus) {
    if (status) {
      return db
        .select()
        .from(proposals)
        .where(and(eq(proposals.userId, userId), eq(proposals.status, status)))
        .orderBy(desc(proposals.createdAt));
    }

    return db
      .select()
      .from(proposals)
      .where(eq(proposals.userId, userId))
      .orderBy(desc(proposals.createdAt));
  }

  async getProposalById(userId: number, proposalId: number) {
    const [proposal] = await db
      .select()
      .from(proposals)
      .where(and(eq(proposals.id, proposalId), eq(proposals.userId, userId)));

    return proposal;
  }

  async updateProposalStatus(userId: number, proposalId: number, status: ProposalStatus) {
    const payload: { status: ProposalStatus; acceptedAt?: Date | null; cancelledAt?: Date | null; updatedAt: Date } = {
      status,
      updatedAt: new Date()
    };

    if (status === 'vendida') {
      payload.acceptedAt = new Date();
      payload.cancelledAt = null;
    }

    if (status === 'cancelada') {
      payload.cancelledAt = new Date();
      payload.acceptedAt = null;
    }

    if (status === 'pendente') {
      payload.acceptedAt = null;
      payload.cancelledAt = null;
    }

    const [proposal] = await db
      .update(proposals)
      .set(payload)
      .where(and(eq(proposals.id, proposalId), eq(proposals.userId, userId)))
      .returning();

    return proposal;
  }

  async listTemplates(category?: string) {
    if (category) {
      return db
        .select()
        .from(templates)
        .where(and(eq(templates.isActive, true), eq(templates.category, category)))
        .orderBy(templates.name);
    }

    return db.select().from(templates).where(eq(templates.isActive, true)).orderBy(templates.name);
  }

  async getTemplateById(templateId: number) {
    const [template] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.id, templateId), eq(templates.isActive, true)));

    return template;
  }

  async createPaymentSession(input: CreatePaymentSessionInput) {
    const [session] = await db
      .insert(paymentSessions)
      .values({
        userId: input.userId,
        proposalId: input.proposalId,
        mode: input.mode,
        stripeSessionId: input.stripeSessionId,
        stripePaymentIntentId: input.stripePaymentIntentId,
        stripeSubscriptionId: input.stripeSubscriptionId,
        amount: input.amount,
        currency: input.currency,
        status: 'pending',
        metadata: input.metadata ?? {},
        updatedAt: new Date()
      })
      .returning();

    return session;
  }

  async findPaymentSessionByStripeSessionId(stripeSessionId: string) {
    const [session] = await db.select().from(paymentSessions).where(eq(paymentSessions.stripeSessionId, stripeSessionId));
    return session;
  }


  async findPaymentSessionByPaymentIntentId(stripePaymentIntentId: string) {
    const [session] = await db
      .select()
      .from(paymentSessions)
      .where(eq(paymentSessions.stripePaymentIntentId, stripePaymentIntentId));

    return session;
  }

  async markPaymentSessionStatus(stripeSessionId: string, status: PaymentSessionStatus) {
    const [session] = await db
      .update(paymentSessions)
      .set({ status, updatedAt: new Date() })
      .where(eq(paymentSessions.stripeSessionId, stripeSessionId))
      .returning();

    return session;
  }

  async getRecentPaymentsByUser(userId: number) {
    return db
      .select({
        id: paymentSessions.id,
        proposalId: paymentSessions.proposalId,
        mode: paymentSessions.mode,
        status: paymentSessions.status,
        amount: paymentSessions.amount,
        currency: paymentSessions.currency,
        createdAt: paymentSessions.createdAt
      })
      .from(paymentSessions)
      .where(eq(paymentSessions.userId, userId))
      .orderBy(desc(paymentSessions.createdAt));
  }

  async upsertUserSubscription(input: {
    userId: number;
    stripeSubscriptionId: string;
    stripeCustomerId: string;
    stripePriceId: string;
    status: string;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
  }) {
    const existing = await this.findSubscriptionByStripeId(input.stripeSubscriptionId);

    if (existing) {
      const [updated] = await db
        .update(userSubscriptions)
        .set({
          stripePriceId: input.stripePriceId,
          status: input.status,
          currentPeriodEnd: input.currentPeriodEnd,
          cancelAtPeriodEnd: input.cancelAtPeriodEnd,
          updatedAt: new Date()
        })
        .where(eq(userSubscriptions.stripeSubscriptionId, input.stripeSubscriptionId))
        .returning();

      return updated;
    }

    const [created] = await db
      .insert(userSubscriptions)
      .values({
        userId: input.userId,
        stripeSubscriptionId: input.stripeSubscriptionId,
        stripeCustomerId: input.stripeCustomerId,
        stripePriceId: input.stripePriceId,
        status: input.status,
        currentPeriodEnd: input.currentPeriodEnd,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        updatedAt: new Date()
      })
      .returning();

    return created;
  }

  async findSubscriptionByStripeId(stripeSubscriptionId: string) {
    const [subscription] = await db
      .select()
      .from(userSubscriptions)
      .where(eq(userSubscriptions.stripeSubscriptionId, stripeSubscriptionId));

    return subscription;
  }

  async getActiveSubscriptionByUser(userId: number) {
    const [subscription] = await db
      .select()
      .from(userSubscriptions)
      .where(and(eq(userSubscriptions.userId, userId), eq(userSubscriptions.status, 'active')))
      .orderBy(desc(userSubscriptions.updatedAt));

    return subscription;
  }

  async getSalesMetrics(userId: number): Promise<SalesMetrics> {
    const [totals] = await db
      .select({
        totalProposals: count(proposals.id),
        totalRevenue: sql<string>`coalesce(sum(case when ${proposals.status} = 'vendida' then ${proposals.value} else 0 end), 0)`,
        totalSales: sql<number>`coalesce(sum(case when ${proposals.status} = 'vendida' then 1 else 0 end), 0)`
      })
      .from(proposals)
      .where(eq(proposals.userId, userId));

    const totalProposals = Number(totals.totalProposals ?? 0);
    const totalSales = Number(totals.totalSales ?? 0);
    const totalRevenue = Number(totals.totalRevenue ?? 0);
    const conversionRate = totalProposals === 0 ? 0 : Number(((totalSales / totalProposals) * 100).toFixed(2));

    return {
      totalProposals,
      totalSales,
      conversionRate,
      totalRevenue
    };
  }
}

export const storage = new Storage();
