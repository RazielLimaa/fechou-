import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { contractClauses, contracts } from "../../db/schema.js";
import { mergeContractLayoutConfig } from "./contract-layout.js";
import { clauseService } from "./clause.service.js";
import {
  buildContractTemplateFieldStatus,
  buildContractModelText,
  evaluateWarnings,
  selectClausesForContext,
  type ContractBlueprintContext,
} from "./legal-blueprint.js";

function formatCurrencyBRL(value: string | number) {
  const numeric = typeof value === "string" ? Number(String(value).replace(",", ".")) : value;
  if (!Number.isFinite(numeric)) return String(value);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(numeric);
}

export interface AutoGenerateContractInput extends Partial<ContractBlueprintContext> {
  replaceExisting?: boolean;
  maxAutomaticClauses?: number;
  automaticClauseCount?: number;
  autoClauseCount?: number;
  clauseCount?: number;
  clauseLimit?: number;
  contratadaNome?: string;
  contratadaDocumento?: string;
  contratadaEndereco?: string;
  contratanteDocumento?: string;
  contratanteEndereco?: string;
  customerDocument?: string;
  customerAddress?: string;
  provider_document?: string;
  provider_address?: string;
  client_document?: string;
  client_address?: string;
}

export class ContractAutomationService {
  async autoGenerate(userId: number, contractId: number, input: AutoGenerateContractInput) {
    await clauseService.ensureCatalogSynced();

    const [contract] = await db
      .select()
      .from(contracts)
      .where(and(eq(contracts.id, contractId), eq(contracts.userId, userId)))
      .limit(1);

    if (!contract) return null;

    const context: Partial<ContractBlueprintContext> = {
      clientName: input.clientName ?? contract.clientName,
      clientDocument:
        input.clientDocument ??
        (input as any).contratanteDocumento ??
        (input as any).customerDocument ??
        (input as any).client_document,
      clientAddress:
        input.clientAddress ??
        (input as any).contratanteEndereco ??
        (input as any).customerAddress ??
        (input as any).client_address,
      providerName: input.providerName ?? (input as any).contratadaNome,
      providerDocument:
        input.providerDocument ??
        (input as any).contratadaDocumento ??
        (input as any).provider_document,
      providerAddress:
        input.providerAddress ??
        (input as any).contratadaEndereco ??
        (input as any).provider_address,
      objectSummary: input.objectSummary ?? contract.contractType,
      serviceScope: input.serviceScope ?? contract.serviceScope,
      contractValue: input.contractValue ?? formatCurrencyBRL(contract.contractValue),
      paymentTerms: input.paymentTerms ?? `pagamento via ${contract.paymentMethod}`,
      clauseMode: input.clauseMode,
      targetClauseCount:
        input.targetClauseCount ??
        input.maxAutomaticClauses ??
        input.automaticClauseCount ??
        input.autoClauseCount ??
        input.clauseCount ??
        input.clauseLimit,
      supportSummary: input.supportSummary,
      subprocessorSummary: input.subprocessorSummary,
      securitySummary: input.securitySummary,
      forumCityUf: input.forumCityUf,
      forumConnection: input.forumConnection,
      ...input,
    };

    const { context: normalizedContext, clauses, selection } = selectClausesForContext(context);
    const templateFieldStatus = buildContractTemplateFieldStatus(normalizedContext, clauses);
    const warnings = evaluateWarnings(normalizedContext);
    if (templateFieldStatus.missingTemplateFields.length > 0) {
      warnings.unshift({
        code: "missing_template_fields",
        severity: "warning",
        condition: "Campos de qualificacao ou contrato ainda nao preenchidos.",
        message: `${templateFieldStatus.missingTemplateFields.length} campo(s) precisam ser preenchidos para evitar marcadores no contrato.`,
        recommendation: "Preencha os campos faltantes antes de enviar o contrato para assinatura.",
      });
    }
    if (selection.raisedToMinimum) {
      warnings.unshift({
        code: "clause_limit_minimum",
        severity: "info",
        condition: "Limite de clausulas menor que o minimo recomendado para o contexto.",
        message: `O limite pedido foi ajustado para ${selection.minimumRecommendedCount} clausulas essenciais.`,
        recommendation: "Mantivemos as clausulas minimas para evitar lacunas importantes no contrato.",
      });
    }
    const contractText = buildContractModelText(normalizedContext);

    if (input.replaceExisting !== false) {
      await db.delete(contractClauses).where(eq(contractClauses.contractId, contractId));
    }

    await Promise.all(
      clauses.map((clause, index) =>
        db
          .insert(contractClauses)
          .values({
            contractId,
            clauseId: clause.id as any,
            orderIndex: index,
          })
          .onConflictDoNothing()
      )
    );

    const currentLayout = ((contract as any).layoutConfig ?? {}) as Record<string, unknown>;
    const nextLayout = mergeContractLayoutConfig(currentLayout, {
      contractContext: normalizedContext as unknown as Record<string, unknown>,
    });

    await db
      .update(contracts)
      .set({
        layoutConfig: nextLayout,
        updatedAt: new Date(),
      } as any)
      .where(eq(contracts.id, contractId));

    return {
      context: normalizedContext,
      warnings,
      clauses: clauses.map((item, index) => ({
        id: item.id,
        slug: item.slug,
        title: item.title,
        required: item.required,
        riskLevel: item.riskLevel,
        orderIndex: index,
      })),
      clauseSelection: selection,
      templateFields: templateFieldStatus.templateFields,
      missingTemplateFields: templateFieldStatus.missingTemplateFields,
      contractText,
    };
  }
}

export const contractAutomationService = new ContractAutomationService();
