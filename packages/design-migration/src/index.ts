import type { DeckDocument } from "../../deck-model/src/index.js";
import { brandCoverage, runBrandQA, type BrandCoverage, type BrandQAIssue } from "../../brand-qa/src/index.js";
import { bindingCommandsFromSuggestions, inferTokenBindings, type TokenBindingSuggestion } from "../../design-system-inference/src/index.js";
import { executeDesignCommand, type DeckTheme, type DesignCommand } from "../../design-system/src/index.js";

export interface DesignMigrationPlan {
  themeId: string;
  minimumConfidence: number;
  suggestions: TokenBindingSuggestion[];
  acceptedSuggestions: TokenBindingSuggestion[];
  commands: DesignCommand[];
  before: { coverage: BrandCoverage; issues: BrandQAIssue[] };
  after: { coverage: BrandCoverage; issues: BrandQAIssue[] };
  affectedSlideIds: string[];
  affectedElementIds: string[];
}

export function planDesignMigration(deck: DeckDocument, theme: DeckTheme, minimumConfidence = .99): DesignMigrationPlan {
  if (!Number.isFinite(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 1) throw new Error("minimumConfidence must be between 0 and 1");
  const suggestions = inferTokenBindings(deck, theme);
  const acceptedSuggestions = suggestions.filter((item) => item.confidence >= minimumConfidence);
  const commands = bindingCommandsFromSuggestions(suggestions, minimumConfidence);
  let simulated = structuredClone(deck);
  const affectedSlideIds = new Set<string>();
  const affectedElementIds = new Set<string>();
  if (!(simulated as any).theme) simulated = executeDesignCommand(simulated, { command: "initializeTheme", theme }).deck;
  for (const command of commands) {
    const result = executeDesignCommand(simulated, command);
    simulated = result.deck;
    result.affectedSlideIds.forEach((id) => affectedSlideIds.add(id));
    result.affectedElementIds.forEach((id) => affectedElementIds.add(id));
  }
  return {
    themeId: theme.id,
    minimumConfidence,
    suggestions,
    acceptedSuggestions,
    commands,
    before: { coverage: brandCoverage(deck), issues: runBrandQA(deck, (deck as any).theme ?? theme) },
    after: { coverage: brandCoverage(simulated), issues: runBrandQA(simulated, theme) },
    affectedSlideIds: [...affectedSlideIds],
    affectedElementIds: [...affectedElementIds],
  };
}

export function applyDesignMigration(deck: DeckDocument, plan: DesignMigrationPlan, theme: DeckTheme): DeckDocument {
  if (plan.themeId !== theme.id) throw new Error(`Migration plan expects theme ${plan.themeId}, got ${theme.id}`);
  let next = deck;
  if (!(next as any).theme) next = executeDesignCommand(next, { command: "initializeTheme", theme }).deck;
  for (const command of plan.commands) next = executeDesignCommand(next, command).deck;
  return next;
}
