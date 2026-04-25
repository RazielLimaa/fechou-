import type { MccIntakeInput } from "./domain.js";
import { ContractModelingEngine } from "./engine.js";

export const highValueB2BSaasExample: MccIntakeInput = {
  contractId: "contract-demo-001",
  contractName: "Contrato SaaS B2B com dados pessoais",
  contractKindHint: "saas",
  relationshipKindHint: "b2b",
  amount: { amountCents: 150_000_00, currency: "BRL" },
  recurringBilling: true,
  hasDeliverables: true,
  hasPersonalData: true,
  hasSensitiveData: false,
  handlesIntellectualProperty: true,
  ipMode: "license",
  executiveTitlePriority: true,
  arbitrationRequested: false,
  parties: [
    { role: "provider", documentType: "cnpj", isBusiness: true, isConsumer: false, isAdherent: false },
    { role: "customer", documentType: "cnpj", isBusiness: true, isConsumer: false, isAdherent: false },
  ],
};

export const adhesionB2CExample: MccIntakeInput = {
  contractId: "contract-demo-002",
  contractName: "Contrato digital de servico ao consumidor",
  contractKindHint: "service_agreement",
  relationshipKindHint: "b2c",
  isAdhesion: true,
  amount: { amountCents: 120_000, currency: "BRL" },
  hasDeliverables: true,
  hasPersonalData: true,
  arbitrationRequested: true,
  parties: [
    { role: "provider", documentType: "cnpj", isBusiness: true, isConsumer: false, isAdherent: false },
    { role: "customer", documentType: "cpf", isBusiness: false, isConsumer: true, isAdherent: true },
  ],
};

export function runMccExamples() {
  const engine = new ContractModelingEngine();
  return {
    highValueB2BSaas: engine.model(highValueB2BSaasExample),
    adhesionB2C: engine.model(adhesionB2CExample),
  };
}
