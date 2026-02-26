# Estrutura completa da página Premium Dashboard (endpoints conectados)

Este guia mostra **como conectar a página completa** sem mudar o layout visual, usando os endpoints já criados no backend.

## 1) Endpoints que a página usa

Base URL: `/api`

- `GET /metrics/premium-dashboard?period=monthly|weekly`
  - Fonte principal da página (KPIs, gráficos, insights, ações e ranking).
- `GET /metrics/premium-dashboard/export.csv`
  - Download do CSV Power BI (substitui geração de CSV no frontend).
- `GET /auth/me`
  - Opcional para validar sessão/logado.
- `GET /proposals`
  - Opcional se você quiser dados brutos para debug/telas auxiliares.

## 2) Contrato de resposta esperado para o dashboard

O endpoint `GET /metrics/premium-dashboard` retorna:

- `period`
- `generatedAt`
- `soldCount`
- `pendingCount`
- `canceledCount`
- `totalValue`
- `pendingValue`
- `avgTicket`
- `conversionRatePct`
- `chartData[]`
- `revenueSpark[]`
- `pendingReasons[]`
- `pendingRanked[]`
- `trend`
- `health`
- `insights[]`
- `actions[]`
- `pendingAgingAvg`
- `recentSoldCount`
- `biggestPending`

## 3) Estrutura da página React (wire-up completo)

> Abaixo está um exemplo de integração mantendo o layout e trocando apenas a fonte de dados local por API.

```tsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

type PeriodType = "monthly" | "weekly";

async function getPremiumDashboard(period: PeriodType) {
  const res = await fetch(`/api/metrics/premium-dashboard?period=${period}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Falha ao carregar dashboard premium");
  }

  return res.json();
}

export default function PremiumDashboardPage() {
  const [viewMode, setViewMode] = useState<PeriodType>("monthly");

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["premium-dashboard", viewMode],
    queryFn: () => getPremiumDashboard(viewMode),
  });

  const exportToExcel = () => {
    const url = "/api/metrics/premium-dashboard/export.csv";

    // opção 1: abrir direto
    window.open(url, "_blank", "noopener,noreferrer");

    // opção 2 (se quiser controlar erros): fetch + blob
    // (mantido comentado para não alterar UX atual)
  };

  const stats = useMemo(() => {
    return {
      soldCount: data?.soldCount ?? 0,
      pendingCount: data?.pendingCount ?? 0,
      canceledCount: data?.canceledCount ?? 0,
      totalValue: data?.totalValue ?? 0,
      pendingValue: data?.pendingValue ?? 0,
      avgTicket: data?.avgTicket ?? 0,
      conversionRatePct: data?.conversionRatePct ?? 0,
      chartData: data?.chartData ?? [],
      pendingReasons: data?.pendingReasons ?? [],
      pendingRanked: data?.pendingRanked ?? [],
      trend: data?.trend ?? { lastPeriodSold: 0, prevPeriodSold: 0 },
      revenueSpark: data?.revenueSpark ?? [],
    };
  }, [data]);

  const premium = useMemo(() => {
    return {
      health: data?.health ?? { score: 0, reasons: [] },
      insights: data?.insights ?? [],
      actions: data?.actions ?? [],
      pendingAgingAvg: data?.pendingAgingAvg ?? 0,
      recentSoldCount: data?.recentSoldCount ?? 0,
      biggestPending: data?.biggestPending,
    };
  }, [data]);

  if (isLoading) {
    return <div>Carregando...</div>;
  }

  return (
    <>
      {/* Seu layout atual permanece igual */}
      {/* Toggle mensal/semanal */}
      <button onClick={() => setViewMode("monthly")}>Mensal</button>
      <button onClick={() => setViewMode("weekly")}>Semanal</button>

      {/* Export */}
      <button onClick={exportToExcel}>Exportar Power BI</button>

      {/* Usa stats e premium exatamente como seu layout já usa hoje */}
      <pre>{JSON.stringify({ stats, premium, isFetching }, null, 2)}</pre>
      <button onClick={() => refetch().then(() => toast.success("Dados atualizados"))}>
        Atualizar dados
      </button>
    </>
  );
}
```

## 4) Mapeamento por bloco visual da página

- Header + Toggle período
  - usa `viewMode` e refetch automático do query key.
- KPIs (cards)
  - `soldCount`, `pendingCount`, `totalValue`, `avgTicket`, `conversionRatePct`, `pendingValue`.
- Gráfico de barras e sparkline
  - `chartData`, `revenueSpark`.
- Pizza de motivos
  - `pendingReasons`.
- Health Score
  - `health.score`, `health.reasons`, `pendingAgingAvg`, `recentSoldCount`.
- Insights
  - `insights[]`.
- Next Actions
  - `actions[]`.
- Top pendências
  - `pendingRanked[]`, `biggestPending`.
- Export botão
  - `GET /metrics/premium-dashboard/export.csv`.

## 5) Checklist de conexão final

1. Trocar o cálculo local pesado por `useQuery(["premium-dashboard", period])`.
2. Usar os campos da resposta para preencher os mesmos componentes visuais.
3. Trocar função local de exportação por download de `/api/metrics/premium-dashboard/export.csv`.
4. Manter tratamento de erro (`401`, `400`, `500`) via toast/mensagem de fallback.
