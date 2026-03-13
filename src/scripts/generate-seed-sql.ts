import { writeFileSync } from 'node:fs';
import { ALL_CLAUSES, type ClauseCategory } from '../services/contracts/clause-engine.js';

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

const categoryMap: Record<ClauseCategory, string> = {
  prestacao_servicos: 'geral',
  pagamento_multas: 'financeiro',
  propriedade_intelectual: 'direitos',
  confidencialidade: 'seguranca',
  rescisao_penalidades: 'geral',
  responsabilidade_civil: 'financeiro',
  prazo_entrega: 'geral',
  foro_conflitos: 'direitos'
};

function generateSQL(): string {
  const timestamp = new Date().toISOString();

  const values = ALL_CLAUSES.map((clause) => {
    const category = categoryMap[clause.category];

    return `('${escapeSql(clause.title)}', '${escapeSql(clause.content)}', '${category}', ${
      clause.profession ? `'${escapeSql(clause.profession)}'` : 'NULL'
    }, true)`;
  }).join(',\n');

  return `-- FECHOU! - Seed da tabela clauses\n-- Gerado em: ${timestamp}\n-- Total de cláusulas: ${ALL_CLAUSES.length}\n\nTRUNCATE TABLE clauses RESTART IDENTITY CASCADE;\n\nINSERT INTO clauses (title, content, category, profession, is_default) VALUES\n${values};\n`;
}

const seedSQL = generateSQL();
writeFileSync('seed_fechou.sql', seedSQL);
console.log('✅ Arquivo seed_fechou.sql gerado com sucesso!');
