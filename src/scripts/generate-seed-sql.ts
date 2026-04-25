import { writeFileSync } from "node:fs";
import { ALL_CLAUSES } from "../services/contracts/clause-engine.js";

function escapeSql(value: string) {
  return value.replace(/'/g, "''");
}

function toNullableSql(value: string | null) {
  return value ? `'${escapeSql(value)}'` : "NULL";
}

function generateSQL() {
  const timestamp = new Date().toISOString();
  const ids = ALL_CLAUSES.map((clause) => `'${escapeSql(clause.id)}'`).join(", ");

  const values = ALL_CLAUSES.map((clause) => {
    return `('${escapeSql(clause.id)}', '${escapeSql(clause.title)}', '${escapeSql(clause.content)}', '${escapeSql(
      clause.category
    )}', ${toNullableSql(clause.profession)}, '${escapeSql(clause.description)}', true)`;
  }).join(",\n");

  return [
    "-- FECHOU! - Seed da tabela clauses",
    `-- Gerado em: ${timestamp}`,
    `-- Total de clausulas: ${ALL_CLAUSES.length}`,
    "",
    "INSERT INTO clauses (id, title, content, category, profession, description, is_default)",
    "VALUES",
    `${values}`,
    "ON CONFLICT (id) DO UPDATE SET",
    "  title = EXCLUDED.title,",
    "  content = EXCLUDED.content,",
    "  category = EXCLUDED.category,",
    "  profession = EXCLUDED.profession,",
    "  description = EXCLUDED.description,",
    "  is_default = EXCLUDED.is_default;",
    "",
    `DELETE FROM clauses WHERE id NOT IN (${ids});`,
    "",
  ].join("\n");
}

const seedSQL = generateSQL();
writeFileSync("seed_fechou.sql", seedSQL);
console.log("seed_fechou.sql gerado com sucesso.");
