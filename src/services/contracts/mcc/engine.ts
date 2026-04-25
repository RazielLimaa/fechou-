import crypto from "crypto";
import {
  MCC_CLAUSE_CATALOG,
  MCC_CLAUSE_DEPENDENCIES,
  MCC_CLAUSE_RULES,
  MCC_CLAUSE_VARIANTS,
} from "./catalog.js";
import { ClauseCompositionEngine } from "./clause-composition-engine.js";
import { ContextEngine } from "./context-engine.js";
import type { ClauseCatalog, ClauseDependency, ClauseRule, ClauseVariant, ContractDraft, MccIntakeInput, MccRunResult } from "./domain.js";
import { EvidenceEngine } from "./evidence-engine.js";
import { RiskEngine } from "./risk-engine.js";
import { ScoreEngine } from "./score-engine.js";
import { ValidationEngine } from "./validation-engine.js";

export interface ContractModelingEngineConfig {
  catalog?: ClauseCatalog[];
  variants?: ClauseVariant[];
  dependencies?: ClauseDependency[];
  rules?: ClauseRule[];
}

function hashJson(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

export class ContractModelingEngine {
  private readonly contextEngine = new ContextEngine();
  private readonly riskEngine = new RiskEngine();
  private readonly evidenceEngine = new EvidenceEngine();
  private readonly compositionEngine = new ClauseCompositionEngine();
  private readonly validationEngine = new ValidationEngine();
  private readonly scoreEngine = new ScoreEngine();

  private readonly catalog: ClauseCatalog[];
  private readonly variants: ClauseVariant[];
  private readonly dependencies: ClauseDependency[];
  private readonly rules: ClauseRule[];

  constructor(config: ContractModelingEngineConfig = {}) {
    this.catalog = config.catalog ?? MCC_CLAUSE_CATALOG;
    this.variants = config.variants ?? MCC_CLAUSE_VARIANTS;
    this.dependencies = config.dependencies ?? MCC_CLAUSE_DEPENDENCIES;
    this.rules = config.rules ?? MCC_CLAUSE_RULES;
  }

  model(input: MccIntakeInput): MccRunResult {
    const contextResult = this.contextEngine.interpret(input);
    const initialRisk = this.riskEngine.assess(contextResult.context);
    const evidence = this.evidenceEngine.recommend(contextResult.context, initialRisk.riskProfile);
    const composition = this.compositionEngine.compose(
      contextResult.context,
      this.catalog,
      this.variants,
      this.dependencies,
      this.rules,
      evidence.evidenceProfile,
      this.evidenceEngine.applyPatch.bind(this.evidenceEngine),
    );
    const validation = this.validationEngine.validate(
      contextResult.context,
      composition.clauses,
      composition.evidenceProfile,
      composition.seededIssues,
    );
    const finalRisk = this.riskEngine.assess(contextResult.context, composition.risks, validation.issues);
    const score = this.scoreEngine.score(contextResult.context, composition.clauses, validation.issues, composition.evidenceProfile);
    const now = nowIso();
    const snapshot = {
      id: `snapshot.${input.contractId ?? "draft"}.${Date.now()}`,
      contractId: input.contractId,
      version: 1,
      renderedHash: hashJson(composition.clauses),
      contextHash: hashJson(contextResult.context),
      graphHash: hashJson(composition.graph),
      scoreHash: hashJson(score.score),
      createdAt: now,
    };

    const draft: ContractDraft = {
      id: `draft.${input.contractId ?? "new"}.${Date.now()}`,
      contractId: input.contractId,
      status: "modeled",
      context: contextResult.context,
      clauses: composition.clauses,
      graph: composition.graph,
      riskProfile: finalRisk.riskProfile,
      validationIssues: validation.issues,
      score: score.score,
      evidenceProfile: composition.evidenceProfile,
      decisions: [
        ...contextResult.decisions,
        ...initialRisk.decisions,
        ...evidence.decisions,
        ...composition.decisions,
        ...validation.decisions,
        ...finalRisk.decisions,
        ...score.decisions,
      ],
      snapshot,
      audit: { createdAt: now, updatedAt: now, version: 1 },
    };

    const blockers = validation.issues.filter((item) => item.blocking).length;
    const warnings = validation.issues.filter((item) => item.severity === "warning").length;

    return {
      draft,
      summary: {
        classification: `${contextResult.context.contractKind}/${contextResult.context.relationshipKind}/${contextResult.context.amountBand}`,
        blockers,
        warnings,
        suggestedActions: validation.issues.slice(0, 5).map((item) => item.recommendation),
      },
    };
  }
}

export const contractModelingEngine = new ContractModelingEngine();
