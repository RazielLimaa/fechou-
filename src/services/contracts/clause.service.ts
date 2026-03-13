import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { clauses, contractClauses, contracts } from '../../db/schema.js';
import { ALL_CLAUSES, type ClauseCategory } from './clause-engine.js';

type ClauseListItem = typeof clauses.$inferSelect;

const CATEGORY_ALIAS: Record<string, string[]> = {
  geral: ['geral'],
  financeiro: ['financeiro'],
  direitos: ['direitos'],
  seguranca: ['seguranca'],
  segurança: ['seguranca'],
  todos: []
};

const ENGINE_TO_UI_CATEGORY: Record<ClauseCategory, string> = {
  prestacao_servicos: 'geral',
  pagamento_multas: 'financeiro',
  propriedade_intelectual: 'direitos',
  confidencialidade: 'seguranca',
  rescisao_penalidades: 'geral',
  responsabilidade_civil: 'financeiro',
  prazo_entrega: 'geral',
  foro_conflitos: 'direitos'
};

export class ClauseService {
  private async seedFromEngineIfEmpty() {
    const [countRow] = await db.select({ count: sql<number>`count(*)` }).from(clauses);
    if ((countRow?.count ?? 0) > 0) return;

    await db.insert(clauses).values(
      ALL_CLAUSES.map((item) => ({
        title: item.title,
        content: item.content,
        category: ENGINE_TO_UI_CATEGORY[item.category],
        profession: item.profession,
        isDefault: true
      }))
    );
  }

  private normalizeCategory(category?: string): string[] {
    if (!category) return [];
    const key = category.trim().toLowerCase();

    if (CATEGORY_ALIAS[key]) return CATEGORY_ALIAS[key];
    return [key];
  }

  async searchClauses(search?: string, category?: string, profession?: string): Promise<ClauseListItem[]> {
    await this.seedFromEngineIfEmpty();

    const filters = [];

    if (search) {
      filters.push(or(ilike(clauses.title, `%${search}%`), ilike(clauses.content, `%${search}%`)));
    }

    const categories = this.normalizeCategory(category);
    if (categories.length > 0) {
      filters.push(or(...categories.map((cat) => eq(clauses.category, cat))));
    }

    if (profession) {
      filters.push(or(eq(clauses.profession, profession), sql`${clauses.profession} is null`));
    }

    if (filters.length === 0) {
      return db.select().from(clauses).orderBy(asc(clauses.title));
    }

    return db.select().from(clauses).where(and(...filters)).orderBy(asc(clauses.title));
  }

  filterClauses(category: string) {
    return db.select().from(clauses).where(eq(clauses.category, category));
  }

  filterClausesByProfession(profession: string) {
    return db.select().from(clauses).where(eq(clauses.profession, profession));
  }

  async addClauseToContract(contractId: number, clauseId: number) {
    const [contract] = await db.select({ id: contracts.id }).from(contracts).where(eq(contracts.id, contractId));
    if (!contract) return null;

    const [clause] = await db.select({ id: clauses.id }).from(clauses).where(eq(clauses.id, clauseId));
    if (!clause) return null;

    const [maxOrder] = await db
      .select({ value: sql<number>`coalesce(max(${contractClauses.orderIndex}), -1)` })
      .from(contractClauses)
      .where(eq(contractClauses.contractId, contractId));

    const [row] = await db
      .insert(contractClauses)
      .values({
        contractId,
        clauseId,
        orderIndex: (maxOrder?.value ?? -1) + 1
      })
      .returning();

    return row;
  }

  async removeClauseFromContract(contractId: number, clauseId: number) {
    const [removed] = await db
      .delete(contractClauses)
      .where(and(eq(contractClauses.contractId, contractId), eq(contractClauses.clauseId, clauseId)))
      .returning();

    return removed;
  }

  async updateClauseContent(contractId: number, clauseId: number, content: string) {
    const [updated] = await db
      .update(contractClauses)
      .set({ customContent: content })
      .where(and(eq(contractClauses.contractId, contractId), eq(contractClauses.clauseId, clauseId)))
      .returning();

    return updated;
  }

  async reorderClauses(contractId: number, startIndex: number, endIndex: number) {
    const rows = await db
      .select()
      .from(contractClauses)
      .where(eq(contractClauses.contractId, contractId))
      .orderBy(asc(contractClauses.orderIndex));

    if (startIndex < 0 || startIndex >= rows.length || endIndex < 0 || endIndex >= rows.length) return null;

    const reordered = [...rows];
    const [moved] = reordered.splice(startIndex, 1);
    reordered.splice(endIndex, 0, moved);

    await Promise.all(
      reordered.map((item, index) => db.update(contractClauses).set({ orderIndex: index }).where(eq(contractClauses.id, item.id)))
    );

    return db.select().from(contractClauses).where(eq(contractClauses.contractId, contractId)).orderBy(asc(contractClauses.orderIndex));
  }
}

export const clauseService = new ClauseService();
