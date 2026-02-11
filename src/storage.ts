import { and, count, desc, eq, sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { proposals, templates, users } from './db/schema.js';

export type ProposalStatus = 'pendente' | 'vendida' | 'cancelada';

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
      .select({ id: users.id, name: users.name, email: users.email, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, id));

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
