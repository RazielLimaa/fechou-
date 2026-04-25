export interface ContractLayoutSeed {
  clientName?: string;
  contractType?: string;
  contractValue?: string | number;
  paymentMethod?: string;
  serviceScope?: string;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneLayoutValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneLayoutValue(item));
  }

  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, cloneLayoutValue(nestedValue)])
    );
  }

  return value;
}

export function mergeContractLayoutConfig(
  baseInput?: Record<string, unknown> | null,
  patchInput?: Record<string, unknown> | null
) {
  const base = isPlainRecord(baseInput) ? baseInput : {};
  const patch = isPlainRecord(patchInput) ? patchInput : {};
  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    const current = result[key];
    if (isPlainRecord(current) && isPlainRecord(value)) {
      result[key] = mergeContractLayoutConfig(current, value);
      continue;
    }

    result[key] = cloneLayoutValue(value);
  }

  return result;
}

export function toStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

export function buildDefaultContractLayout(seed: ContractLayoutSeed = {}) {
  return {
    appearance: {
      primaryColor: "#ff6600",
      secondaryColor: "#111111",
      paperTint: "#fffaf5",
      fontFamily: "inter",
      fontScale: 1,
      contentWidth: 800,
      borderRadius: 14,
      sectionSpacing: 32,
      showFechouBranding: true,
      showSummaryCards: true,
      showContractNumber: true,
    },
    blocks: {
      hero: {
        visible: true,
        label: "Contrato de servico",
        title: seed.contractType ?? "",
        subtitle: "",
        body: "",
      },
      intro: {
        visible: false,
        title: "Introducao",
        body: "",
      },
      summary: {
        visible: true,
        title: "Resumo do contrato",
        body: "",
      },
      scope: {
        visible: true,
        title: "Escopo de trabalho",
        body: seed.serviceScope ?? "",
      },
      clauses: {
        visible: true,
        title: "Clausulas contratuais",
        body: "",
      },
      signatures: {
        visible: true,
        title: "Assinatura e aceite",
        body: "",
      },
      footer: {
        visible: true,
        leftNote: "",
        rightNote: "",
      },
    },
    blockOrder: ["hero", "intro", "summary", "scope", "clauses", "signatures", "footer"],
    preview: {
      includeClauseIds: [],
      hiddenClauseIds: [],
    },
    customVariables: {},
    contractContext: {
      clientName: seed.clientName ?? "",
      objectSummary: seed.contractType ?? "",
      serviceScope: seed.serviceScope ?? "",
      contractValue: seed.contractValue != null ? String(seed.contractValue) : "",
      paymentTerms: seed.paymentMethod ? `pagamento via ${seed.paymentMethod}` : "",
    },
  };
}
