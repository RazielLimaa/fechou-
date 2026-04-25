import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { clauses, contractClauses, contracts } from "../../db/schema.js";
import { ALL_CLAUSES } from "./clause-engine.js";
import { LEGAL_CLAUSE_BY_ID } from "./legal-blueprint.js";

type DbClause = typeof clauses.$inferSelect;
type ClauseListItem = DbClause & {
  slug?: string;
  required?: boolean;
  riskLevel?: string;
  appliesTo?: string[];
  version?: string;
  status?: string;
};

const CATEGORY_ALIAS: Record<string, string[]> = {
  geral: ["institucional_governanca", "escopo_entregaveis", "rescisao_continuidade"],
  financeiro: ["preco_cobranca", "responsabilidade_garantias"],
  direitos: ["propriedade_intelectual", "disputas_comunicacoes", "compliance_operacional"],
  seguranca: ["confidencialidade", "dados_privacidade", "seguranca_evidencias"],
  institucional_governanca: ["institucional_governanca"],
  escopo_entregaveis: ["escopo_entregaveis"],
  preco_cobranca: ["preco_cobranca"],
  propriedade_intelectual: ["propriedade_intelectual"],
  confidencialidade: ["confidencialidade"],
  dados_privacidade: ["dados_privacidade"],
  seguranca_evidencias: ["seguranca_evidencias"],
  responsabilidade_garantias: ["responsabilidade_garantias"],
  rescisao_continuidade: ["rescisao_continuidade"],
  disputas_comunicacoes: ["disputas_comunicacoes"],
  compliance_operacional: ["compliance_operacional"],
  todos: [],
};

const CURRENT_CLAUSE_IDS = ALL_CLAUSES.map((item) => item.id as any);

function enrichClause(row: DbClause): ClauseListItem {
  const metadata = LEGAL_CLAUSE_BY_ID.get(String(row.id));
  if (!metadata) return row;

  return {
    ...row,
    slug: metadata.slug,
    required: metadata.required,
    riskLevel: metadata.riskLevel,
    appliesTo: metadata.appliesTo,
    version: metadata.version,
    status: metadata.status,
  };
}

export class ClauseService {
  async ensureCatalogSynced() {
    if (CURRENT_CLAUSE_IDS.length === 0) return;

    await db
      .insert(clauses)
      .values(
        ALL_CLAUSES.map((item) => ({
          id: item.id as any,
          title: item.title,
          content: item.content,
          description: item.description,
          category: item.category,
          profession: item.profession,
          isDefault: true,
        }))
      )
      .onConflictDoUpdate({
        target: clauses.id,
        set: {
          title: sql`excluded.title`,
          content: sql`excluded.content`,
          description: sql`excluded.description`,
          category: sql`excluded.category`,
          profession: sql`excluded.profession`,
          isDefault: sql`excluded.is_default`,
        },
      });

    await db.delete(clauses).where(sql`${clauses.id} not in (${sql.join(CURRENT_CLAUSE_IDS, sql`, `)})`);
  }

  private async touchContract(contractId: number) {
    await db
      .update(contracts)
      .set({ updatedAt: new Date() } as any)
      .where(eq(contracts.id, contractId));
  }

  private normalizeCategory(category?: string): string[] {
    if (!category) return [];
    const key = category.trim().toLowerCase();
    return CATEGORY_ALIAS[key] ?? [key];
  }

  private async addClauseToExistingContract(contractId: number, clauseId: string) {
    const [existingClause] = await db
      .select({ id: clauses.id })
      .from(clauses)
      .where(eq(clauses.id, clauseId as any));

    if (!existingClause) return null;

    const [existingLink] = await db
      .select()
      .from(contractClauses)
      .where(and(eq(contractClauses.contractId, contractId), eq(contractClauses.clauseId, clauseId as any)));

    if (existingLink) return existingLink;

    const [maxOrder] = await db
      .select({
        value: sql<number>`coalesce(max(${contractClauses.orderIndex}), -1)`,
      })
      .from(contractClauses)
      .where(eq(contractClauses.contractId, contractId));

    const [row] = await db
      .insert(contractClauses)
      .values({
        contractId,
        clauseId: clauseId as any,
        orderIndex: (maxOrder?.value ?? -1) + 1,
      })
      .returning();

    await this.touchContract(contractId);
    return row;
  }

  async searchClauses(search?: string, category?: string, profession?: string): Promise<ClauseListItem[]> {
    await this.ensureCatalogSynced();

    const filters = [];
    if (search) {
      filters.push(or(ilike(clauses.title, `%${search}%`), ilike(clauses.content, `%${search}%`)));
    }

    const categories = this.normalizeCategory(category);
    if (categories.length > 0) {
      filters.push(or(...categories.map((item) => eq(clauses.category, item))));
    }

    if (profession) {
      filters.push(or(eq(clauses.profession, profession), sql`${clauses.profession} is null`));
    }

    const baseQuery = db.select().from(clauses);
    const rows = filters.length === 0
      ? await baseQuery.where(inArray(clauses.id, CURRENT_CLAUSE_IDS)).orderBy(asc(clauses.title))
      : await baseQuery.where(and(inArray(clauses.id, CURRENT_CLAUSE_IDS), ...filters)).orderBy(asc(clauses.title));

    return rows.map(enrichClause);
  }

  filterClauses(category: string) {
    return db.select().from(clauses).where(and(eq(clauses.category, category), inArray(clauses.id, CURRENT_CLAUSE_IDS)));
  }

  filterClausesByProfession(profession: string) {
    return db
      .select()
      .from(clauses)
      .where(and(eq(clauses.profession, profession), inArray(clauses.id, CURRENT_CLAUSE_IDS)));
  }

  async addClauseToContract(contractId: number, clauseId: string) {
    const [contract] = await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(eq(contracts.id, contractId));

    if (!contract) return null;
    return this.addClauseToExistingContract(contractId, clauseId);
  }

  async addClauseToContractOwned(userId: number, contractId: number, clauseId: string) {
    const [contract] = await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(and(eq(contracts.id, contractId), eq(contracts.userId, userId)));

    if (!contract) return null;
    return this.addClauseToExistingContract(contractId, clauseId);
  }

  async removeClauseFromContract(contractId: number, clauseId: string) {
    const [removed] = await db
      .delete(contractClauses)
      .where(and(eq(contractClauses.contractId, contractId), eq(contractClauses.clauseId, clauseId as any)))
      .returning();

    if (removed) await this.touchContract(contractId);
    return removed;
  }

  async removeClauseFromContractOwned(userId: number, contractId: number, clauseId: string) {
    const [contract] = await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(and(eq(contracts.id, contractId), eq(contracts.userId, userId)));

    if (!contract) return null;
    return this.removeClauseFromContract(contractId, clauseId);
  }

  async updateClauseContent(contractId: number, clauseId: string, content: string) {
    const [updated] = await db
      .update(contractClauses)
      .set({ customContent: content })
      .where(and(eq(contractClauses.contractId, contractId), eq(contractClauses.clauseId, clauseId as any)))
      .returning();

    if (updated) await this.touchContract(contractId);
    return updated;
  }

  async updateClauseContentOwned(userId: number, contractId: number, clauseId: string, content: string) {
    const [contract] = await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(and(eq(contracts.id, contractId), eq(contracts.userId, userId)));

    if (!contract) return null;
    return this.updateClauseContent(contractId, clauseId, content);
  }

  async reorderClauses(contractId: number, startIndex: number, endIndex: number) {
    const rows = await db
      .select()
      .from(contractClauses)
      .where(eq(contractClauses.contractId, contractId))
      .orderBy(asc(contractClauses.orderIndex));

    if (startIndex < 0 || startIndex >= rows.length || endIndex < 0 || endIndex >= rows.length) {
      return null;
    }

    const reordered = [...rows];
    const [moved] = reordered.splice(startIndex, 1);
    reordered.splice(endIndex, 0, moved);

    await Promise.all(
      reordered.map((item, index) =>
        db.update(contractClauses).set({ orderIndex: index }).where(eq(contractClauses.id, item.id))
      )
    );

    await this.touchContract(contractId);

    return db
      .select()
      .from(contractClauses)
      .where(eq(contractClauses.contractId, contractId))
      .orderBy(asc(contractClauses.orderIndex));
  }

  async reorderClausesOwned(userId: number, contractId: number, startIndex: number, endIndex: number) {
    const [contract] = await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(and(eq(contracts.id, contractId), eq(contracts.userId, userId)));

    if (!contract) return null;
    return this.reorderClauses(contractId, startIndex, endIndex);
  }
}

export const clauseService = new ClauseService();
