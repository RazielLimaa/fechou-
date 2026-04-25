import crypto from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { clauses, contractClauses, contracts } from '../../db/schema.js';
import {
  decryptSignature,
  deserializeEncryptedSignature,
} from '../../lib/signatureCrypto.js';
import {
  createAuthenticatedContractSignaturePreviewAsset,
  setAuthenticatedContractSignaturePreviewAssetCache,
} from '../../lib/signaturePreview.js';
import { buildTemplateVariables } from './legal-blueprint.js';
import { buildDefaultContractLayout, isPlainRecord, mergeContractLayoutConfig, toStringArray } from './contract-layout.js';
import { templateService } from './template.service.js';

interface RenderedClause {
  clauseId: string;
  title: string;
  content: string;
}

type ContractRenderMode = 'preview' | 'pdf';
type ContractPreviewAccessMode = 'private' | 'public';
type RenderContractOptions = {
  publicPreview?: boolean;
};
type CachedPreviewAsset = {
  previewToken: string;
  previewUrl: string;
  verificationCode: string;
  pngBuffer: Buffer | null;
};
type CachedPreviewBundle = {
  contractId: number;
  userId: number;
  versionKey: string;
  stateHash: string;
  expiresAt: number;
  html: string;
  previewIssuedAtIso: string;
  previewProtectionCode: string;
  clientAsset: CachedPreviewAsset | null;
  providerAsset: CachedPreviewAsset | null;
  renderedClauses: RenderedClause[];
};
type CachedPdfBundle = {
  contractId: number;
  userId: number;
  versionKey: string;
  stateHash: string;
  expiresAt: number;
  pdfBuffer: Buffer;
  userPlan: string;
  createdAt: number;
};

const PREVIEW_RENDER_CACHE_MAX_ITEMS = Number(process.env.CONTRACT_PREVIEW_RENDER_CACHE_MAX_ITEMS ?? 120);
const PREVIEW_RENDER_CACHE_TTL_MS = Number(process.env.CONTRACT_PREVIEW_RENDER_CACHE_TTL_MS ?? 15 * 60 * 1000);
const PDF_RENDER_CACHE_MAX_ITEMS = Number(process.env.CONTRACT_PDF_CACHE_MAX_ITEMS ?? 24);
const PDF_RENDER_CACHE_TTL_MS = Number(process.env.CONTRACT_PDF_CACHE_TTL_MS ?? 90_000);
const PDF_BROWSER_IDLE_TTL_MS = Number(process.env.CONTRACT_PDF_BROWSER_IDLE_TTL_MS ?? 45_000);
const previewRenderCache = new Map<string, CachedPreviewBundle>();
const pdfRenderCache = new Map<string, CachedPdfBundle>();

let sharedPdfBrowser: any = null;
let sharedPdfBrowserPromise: Promise<any> | null = null;
let sharedPdfBrowserIdleTimer: NodeJS.Timeout | null = null;

type ContractRenderVersion = {
  contractId: number;
  userId: number;
  updatedAtIso: string;
  userPlan: string;
};

function escapeHtml(input: string) {
  return String(input ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sanitizeColor(color: unknown): string {
  const s = String(color ?? '').trim();
  return /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(s) ? s : '#ff6600';
}

const SAFE_FONTS: Record<string, string> = {
  inter: "'Inter', system-ui, sans-serif",
  georgia: 'Georgia, serif',
  roboto: "'Roboto', system-ui, sans-serif",
  playfair: "'Playfair Display', Georgia, serif",
};

function sanitizeRangeNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function toMultilineHtml(input: unknown) {
  return escapeHtml(String(input ?? '')).replaceAll('\n', '<br/>');
}

function sanitizeLogoUrl(url: unknown): string | null {
  if (!url) return null;
  const s = String(url).trim();

  if (s.startsWith('data:image/')) {
    if (/^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(s)) {
      return s;
    }
    return null;
  }

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
  prestacao_servicos: 'Prestação de Serviços',
  desenvolvimento: 'Desenvolvimento de Software',
  consultoria: 'Consultoria',
  design: 'Design',
  marketing: 'Marketing',
  fotografia: 'Fotografia',
  video: 'Produção de Vídeo',
  redacao: 'Redação / Copywriting',
  traducao: 'Tradução',
  educacao: 'Educação / Mentoria',
};

const PAYMENT_FORM_LABELS: Record<string, string> = {
  pix: 'PIX',
  transferencia: 'Transferência Bancária',
  boleto: 'Boleto Bancário',
  cartao_credito: 'Cartão de Crédito',
  cartao_debito: 'Cartão de Débito',
  dinheiro: 'Dinheiro',
  cheque: 'Cheque',
};

function pngBufferToDataUrl(buf: Buffer): string {
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function hashJson(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function buildPreviewRenderCacheKey(contractId: number, userId: number, accessMode: ContractPreviewAccessMode) {
  return `${contractId}:${userId}:${accessMode}`;
}

function cleanupPreviewRenderCache(nowMs = Date.now()) {
  for (const [key, entry] of previewRenderCache.entries()) {
    if (entry.expiresAt <= nowMs) {
      previewRenderCache.delete(key);
    }
  }

  if (previewRenderCache.size <= PREVIEW_RENDER_CACHE_MAX_ITEMS) return;

  const ordered = Array.from(previewRenderCache.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const overflow = previewRenderCache.size - PREVIEW_RENDER_CACHE_MAX_ITEMS;
  for (let i = 0; i < overflow; i += 1) {
    const victim = ordered[i];
    if (victim) previewRenderCache.delete(victim[0]);
  }
}

function buildPdfRenderCacheKey(contractId: number, userId: number) {
  return `${contractId}:${userId}`;
}

function cleanupPdfRenderCache(nowMs = Date.now()) {
  for (const [key, entry] of pdfRenderCache.entries()) {
    if (entry.expiresAt <= nowMs) {
      pdfRenderCache.delete(key);
    }
  }

  if (pdfRenderCache.size <= PDF_RENDER_CACHE_MAX_ITEMS) return;

  const ordered = Array.from(pdfRenderCache.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt);
  const overflow = pdfRenderCache.size - PDF_RENDER_CACHE_MAX_ITEMS;
  for (let i = 0; i < overflow; i += 1) {
    const victim = ordered[i];
    if (victim) pdfRenderCache.delete(victim[0]);
  }
}

function resetSharedPdfBrowserState() {
  sharedPdfBrowser = null;
  sharedPdfBrowserPromise = null;
  if (sharedPdfBrowserIdleTimer) {
    clearTimeout(sharedPdfBrowserIdleTimer);
    sharedPdfBrowserIdleTimer = null;
  }
}

function scheduleSharedPdfBrowserClose() {
  if (sharedPdfBrowserIdleTimer) {
    clearTimeout(sharedPdfBrowserIdleTimer);
  }

  sharedPdfBrowserIdleTimer = setTimeout(() => {
    const browser = sharedPdfBrowser;
    resetSharedPdfBrowserState();
    if (!browser) return;

    void Promise.resolve(browser.close()).catch(() => {});
  }, Math.max(10_000, PDF_BROWSER_IDLE_TTL_MS));

  sharedPdfBrowserIdleTimer.unref?.();
}

async function launchSharedPdfBrowser() {
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

  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({
    headless: true,
    args: PUPPETEER_ARGS,
    timeout: 60_000,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });

  browser.once?.('disconnected', () => {
    if (sharedPdfBrowser === browser) {
      resetSharedPdfBrowserState();
    }
  });

  return browser;
}

async function getSharedPdfBrowser() {
  if (sharedPdfBrowser) {
    if (sharedPdfBrowserIdleTimer) {
      clearTimeout(sharedPdfBrowserIdleTimer);
      sharedPdfBrowserIdleTimer = null;
    }
    return sharedPdfBrowser;
  }

  if (!sharedPdfBrowserPromise) {
    sharedPdfBrowserPromise = launchSharedPdfBrowser()
      .then((browser) => {
        sharedPdfBrowser = browser;
        return browser;
      })
      .catch((err) => {
        resetSharedPdfBrowserState();
        throw err;
      });
  }

  return sharedPdfBrowserPromise;
}

async function withIsolatedPdfPage<T>(task: (page: any) => Promise<T>) {
  const browser = await getSharedPdfBrowser();
  const context = browser.createBrowserContext
    ? await browser.createBrowserContext()
    : null;
  const page = context ? await context.newPage() : await browser.newPage();

  try {
    return await task(page);
  } finally {
    try {
      if (context) {
        await context.close();
      } else {
        await page.close();
      }
    } catch {
      // Ignora erro de cleanup do contexto/página
    }

    scheduleSharedPdfBrowserClose();
  }
}

function restoreCachedPreviewImageAsset(
  asset: CachedPreviewAsset | null,
  contractId: number,
  userId: number,
  kind: 'client' | 'provider',
  expiresAt: number
) {
  if (!asset?.pngBuffer) return;

  setAuthenticatedContractSignaturePreviewAssetCache({
    token: asset.previewToken,
    contractId,
    userId,
    kind,
    expiresAt,
    pngBuffer: asset.pngBuffer,
  });
}

function getClientSignaturePngBufferFromContract(
  contract: any,
  contractId: number
): Buffer | null {
  const ciphertext = contract.signatureCiphertext ?? null;
  const iv = contract.signatureIv ?? null;
  const authTag = contract.signatureAuthTag ?? null;

  if (!ciphertext || !iv || !authTag) return null;

  try {
    const buffers = deserializeEncryptedSignature({
      ciphertextB64: ciphertext,
      ivB64: iv,
      authTagB64: authTag,
    });
    const signerName = contract.signerName ?? contract.contractSignerName ?? '';
    const signerDocument = contract.signerDocument ?? contract.contractSignerDocument ?? '';
    return decryptSignature(buffers, {
      proposalId: contractId,
      signerName,
      signerDocument,
    });
  } catch {
    return null;
  }
}

function getProviderSignaturePngBufferFromContract(
  contract: any,
  contractId: number,
  userId: number
): Buffer | null {
  const ciphertext = contract.providerContractCiphertext ?? null;
  const iv = contract.providerContractIv ?? null;
  const authTag = contract.providerContractAuthTag ?? null;

  if (!ciphertext || !iv || !authTag) return null;

  try {
    const buffers = deserializeEncryptedSignature({
      ciphertextB64: ciphertext,
      ivB64: iv,
      authTagB64: authTag,
    });
    return decryptSignature(buffers, {
      proposalId: contractId,
      signerName: `provider:${userId}`,
      signerDocument: `uid-${String(userId).padStart(5, '0')}`,
    });
  } catch {
    return null;
  }
}

function getStringValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== 'string') return '';
  return value.trim();
}

function getBooleanValue(record: Record<string, unknown>, key: string, fallback = false) {
  const value = record[key];
  if (typeof value === 'boolean') return value;
  return fallback;
}

function getStringArrayValue(record: Record<string, unknown>, key: string) {
  return toStringArray(record[key]);
}

function inferContractValueBand(contractValue: unknown) {
  const numeric = Number(String(contractValue ?? '').replace(/[^\d.,-]/g, '').replace('.', '').replace(',', '.'));
  if (!Number.isFinite(numeric)) return 'medio' as const;
  if (numeric >= 50000) return 'alto' as const;
  if (numeric <= 5000) return 'baixo' as const;
  return 'medio' as const;
}

function inferContractModels(contract: any, layoutContext: Record<string, unknown>) {
  const provided = getStringArrayValue(layoutContext, 'contractModels')
    .filter((item) => item === 'saas' || item === 'projeto' || item === 'servico_continuado') as Array<'saas' | 'projeto' | 'servico_continuado'>;
  if (provided.length > 0) return provided;

  const joined = `${contract.contractType ?? ''} ${contract.profession ?? ''} ${contract.serviceScope ?? ''}`.toLowerCase();
  const inferred = new Set<'saas' | 'projeto' | 'servico_continuado'>();
  if (/(saas|software|plataforma|licenca|assinatura|recorr)/.test(joined)) inferred.add('saas');
  if (/(projeto|implantacao|entrega|escopo|cronograma|marco)/.test(joined)) inferred.add('projeto');
  if (/(mensal|continuado|recorrente|suporte|retainer)/.test(joined)) inferred.add('servico_continuado');
  if (inferred.size === 0) inferred.add('projeto');
  return Array.from(inferred);
}

function buildContractTemplateVariables(contract: any, layout: any) {
  const layoutContext = isPlainRecord(layout?.contractContext) ? layout.contractContext : {};
  const customVariablesRaw = isPlainRecord(layout?.customVariables) ? layout.customVariables : {};
  const customVariables = Object.fromEntries(
    Object.entries(customVariablesRaw).map(([key, value]) => [key, String(value ?? '').trim()])
  );
  const paymentLabel = PAYMENT_FORM_LABELS[contract.paymentMethod] ?? String(contract.paymentMethod ?? '').trim();
  const formattedValue = fmt(contract.contractValue);
  const executionDateLabel = fmtDate(contract.executionDate);
  const executionDateIso = contract.executionDate instanceof Date
    ? contract.executionDate.toISOString().slice(0, 10)
    : String(contract.executionDate ?? '').slice(0, 10);

  const blueprintVariables = buildTemplateVariables({
    audience: getStringValue(layoutContext, 'audience') === 'b2c' ? 'b2c' : 'b2b',
    contractModels: inferContractModels(contract, layoutContext),
    riskLevel: getStringValue(layoutContext, 'riskLevel') === 'alto'
      ? 'alto'
      : getStringValue(layoutContext, 'riskLevel') === 'baixo'
        ? 'baixo'
        : 'medio',
    personalData: getBooleanValue(layoutContext, 'personalData', true),
    sensitiveData: getBooleanValue(layoutContext, 'sensitiveData', false),
    sourceCodeDelivery: getBooleanValue(
      layoutContext,
      'sourceCodeDelivery',
      /(codigo|fonte|software|sistema|app)/i.test(String(contract.contractType ?? ''))
    ),
    ipMode: getStringValue(layoutContext, 'ipMode') === 'cessao'
      ? 'cessao'
      : getStringValue(layoutContext, 'ipMode') === 'titularidade_prestador'
        ? 'titularidade_prestador'
        : 'licenca',
    supportLevel: getStringValue(layoutContext, 'supportLevel') === 'estendido'
      ? 'estendido'
      : getStringValue(layoutContext, 'supportLevel') === 'none'
        ? 'none'
        : 'horario_comercial',
    subscription: getBooleanValue(
      layoutContext,
      'subscription',
      /(mensal|assinatura|recorr)/i.test(`${contract.contractType ?? ''} ${contract.serviceScope ?? ''}`)
    ),
    milestoneBilling: getBooleanValue(layoutContext, 'milestoneBilling', false),
    includeArbitration: getBooleanValue(layoutContext, 'includeArbitration', false),
    includeEscrow: getBooleanValue(layoutContext, 'includeEscrow', false),
    includePortfolioUse: getBooleanValue(layoutContext, 'includePortfolioUse', false),
    includeChargebackRule: getBooleanValue(layoutContext, 'includeChargebackRule', false),
    includeHandOver: getBooleanValue(layoutContext, 'includeHandOver', true),
    authenticationMethods: getStringArrayValue(layoutContext, 'authenticationMethods').length > 0
      ? getStringArrayValue(layoutContext, 'authenticationMethods')
      : ['email', 'otp_whatsapp'],
    valueBand: inferContractValueBand(contract.contractValue),
    clientName: getStringValue(layoutContext, 'clientName') || String(contract.clientName ?? ''),
    clientDocument:
      getStringValue(layoutContext, 'clientDocument') ||
      getStringValue(layoutContext, 'contratanteDocumento') ||
      customVariables.contratanteDocumento ||
      customVariables.clientDocument ||
      '',
    clientAddress:
      getStringValue(layoutContext, 'clientAddress') ||
      getStringValue(layoutContext, 'contratanteEndereco') ||
      customVariables.contratanteEndereco ||
      customVariables.clientAddress ||
      '',
    providerName: getStringValue(layoutContext, 'providerName') || 'Fechou Tecnologia Ltda.',
    providerDocument:
      getStringValue(layoutContext, 'providerDocument') ||
      getStringValue(layoutContext, 'contratadaDocumento') ||
      customVariables.contratadaDocumento ||
      customVariables.providerDocument ||
      '',
    providerAddress:
      getStringValue(layoutContext, 'providerAddress') ||
      getStringValue(layoutContext, 'contratadaEndereco') ||
      customVariables.contratadaEndereco ||
      customVariables.providerAddress ||
      '',
    objectSummary: getStringValue(layoutContext, 'objectSummary') || String(contract.contractType ?? 'servicos contratados'),
    serviceScope: getStringValue(layoutContext, 'serviceScope') || String(contract.serviceScope ?? ''),
    deliverablesSummary: getStringValue(layoutContext, 'deliverablesSummary') || String(contract.serviceScope ?? ''),
    paymentTerms: getStringValue(layoutContext, 'paymentTerms') || `pagamento via ${paymentLabel || 'condicao contratual definida'}`,
    contractValue: getStringValue(layoutContext, 'contractValue') || formattedValue,
    durationLabel: getStringValue(layoutContext, 'durationLabel') || 'conforme vigencia definida pelas partes',
    executionDateLabel: getStringValue(layoutContext, 'executionDateLabel') || executionDateLabel,
    forumCityUf: getStringValue(layoutContext, 'forumCityUf'),
    forumConnection: getStringValue(layoutContext, 'forumConnection'),
    supportSummary: getStringValue(layoutContext, 'supportSummary'),
    subprocessorSummary: getStringValue(layoutContext, 'subprocessorSummary'),
    securitySummary: getStringValue(layoutContext, 'securitySummary'),
  });

  const replacements: Record<string, string> = {
    ...blueprintVariables,
    ...customVariables,
    cliente: String(contract.clientName ?? ''),
    valor: formattedValue,
    data_execucao: executionDateIso,
    dataExecucao: executionDateLabel,
    forma_pagamento: paymentLabel,
    metodoPagamento: paymentLabel,
    escopo: String(contract.serviceScope ?? ''),
    tipoContrato: String(contract.contractType ?? ''),
    profissao: String(contract.profession ?? ''),
    subcontratacaoRegra:
      customVariables.subcontratacaoRegra ||
      getStringValue(layoutContext, 'subcontratacaoRegra') ||
      'somente para atividades acessorias ou especializadas, com supervisao da contratada e sem transferencia integral da obrigacao principal',
    regraAuditoria:
      customVariables.regraAuditoria ||
      getStringValue(layoutContext, 'regraAuditoria') ||
      'aviso previo razoavel, delimitacao objetiva de escopo, preservacao de sigilo e realizacao em janela operacional adequada',
  };

  return Object.fromEntries(
    Object.entries(replacements).map(([key, value]) => [key.toLowerCase(), String(value ?? '').trim()])
  );
}

function resolveFallbackTemplateValue(variableName: string, replacements: Record<string, string>) {
  const key = variableName.toLowerCase();

  if (replacements[key]) return replacements[key];
  if (key.includes('cliente') || key.includes('contratante')) return replacements.contratantenome || replacements.cliente || 'contratante';
  if (key.includes('contratada') || key.includes('prestador')) return replacements.contratadanome || 'contratada';
  if (key.includes('responsab')) return replacements.limiteresponsabilidade || 'o valor efetivamente pago pelo contrato';
  if (key.includes('pag')) return replacements.condicoespagamento || replacements.forma_pagamento || 'conforme condicoes definidas neste contrato';
  if (key.includes('valor')) return replacements.valorcontrato || replacements.valor || 'R$ [preencher]';
  if (key.includes('escopo') || key.includes('objeto')) return replacements.escoporesumo || replacements.escopo || replacements.objetocontrato || 'escopo definido entre as partes';
  if (key.includes('foro')) return replacements.forocidadeuf || 'foro competente';
  if (key.includes('prazo')) return replacements.durationlabel || 'prazo definido pelas partes';
  if (key.includes('dado') || key.includes('lgpd')) return replacements.finalidadedados || 'tratamento vinculado a execucao deste contrato';
  return `[${variableName}]`;
}

function replaceContractVariables(contract: any, layout: any, clauseContent: string) {
  const replacements = buildContractTemplateVariables(contract, layout);

  return clauseContent.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, variableName: string) => {
    const key = variableName.toLowerCase();
    return replacements[key] || resolveFallbackTemplateValue(variableName, replacements);
  });
}

async function loadContractRenderModel(contractId: number, userId: number) {
  const [contractRows, contractClausesRows, userPlanResult] = await Promise.all([
    db
      .select()
      .from(contracts)
      .where(and(eq(contracts.id, contractId), eq(contracts.userId, userId)))
      .limit(1),
    db
      .select({
        clauseId: contractClauses.clauseId,
        title: clauses.title,
        content: clauses.content,
        customContent: contractClauses.customContent,
        orderIndex: contractClauses.orderIndex,
      })
      .from(contractClauses)
      .innerJoin(clauses, eq(clauses.id, contractClauses.clauseId))
      .innerJoin(contracts, eq(contracts.id, contractClauses.contractId))
      .where(and(eq(contractClauses.contractId, contractId), eq(contracts.userId, userId)))
      .orderBy(asc(contractClauses.orderIndex)),
    templateService.checkUserPlan(userId).catch(() => 'free'),
  ]);

  const contract = contractRows[0];
  if (!contract) return null;

  const userPlan = userPlanResult ?? 'free';
  const isPro = userPlan === 'pro' || userPlan === 'premium';
  const rawLayout = ((contract as any).layoutConfig ?? {}) as Record<string, unknown>;
  const mergedLayout = mergeContractLayoutConfig(
    buildDefaultContractLayout({
      clientName: contract.clientName,
      contractType: contract.contractType,
      contractValue: String(contract.contractValue),
      paymentMethod: contract.paymentMethod,
      serviceScope: contract.serviceScope,
    }),
    rawLayout
  );
  mergedLayout.logoUrl = (contract as any).logoUrl ?? (mergedLayout.logoUrl as string | null) ?? null;

  const previewConfig = isPlainRecord(mergedLayout.preview) ? mergedLayout.preview : {};
  const includeClauseIds = new Set(toStringArray(previewConfig.includeClauseIds));
  const hiddenClauseIds = new Set(toStringArray(previewConfig.hiddenClauseIds));

  const renderedClauses: RenderedClause[] = contractClausesRows
    .filter((item) => {
      const clauseId = String((item as any).clauseId ?? '');
      if (hiddenClauseIds.has(clauseId)) return false;
      if (includeClauseIds.size > 0) return includeClauseIds.has(clauseId);
      return true;
    })
    .map((item) => {
      const source = item.customContent ?? item.content ?? '';
      return {
        clauseId: String((item as any).clauseId ?? ''),
        title: item.title ?? '',
        content: replaceContractVariables(contract, mergedLayout, source),
      };
    });

  return {
    contract,
    renderedClauses,
    userPlan,
    isPro,
    mergedLayout,
  };
}

async function loadContractRenderVersion(contractId: number, userId: number): Promise<ContractRenderVersion | null> {
  const [contractRows, userPlanResult] = await Promise.all([
    db
      .select({
        id: contracts.id,
        userId: contracts.userId,
        updatedAt: contracts.updatedAt,
      })
      .from(contracts)
      .where(and(eq(contracts.id, contractId), eq(contracts.userId, userId)))
      .limit(1),
    templateService.checkUserPlan(userId).catch(() => 'free'),
  ]);

  const contract = contractRows[0];
  if (!contract) return null;

  return {
    contractId,
    userId,
    updatedAtIso: contract.updatedAt instanceof Date
      ? contract.updatedAt.toISOString()
      : String(contract.updatedAt ?? ''),
    userPlan: userPlanResult ?? 'free',
  };
}

function buildContractRenderVersionKey(version: ContractRenderVersion) {
  return hashJson({
    contractId: version.contractId,
    userId: version.userId,
    updatedAtIso: version.updatedAtIso,
    userPlan: version.userPlan,
  });
}

function buildPreviewStateHash(model: Awaited<ReturnType<typeof loadContractRenderModel>>, contractId: number, userId: number) {
  const contract = (model?.contract ?? {}) as any;

  return hashJson({
    contractId,
    userId,
    userPlan: model?.userPlan ?? 'free',
    isPro: model?.isPro ?? false,
    contract: {
      id: contract.id ?? contractId,
      updatedAt: contract.updatedAt instanceof Date ? contract.updatedAt.toISOString() : String(contract.updatedAt ?? ''),
      clientName: contract.clientName ?? '',
      contractType: contract.contractType ?? '',
      contractValue: String(contract.contractValue ?? ''),
      executionDate: contract.executionDate instanceof Date ? contract.executionDate.toISOString() : String(contract.executionDate ?? ''),
      paymentMethod: contract.paymentMethod ?? '',
      serviceScope: contract.serviceScope ?? '',
      status: contract.status ?? '',
      lifecycleStatus: contract.lifecycleStatus ?? '',
      signedAt: contract.signedAt instanceof Date ? contract.signedAt.toISOString() : String(contract.signedAt ?? ''),
      signerName: contract.signerName ?? '',
      signerDocument: contract.signerDocument ?? '',
      providerSignedAt: contract.providerSignedAt instanceof Date ? contract.providerSignedAt.toISOString() : String(contract.providerSignedAt ?? ''),
      signatureCiphertext: contract.signatureCiphertext ?? '',
      signatureIv: contract.signatureIv ?? '',
      signatureAuthTag: contract.signatureAuthTag ?? '',
      providerContractCiphertext: contract.providerContractCiphertext ?? '',
      providerContractIv: contract.providerContractIv ?? '',
      providerContractAuthTag: contract.providerContractAuthTag ?? '',
    },
    layout: model?.mergedLayout ?? {},
    clauses: model?.renderedClauses ?? [],
  });
}

function resolveLayoutBlock(layout: any, key: string, defaults: Record<string, unknown>) {
  const blocks = isPlainRecord(layout?.blocks) ? layout.blocks : {};
  const raw = isPlainRecord(blocks[key]) ? blocks[key] : {};
  return {
    ...defaults,
    ...raw,
  };
}

function resolveLayoutBlockOrder(layout: any) {
  const allowed = new Set(['hero', 'intro', 'summary', 'scope', 'clauses', 'signatures', 'footer']);
  const requested = toStringArray(layout?.blockOrder).filter((item) => allowed.has(item));
  const fallback = ['hero', 'intro', 'summary', 'scope', 'clauses', 'signatures', 'footer'];
  return Array.from(new Set(requested.length > 0 ? requested : fallback));
}

function buildFullHtml(opts: {
  contract: any;
  renderedClauses: RenderedClause[];
  layout: any;
  clientSignatureSrc: string | null;
  providerSignatureSrc: string | null;
  isPro: boolean;
  renderMode: ContractRenderMode;
  previewProtectionCode?: string | null;
  previewIssuedAtIso?: string | null;
  clientSignatureVerificationCode?: string | null;
  providerSignatureVerificationCode?: string | null;
}): string {
  const {
    contract,
    renderedClauses,
    layout,
    clientSignatureSrc,
    providerSignatureSrc,
    isPro,
    renderMode,
    previewProtectionCode,
    previewIssuedAtIso,
    clientSignatureVerificationCode,
    providerSignatureVerificationCode,
  } = opts;

  const appearance = isPlainRecord(layout?.appearance) ? layout.appearance : layout;
  const color = isPro ? sanitizeColor(appearance?.primaryColor) : '#ff6600';
  const accentColor = isPro ? sanitizeColor(appearance?.secondaryColor ?? '#111111') : '#111111';
  const paperTint = isPro ? sanitizeColor(appearance?.paperTint ?? '#fffaf5') : '#ffffff';
  const logoUrl = isPro ? sanitizeLogoUrl(layout?.logoUrl ?? appearance?.logoUrl) : null;
  const font = isPro ? (SAFE_FONTS[String(appearance?.fontFamily ?? 'inter')] ?? SAFE_FONTS.inter) : SAFE_FONTS.inter;
  const fontScale = isPro ? sanitizeRangeNumber(appearance?.fontScale, 0.9, 1.2, 1) : 1;
  const contentWidth = isPro ? sanitizeRangeNumber(appearance?.contentWidth, 720, 980, 800) : 800;
  const borderRadius = isPro ? sanitizeRangeNumber(appearance?.borderRadius, 8, 26, 14) : 10;
  const sectionSpacing = isPro ? sanitizeRangeNumber(appearance?.sectionSpacing, 20, 56, 32) : 32;
  const showSummaryCards = appearance?.showSummaryCards !== false;
  const showContractNumber = appearance?.showContractNumber !== false;
  const previewProtected = renderMode === 'preview';

  const watermarkHtml = !isPro ? (() => {
    const watermarkSvg = encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="300" viewBox="0 0 440 300">` +
      `<g transform="rotate(-35 100 80)">` +
      `<text x="15" y="90" font-family="Arial,sans-serif" font-size="28" font-weight="900" fill="rgba(255,102,0,0.06)" letter-spacing="3">FECHOU!</text>` +
      `<text x="20" y="120" font-family="Arial,sans-serif" font-size="22" font-weight="900" fill="rgba(255,102,0,0.04)" letter-spacing="2">fechou.app</text>` +
      `</g>` +
      `<g transform="rotate(-35 310 215)">` +
      `<text x="235" y="225" font-family="Arial,sans-serif" font-size="28" font-weight="900" fill="rgba(255,102,0,0.06)" letter-spacing="3">FECHOU!</text>` +
      `<text x="240" y="255" font-family="Arial,sans-serif" font-size="22" font-weight="900" fill="rgba(255,102,0,0.04)" letter-spacing="2">fechou.app</text>` +
      `</g>` +
      `</svg>`
    );
    const backgroundUrl = `url("data:image/svg+xml;utf8,${watermarkSvg}")`;

    return [
      `<div class="contract-watermark-layer contract-watermark-screen" style="background-image:${backgroundUrl};"></div>`,
      `<div class="contract-watermark-layer contract-watermark-print" style="background-image:${backgroundUrl};"></div>`,
    ].join('');
  })() : '';

  const contractNumber = `FECH-${String(contract.id).padStart(6, '0')}`;
  const today = fmtDate(new Date().toISOString());
  const previewStamp = escapeHtml(
    previewProtectionCode
      ?? crypto.createHash('sha256').update(`${contract.id}:${contract.clientName ?? ''}`).digest('hex').slice(0, 12).toUpperCase()
  );
  const previewIssuedAtLabel = previewIssuedAtIso ? fmtDate(previewIssuedAtIso) : today;

  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" style="height:36px;object-fit:contain;margin-bottom:6px;" />`
    : `<div style="font-size:28px;font-weight:900;letter-spacing:-0.02em;color:#111;">FECHOU<span style="color:${color}">!</span></div>
       <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.25em;color:#888;margin-top:2px;">Plataforma de Contratos</div>`;

  const showBranding = !isPro || (appearance?.showFechouBranding !== false);
  const brandingLine = showBranding
    ? `<div style="font-size:10px;color:#ccc;text-transform:uppercase;letter-spacing:0.2em;">FECHOU! — fechou.app</div>`
    : `<div style="font-size:10px;color:#ccc;letter-spacing:0.1em;">fechou.app</div>`;

  const legacyClausesHtml = renderedClauses.length > 0 ? `
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

  const heroBlock = resolveLayoutBlock(layout, 'hero', {
    visible: true,
    label: 'Contrato de Servico',
    title: CONTRACT_TYPE_LABELS[contract.contractType] ?? contract.contractType ?? 'Prestacao de Servicos',
    subtitle: '',
    body: '',
  });
  const introBlock = resolveLayoutBlock(layout, 'intro', {
    visible: false,
    title: 'Introducao',
    body: '',
  });
  const summaryBlock = resolveLayoutBlock(layout, 'summary', {
    visible: true,
    title: 'Resumo do contrato',
    body: '',
  });
  const scopeBlock = resolveLayoutBlock(layout, 'scope', {
    visible: true,
    title: 'Escopo de Trabalho',
    body: contract.serviceScope ?? '',
  });
  const clausesBlock = resolveLayoutBlock(layout, 'clauses', {
    visible: true,
    title: 'Clausulas Contratuais',
    body: '',
  });
  const signaturesBlock = resolveLayoutBlock(layout, 'signatures', {
    visible: true,
    title: 'Assinatura e Aceite',
    body: '',
  });
  const footerBlock = resolveLayoutBlock(layout, 'footer', {
    visible: true,
    leftNote: '',
    rightNote: '',
  });

  function buildSignatureBlock(input: {
    signatureSrc: string | null;
    alt: string;
    verificationCode: string;
  }) {
    if (!input.signatureSrc) {
      return `<div style="height:48px;display:flex;align-items:center;justify-content:center;border-bottom:1.5px dashed #d1d5db;margin-bottom:10px;">
        <span style="font-size:9px;color:#d1d5db;letter-spacing:0.18em;text-transform:uppercase;">Aguardando assinatura</span>
      </div>`;
    }

    if (!previewProtected) {
      return `<div style="height:64px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:4px;">
        <img src="${escapeHtml(input.signatureSrc)}" alt="${escapeHtml(input.alt)}" style="max-height:56px;max-width:100%;object-fit:contain;" />
      </div>
      <div style="border-bottom:1.5px solid #333;margin-bottom:10px;"></div>
      <div style="display:inline-flex;align-items:center;gap:4px;font-size:9px;color:#16a34a;font-weight:700;letter-spacing:0.08em;margin-bottom:6px;">
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="6" fill="#16a34a"/><path d="M3.5 6.5l2 2 3-4" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Assinado digitalmente
      </div>`;
    }

    return `<div
      data-signature-protected="true"
      style="position:relative;min-height:86px;overflow:hidden;border-radius:12px;border:1px solid ${color}33;background:linear-gradient(180deg, rgba(255,255,255,0.96), rgba(249,250,251,0.98));margin-bottom:4px;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;">
      <img
        src="${escapeHtml(input.signatureSrc)}"
        alt="${escapeHtml(input.alt)}"
        draggable="false"
        referrerpolicy="same-origin"
        style="position:absolute;left:50%;bottom:15px;transform:translateX(-50%);max-height:56px;max-width:calc(100% - 22px);object-fit:contain;pointer-events:none;user-select:none;-webkit-user-drag:none;filter:contrast(1.08) saturate(0.92);" />
      <div style="position:absolute;inset:0;background-image:repeating-linear-gradient(-22deg, rgba(17,17,17,0) 0 10px, rgba(17,17,17,0.05) 10px 11px),repeating-linear-gradient(90deg, rgba(255,102,0,0.14) 0 2px, transparent 2px 22px);opacity:0.26;mix-blend-mode:multiply;pointer-events:none;"></div>
      <div style="position:absolute;left:-10%;right:-10%;top:50%;height:14px;transform:rotate(-6deg);background:linear-gradient(90deg, rgba(255,102,0,0.16), rgba(17,17,17,0.08), rgba(255,102,0,0.16));opacity:0.5;pointer-events:none;"></div>
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">
        <div style="transform:rotate(-10deg);font-size:10px;font-weight:900;letter-spacing:0.24em;color:rgba(17,17,17,0.15);white-space:nowrap;text-transform:uppercase;">
          Preview Protegido ${escapeHtml(contractNumber)} ${escapeHtml(input.verificationCode)} Preview Protegido
        </div>
      </div>
      <div style="position:absolute;left:8px;top:8px;padding:4px 7px;border-radius:999px;background:rgba(17,17,17,0.88);color:#fff;font-size:8px;font-weight:800;letter-spacing:0.2em;text-transform:uppercase;pointer-events:none;">
        ${escapeHtml(input.verificationCode)}
      </div>
      <div style="position:absolute;right:8px;bottom:6px;max-width:74%;text-align:right;color:rgba(17,17,17,0.6);font-size:7px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;pointer-events:none;">
        Preview protegido • nao valido como comprovante visual
      </div>
    </div>
    <div style="border-bottom:1.5px solid #333;margin-bottom:10px;"></div>
    <div style="display:inline-flex;align-items:center;gap:4px;font-size:9px;color:#b45309;font-weight:800;letter-spacing:0.08em;margin-bottom:6px;text-transform:uppercase;">
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="6" fill="#f59e0b"/><path d="M6 3v3.25M6 8.5h.01" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>
      Assinatura protegida em preview
    </div>`;
  }

  const providerSigBlock = buildSignatureBlock({
    signatureSrc: providerSignatureSrc,
    alt: 'Assinatura do contratado',
    verificationCode: providerSignatureVerificationCode ?? previewStamp,
  });

  const clientSigBlock = buildSignatureBlock({
    signatureSrc: clientSignatureSrc,
    alt: 'Assinatura do contratante',
    verificationCode: clientSignatureVerificationCode ?? previewStamp,
  });

  const heroSectionHtml = heroBlock.visible === false ? '' : `
    <div style="margin-bottom:${sectionSpacing}px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.3em;color:#888;margin-bottom:6px;">${escapeHtml(String(heroBlock.label ?? 'Contrato de Servico'))}</div>
      <div style="font-size:${26 * fontScale}px;font-weight:800;color:${accentColor};line-height:1.2;">${escapeHtml(String(heroBlock.title ?? 'Prestacao de Servicos'))}</div>
      ${String(heroBlock.subtitle ?? '').trim()
        ? `<div style="font-size:${12 * fontScale}px;color:#6b7280;margin-top:8px;">${toMultilineHtml(heroBlock.subtitle)}</div>`
        : ''}
      ${String(heroBlock.body ?? '').trim()
        ? `<div style="font-size:${12 * fontScale}px;line-height:1.8;color:#4b5563;margin-top:10px;">${toMultilineHtml(heroBlock.body)}</div>`
        : ''}
    </div>`;

  const introSectionHtml = introBlock.visible === false || !String(introBlock.body ?? '').trim() ? '' : `
    <div style="margin-bottom:${sectionSpacing}px;padding:${16 * fontScale}px;border:1px solid ${color}22;border-radius:${borderRadius}px;background:linear-gradient(135deg, ${paperTint}, #ffffff);">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.22em;color:${color};font-weight:800;margin-bottom:10px;">${escapeHtml(String(introBlock.title ?? 'Introducao'))}</div>
      <div style="font-size:${12 * fontScale}px;line-height:1.8;color:#374151;">${toMultilineHtml(introBlock.body)}</div>
    </div>`;

  const summarySectionHtml = summaryBlock.visible === false ? '' : `
    <div style="margin-bottom:${sectionSpacing}px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.22em;color:${color};font-weight:800;margin-bottom:12px;">${escapeHtml(String(summaryBlock.title ?? 'Resumo do contrato'))}</div>
      ${String(summaryBlock.body ?? '').trim()
        ? `<div style="font-size:${12 * fontScale}px;line-height:1.8;color:#4b5563;margin-bottom:14px;">${toMultilineHtml(summaryBlock.body)}</div>`
        : ''}
      ${showSummaryCards ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div style="padding:14px 16px;background:#f8f8f8;border-radius:${borderRadius}px;border:1px solid ${color}18;">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.25em;color:#888;margin-bottom:4px;">Cliente</div>
          <div style="font-weight:700;font-size:${14 * fontScale}px;color:${color};">${escapeHtml(contract.clientName)}</div>
        </div>
        <div style="padding:14px 16px;background:#f8f8f8;border-radius:${borderRadius}px;border:1px solid ${color}18;">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.25em;color:#888;margin-bottom:4px;">Valor do Contrato</div>
          <div style="font-weight:700;font-size:${14 * fontScale}px;color:${accentColor};">${fmt(contract.contractValue)}</div>
        </div>
        <div style="padding:14px 16px;background:#f8f8f8;border-radius:${borderRadius}px;border:1px solid ${color}18;">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.25em;color:#888;margin-bottom:4px;">Data de Execucao</div>
          <div style="font-weight:700;font-size:${14 * fontScale}px;color:${accentColor};">${fmtDate(contract.executionDate)}</div>
        </div>
        <div style="padding:14px 16px;background:#f8f8f8;border-radius:${borderRadius}px;border:1px solid ${color}18;">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.25em;color:#888;margin-bottom:4px;">Pagamento</div>
          <div style="font-weight:700;font-size:${14 * fontScale}px;color:${accentColor};">${escapeHtml(PAYMENT_FORM_LABELS[contract.paymentMethod] ?? contract.paymentMethod)}</div>
        </div>
      </div>` : ''}
    </div>`;

  const scopeSource = String(scopeBlock.body ?? '').trim() || String(contract.serviceScope ?? '').trim();
  const scopeSectionHtml = scopeBlock.visible === false || !scopeSource ? '' : `
    <div style="margin-bottom:${sectionSpacing}px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.22em;color:${color};font-weight:800;margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid ${color}33;">${escapeHtml(String(scopeBlock.title ?? 'Escopo de Trabalho'))}</div>
      <div style="font-size:${13 * fontScale}px;line-height:1.8;color:#333;text-align:justify;">${toMultilineHtml(scopeSource)}</div>
    </div>`;

  const clausesIntroHtml = String(clausesBlock.body ?? '').trim()
    ? `<div style="font-size:${12 * fontScale}px;line-height:1.8;color:#4b5563;margin-bottom:14px;">${toMultilineHtml(clausesBlock.body)}</div>`
    : '';
  const clausesListHtml = renderedClauses.map((c, i) => `
        <div style="margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid #f0f0f0;">
          <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px;">
            <span style="background:${accentColor};color:#fff;font-size:9px;font-weight:800;padding:2px 6px;border-radius:3px;flex-shrink:0;">${i + 1}</span>
            <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#111;">${escapeHtml(c.title ?? '')}</span>
          </div>
          <p style="font-size:${12 * fontScale}px;line-height:1.8;color:#444;text-align:justify;margin:0;padding-left:20px;">
            ${toMultilineHtml(c.content ?? '')}
          </p>
        </div>`).join('');
  const clausesSectionHtml = clausesBlock.visible === false || (renderedClauses.length === 0 && !clausesIntroHtml) ? '' : `
    <div style="margin-bottom:${sectionSpacing}px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.22em;color:${color};font-weight:800;margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid ${color}33;">
        ${escapeHtml(String(clausesBlock.title ?? 'Clausulas Contratuais'))}
        ${renderedClauses.length > 0 ? `<span style="margin-left:8px;background:#f0f0f0;color:#888;font-size:9px;font-weight:700;padding:1px 6px;border-radius:10px;">${renderedClauses.length}</span>` : ''}
      </div>
      ${clausesIntroHtml}
      ${renderedClauses.length > 0 ? clausesListHtml : `<div style="font-size:${12 * fontScale}px;color:#9ca3af;">Nenhuma clausula foi adicionada ao preview.</div>`}
    </div>`;

  const signaturesSectionHtml = signaturesBlock.visible === false ? '' : `
    <div style="margin-top:${Math.max(28, sectionSpacing)}px;padding-top:24px;border-top:2px solid ${accentColor};">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.22em;color:${color};font-weight:800;text-align:center;margin-bottom:12px;">${escapeHtml(String(signaturesBlock.title ?? 'Assinatura e Aceite'))}</div>
      ${String(signaturesBlock.body ?? '').trim()
        ? `<div style="font-size:${12 * fontScale}px;line-height:1.8;color:#4b5563;text-align:center;margin-bottom:20px;">${toMultilineHtml(signaturesBlock.body)}</div>`
        : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:48px;">
        <div style="text-align:center;">
          ${providerSigBlock}
          <div style="font-size:${12 * fontScale}px;font-weight:700;color:#111;">Prestador de Servicos</div>
          <div style="font-size:10px;color:#999;margin-top:2px;">Contratado</div>
        </div>
        <div style="text-align:center;">
          ${clientSigBlock}
          <div style="font-size:${12 * fontScale}px;font-weight:700;color:#111;">${escapeHtml(contract.clientName)}</div>
          <div style="font-size:10px;color:#999;margin-top:2px;">Contratante</div>
          ${(contract as any).signerDocument
            ? `<div style="font-size:9px;color:#bbb;margin-top:3px;">${escapeHtml((contract as any).signerDocument)}</div>`
            : ''}
        </div>
      </div>
    </div>`;

  const footerSectionHtml = footerBlock.visible === false ? '' : `
    <div style="margin-top:${Math.max(28, sectionSpacing)}px;padding-top:16px;border-top:1px solid #eee;display:flex;justify-content:space-between;align-items:center;gap:18px;">
      <div style="font-size:10px;color:#ccc;">${String(footerBlock.leftNote ?? '').trim() ? toMultilineHtml(footerBlock.leftNote) : brandingLine}</div>
      <div style="font-size:10px;color:#ccc;text-align:right;">${String(footerBlock.rightNote ?? '').trim() ? toMultilineHtml(footerBlock.rightNote) : `${contractNumber} · ${today}`}</div>
    </div>`;

  const blockHtmlByKey: Record<string, string> = {
    hero: heroSectionHtml,
    intro: introSectionHtml,
    summary: summarySectionHtml,
    scope: scopeSectionHtml,
    clauses: clausesSectionHtml,
    signatures: signaturesSectionHtml,
    footer: footerSectionHtml,
  };
  const orderedSectionsHtml = resolveLayoutBlockOrder(layout)
    .map((key) => blockHtmlByKey[key] ?? '')
    .join('');

  const previewProtectionBanner = previewProtected ? `
    <div style="margin-bottom:22px;padding:10px 14px;border:1px solid ${color}33;border-radius:12px;background:linear-gradient(135deg, rgba(255,102,0,0.08), rgba(17,17,17,0.03));display:flex;justify-content:space-between;align-items:center;gap:12px;">
      <div>
        <div style="font-size:10px;font-weight:900;letter-spacing:0.22em;text-transform:uppercase;color:#92400e;">Preview protegido</div>
        <div style="font-size:11px;color:#6b7280;margin-top:4px;">Assinaturas exibidas com camadas visuais antifraude, token opaco e acesso autenticado.</div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-size:9px;color:#6b7280;text-transform:uppercase;letter-spacing:0.16em;">Selo</div>
        <div style="font-size:12px;font-weight:900;color:#111;">${previewStamp}</div>
        <div style="font-size:9px;color:#9ca3af;margin-top:2px;">${escapeHtml(previewIssuedAtLabel)}</div>
      </div>
    </div>` : '';

  const previewShieldHtml = previewProtected ? `
    <div style="position:absolute;inset:14px;border:1px solid rgba(17,17,17,0.05);pointer-events:none;z-index:42;"></div>
    <div style="position:absolute;inset:0;pointer-events:none;z-index:41;opacity:0.1;background-image:radial-gradient(circle at 12px 12px, rgba(17,17,17,0.25) 0 1px, transparent 1px);background-size:24px 24px;"></div>` : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'self' data:; connect-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';" />
<meta name="referrer" content="same-origin" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: ${font}; background: #f3f4f6; color: #111; }
  img { image-rendering: -webkit-optimize-contrast; }
  .contract-watermark-layer {
    pointer-events: none;
    background-repeat: repeat;
    background-size: 440px 300px;
  }
  .contract-watermark-screen {
    position: absolute;
    inset: 0;
    z-index: 50;
  }
  .contract-watermark-print {
    display: none;
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .contract-watermark-screen { display: none !important; }
    .contract-watermark-print {
      display: block !important;
      position: fixed;
      inset: 0;
      z-index: 50;
    }
  }
</style>
</head>
<body>
<div style="max-width:${contentWidth}px;margin:0 auto;min-height:1122px;position:relative;background:${paperTint};border-radius:${borderRadius}px;overflow:hidden;box-shadow:0 18px 60px rgba(17,17,17,0.08);">
  ${watermarkHtml}
  ${previewShieldHtml}
  <div style="position:relative;z-index:20;padding:${48 * fontScale}px ${52 * fontScale}px;">

    ${previewProtectionBanner}

    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px;padding-bottom:24px;border-bottom:2px solid ${color};">
      <div>${logoHtml}</div>
      <div style="text-align:right;display:${showContractNumber ? 'block' : 'none'};">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.2em;color:#aaa;">Nº do Contrato</div>
        <div style="font-size:18px;font-weight:800;color:#111;margin-top:2px;">${contractNumber}</div>
        <div style="margin-top:6px;display:inline-block;padding:3px 10px;border-radius:999px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;border:1px solid ${color};color:${color};">
          ${contract.status === 'finalizado' ? 'Finalizado' : contract.status === 'assinado' ? 'Assinado' : 'Em Edição'}
        </div>
      </div>
    </div>

    <div style="display:none;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.3em;color:#aaa;margin-bottom:6px;">Contrato de Serviço</div>
      <div style="font-size:26px;font-weight:800;color:#111;line-height:1.2;">
        ${escapeHtml(CONTRACT_TYPE_LABELS[contract.contractType] ?? contract.contractType ?? 'Prestação de Serviços')}
      </div>
    </div>

    <div style="display:none;">
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

    <div style="display:none;">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.3em;color:${color};font-weight:800;margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid ${color}33;">Escopo de Trabalho</div>
      <p style="font-size:13px;line-height:1.8;color:#333;text-align:justify;">${escapeHtml(contract.serviceScope ?? '').replaceAll('\n', '<br/>')}</p>
    </div>

    ${orderedSectionsHtml}

    <div style="display:none;">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.3em;color:${color};font-weight:800;text-align:center;margin-bottom:28px;">Assinatura e Aceite</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:48px;">
        <div style="text-align:center;">
          ${providerSigBlock}
          <div style="font-size:12px;font-weight:700;color:#111;">Prestador de Serviços</div>
          <div style="font-size:10px;color:#999;margin-top:2px;">Contratado</div>
        </div>

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

    <div style="display:none;">
      ${brandingLine}
      <div style="font-size:10px;color:#ccc;">${contractNumber} · ${today}</div>
    </div>

  </div>
</div>
</body>
</html>`;
}

export class ContractRenderService {
  replaceVariables(
    contractData: {
      clientName: string;
      contractValue: string;
      executionDate: Date;
      paymentMethod: string;
      serviceScope: string;
      contractType?: string;
      profession?: string;
    },
    clauseContent: string
  ) {
    return replaceContractVariables({
      ...contractData,
      contractType: contractData.contractType ?? 'servicos contratados',
      profession: contractData.profession ?? '',
    }, {}, clauseContent);
  }

  async renderContract(
    contractId: number,
    userId: number,
    knownStateHash?: string | null,
    options?: RenderContractOptions
  ) {
    const version = await loadContractRenderVersion(contractId, userId);
    if (!version) return null;

    const now = Date.now();
    const previewTtlMs = Math.max(60_000, Math.min(PREVIEW_RENDER_CACHE_TTL_MS, 30 * 60 * 1000));
    const expiresAt = now + previewTtlMs;
    const versionKey = buildContractRenderVersionKey(version);
    const accessMode: ContractPreviewAccessMode = options?.publicPreview ? 'public' : 'private';
    const cacheKey = buildPreviewRenderCacheKey(contractId, userId, accessMode);

    cleanupPreviewRenderCache(now);
    const cachedPreview = previewRenderCache.get(cacheKey);
    if (cachedPreview && cachedPreview.versionKey === versionKey && cachedPreview.expiresAt > now) {
      if (accessMode === 'private') {
        restoreCachedPreviewImageAsset(cachedPreview.clientAsset, contractId, userId, 'client', cachedPreview.expiresAt);
        restoreCachedPreviewImageAsset(cachedPreview.providerAsset, contractId, userId, 'provider', cachedPreview.expiresAt);
      }

      const notModified = Boolean(knownStateHash && knownStateHash === cachedPreview.stateHash);

      return {
        html: notModified ? null : cachedPreview.html,
        contract: null,
        clauses: cachedPreview.renderedClauses,
        stateHash: cachedPreview.stateHash,
        notModified,
        previewExpiresAt: new Date(cachedPreview.expiresAt).toISOString(),
      };
    }

    const model = await loadContractRenderModel(contractId, userId);
    if (!model) return null;

    const hasClientSignature =
      Boolean((model.contract as any).signatureCiphertext) &&
      Boolean((model.contract as any).signatureIv) &&
      Boolean((model.contract as any).signatureAuthTag);
    const hasProviderSignature =
      Boolean((model.contract as any).providerContractCiphertext) &&
      Boolean((model.contract as any).providerContractIv) &&
      Boolean((model.contract as any).providerContractAuthTag);
    const stateHash = buildPreviewStateHash(model, contractId, userId);

    const previewSessionNonce = crypto.randomBytes(16).toString('hex');
    const previewProtectionCode = crypto
      .createHash('sha256')
      .update(`preview:${contractId}:${userId}:${previewSessionNonce}`)
      .digest('hex')
      .slice(0, 12)
      .toUpperCase();

    const clientPng = hasClientSignature ? getClientSignaturePngBufferFromContract(model.contract, contractId) : null;
    const providerPng = hasProviderSignature ? getProviderSignaturePngBufferFromContract(model.contract, contractId, userId) : null;

    const clientAsset = accessMode === 'private' && clientPng
      ? {
          ...createAuthenticatedContractSignaturePreviewAsset({
            contractId,
            userId,
            kind: 'client',
            expiresAt,
            pngBuffer: clientPng,
          }),
          pngBuffer: clientPng,
        }
      : null;
    const providerAsset = accessMode === 'private' && providerPng
      ? {
          ...createAuthenticatedContractSignaturePreviewAsset({
            contractId,
            userId,
            kind: 'provider',
            expiresAt,
            pngBuffer: providerPng,
          }),
          pngBuffer: providerPng,
        }
      : null;

    const clientSignatureSrc = accessMode === 'public'
      ? (clientPng ? pngBufferToDataUrl(clientPng) : null)
      : (clientAsset?.previewUrl ?? null);
    const providerSignatureSrc = accessMode === 'public'
      ? (providerPng ? pngBufferToDataUrl(providerPng) : null)
      : (providerAsset?.previewUrl ?? null);

    const html = buildFullHtml({
      contract: model.contract,
      renderedClauses: model.renderedClauses,
      layout: model.mergedLayout,
      clientSignatureSrc,
      providerSignatureSrc,
      isPro: model.isPro,
      renderMode: 'preview',
      previewProtectionCode,
      previewIssuedAtIso: new Date(now).toISOString(),
      clientSignatureVerificationCode: clientAsset?.verificationCode ?? previewProtectionCode,
      providerSignatureVerificationCode: providerAsset?.verificationCode ?? previewProtectionCode,
    });

    previewRenderCache.set(cacheKey, {
      contractId,
      userId,
      versionKey,
      stateHash,
      expiresAt,
      html,
      previewIssuedAtIso: new Date(now).toISOString(),
      previewProtectionCode,
      clientAsset,
      providerAsset,
      renderedClauses: model.renderedClauses,
    });
    cleanupPreviewRenderCache(now);

    return {
      html,
      contract: model.contract,
      clauses: model.renderedClauses,
      stateHash,
      notModified: false,
      previewExpiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async generateContractPDF(contractId: number, userId: number): Promise<{ pdfBuffer: Buffer; userPlan: string } | null> {
    const version = await loadContractRenderVersion(contractId, userId);
    if (!version) return null;

    const versionKey = buildContractRenderVersionKey(version);
    const cacheKey = buildPdfRenderCacheKey(contractId, userId);
    const now = Date.now();

    cleanupPdfRenderCache(now);
    const cachedPdf = pdfRenderCache.get(cacheKey);
    if (cachedPdf && cachedPdf.versionKey === versionKey && cachedPdf.expiresAt > now) {
      return {
        pdfBuffer: Buffer.from(cachedPdf.pdfBuffer),
        userPlan: cachedPdf.userPlan,
      };
    }

    const model = await loadContractRenderModel(contractId, userId);
    if (!model) return null;
    const stateHash = buildPreviewStateHash(model, contractId, userId);

    const clientSignatureDataUrl = (() => {
      const buffer = getClientSignaturePngBufferFromContract(model.contract, contractId);
      return buffer ? pngBufferToDataUrl(buffer) : null;
    })();

    const providerSignatureDataUrl = (() => {
      const buffer = getProviderSignaturePngBufferFromContract(model.contract, contractId, userId);
      return buffer ? pngBufferToDataUrl(buffer) : null;
    })();

    const html = buildFullHtml({
      contract: model.contract,
      renderedClauses: model.renderedClauses,
      layout: model.mergedLayout,
      clientSignatureSrc: clientSignatureDataUrl,
      providerSignatureSrc: providerSignatureDataUrl,
      isPro: model.isPro,
      renderMode: 'pdf',
    });

    const safeHtml = html;
    let pdfResult: Buffer | null = null;

    try {
      pdfResult = await withIsolatedPdfPage(async (page) => {
        await page.setContent(safeHtml, {
          waitUntil: 'domcontentloaded',
          timeout: 45_000,
        });

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
          format: 'A4',
          printBackground: true,
          margin: { top: '0', right: '0', bottom: '0', left: '0' },
          timeout: 45_000,
        });

        return Buffer.from(pdf);
      });
    } catch (err) {
      console.error('[generateContractPDF] Erro ao gerar PDF:', (err as Error).message ?? err);
      pdfResult = null;
    }

    if (!pdfResult) return null;

    pdfRenderCache.set(cacheKey, {
      contractId,
      userId,
      versionKey,
      stateHash,
      expiresAt: now + Math.max(15_000, PDF_RENDER_CACHE_TTL_MS),
      pdfBuffer: Buffer.from(pdfResult),
      userPlan: model.userPlan,
      createdAt: now,
    });
    cleanupPdfRenderCache(now);

    return {
      pdfBuffer: pdfResult,
      userPlan: model.userPlan,
    };
  }
}

export const contractRenderService = new ContractRenderService();
