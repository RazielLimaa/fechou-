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

const escapeXml = (value: string | number) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const toNumber = (rawValue: string) => {
  if (!rawValue) return 0;
  return Number(rawValue.replace(/\./g, '').replace(',', '.')) || 0;
};

const asDate = (value: Date) => value.toISOString().slice(0, 10);

const row = (cells: string[]) => `<Row>${cells.join('')}</Row>`;
const cell = (value: string | number) => `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
const numberCell = (value: number) => `<Cell><Data ss:Type="Number">${Number.isFinite(value) ? value : 0}</Data></Cell>`;

export function buildPremiumDashboardSpreadsheetXml(input: {
  proposals: PremiumDashboardProposalRow[];
  dashboard: PremiumDashboardComputed;
  period: 'monthly' | 'weekly';
}) {
  const { proposals, dashboard, period } = input;

  const dadosRows = proposals
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((proposal) => {
      const numericValue = toNumber(proposal.value);
      const paid = proposal.status === 'vendida' ? 'Sim' : 'Não';
      return row([
        cell(asDate(new Date(proposal.createdAt))),
        cell(proposal.clientName),
        cell(proposal.title),
        cell(proposal.status),
        cell('N/A'),
        numberCell(Number(numericValue.toFixed(2))),
        cell(paid)
      ]);
    })
    .join('');

  const clientesMap = new Map<string, { sold: number; pending: number; canceled: number; revenue: number }>();
  for (const proposal of proposals) {
    const key = proposal.clientName;
    const current = clientesMap.get(key) ?? { sold: 0, pending: 0, canceled: 0, revenue: 0 };
    const numericValue = toNumber(proposal.value);
    if (proposal.status === 'vendida') {
      current.sold += 1;
      current.revenue += numericValue;
    } else if (proposal.status === 'pendente') {
      current.pending += 1;
    } else if (proposal.status === 'cancelada') {
      current.canceled += 1;
    }
    clientesMap.set(key, current);
  }

  const clientesRows = Array.from(clientesMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
    .map(([clientName, data]) => {
      const avgTicket = data.sold ? data.revenue / data.sold : 0;
      return row([
        cell(clientName),
        numberCell(data.sold),
        numberCell(data.pending),
        numberCell(data.canceled),
        numberCell(Number(data.revenue.toFixed(2))),
        numberCell(Number(avgTicket.toFixed(2)))
      ]);
    })
    .join('');

  const chartRows = dashboard.chartData
    .map((item) => row([
      cell(item.label),
      numberCell(Number(item.revenue.toFixed(2))),
      numberCell(item.sold),
      numberCell(item.pending),
      numberCell(item.canceled)
    ]))
    .join('');

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="Dashboard">
    <Table>
      ${row([cell('Fechou! — Relatório Completo')])}
      ${row([cell(`Período selecionado: ${period}`)])}
      ${row([cell('Gerado em'), cell(new Date().toISOString())])}
      ${row([cell('')])}
      ${row([cell('KPI'), cell('Valor')])}
      ${row([cell('Receita total (R$)'), numberCell(Number(dashboard.totalValue.toFixed(2)))])}
      ${row([cell('Ticket médio (R$)'), numberCell(Number(dashboard.avgTicket.toFixed(2)))])}
      ${row([cell('Vendidas (qtd)'), numberCell(dashboard.soldCount)])}
      ${row([cell('Pendentes (qtd)'), numberCell(dashboard.pendingCount)])}
      ${row([cell('Canceladas (qtd)'), numberCell(dashboard.canceledCount)])}
      ${row([cell('Conversão (%)'), numberCell(Number(dashboard.conversionRatePct.toFixed(2)))])}
      ${row([cell('')])}
      ${row([cell('Série mensal/semanal'), cell('Receita (R$)'), cell('Vendidas'), cell('Pendentes'), cell('Canceladas')])}
      ${chartRows}
    </Table>
  </Worksheet>
  <Worksheet ss:Name="Dados">
    <Table>
      ${row([cell('Data'), cell('Cliente'), cell('Proposta'), cell('Status'), cell('Canal'), cell('Valor (R$)'), cell('Pago?')])}
      ${dadosRows}
    </Table>
  </Worksheet>
  <Worksheet ss:Name="Clientes">
    <Table>
      ${row([cell('Cliente'), cell('Vendas (qtd)'), cell('Pendentes (qtd)'), cell('Canceladas (qtd)'), cell('Receita (R$)'), cell('Ticket Médio (R$)')])}
      ${clientesRows}
    </Table>
  </Worksheet>
  <Worksheet ss:Name="Config">
    <Table>
      ${row([cell('Parâmetro'), cell('Valor')])}
      ${row([cell('Moeda'), cell('BRL')])}
      ${row([cell('Ano base'), numberCell(new Date().getFullYear())])}
      ${row([cell('Últimos meses'), numberCell(12)])}
    </Table>
  </Worksheet>
</Workbook>`;
}
