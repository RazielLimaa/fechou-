import { inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { clauses } from "../../db/schema.js";
import { getProfessionSuggestedClauseSlugs, LEGAL_CLAUSE_CATALOG } from "./legal-blueprint.js";
import { clauseService } from "./clause.service.js";

const CLAUSE_ID_BY_SLUG = new Map(LEGAL_CLAUSE_CATALOG.map((item) => [item.slug, item.id]));

export class ProfessionService {
  async suggestClausesForProfession(profession: string, contractType?: string) {
    await clauseService.ensureCatalogSynced();

    const slugs = getProfessionSuggestedClauseSlugs(profession, contractType);
    const ids = slugs
      .map((slug) => CLAUSE_ID_BY_SLUG.get(slug))
      .filter((item): item is string => Boolean(item));

    if (ids.length === 0) return [];

    return db.select().from(clauses).where(inArray(clauses.id, ids as any));
  }
}

export const professionService = new ProfessionService();
