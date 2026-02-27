# Export Excel premium (.xlsx) — integração frontend

## Exemplo de chamada no frontend (fetch + blob)

```ts
export async function downloadPremiumDashboardTemplate(period: "monthly" | "weekly") {
  const response = await fetch(`/api/metrics/premium-dashboard/export-template.xlsx?period=${period}`, {
    method: "GET",
    credentials: "include", // importante para auth por cookie
    headers: {
      Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }
  });

  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.includes("spreadsheetml.sheet")) {
    let message = "Falha ao exportar planilha.";
    try {
      const body = await response.json();
      if (body?.message) message = body.message;
    } catch {
      // resposta não-JSON
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `premium-dashboard-${period}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

## Observações de deploy (Windows/Linux + venv Python)

- O backend chama o script `scripts/generate_premium_dashboard_excel.py` via `python3` (fallback `python`).
- Em produção, instale dependências Python no host/container:
  - `openpyxl`
- Você pode definir binário explícito com `PYTHON_BIN`:
  - Linux: `PYTHON_BIN=/opt/venv/bin/python`
  - Windows: `PYTHON_BIN=C:\\venv\\Scripts\\python.exe`
- Garanta que a pasta `scripts/` esteja presente no artefato de deploy.
- Se o Python falhar, API retorna `500 { message: "Falha ao gerar planilha premium." }`.
