import type { DeckDocument, SceneElement } from "../../deck-model/src/index.js";
import type { DeckTheme, DesignCommand, ThemeBindingTarget } from "../../design-system/src/index.js";

export interface TokenBindingSuggestion {
  slideId: string;
  elementId: string;
  target: ThemeBindingTarget;
  token: string;
  currentValue: string | number;
  confidence: number;
  reason: string;
}

function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : undefined;
}

function uniformTextValue(element: Extract<SceneElement, { type: "text" }>, target: "textColor" | "fontFamily" | "fontSizePt"): string | number | undefined {
  const values = element.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => target === "textColor" ? normalizeColor(run.color) : target === "fontFamily" ? run.fontFamily?.trim() : run.fontSizePt));
  const present = values.filter((value): value is string | number => value !== undefined && value !== "");
  if (!present.length) return undefined;
  return present.every((value) => value === present[0]) ? present[0] : undefined;
}

function nearestNumericToken(value: number, tokens: Record<string, number>, tolerance: number): { token: string; confidence: number } | undefined {
  let best: { token: string; delta: number } | undefined;
  for (const [token, candidate] of Object.entries(tokens)) {
    const delta = Math.abs(candidate - value);
    if (!best || delta < best.delta) best = { token, delta };
  }
  if (!best || best.delta > tolerance) return undefined;
  return { token: best.token, confidence: best.delta === 0 ? 1 : Math.max(.6, 1 - best.delta / Math.max(1, tolerance * 2)) };
}

function colorToken(value: string, tokens: Record<string, string>): string | undefined {
  const normalized = normalizeColor(value);
  if (!normalized) return undefined;
  return Object.entries(tokens).find(([, candidate]) => normalizeColor(candidate) === normalized)?.[0];
}

function fontToken(value: string, tokens: Record<string, string>): string | undefined {
  const normalized = value.trim().toLowerCase();
  return Object.entries(tokens).find(([, candidate]) => candidate.trim().toLowerCase() === normalized)?.[0];
}

export function inferTokenBindings(deck: DeckDocument, theme: DeckTheme): TokenBindingSuggestion[] {
  const suggestions: TokenBindingSuggestion[] = [];
  for (const slide of deck.slides) for (const element of slide.scene) {
    const bindings = (element as any).tokenBindings ?? {};
    if ((element.type === "shape" || element.type === "frame") && element.fill && !bindings.fill) {
      const token = colorToken(element.fill, theme.colors);
      if (token) suggestions.push({ slideId: slide.id, elementId: element.id, target: "fill", token, currentValue: element.fill, confidence: 1, reason: `Exact fill match to color token ${token}` });
    }
    if ((element.type === "shape" || element.type === "line" || element.type === "frame") && element.stroke?.color && !bindings.strokeColor) {
      const token = colorToken(element.stroke.color, theme.colors);
      if (token) suggestions.push({ slideId: slide.id, elementId: element.id, target: "strokeColor", token, currentValue: element.stroke.color, confidence: 1, reason: `Exact stroke match to color token ${token}` });
    }
    if (element.type === "text") {
      const currentColor = uniformTextValue(element, "textColor");
      if (typeof currentColor === "string" && !bindings.textColor) {
        const token = colorToken(currentColor, theme.colors);
        if (token) suggestions.push({ slideId: slide.id, elementId: element.id, target: "textColor", token, currentValue: currentColor, confidence: 1, reason: `Uniform text color matches token ${token}` });
      }
      const currentFont = uniformTextValue(element, "fontFamily");
      if (typeof currentFont === "string" && !bindings.fontFamily) {
        const token = fontToken(currentFont, theme.fonts);
        if (token) suggestions.push({ slideId: slide.id, elementId: element.id, target: "fontFamily", token, currentValue: currentFont, confidence: 1, reason: `Uniform font family matches token ${token}` });
      }
      const currentSize = uniformTextValue(element, "fontSizePt");
      if (typeof currentSize === "number" && !bindings.fontSizePt) {
        const match = nearestNumericToken(currentSize, theme.typeScalePt, .5);
        if (match) suggestions.push({ slideId: slide.id, elementId: element.id, target: "fontSizePt", token: match.token, currentValue: currentSize, confidence: match.confidence, reason: match.confidence === 1 ? `Exact type scale match to ${match.token}` : `Font size is within 0.5pt of ${match.token}` });
      }
    }
  }
  return suggestions.sort((a, b) => b.confidence - a.confidence || a.slideId.localeCompare(b.slideId) || a.elementId.localeCompare(b.elementId) || a.target.localeCompare(b.target));
}

export function bindingCommandsFromSuggestions(suggestions: TokenBindingSuggestion[], minConfidence = .99): DesignCommand[] {
  const groups = new Map<string, { slideId: string; target: ThemeBindingTarget; token: string; elementIds: string[] }>();
  for (const suggestion of suggestions) {
    if (suggestion.confidence < minConfidence) continue;
    const key = `${suggestion.slideId}:${suggestion.target}:${suggestion.token}`;
    const group = groups.get(key) ?? { slideId: suggestion.slideId, target: suggestion.target, token: suggestion.token, elementIds: [] };
    group.elementIds.push(suggestion.elementId);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({ command: "bindToken", slideId: group.slideId, elementIds: [...new Set(group.elementIds)], target: group.target, token: group.token }));
}
