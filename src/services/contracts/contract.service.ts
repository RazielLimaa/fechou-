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

function mapStatus(s: string): string {
  const map: Record<string, string> = {
    draft:     'rascunho',
    editing:   'rascunho',
    finalized: 'finalizado',
    cancelled: 'cancelado',
    rascunho:  'rascunho',
    finalizado:'finalizado',
    assinado:  'assinado',
    cancelado: 'cancelado',
  };
  return map[s] ?? 'rascunho';
}

function mapStatusToDb(s: string): string {
  const map: Record<string, string> = {
    rascunho:  'draft',
    finalizado:'finalized',
    assinado:  'finalized',
    cancelado: 'cancelled',
  };
  return map[s] ?? 'draft';
}

export class ContractService {
  // ─── listContracts ─────────────────────────────────────────────────────────

  async listContracts(userId: number) {
    const rows = await db
      .select()
      .from(contracts)
      .where(eq(contracts.userId, userId))
      .orderBy(asc(contracts.createdAt));

    return rows.map((c) => ({
      ...c,
      value:       c.contractValue,
      paymentForm: c.paymentMethod,
      scope:       c.serviceScope,
      logoUrl:     (c as any).logoUrl ?? null,
      status:      mapStatus((c as any).status ?? 'draft'),
      lifecycleStatus: (c as any).lifecycleStatus ?? null,
      signedAt:        (c as any).signedAt        ?? null,
      signed:          Boolean((c as any).signedAt),
      shareToken:      (c as any).shareToken      ?? null,
    }));
  }

  // ─── createContract ────────────────────────────────────────────────────────

  async createContract(input: CreateContractInput) {
    const [created] = await db
      .insert(contracts)
      .values({
        ...input,
        status:      'draft',
        layoutConfig: {},
        updatedAt:   new Date(),
      })
      .returning();

    const suggested = await professionService.suggestClausesForProfession(input.profession);

    await Promise.all(
      suggested.map((clause, index) =>
        db.insert(contractClauses).values({
          contractId: created.id,
          clauseId:   clause.id,
          orderIndex: index,
        })
      )
    );

    return {
      contractId:       created.id,
      suggestedClauses: suggested.map((item) => ({ id: item.id, title: item.title })),
    };
  }

  // ─── getContract ───────────────────────────────────────────────────────────

  async getContract(contractId: number, userId: number) {
    const [contract] = await db
      .select()
      .from(contracts)
      .where(and(eq(contracts.id, contractId), eq(contracts.userId, userId)));

    if (!contract) return null;

    const associatedClauses = await db
      .select({
        id:           contractClauses.id,
        clauseId:     contractClauses.clauseId,
        title:        clauses.title,
        content:      clauses.content,
        category:     clauses.category,
        customContent:contractClauses.customContent,
        orderIndex:   contractClauses.orderIndex,
      })
      .from(contractClauses)
      .innerJoin(clauses, eq(clauses.id, contractClauses.clauseId))
      .where(eq(contractClauses.contractId, contractId))
      .orderBy(asc(contractClauses.orderIndex));

    return {
      ...contract,
      logoUrl:         (contract as any).logoUrl         ?? null,
      lifecycleStatus: (contract as any).lifecycleStatus ?? null,
      signedAt:        (contract as any).signedAt        ?? null,
      signed:          Boolean((contract as any).signedAt),
      clauses:         associatedClauses,
      layout:          contract.layoutConfig,
    };
  }

  // ─── getContractByShareTokenHash ───────────────────────────────────────────

  async getContractByShareTokenHash(tokenHash: string) {
    const [contract] = await db
      .select()
      .from(contracts)
      .where(eq((contracts as any).shareTokenHash, tokenHash));

    if (!contract) return null;

    const c = contract as any;

    return {
      id:          contract.id,
      userId:      contract.userId,
      title:       `${c.contractType ?? 'Contrato'} — ${contract.clientName}`,
      clientName:  contract.clientName,
      description: c.serviceScope ?? '',
      value:       c.contractValue ?? '0',
      status:      mapStatus(c.status ?? 'draft'),
      shareTokenExpiresAt: c.shareTokenExpiresAt ? new Date(c.shareTokenExpiresAt) : null,
      pixKey:      null as string | null,
      pixKeyType:  null as string | null,
      contract: {
        signed:     Boolean(c.signedAt),
        signedAt:   c.signedAt   ?? null,
        signerName: c.signerName ?? c.contractSignerName ?? null,
        canPay:     Boolean(c.paymentReleasedAt ?? c.paymentConfirmedAt),
      },
      _source: 'contract' as const,
    };
  }

  // ─── updateContractLayout ──────────────────────────────────────────────────

  async updateContractLayout(
    contractId: number,
    userId: number,
    layoutConfig: Record<string, unknown>
  ) {
    const [updated] = await db
      .update(contracts)
      .set({ layoutConfig, updatedAt: new Date() })
      .where(and(eq(contracts.id, contractId), eq(contracts.userId, userId)))
      .returning();

    return updated;
  }

  // ─── updateContractLogo ────────────────────────────────────────────────────

  async updateContractLogo(
    contractId: number,
    userId: number,
    logoDataUrl: string | null
  ) {
    const [updated] = await db
      .update(contracts)
      .set({ logoUrl: logoDataUrl, updatedAt: new Date() } as any)
      .where(and(eq(contracts.id, contractId), eq(contracts.userId, userId)))
      .returning();

    if (!updated) return null;

    return {
      ...updated,
      logoUrl: (updated as any).logoUrl ?? null,
    };
  }

  // ─── getContractSignature ──────────────────────────────────────────────────
  // CORRIGIDO: o backend salva como signatureCiphertext/signatureIv/signatureAuthTag
  // (strings base64), mas o método antigo procurava pelos nomes com sufixo B64.

  async getContractSignature(contractId: number, userId: number): Promise<{
    proposalId:    number | string;
    signerName:    string;
    signerDocument:string;
    ciphertextB64: string;
    ivB64:         string;
    authTagB64:    string;
  } | null> {
    const [row] = await db
      .select()
      .from(contracts)
      .where(and(eq(contracts.id, contractId), eq(contracts.userId, userId)));

    if (!row) return null;

    const c = row as any;

    // Nomes conforme schema.ts: signatureCiphertext, signatureIv, signatureAuthTag
    const ciphertext = c.signatureCiphertext ?? null;
    const iv         = c.signatureIv         ?? null;
    const authTag    = c.signatureAuthTag     ?? null;

    if (!ciphertext || !iv || !authTag) return null;

    // Normaliza para string base64 — pode vir como Buffer (Postgres bytea) ou string
    const toB64 = (v: any): string =>
      Buffer.isBuffer(v) ? v.toString('base64') : String(v);

    return {
      proposalId:     c.proposalId     ?? c.proposal_id     ?? contractId,
      signerName:     c.signerName     ?? c.contractSignerName ?? c.signer_name     ?? '',
      signerDocument: c.signerDocument ?? c.contractSignerDocument ?? c.signer_document ?? '',
      ciphertextB64:  toB64(ciphertext),
      ivB64:          toB64(iv),
      authTagB64:     toB64(authTag),
    };
  }

  // ─── setContractShareToken ─────────────────────────────────────────────────

  async setContractShareToken(
    contractId: number,
    userId: number,
    tokenHash: string,
    expiresAt: Date
  ) {
    await db
      .update(contracts)
      .set({
        shareTokenHash:      tokenHash,
        shareTokenExpiresAt: expiresAt,
        updatedAt:           new Date(),
      } as any)
      .where(and(eq(contracts.id, contractId), eq(contracts.userId, userId)));
  }

  // ─── markContractPaid ──────────────────────────────────────────────────────

  async markContractPaid(
    contractId: number,
    userId: number,
    data?: { note?: string; payerName?: string; payerDocument?: string }
  ) {
    const [updated] = await db
      .update(contracts)
      .set({
        lifecycleStatus:    'PAID',
        status:             'finalized',
        paymentConfirmedAt: new Date(),
        payerName:          data?.payerName    ?? null,
        payerDocument:      data?.payerDocument ?? null,
        paymentNote:        data?.note          ?? null,
        updatedAt:          new Date(),
      } as any)
      .where(and(eq(contracts.id, contractId), eq(contracts.userId, userId)))
      .returning();

    if (!updated) return null;
    return updated;
  }

  // ─── cancelContract ────────────────────────────────────────────────────────

  async cancelContract(contractId: number, userId: number) {
    const [updated] = await db
      .update(contracts)
      .set({
        lifecycleStatus: 'CANCELLED',
        status:          'cancelled',
        updatedAt:       new Date(),
      } as any)
      .where(and(eq(contracts.id, contractId), eq(contracts.userId, userId)))
      .returning();

    if (!updated) return null;
    return updated;
  }
}

export const contractService = new ContractService();