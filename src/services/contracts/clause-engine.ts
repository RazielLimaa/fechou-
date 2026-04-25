import {
  LEGAL_CLAUSE_CATALOG,
  type ClauseRiskLevel as RiskLevel,
  type LegalClauseCategory as ClauseCategory,
} from "./legal-blueprint.js";

export type { RiskLevel, ClauseCategory };

export interface ClauseDefinition {
  id: string;
  slug: string;
  title: string;
  category: ClauseCategory;
  profession: string | null;
  description: string;
  content: string;
  legalBasis: string;
  riskLevel: RiskLevel;
  tags: string[];
  required: boolean;
  appliesTo: string[];
  variablesTemplate: Record<string, string>;
  version: string;
  status: "published" | "draft" | "deprecated";
}

function deriveLegacyLegalBasis(appliesTo: string[]) {
  if (appliesTo.includes("dados_pessoais")) return "LGPD + guias ANPD";
  if (appliesTo.includes("assinatura_eletronica")) return "Lei 14.063/2020 + MP 2.200-2/2001";
  if (appliesTo.includes("b2c")) return "Codigo Civil + CDC";
  return "Codigo Civil + legislacao complementar";
}

function deriveProfessionTag(tags: string[]) {
  if (tags.includes("saas")) return "saas";
  if (tags.includes("tecnologia")) return "tecnologia";
  if (tags.includes("criativo")) return "design";
  if (tags.includes("marketing")) return "marketing";
  if (tags.includes("consultoria")) return "consultoria";
  if (tags.includes("juridico")) return "juridico";
  return null;
}

export const ALL_CLAUSES: ClauseDefinition[] = LEGAL_CLAUSE_CATALOG.map((item) => ({
  id: item.id,
  slug: item.slug,
  title: item.title,
  category: item.category,
  profession: deriveProfessionTag(item.professionTags),
  description: item.description,
  content: item.contentTemplate,
  legalBasis: deriveLegacyLegalBasis(item.appliesTo),
  riskLevel: item.riskLevel,
  tags: Array.from(new Set([...item.appliesTo, ...item.professionTags, item.slug])),
  required: item.required,
  appliesTo: item.appliesTo,
  variablesTemplate: item.variablesTemplate,
  version: item.version,
  status: item.status,
}));

export const getByCategory = (category: ClauseCategory) => ALL_CLAUSES.filter((item) => item.category === category);
export const getByProfession = (profession: string) =>
  ALL_CLAUSES.filter((item) => item.profession === profession || item.profession === null);
export const searchClauses = (query: string) => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return ALL_CLAUSES;

  return ALL_CLAUSES.filter((item) => {
    return (
      item.title.toLowerCase().includes(normalized) ||
      item.content.toLowerCase().includes(normalized) ||
      item.description.toLowerCase().includes(normalized) ||
      item.tags.some((tag) => tag.toLowerCase().includes(normalized))
    );
  });
};

export const getStats = () => {
  const byCategory: Record<string, number> = {};
  const byRisk: Record<RiskLevel, number> = { baixo: 0, medio: 0, alto: 0 };

  for (const clause of ALL_CLAUSES) {
    byCategory[clause.category] = (byCategory[clause.category] ?? 0) + 1;
    byRisk[clause.riskLevel] += 1;
  }

  return {
    total: ALL_CLAUSES.length,
    byCategory,
    byRisk,
  };
};
