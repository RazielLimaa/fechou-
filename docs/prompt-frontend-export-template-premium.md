# Prompt para implementar no frontend (exportação de template premium)

Use este prompt em uma IA/copilot do frontend:

```text
Contexto:
- O backend já possui o endpoint autenticado `GET /api/metrics/premium-dashboard/export-template.xlsx?period=monthly|weekly`.
- Esse endpoint retorna uma planilha template (Excel compatível) preenchida com os mesmos dados do dashboard premium do usuário autenticado.
- Também existe `GET /api/metrics/premium-dashboard/export.csv` para BI.

Tarefa:
1) Adicionar na camada de API do frontend:
   - `exportTemplateUrl(period: "monthly" | "weekly")`
   - manter `exportCsvUrl()`.

2) Na tela do dashboard premium:
   - adicionar um botão: "Baixar template (Excel)".
   - ao clicar, abrir `window.open(metricsApi.exportTemplateUrl(viewMode), "_blank", "noopener,noreferrer")`.
   - manter botão de CSV separado (ex.: "Exportar CSV (BI)").

3) UX/estado:
   - desabilitar botão de exportação se usuário não estiver autenticado.
   - mostrar feedback de erro amigável para status 400/401/403.
   - preservar o `viewMode` atual (monthly/weekly) ao exportar template.

4) Regras importantes:
   - não fazer parse do arquivo no frontend; apenas iniciar download.
   - não enviar token por querystring; usar o mesmo mecanismo de autenticação já usado na aplicação (cookie/httpOnly ou header padrão do app).
   - não quebrar contratos existentes dos endpoints premium.

5) Critérios de aceite:
   - botão de template baixa arquivo `.xlsx` com sucesso.
   - dados exportados mudam conforme usuário logado.
   - dados exportados respeitam `viewMode` selecionado.
   - botão CSV continua funcionando normalmente.

Entrega esperada:
- diff dos arquivos alterados (api client, página premium e componentes de ação/header).
- breve checklist de teste manual com evidência dos cenários acima.
```
