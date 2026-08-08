import { normalizeSearchText, tokenizeSearchText } from "../../slide-search/src/index.js";
import type { SceneElement } from "../../deck-model/src/index.js";
import type { SlideLibraryItem } from "./index.js";

export interface SlideLibrarySearchFilters {
  tags?: string[];
  archetypes?: string[];
  claimIds?: string[];
  evidenceRefs?: string[];
  hasAssets?: boolean;
  sourceDeckId?: string;
}

export interface SlideLibrarySearchResult {
  itemId: string;
  title: string;
  score: number;
  tags: string[];
  archetype: string;
  sourceDeckId: string;
  sourceSlideId: string;
  takeaway: string;
  reasons: string[];
}

function elementText(element: SceneElement): string[] {
  if (element.type === "text") return element.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.text));
  if (element.type === "table") return element.rows.flatMap((row) => row.map((cell) => cell.text));
  if (element.type === "chart") return [element.chart.insightStatement, ...(element.chart.categories ?? []), ...element.chart.series.map((series) => series.name)];
  if (element.type === "diagram") return [...element.nodes.map((node) => node.label), ...element.edges.map((edge) => edge.label ?? "")];
  return [];
}
function contains(values: string[], required: string[] | undefined): boolean {
  if (!required?.length) return true;
  const set = new Set(values.map(normalizeSearchText));
  return required.some((value) => set.has(normalizeSearchText(value)));
}
function matches(item: SlideLibraryItem, filters: SlideLibrarySearchFilters): boolean {
  if (filters.tags?.length && !contains(item.tags, filters.tags)) return false;
  if (filters.archetypes?.length && !filters.archetypes.includes(item.slide.archetype)) return false;
  if (filters.claimIds?.length && !contains(item.claimIds, filters.claimIds)) return false;
  if (filters.evidenceRefs?.length && !contains(item.evidenceRefs, filters.evidenceRefs)) return false;
  if (filters.hasAssets !== undefined && Boolean(item.assetIds.length) !== filters.hasAssets) return false;
  if (filters.sourceDeckId && item.source.deckId !== filters.sourceDeckId) return false;
  return true;
}
function occurrences(tokens: string[], query: string): number {
  return tokens.reduce((sum, token) => sum + (token === query ? 1 : token.startsWith(query) || query.startsWith(token) ? .35 : 0), 0);
}
function round(value: number) { return Math.round(value * 1000) / 1000; }

export function searchSlideLibrary(items: SlideLibraryItem[], query: string, filters: SlideLibrarySearchFilters = {}, limit = 30): SlideLibrarySearchResult[] {
  const normalized = normalizeSearchText(query);
  const queryTokens = [...new Set(tokenizeSearchText(query))];
  const results: SlideLibrarySearchResult[] = [];
  for (const item of items) {
    if (!matches(item, filters)) continue;
    const fields = [
      { name: "title", value: item.title, weight: 6 },
      { name: "takeaway", value: item.slide.semantic.takeaway, weight: 5 },
      { name: "description", value: item.description ?? "", weight: 3 },
      { name: "tags", value: item.tags.join(" "), weight: 2.5 },
      { name: "text", value: item.slide.scene.flatMap(elementText).join(" "), weight: 1.5 },
      { name: "archetype", value: item.slide.archetype, weight: 1.2 },
      { name: "claims", value: item.claimIds.join(" "), weight: 1 },
      { name: "evidence", value: item.evidenceRefs.join(" "), weight: 1 },
    ];
    let score = 0;
    const reasons: string[] = [];
    for (const field of fields) {
      const text = normalizeSearchText(field.value);
      const tokens = tokenizeSearchText(field.value);
      let fieldScore = queryTokens.reduce((sum, token) => sum + occurrences(tokens, token) * field.weight, 0);
      if (normalized && text.includes(normalized)) { fieldScore += field.weight * 2.5; reasons.push(`phrase:${field.name}`); }
      if (fieldScore > 0) { score += fieldScore; reasons.push(`match:${field.name}`); }
    }
    if (!queryTokens.length) score = 1;
    if (score <= 0 && queryTokens.length) continue;
    results.push({ itemId: item.id, title: item.title, score: round(score), tags: [...item.tags], archetype: item.slide.archetype, sourceDeckId: item.source.deckId, sourceSlideId: item.source.slideId, takeaway: item.slide.semantic.takeaway, reasons: [...new Set(reasons)] });
  }
  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, Math.max(0, limit));
}
