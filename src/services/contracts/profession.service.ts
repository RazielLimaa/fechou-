import { inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { clauses } from '../../db/schema.js';

const PROFESSION_CLAUSE_MAP: Record<string, string[]> = {
  WEB: ['propriedade intelectual', 'entrega de projeto', 'licenciamento de software', 'suporte técnico'],
  SOFTWARE: ['propriedade intelectual', 'entrega de projeto', 'licenciamento de software', 'suporte técnico'],
  MOBILE: ['propriedade intelectual', 'entrega de projeto', 'licenciamento de software', 'suporte técnico'],
  DESIGN: ['direitos autorais', 'entrega de arquivos', 'limite de revisões'],
  BRANDING: ['direitos autorais', 'entrega de arquivos', 'limite de revisões'],
  MARKETING: ['estratégia de marketing', 'resultados não garantidos'],
  FOTOGRAFIA: ['direito de imagem', 'cancelamento de evento'],
  EVENTOS: ['direito de imagem', 'cancelamento de evento'],
  'ESTÉTICA': ['responsabilidade profissional', 'consentimento do cliente'],
  'SAÚDE': ['responsabilidade profissional', 'consentimento do cliente'],
  'EDUCAÇÃO': ['uso de material didático'],
  'JURÍDICO': ['confidencialidade reforçada', 'limitação de responsabilidade']
};

export class ProfessionService {
  async suggestClausesForProfession(profession: string) {
    const key = profession.trim().toUpperCase();
    const titles = PROFESSION_CLAUSE_MAP[key] ?? [];

    if (titles.length === 0) return [];

    return db.select().from(clauses).where(inArray(clauses.title, titles));
  }
}

export const professionService = new ProfessionService();
