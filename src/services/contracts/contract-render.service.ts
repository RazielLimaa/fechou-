import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { clauses, contractClauses, contracts, users } from '../../db/schema.js';
import {
  decryptSignature,
  deserializeEncryptedSignature,
} from '../../lib/signatureCrypto.js';
import { templateService } from './template.service.js';

interface RenderedClause {
  title: string;
  content: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(input: string) {
  return String(input ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Valida cor CSS — aceita apenas #RRGGBB ou #RGB para evitar injeção no CSS
function sanitizeColor(color: unknown): string {
  const s = String(color ?? '').trim();
  return /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(s) ? s : '#ff6600';
}

// Valida nome de fonte — aceita apenas valores da whitelist
const SAFE_FONTS: Record<string, string> = {
  inter:    "'Inter', sans-serif",
  georgia:  'Georgia, serif',
  roboto:   "'Roboto', sans-serif",
  playfair: "'Playfair Display', serif",
};

// Valida e sanitiza URL de logo — bloqueia SSRF (file://, data: externo, IPs internos)
function sanitizeLogoUrl(url: unknown): string | null {
  if (!url) return null;
  const s = String(url).trim();

  // Permite apenas data URLs de imagem (já carregadas no banco como base64)
  if (s.startsWith('data:image/')) {
    // Valida que é realmente uma data URL de imagem segura
    if (/^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(s)) {
      return s;
    }
    return null;
  }

  // Bloqueia tudo que não seja data URL — evita SSRF via http/https/file
  // (logos devem ser salvas como base64 no banco, não como URLs externas)
  return null;
}

const fmt = (v: string | number) => {
  const n = typeof v === 'string' ? parseFloat(v.replace(/[^\d.-]/g, '')) : v;
  return isNaN(n)
    ? String(v)
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
};

const fmtDate = (d: string | Date | null | undefined): string => {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
};

const CONTRACT_TYPE_LABELS: Record<string, string> = {
  prestacao_servicos:   'Prestação de Serviços',
  desenvolvimento:      'Desenvolvimento de Software',
  consultoria:          'Consultoria',
  design:               'Design',
  marketing:            'Marketing',
  fotografia:           'Fotografia',
  video:                'Produção de Vídeo',
  redacao:              'Redação / Copywriting',
  traducao:             'Tradução',
  educacao:             'Educação / Mentoria',
};

const PAYMENT_FORM_LABELS: Record<string, string> = {
  pix:                  'PIX',
  transferencia:        'Transferência Bancária',
  boleto:               'Boleto Bancário',
  cartao_credito:       'Cartão de Crédito',
  cartao_debito:        'Cartão de Débito',
  dinheiro:             'Dinheiro',
  cheque:               'Cheque',
};

// ─── pngBuffer → data URL base64 ─────────────────────────────────────────────

function pngBufferToDataUrl(buf: Buffer): string {
  return `data:image/png;base64,${buf.toString('base64')}`;
}

// ─── busca e descriptografa assinatura do contratante ─────────────────────────

async function getClientSignatureDataUrl(
  contractId: number,
  userId: number
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(contracts)
    .where(and(eq(contracts.id, contractId), eq(contracts.userId, userId)));

  if (!row) return null;

  const c = row as any;
  const ciphertext = c.signatureCiphertext ?? null;
  const iv         = c.signatureIv         ?? null;
  const authTag    = c.signatureAuthTag     ?? null;

  if (!ciphertext || !iv || !authTag) return null;

  try {
    const buffers = deserializeEncryptedSignature({
      ciphertextB64: ciphertext,
      ivB64:         iv,
      authTagB64:    authTag,
    });
    const signerName     = c.signerName     ?? c.contractSignerName     ?? '';
    const signerDocument = c.signerDocument ?? c.contractSignerDocument ?? '';
    const pngBuffer = decryptSignature(buffers, {
      proposalId:     contractId,
      signerName,
      signerDocument,
    });
    return pngBufferToDataUrl(pngBuffer);
  } catch {
    return null;
  }
}

// ─── busca e descriptografa assinatura do contratado ──────────────────────────

async function getProviderSignatureDataUrl(
  contractId: number,
  userId: number
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(contracts)
    .where(and(eq(contracts.id, contractId), eq(contracts.userId, userId)));

  if (!row) return null;

  const c = row as any;
  const ciphertext = c.providerContractCiphertext ?? null;
  const iv         = c.providerContractIv         ?? null;
  const authTag    = c.providerContractAuthTag     ?? null;

  if (!ciphertext || !iv || !authTag) return null;

  try {
    const buffers = deserializeEncryptedSignature({
      ciphertextB64: ciphertext,
      ivB64:         iv,
      authTagB64:    authTag,
    });
    const pngBuffer = decryptSignature(buffers, {
      proposalId:     contractId,
      signerName:     `provider:${userId}`,
      signerDocument: `uid-${String(userId).padStart(5, '0')}`,
    });
    return pngBufferToDataUrl(pngBuffer);
  } catch {
    return null;
  }
}

// ─── busca logo do contrato ────────────────────────────────────────────────────

async function getContractLogoUrl(contractId: number, userId: number): Promise<string | null> {
  const [row] = await db
    .select()
    .from(contracts)
    .where(and(eq(contracts.id, contractId), eq(contracts.userId, userId)));
  if (!row) return null;
  return (row as any).logoUrl ?? null;
}

// ─── buildFullHtml — mesmo visual do preview do editor ───────────────────────

function buildFullHtml(opts: {
  contract: any;
  renderedClauses: RenderedClause[];
  layout: any;
  clientSignatureDataUrl: string | null;
  providerSignatureDataUrl: string | null;
  isPro: boolean; // se false, adiciona marca d'água no PDF
}): string {
  const { contract, renderedClauses, layout, clientSignatureDataUrl, providerSignatureDataUrl, isPro } = opts;

  const color   = isPro ? sanitizeColor(layout?.primaryColor) : '#ff6600';
  const logoUrl = isPro ? sanitizeLogoUrl(layout?.logoUrl) : null;
  const font    = isPro ? (SAFE_FONTS[String(layout?.fontFamily ?? 'inter')] ?? SAFE_FONTS.inter) : SAFE_FONTS.inter;

  // Marca d'água para plano free
  // Usa SVG com múltiplas camadas — renderiza corretamente no Puppeteer
  // e é resistente a tentativas de remoção via CSS override
  const watermarkHtml = !isPro ? (() => {
    // Gera posições para cobrir toda a página A4 (800x1122px)
    const texts: string[] = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 4; col++) {
        const x = col * 220 - 30;
        const y = row * 150 - 10;
        // Duas camadas por posição com opacidades ligeiramente diferentes
        // para ser mais difícil de remover com um único selector
        texts.push(
          `<text x="${x}" y="${y}" transform="rotate(-35,${x},${y})" ` +
          `font-family="Arial,sans-serif" font-size="28" font-weight="900" ` +
          `fill="rgba(255,102,0,0.06)" letter-spacing="3">FECHOU!</text>`
        );
        texts.push(
          `<text x="${x+5}" y="${y+5}" transform="rotate(-35,${x+5},${y+5})" ` +
          `font-family="Arial,sans-serif" font-size="22" font-weight="900" ` +
          `fill="rgba(255,102,0,0.04)" letter-spacing="2">fechou.app</text>`
        );
      }
    }
    return `<div style="position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:50;">` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" ` +
      `style="position:absolute;inset:0;width:100%;height:100%;">` +
      texts.join('') +
      `</svg></div>`;
  })() : '';

  const contractNumber = `FECH-${String(contract.id).padStart(6, '0')}`;
  const today = fmtDate(new Date().toISOString());

  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" style="height:36px;object-fit:contain;margin-bottom:6px;" />`
    : `<div style="font-size:28px;font-weight:900;letter-spacing:-0.02em;color:#111;">FECHOU<span style="color:${color}">!</span></div>
       <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.25em;color:#888;margin-top:2px;">Plataforma de Contratos</div>`;

  const showBranding = !isPro || (layout?.showFechouBranding !== false);
  const brandingLine = showBranding
    ? `<div style="font-size:10px;color:#ccc;text-transform:uppercase;letter-spacing:0.2em;">FECHOU! — fechou.app</div>`
    : `<div style="font-size:10px;color:#ccc;letter-spacing:0.1em;">fechou.app</div>`;

  const clausesHtml = renderedClauses.length > 0 ? `
    <div style="margin-bottom:32px;">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.3em;color:${color};font-weight:800;margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid ${color}33;">
        Cláusulas Contratuais
        <span style="margin-left:8px;background:#f0f0f0;color:#888;font-size:9px;font-weight:700;padding:1px 6px;border-radius:10px;">${renderedClauses.length}</span>
      </div>
      ${renderedClauses.map((c, i) => `
        <div style="margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid #f0f0f0;">
          <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px;">
            <span style="background:#111;color:#fff;font-size:9px;font-weight:800;padding:2px 6px;border-radius:3px;flex-shrink:0;">${i + 1}</span>
            <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#111;">${escapeHtml(c.title ?? '')}</span>
          </div>
          <p style="font-size:12px;line-height:1.8;color:#444;text-align:justify;margin:0;padding-left:20px;">
            ${escapeHtml(c.content ?? '').replaceAll('\n', '<br/>')}
          </p>
        </div>`).join('')}
    </div>` : '';

  // Bloco de assinatura do contratado (prestador)
  const providerSigBlock = providerSignatureDataUrl
    ? `<div style="height:64px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:4px;">
         <img src="${providerSignatureDataUrl}" alt="Assinatura do contratado" style="max-height:56px;max-width:100%;object-fit:contain;" />
       </div>
       <div style="border-bottom:1.5px solid #333;margin-bottom:10px;"></div>
       <div style="display:inline-flex;align-items:center;gap:4px;font-size:9px;color:#16a34a;font-weight:700;letter-spacing:0.08em;margin-bottom:6px;">
         <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="6" fill="#16a34a"/><path d="M3.5 6.5l2 2 3-4" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
         Assinado digitalmente
       </div>`
    : `<div style="height:48px;border-bottom:1.5px solid #333;margin-bottom:10px;"></div>`;

  // Bloco de assinatura do contratante
  const clientSigBlock = clientSignatureDataUrl
    ? `<div style="height:64px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:4px;">
         <img src="${clientSignatureDataUrl}" alt="Assinatura do contratante" style="max-height:56px;max-width:100%;object-fit:contain;" />
       </div>
       <div style="border-bottom:1.5px solid #333;margin-bottom:10px;"></div>
       <div style="display:inline-flex;align-items:center;gap:4px;font-size:9px;color:#16a34a;font-weight:700;letter-spacing:0.08em;margin-bottom:6px;">
         <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="6" fill="#16a34a"/><path d="M3.5 6.5l2 2 3-4" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
         Assinado digitalmente
       </div>`
    : `<div style="height:48px;display:flex;align-items:center;justify-content:center;border-bottom:1.5px dashed #d1d5db;margin-bottom:10px;">
         <span style="font-size:9px;color:#d1d5db;letter-spacing:0.18em;text-transform:uppercase;">Aguardando assinatura</span>
       </div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Roboto:wght@400;500;700&family=Playfair+Display:wght@400;700;800&display=swap" rel="stylesheet"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: ${font}; background: #fff; color: #111; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div style="max-width:800px;margin:0 auto;min-height:1122px;position:relative;background:#fff;">
  ${watermarkHtml}
  <div style="position:relative;z-index:20;padding:48px 52px;">

    <!-- Cabeçalho -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px;padding-bottom:24px;border-bottom:2px solid ${color};">
      <div>${logoHtml}</div>
      <div style="text-align:right;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.2em;color:#aaa;">Nº do Contrato</div>
        <div style="font-size:18px;font-weight:800;color:#111;margin-top:2px;">${contractNumber}</div>
        <div style="margin-top:6px;display:inline-block;padding:3px 10px;border-radius:999px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;border:1px solid ${color};color:${color};">
          ${contract.status === 'finalizado' ? 'Finalizado' : contract.status === 'assinado' ? 'Assinado' : 'Em Edição'}
        </div>
      </div>
    </div>

    <!-- Título -->
    <div style="margin-bottom:36px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.3em;color:#aaa;margin-bottom:6px;">Contrato de Serviço</div>
      <div style="font-size:26px;font-weight:800;color:#111;line-height:1.2;">
        ${escapeHtml(CONTRACT_TYPE_LABELS[contract.contractType] ?? contract.contractType ?? 'Prestação de Serviços')}
      </div>
    </div>

    <!-- Grid de informações -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:36px;">
      <div style="padding:14px 16px;background:#f8f8f8;border-radius:10px;border:1px solid #eee;">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.25em;color:#aaa;margin-bottom:4px;">Cliente</div>
        <div style="font-weight:700;font-size:14px;color:${color};">${escapeHtml(contract.clientName)}</div>
      </div>
      <div style="padding:14px 16px;background:#f8f8f8;border-radius:10px;border:1px solid #eee;">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.25em;color:#aaa;margin-bottom:4px;">Valor do Contrato</div>
        <div style="font-weight:700;font-size:14px;color:${color};">${fmt(contract.contractValue)}</div>
      </div>
      <div style="padding:14px 16px;background:#f8f8f8;border-radius:10px;border:1px solid #eee;">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.25em;color:#aaa;margin-bottom:4px;">Data de Execução</div>
        <div style="font-weight:700;font-size:14px;color:#111;">${fmtDate(contract.executionDate)}</div>
      </div>
      <div style="padding:14px 16px;background:#f8f8f8;border-radius:10px;border:1px solid #eee;">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.25em;color:#aaa;margin-bottom:4px;">Pagamento</div>
        <div style="font-weight:700;font-size:14px;color:#111;">${escapeHtml(PAYMENT_FORM_LABELS[contract.paymentMethod] ?? contract.paymentMethod)}</div>
      </div>
    </div>

    <!-- Escopo -->
    <div style="margin-bottom:32px;">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.3em;color:${color};font-weight:800;margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid ${color}33;">Escopo de Trabalho</div>
      <p style="font-size:13px;line-height:1.8;color:#333;text-align:justify;">${escapeHtml(contract.serviceScope ?? '').replaceAll('\n', '<br/>')}</p>
    </div>

    ${clausesHtml}

    <!-- Assinaturas -->
    <div style="margin-top:40px;padding-top:24px;border-top:2px solid #111;">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.3em;color:${color};font-weight:800;text-align:center;margin-bottom:28px;">Assinatura e Aceite</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:48px;">

        <!-- Contratado -->
        <div style="text-align:center;">
          ${providerSigBlock}
          <div style="font-size:12px;font-weight:700;color:#111;">Prestador de Serviços</div>
          <div style="font-size:10px;color:#999;margin-top:2px;">Contratado</div>
        </div>

        <!-- Contratante -->
        <div style="text-align:center;">
          ${clientSigBlock}
          <div style="font-size:12px;font-weight:700;color:#111;">${escapeHtml(contract.clientName)}</div>
          <div style="font-size:10px;color:#999;margin-top:2px;">Contratante</div>
          ${(contract as any).signerDocument
            ? `<div style="font-size:9px;color:#bbb;margin-top:3px;">${escapeHtml((contract as any).signerDocument)}</div>`
            : ''}
        </div>
      </div>
    </div>

    <!-- Rodapé -->
    <div style="margin-top:40px;padding-top:16px;border-top:1px solid #eee;display:flex;justify-content:space-between;align-items:center;">
      ${brandingLine}
      <div style="font-size:10px;color:#ccc;">${contractNumber} · ${today}</div>
    </div>

  </div>
</div>
</body>
</html>`;
}

// ─── ContractRenderService ────────────────────────────────────────────────────

export class ContractRenderService {
  replaceVariables(
    contractData: {
      clientName: string;
      contractValue: string;
      executionDate: Date;
      paymentMethod: string;
      serviceScope: string;
    },
    clauseContent: string
  ) {
    const replacements: Record<string, string> = {
      cliente:         contractData.clientName,
      valor:           contractData.contractValue,
      data_execucao:   contractData.executionDate.toISOString().slice(0, 10),
      forma_pagamento: contractData.paymentMethod,
      escopo:          contractData.serviceScope,
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

    if (!contract) return null;

    const contractClausesRows = await db
      .select({
        title:         clauses.title,
        content:       clauses.content,
        customContent: contractClauses.customContent,
        orderIndex:    contractClauses.orderIndex,
      })
      .from(contractClauses)
      .innerJoin(clauses, eq(clauses.id, contractClauses.clauseId))
      .where(eq(contractClauses.contractId, contract.id))
      .orderBy(asc(contractClauses.orderIndex));

    const renderedClauses: RenderedClause[] = contractClausesRows.map((item) => {
      const source = item.customContent ?? item.content ?? '';
      return {
        title:   item.title ?? '',
        content: this.replaceVariables(
          {
            clientName:    contract.clientName,
            contractValue: String(contract.contractValue),
            executionDate: contract.executionDate,
            paymentMethod: contract.paymentMethod,
            serviceScope:  contract.serviceScope,
          },
          source
        ),
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
          <p>Data de execução: ${fmtDate(contract.executionDate)}</p>
          <p>Valor: ${fmt(contract.contractValue)}</p>
          <p>Forma de pagamento: ${escapeHtml(PAYMENT_FORM_LABELS[contract.paymentMethod] ?? contract.paymentMethod)}</p>
        </header>
        <section id="service_scope">
          <h2>Escopo do serviço</h2>
          <p>${escapeHtml(contract.serviceScope)}</p>
        </section>
        <section id="clauses">
          <h2>Cláusulas</h2>
          ${clausesHtml}
        </section>
      </article>
    `;

    return { html, contract, clauses: renderedClauses };
  }

  async generateContractPDF(contractId: number, userId: number): Promise<Buffer | null> {
    // Busca dados do contrato
    const [contract] = await db
      .select()
      .from(contracts)
      .where(and(eq(contracts.id, contractId), eq(contracts.userId, userId)));

    if (!contract) return null;

    // Busca cláusulas
    const contractClausesRows = await db
      .select({
        title:         clauses.title,
        content:       clauses.content,
        customContent: contractClauses.customContent,
        orderIndex:    contractClauses.orderIndex,
      })
      .from(contractClauses)
      .innerJoin(clauses, eq(clauses.id, contractClauses.clauseId))
      .where(eq(contractClauses.contractId, contract.id))
      .orderBy(asc(contractClauses.orderIndex));

    const renderedClauses: RenderedClause[] = contractClausesRows.map((item) => {
      const source = item.customContent ?? item.content ?? '';
      return {
        title:   item.title ?? '',
        content: this.replaceVariables(
          {
            clientName:    contract.clientName,
            contractValue: String(contract.contractValue),
            executionDate: contract.executionDate,
            paymentMethod: contract.paymentMethod,
            serviceScope:  contract.serviceScope,
          },
          source
        ),
      };
    });

    // Busca plano do usuário para aplicar marca d'água se necessário
    let userPlan = 'free';
    try {
      userPlan = await templateService.checkUserPlan(userId) ?? 'free';
    } catch {
      userPlan = 'free';
    }
    const isPro = userPlan === 'pro' || userPlan === 'premium';

    // Busca assinaturas descriptografadas
    const [clientSignatureDataUrl, providerSignatureDataUrl] = await Promise.all([
      getClientSignatureDataUrl(contractId, userId),
      getProviderSignatureDataUrl(contractId, userId),
    ]);

    // Monta layout completo:
    // - layoutConfig (JSONB) contém primaryColor, fontFamily, showFechouBranding, blocks, customTextBlocks
    // - logoUrl está salvo como coluna separada no banco — precisa ser mesclado
    const rawLayout = (contract as any).layoutConfig ?? {};
    const mergedLayout = {
      ...rawLayout,
      // logoUrl da coluna dedicada tem precedência sobre o que estiver no layoutConfig
      logoUrl: (contract as any).logoUrl ?? rawLayout.logoUrl ?? null,
    };

    // Monta HTML completo (mesmo visual do preview)
    const html = buildFullHtml({
      contract,
      renderedClauses,
      layout: mergedLayout,
      clientSignatureDataUrl,
      providerSignatureDataUrl,
      isPro,
    });

    // ── Gera PDF com Puppeteer ─────────────────────────────────────────────────

    // Remove link de fontes externas — usa fallback Arial para não precisar de rede
    const safeHtml = html.replace(
      /<link[^>]*fonts\.googleapis\.com[^>]*>/g,
      '<style>body{font-family:Arial,Helvetica,sans-serif;}</style>'
    );

    // No Windows em dev, --no-sandbox é necessário para o Chromium funcionar
    const isWindows = process.platform === 'win32';

    const PUPPETEER_ARGS = [
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-default-apps',
      '--no-first-run',
      '--disable-background-networking',
      '--hide-scrollbars',
      '--mute-audio',
      ...(isWindows ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
    ];

    let browser: any = null;
    let pdfResult: Buffer | null = null;

    try {
      const puppeteer = await import('puppeteer');

      browser = await puppeteer.default.launch({
        headless: true,
        args:     PUPPETEER_ARGS,
        timeout:  60_000,
        // Evita crash EBUSY no Windows ao fechar o processo
        handleSIGINT:  false,
        handleSIGTERM: false,
        handleSIGHUP:  false,
      });

      const page = await browser.newPage();

      // Bloqueia apenas HTTP/HTTPS externos — permite data: URLs (assinaturas base64)
      await page.setRequestInterception(true);
      page.on('request', (req: any) => {
        const url: string = req.url() as string;
        const type: string = req.resourceType() as string;
        if (url.startsWith('data:') || type === 'document') {
          req.continue();
        } else {
          req.abort();
        }
      });

      await page.setContent(safeHtml, {
        waitUntil: 'domcontentloaded',
        timeout:   45_000,
      });

      // Aguarda data: URLs (assinaturas) terminarem de renderizar
      await page.evaluate(() =>
        Promise.all(
          Array.from(document.images)
            .filter((img: HTMLImageElement) => !img.complete)
            .map((img: HTMLImageElement) => new Promise(resolve => {
              img.onload = img.onerror = resolve;
            }))
        )
      ).catch(() => {});

      const pdf = await page.pdf({
        format:          'A4',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
        timeout:         45_000,
      });

      pdfResult = Buffer.from(pdf);

    } catch (err) {
      console.error('[generateContractPDF] Erro ao gerar PDF:', (err as Error).message ?? err);
      pdfResult = null;
    } finally {
      if (browser) {
        try {
          const proc = browser.process?.();
          // Tenta fechar normalmente
          await Promise.race([
            browser.close(),
            new Promise(resolve => setTimeout(resolve, 5000)),
          ]).catch(() => {});
          // No Windows: aguarda o processo do Chrome terminar para liberar arquivos temporários
          if (isWindows && proc) {
            await new Promise<void>(resolve => {
              const done = () => resolve();
              proc.once('exit', done);
              setTimeout(done, 3000);
            });
          }
        } catch {
          // Nunca crasha o servidor por causa do fechamento do browser
        }
      }
    }

    return pdfResult;
  }
}

export const contractRenderService = new ContractRenderService();