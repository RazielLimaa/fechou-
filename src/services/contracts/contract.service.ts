import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { clauses, contractClauses, contracts } from '../../db/schema.js';
import { professionService } from './profession.service.js';

interface CreateContractInput {
  userId: number;
  clientName: string;
  profession: string;
  contractType: string;
  executionDate: Date;
  contractValue: string;
  paymentMethod: string;
  serviceScope: string;
}

export class ContractService {
  async createContract(input: CreateContractInput) {
    const [created] = await db
      .insert(contracts)
      .values({
        ...input,
        status: 'draft',
        layoutConfig: {},
        updatedAt: new Date()
      })
      .returning();

    const suggested = await professionService.suggestClausesForProfession(input.profession);

    await Promise.all(
      suggested.map((clause, index) =>
        db.insert(contractClauses).values({
          contractId: created.id,
          clauseId: clause.id,
          orderIndex: index
        })
      )
    );

    return {
      contractId: created.id,
      suggestedClauses: suggested.map((item) => ({ id: item.id, title: item.title }))
    };
  }

  async getContract(contractId: number, userId: number) {
    const [contract] = await db
      .select()
      .from(contracts)
      .where(and(eq(contracts.id, contractId), eq(contracts.userId, userId)));

    if (!contract) return null;

    const associatedClauses = await db
      .select({
        id: contractClauses.id,
        clauseId: contractClauses.clauseId,
        title: clauses.title,
        content: clauses.content,
        customContent: contractClauses.customContent,
        orderIndex: contractClauses.orderIndex
      })
      .from(contractClauses)
      .innerJoin(clauses, eq(clauses.id, contractClauses.clauseId))
      .where(eq(contractClauses.contractId, contractId))
      .orderBy(asc(contractClauses.orderIndex));

    return {
      ...contract,
      clauses: associatedClauses,
      layout: contract.layoutConfig
    };
  }

  async updateContractLayout(contractId: number, userId: number, layoutConfig: Record<string, unknown>) {
    const [updated] = await db
      .update(contracts)
      .set({
        layoutConfig,
        updatedAt: new Date()
      })
      .where(and(eq(contracts.id, contractId), eq(contracts.userId, userId)))
      .returning();

    return updated;
  }
}

export const contractService = new ContractService();
