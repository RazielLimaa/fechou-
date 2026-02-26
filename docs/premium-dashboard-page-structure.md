# Estrutura completa da página Premium Dashboard (todos endpoints conectados)

Abaixo está a estrutura para ligar **cada bloco/função** da página aos endpoints novos, sem alterar layout.

## Endpoints disponíveis

Base: `/api/metrics`

1. `GET /premium-dashboard?period=monthly|weekly` (payload completo)
2. `GET /premium-dashboard/kpis?period=monthly|weekly`
3. `GET /premium-dashboard/charts?period=monthly|weekly`
4. `GET /premium-dashboard/health?period=monthly|weekly`
5. `GET /premium-dashboard/insights?period=monthly|weekly&limit=6`
6. `GET /premium-dashboard/actions?period=monthly|weekly&limit=5`
7. `GET /premium-dashboard/pending-reasons?period=monthly|weekly`
8. `GET /premium-dashboard/pending-ranked?period=monthly|weekly&limit=8`
9. `GET /premium-dashboard/executive-summary?period=monthly|weekly`
10. `GET /premium-dashboard/export.csv`
11. `GET /premium-dashboard/export-template.xls?period=monthly|weekly`

## Conexão por função da página

- Toggle mensal/semanal: muda `period` em todas as queries.
- KPI Cards: endpoint `kpis`.
- Gráfico barras + sparkline + trend: endpoint `charts`.
- Health score + aging + vendidas 30d: endpoint `health`.
- Cards de insights: endpoint `insights`.
- Next actions: endpoint `actions`.
- Pizza motivos: endpoint `pending-reasons`.
- Lista pendências prioritárias + maior pendência: endpoint `pending-ranked`.
- Resumo executivo (risco/conversão/pendente/ticket): endpoint `executive-summary`.
- Botão exportar: endpoint `export.csv` para BI e `export-template.xls` para planilha template premium preenchida com os dados do usuário.

## Exemplo de camada de API (frontend)

```ts
export type PeriodType = "monthly" | "weekly";

const qs = (obj: Record<string, string | number | undefined>) => {
  const url = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.set(k, String(v));
  });
  return url.toString();
};

async function get<T>(path: string) {
  const res = await fetch(`/api/metrics${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Falha ao buscar métricas premium");
  }

  return (await res.json()) as T;
}

export const metricsApi = {
  full: (period: PeriodType) => get(`/premium-dashboard?${qs({ period })}`),
  kpis: (period: PeriodType) => get(`/premium-dashboard/kpis?${qs({ period })}`),
  charts: (period: PeriodType) => get(`/premium-dashboard/charts?${qs({ period })}`),
  health: (period: PeriodType) => get(`/premium-dashboard/health?${qs({ period })}`),
  insights: (period: PeriodType, limit = 6) => get(`/premium-dashboard/insights?${qs({ period, limit })}`),
  actions: (period: PeriodType, limit = 5) => get(`/premium-dashboard/actions?${qs({ period, limit })}`),
  pendingReasons: (period: PeriodType) => get(`/premium-dashboard/pending-reasons?${qs({ period })}`),
  pendingRanked: (period: PeriodType, limit = 8) => get(`/premium-dashboard/pending-ranked?${qs({ period, limit })}`),
  executiveSummary: (period: PeriodType) => get(`/premium-dashboard/executive-summary?${qs({ period })}`),
  exportCsvUrl: () => "/api/metrics/premium-dashboard/export.csv",
  exportTemplateUrl: (period: PeriodType) => `/api/metrics/premium-dashboard/export-template.xls?${qs({ period })}`,
};
```

## Exemplo de página (layout igual, só trocando fonte de dados)

```tsx
const [viewMode, setViewMode] = useState<PeriodType>("monthly");

const kpisQ = useQuery({ queryKey: ["premium-kpis", viewMode], queryFn: () => metricsApi.kpis(viewMode) });
const chartsQ = useQuery({ queryKey: ["premium-charts", viewMode], queryFn: () => metricsApi.charts(viewMode) });
const healthQ = useQuery({ queryKey: ["premium-health", viewMode], queryFn: () => metricsApi.health(viewMode) });
const insightsQ = useQuery({ queryKey: ["premium-insights", viewMode], queryFn: () => metricsApi.insights(viewMode, 6) });
const actionsQ = useQuery({ queryKey: ["premium-actions", viewMode], queryFn: () => metricsApi.actions(viewMode, 5) });
const reasonsQ = useQuery({ queryKey: ["premium-reasons", viewMode], queryFn: () => metricsApi.pendingReasons(viewMode) });
const rankedQ = useQuery({ queryKey: ["premium-ranked", viewMode], queryFn: () => metricsApi.pendingRanked(viewMode, 8) });
const execQ = useQuery({ queryKey: ["premium-exec", viewMode], queryFn: () => metricsApi.executiveSummary(viewMode) });

const isLoading =
  kpisQ.isLoading || chartsQ.isLoading || healthQ.isLoading || insightsQ.isLoading ||
  actionsQ.isLoading || reasonsQ.isLoading || rankedQ.isLoading || execQ.isLoading;

const stats = {
  soldCount: kpisQ.data?.soldCount ?? 0,
  pendingCount: kpisQ.data?.pendingCount ?? 0,
  canceledCount: kpisQ.data?.canceledCount ?? 0,
  totalValue: kpisQ.data?.totalValue ?? 0,
  pendingValue: kpisQ.data?.pendingValue ?? 0,
  avgTicket: kpisQ.data?.avgTicket ?? 0,
  conversionRatePct: kpisQ.data?.conversionRatePct ?? 0,
  chartData: chartsQ.data?.chartData ?? [],
  revenueSpark: chartsQ.data?.revenueSpark ?? [],
  trend: chartsQ.data?.trend ?? { lastPeriodSold: 0, prevPeriodSold: 0 },
  pendingReasons: reasonsQ.data?.pendingReasons ?? [],
  pendingRanked: rankedQ.data?.pendingRanked ?? [],
};

const premium = {
  health: healthQ.data?.health ?? { score: 0, reasons: [] },
  pendingAgingAvg: healthQ.data?.pendingAgingAvg ?? 0,
  recentSoldCount: healthQ.data?.recentSoldCount ?? 0,
  insights: insightsQ.data?.insights ?? [],
  actions: actionsQ.data?.actions ?? [],
  biggestPending: rankedQ.data?.biggestPending,
};

const executive = {
  conversionRatePct: execQ.data?.conversionRatePct ?? 0,
  pendingValue: execQ.data?.pendingValue ?? 0,
  avgTicket: execQ.data?.avgTicket ?? 0,
  risk: execQ.data?.risk ?? "Baixo",
};

const exportToExcelTemplate = (period: PeriodType) => {
  window.open(metricsApi.exportTemplateUrl(period), "_blank", "noopener,noreferrer");
};

const exportToCsv = () => {
  window.open(metricsApi.exportCsvUrl(), "_blank", "noopener,noreferrer");
};
```

## Segurança aplicada nos endpoints

- Todos são autenticados (`router.use(authenticate)`).
- Validação estrita de query params com `zod` (`period`, `limit`).
- `limit` com limites máximos para evitar abuso de payload.
- Dados sempre escopados ao `userId` autenticado.
- CSV retornado com `Content-Type` e `Content-Disposition` corretos.
