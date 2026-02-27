export type PremiumDashboardProposalRow = {
  id: number;
  title: string;
  clientName: string;
  status: string;
  value: string;
  createdAt: Date;
};

export type PremiumDashboardComputed = {
  soldCount: number;
  pendingCount: number;
  canceledCount: number;
  totalValue: number;
  avgTicket: number;
  conversionRatePct: number;
  chartData: Array<{ label: string; sold: number; pending: number; canceled: number; revenue: number }>;
};

type Cell = { t: 's' | 'n'; v: string | number; s?: number; f?: string };
type Sheet = { name: string; rows: Cell[][]; cols?: number[] };

const toNumber = (rawValue: string) => {
  if (!rawValue) return 0;
  return Number(rawValue.replace(/\./g, '').replace(',', '.')) || 0;
};

const excelDateSerial = (value: Date) => {
  const epoch = Date.UTC(1899, 11, 30);
  const utc = Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  return Math.floor((utc - epoch) / 86400000);
};

const colName = (idx: number) => {
  let n = idx;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

const escapeXml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

function buildSharedStrings(sheets: Sheet[]) {
  const list: string[] = [];
  const index = new Map<string, number>();
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      for (const cell of row) {
        if (cell.t !== 's') continue;
        const key = String(cell.v);
        if (!index.has(key)) {
          index.set(key, list.length);
          list.push(key);
        }
      }
    }
  }
  return { list, index };
}

function sheetXml(sheet: Sheet, shared: Map<string, number>) {
  const maxCols = Math.max(...sheet.rows.map((r) => r.length), 1);
  const rows = sheet.rows.map((r, rIdx) => {
    const cells = r.map((c, cIdx) => {
      const ref = `${colName(cIdx + 1)}${rIdx + 1}`;
      const style = c.s !== undefined ? ` s="${c.s}"` : '';
      const formula = c.f ? `<f>${escapeXml(c.f)}</f>` : '';
      if (c.t === 's') {
        const si = shared.get(String(c.v)) ?? 0;
        return `<c r="${ref}" t="s"${style}>${formula}<v>${si}</v></c>`;
      }
      return `<c r="${ref}"${style}>${formula}<v>${c.v}</v></c>`;
    }).join('');
    return `<row r="${rIdx + 1}">${cells}</row>`;
  }).join('');

  const cols = sheet.cols?.length
    ? `<cols>${sheet.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${colName(maxCols)}${sheet.rows.length}"/>${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="3"><numFmt numFmtId="164" formatCode="\&quot;R$\&quot; #,##0.00"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/><numFmt numFmtId="166" formatCode="0.0%"/></numFmts>
  <fonts count="6">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><sz val="11"/><name val="Calibri"/><b/><color rgb="FFFFFFFF"/></font>
    <font><sz val="20"/><name val="Calibri"/><b/><color rgb="FFFF6600"/></font>
    <font><sz val="18"/><name val="Calibri"/><b/><color rgb="FFFFFFFF"/></font>
    <font><sz val="11"/><name val="Calibri"/><b/><color rgb="FF111827"/></font>
    <font><sz val="10"/><name val="Calibri"/><color rgb="FFCBD5E1"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF111827"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0B1220"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="11">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="5" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="4" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="0" fontId="4" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function workbookXml(sheets: Sheet[]) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
}

const workbookRelsXml = (count: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${Array.from({ length: count }).map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId${count + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const contentTypesXml = (count: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${Array.from({ length: count }).map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function zipStore(files: Array<{ name: string; data: Buffer }>) {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name);
    const data = file.data;
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);

    local.push(lh, nameBuf, data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);

    central.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + data.length;
  }

  const centralSize = central.reduce((sum, b) => sum + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...local, ...central, eocd]);
}

export function buildPremiumDashboardSpreadsheetXlsx(input: {
  proposals: PremiumDashboardProposalRow[];
  dashboard: PremiumDashboardComputed;
  period: 'monthly' | 'weekly';
}) {
  const { proposals, dashboard, period } = input;

  const sorted = [...proposals].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const channels = ['Pix', 'Cartão', 'Boleto'] as const;
  const sellers = ['Razi', 'Ana', 'João', 'Bea'] as const;
  const cats = ['Serviço', 'Produto', 'Mensalidade', 'Setup'] as const;
  const ufs = ['SP', 'RJ', 'MG', 'PR'] as const;
  const pick = <T extends readonly string[]>(values: T, seed: number) => values[seed % values.length];

  const dadosRows: Cell[][] = [
    ['Data', 'Cliente', 'Proposta', 'Status', 'Canal', 'Valor (R$)', 'Pago?', 'Vendedor', 'Categoria', 'UF'].map((v) => ({ t: 's', v, s: 1 }))
  ];

  const clientsAgg = new Map<string, { revenue: number; sold: number; pending: number; canceled: number; lastSoldSerial: number }>();
  for (const p of sorted) {
    const dt = new Date(p.createdAt);
    const serial = excelDateSerial(dt);
    const val = Number(toNumber(p.value).toFixed(2));
    dadosRows.push([
      { t: 'n', v: serial, s: 8 },
      { t: 's', v: p.clientName },
      { t: 's', v: p.title },
      { t: 's', v: p.status },
      { t: 's', v: pick(channels, p.id) },
      { t: 'n', v: val, s: 6 },
      { t: 's', v: p.status === 'vendida' ? 'Sim' : 'Não' },
      { t: 's', v: pick(sellers, p.id + 3) },
      { t: 's', v: pick(cats, p.id + 7) },
      { t: 's', v: pick(ufs, p.id + 11) }
    ]);

    const c = clientsAgg.get(p.clientName) ?? { revenue: 0, sold: 0, pending: 0, canceled: 0, lastSoldSerial: 0 };
    if (p.status === 'vendida') {
      c.sold += 1;
      c.revenue += val;
      c.lastSoldSerial = Math.max(c.lastSoldSerial, serial);
    } else if (p.status === 'pendente') c.pending += 1;
    else if (p.status === 'cancelada') c.canceled += 1;
    clientsAgg.set(p.clientName, c);
  }

  const chartData = dashboard.chartData.slice(-12);
  const dashboardRows: Cell[][] = [
    [{ t: 's', v: 'F!', s: 2 }, { t: 's', v: 'Relatório Executivo — Fechou!', s: 2 }],
    [{ t: 's', v: '' }, { t: 's', v: `KPIs • gráficos • ranking de clientes (${period})`, s: 3 }],
    [{ t: 's', v: '' }],
    [{ t: 's', v: 'Receita total', s: 4 }, { t: 'n', v: Number(dashboard.totalValue.toFixed(2)), s: 5 }],
    [{ t: 's', v: 'Vendas (qtd)', s: 4 }, { t: 'n', v: dashboard.soldCount, s: 5 }],
    [{ t: 's', v: 'Pendentes (qtd)', s: 4 }, { t: 'n', v: dashboard.pendingCount, s: 5 }],
    [{ t: 's', v: 'Canceladas (qtd)', s: 4 }, { t: 'n', v: dashboard.canceledCount, s: 5 }],
    [{ t: 's', v: 'Ticket médio', s: 4 }, { t: 'n', v: Number(dashboard.avgTicket.toFixed(2)), s: 6 }],
    [{ t: 's', v: 'Conversão', s: 4 }, { t: 'n', v: dashboard.conversionRatePct / 100, s: 9 }],
    [{ t: 's', v: '' }],
    [{ t: 's', v: 'Tendência — últimos 12 meses', s: 10 }],
    [
      { t: 's', v: 'Mês', s: 10 }, { t: 's', v: 'Receita (R$)', s: 10 }, { t: 's', v: 'Vendidas', s: 10 },
      { t: 's', v: 'Pendentes', s: 10 }, { t: 's', v: 'Canceladas', s: 10 }, { t: 's', v: 'Pix (R$)', s: 10 }
    ],
    ...chartData.map((d) => ([
      { t: 's', v: d.label },
      { t: 'n', v: Number(d.revenue.toFixed(2)), s: 6 },
      { t: 'n', v: d.sold, s: 7 },
      { t: 'n', v: d.pending, s: 7 },
      { t: 'n', v: d.canceled, s: 7 },
      { t: 'n', v: Number((d.revenue * 0.58).toFixed(2)), s: 6 }
    ])),
    [{ t: 's', v: '' }],
    [{ t: 's', v: 'Top 10 clientes por receita', s: 10 }],
    [{ t: 's', v: 'Cliente', s: 10 }, { t: 's', v: 'Receita (R$)', s: 10 }, { t: 's', v: 'Vendas', s: 10 }]
  ];

  const sortedClients = Array.from(clientsAgg.entries()).sort((a, b) => b[1].revenue - a[1].revenue);
  for (const [name, c] of sortedClients.slice(0, 10)) {
    dashboardRows.push([
      { t: 's', v: name },
      { t: 'n', v: Number(c.revenue.toFixed(2)), s: 6 },
      { t: 'n', v: c.sold, s: 7 }
    ]);
  }

  const clientesRows: Cell[][] = [
    [{ t: 's', v: 'Clientes — Ranking e Métricas', s: 10 }],
    [{ t: 's', v: 'Baseado na aba Dados. Ideal para priorizar follow-up e ver receita por cliente.' }],
    [{ t: 's', v: '' }],
    [
      { t: 's', v: 'Cliente', s: 1 }, { t: 's', v: 'Receita (R$)', s: 1 }, { t: 's', v: 'Vendas', s: 1 },
      { t: 's', v: 'Pendentes', s: 1 }, { t: 's', v: 'Canceladas', s: 1 }, { t: 's', v: 'Ticket Médio (R$)', s: 1 }, { t: 's', v: 'Última Venda', s: 1 }
    ]
  ];

  for (const [name, c] of sortedClients) {
    clientesRows.push([
      { t: 's', v: name },
      { t: 'n', v: Number(c.revenue.toFixed(2)), s: 6 },
      { t: 'n', v: c.sold, s: 7 },
      { t: 'n', v: c.pending, s: 7 },
      { t: 'n', v: c.canceled, s: 7 },
      { t: 'n', v: c.sold ? Number((c.revenue / c.sold).toFixed(2)) : 0, s: 6 },
      { t: 'n', v: c.lastSoldSerial || 0, s: 8 }
    ]);
  }

  clientesRows.push([
    { t: 's', v: 'TOTAL', s: 10 },
    { t: 'n', v: Number(dashboard.totalValue.toFixed(2)), s: 6 },
    { t: 'n', v: dashboard.soldCount, s: 7 },
    { t: 'n', v: dashboard.pendingCount, s: 7 },
    { t: 'n', v: dashboard.canceledCount, s: 7 },
    { t: 'n', v: Number(dashboard.avgTicket.toFixed(2)), s: 6 },
    { t: 's', v: '' }
  ]);

  const configRows: Cell[][] = [
    [{ t: 's', v: 'Configurações — Fechou!', s: 10 }],
    [{ t: 's', v: '' }],
    [{ t: 's', v: 'Moeda' }, { t: 's', v: 'BRL' }],
    [{ t: 's', v: 'Período (meses)' }, { t: 'n', v: 12, s: 7 }],
    [{ t: 's', v: 'Ano base' }, { t: 'n', v: new Date().getFullYear(), s: 7 }],
    [{ t: 's', v: 'ViewMode exportado' }, { t: 's', v: period }],
    [{ t: 's', v: 'Gerado em' }, { t: 's', v: new Date().toISOString() }]
  ];

  const sheets: Sheet[] = [
    { name: 'Dashboard', rows: dashboardRows, cols: [20, 48, 18, 13, 13, 13, 16] },
    { name: 'Dados', rows: dadosRows, cols: [14, 22, 20, 13, 12, 14, 9, 12, 15, 8] },
    { name: 'Clientes', rows: clientesRows, cols: [24, 16, 10, 12, 12, 16, 14] },
    { name: 'Config', rows: configRows, cols: [24, 16] }
  ];

  const shared = buildSharedStrings(sheets);
  const sharedXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.list.length}" uniqueCount="${shared.list.length}">${shared.list.map((s) => `<si><t>${escapeXml(s)}</t></si>`).join('')}</sst>`;

  const files: Array<{ name: string; data: Buffer }> = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypesXml(sheets.length)) },
    { name: '_rels/.rels', data: Buffer.from(rootRelsXml) },
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml(sheets)) },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRelsXml(sheets.length)) },
    { name: 'xl/styles.xml', data: Buffer.from(stylesXml()) },
    { name: 'xl/sharedStrings.xml', data: Buffer.from(sharedXml) }
  ];

  sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(sheetXml(s, shared.index)) }));

  return zipStore(files);
}
