import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { clauses, contractClauses, contracts } from '../../db/schema.js';

interface RenderedClause {
  title: string;
  content: string;
}

function escapeHtml(input: string) {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export class ContractRenderService {
  replaceVariables(contractData: {
    clientName: string;
    contractValue: string;
    executionDate: Date;
    paymentMethod: string;
    serviceScope: string;
  }, clauseContent: string) {
    const replacements: Record<string, string> = {
      cliente: contractData.clientName,
      valor: contractData.contractValue,
      data_execucao: contractData.executionDate.toISOString().slice(0, 10),
      forma_pagamento: contractData.paymentMethod,
      escopo: contractData.serviceScope
    };

    return clauseContent.replace(/{{\s*([a-z_]+)\s*}}/gi, (_match, variableName: string) => {
      const key = variableName.toLowerCase();
      return replacements[key] ?? `{{${variableName}}}`;
    });
  }

  async renderContract(contractId: number, userId: number) {
    const [contract] = await db
      .select()
      .from(contracts)
      .where(and(eq(contracts.id, contractId), eq(contracts.userId, userId)));
    console.log("contrato encontrado:", contract);
    const result = await db
      .select()
      .from(contracts)
      .where(and(eq(contracts.id, contractId), eq(contracts.userId, userId)));

    console.log("contractId:", contractId, typeof contractId);
    console.log("userId:", userId, typeof userId);
    console.log("result:", result);
    if (!contract) return null;

    const contractClausesRows = await db
      .select({
        title: clauses.title,
        content: clauses.content,
        customContent: contractClauses.customContent,
        orderIndex: contractClauses.orderIndex
      })
      .from(contractClauses)
      .innerJoin(clauses, eq(clauses.id, contractClauses.clauseId))
      .where(eq(contractClauses.contractId, contract.id))
      .orderBy(asc(contractClauses.orderIndex));

    const renderedClauses: RenderedClause[] = contractClausesRows.map((item) => {
      const source = item.customContent ?? item.content;
      return {
        title: item.title,
        content: this.replaceVariables(
          {
            clientName: contract.clientName,
            contractValue: String(contract.contractValue),
            executionDate: contract.executionDate,
            paymentMethod: contract.paymentMethod,
            serviceScope: contract.serviceScope
          },
          source
        )
      };
    });

    const clausesHtml = renderedClauses
      .map(
        (item) => `
          <section class="clause">
            <h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(item.content).replaceAll('\n', '<br/>')}</p>
          </section>
        `
      )
      .join('\n');

    const html = `
      <article class="contract-document">
        <header>
          <h1>Contrato de ${escapeHtml(contract.contractType)}</h1>
          <p>Cliente: ${escapeHtml(contract.clientName)}</p>
          <p>Profissão: ${escapeHtml(contract.profession)}</p>
          <p>Data de execução: ${escapeHtml(contract.executionDate.toISOString().slice(0, 10))}</p>
          <p>Valor: R$ ${escapeHtml(String(contract.contractValue))}</p>
          <p>Forma de pagamento: ${escapeHtml(contract.paymentMethod)}</p>
        </header>
        <section id="contract_info"></section>
        <section id="service_scope">
          <h2>Escopo do serviço</h2>
          <p>${escapeHtml(contract.serviceScope)}</p>
        </section>
        <section id="clauses">
          <h2>Cláusulas</h2>
          ${clausesHtml}
        </section>
        <section id="signatures">
          <p>________________________________________</p>
          <p>Assinatura do contratante</p>
          <p>________________________________________</p>
          <p>Assinatura do contratado</p>
        </section>
      </article>
    `;

    return { html, contract, clauses: renderedClauses };
  }

  async generateContractPDF(contractId: number, userId: number) {
    const rendered = await this.renderContract(contractId, userId);
    if (!rendered) return null;

    const plainText = rendered.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const safeText = plainText.slice(0, 2000).replace(/[()\\]/g, '');

    const pdf = `%PDF-1.1\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font << /F1 5 0 R >> >> >>endobj\n4 0 obj<< /Length ${safeText.length + 80} >>stream\nBT /F1 10 Tf 40 740 Td (${safeText}) Tj ET\nendstream\nendobj\n5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\nxref\n0 6\n0000000000 65535 f \n0000000010 00000 n \n0000000060 00000 n \n0000000117 00000 n \n0000000243 00000 n \n0000000000 00000 n \ntrailer<< /Root 1 0 R /Size 6 >>\nstartxref\n520\n%%EOF`;

    return Buffer.from(pdf, 'utf8');
  }
}

export const contractRenderService = new ContractRenderService();