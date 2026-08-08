import type { DeckDocument } from "../../deck-model/src/index.js";
import { bindingCommandsFromSuggestions, inferTokenBindings, type TokenBindingSuggestion } from "../../design-system-inference/src/index.js";
import type { DesignCommand, ThemedDeckDocument } from "../../design-system/src/index.js";

export interface CreativeSafeFixPlan {
  schemaVersion: "0.1";
  kind: "exact-theme-bindings";
  safe: true;
  commandCount: number;
  suggestionCount: number;
  affectedSlideIds: string[];
  affectedElementIds: string[];
  suggestions: TokenBindingSuggestion[];
  commands: DesignCommand[];
  rationale: string;
}

export function buildCreativeSafeFixPlan(deck: DeckDocument): CreativeSafeFixPlan {
  const theme = (deck as ThemedDeckDocument).theme;
  if (!theme) {
    return {
      schemaVersion: "0.1",
      kind: "exact-theme-bindings",
      safe: true,
      commandCount: 0,
      suggestionCount: 0,
      affectedSlideIds: [],
      affectedElementIds: [],
      suggestions: [],
      commands: [],
      rationale: "No live deck theme exists, so the Creative Director will not infer or materialize token bindings automatically.",
    };
  }
  const suggestions = inferTokenBindings(deck, theme).filter((suggestion) => suggestion.confidence === 1);
  const commands = bindingCommandsFromSuggestions(suggestions, 1);
  return {
    schemaVersion: "0.1",
    kind: "exact-theme-bindings",
    safe: true,
    commandCount: commands.length,
    suggestionCount: suggestions.length,
    affectedSlideIds: [...new Set(suggestions.map((suggestion) => suggestion.slideId))],
    affectedElementIds: [...new Set(suggestions.map((suggestion) => suggestion.elementId))],
    suggestions,
    commands,
    rationale: "Only exact existing materialized values are bound to equal live theme tokens. The visible result is unchanged; future token propagation and Brand QA improve.",
  };
}
