import type { DeckDocument, SceneElement, SlideArchetype, SlideDocument } from "../../deck-model/src/index.js";

export interface SlideSearchContext {
  approvedSlideIds?: Iterable<string>;
  tagsBySlideId?: Record<string, string[]>;
}

export interface SlideSearchFilters {
  archetypes?: SlideArchetype[];
  sectionIds?: string[];
  approved?: boolean;
  hasMedia?: boolean;
  hasChart?: boolean;
  hasTable?: boolean;
  claimIds?: string[];
  evidenceRefs?: string[];
}

export interface SlideSearchDocument {
  slideId: string;
  order: number;
  title: string;
  archetype: SlideArchetype;
  sectionId?: string;
  approved: boolean;
  tags: string[];
  claimIds: string[];
  evidenceRefs: string[];
  hasMedia: boolean;
  hasChart: boolean;
  hasTable: boolean;
  fields: {
    title: string;
    takeaway: string;
    question: string;
    purpose: string;
    narrative: string;
    text: string;
    archetype: string;
    tags: string;
    claims: string;
    evidence: string;
  };
  tokensByField: Record<string, string[]>;
}

export interface SlideSearchIndex {
  schemaVersion: "0.1";
  deckId: string;
  documents: SlideSearchDocument[];
  documentFrequency: Record<string, number>;
}

export interface SlideSearchReason {
  field: string;
  contribution: number;
  detail: string;
}

export interface SlideSearchResult {
  slideId: string;
  order: number;
  title: string;
  archetype: SlideArchetype;
  score: number;
  approved: boolean;
  takeaway: string;
  reasons: SlideSearchReason[];
}

const FIELD_WEIGHTS: Record<string, number> = {
  title: 6,
  takeaway: 5,
  question: 3.5,
  purpose: 2.5,
  narrative: 2.25,
  text: 1.5,
  archetype: 1.25,
  tags: 2,
  claims: 1,
  evidence: 1,
};

export function normalizeSearchText(value: unknown): string {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function tokenizeSearchText(value: unknown): string[] {
  return normalizeSearchText(value).match(/[\p{L}\p{N}]+/gu) ?? [];
}

function textFromElement(element: SceneElement): string[] {
  if (element.type === "text") return element.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.text));
  if (element.type === "table") return element.rows.flatMap((row) => row.map((cell) => cell.text));
  if (element.type === "chart") return [element.chart.insightStatement, ...(element.chart.categories ?? []), ...element.chart.series.map((series) => series.name)];
  if (element.type === "diagram") return [...element.nodes.map((node) => node.label), ...element.edges.map((edge) => edge.label ?? "")];
  return [];
}

function unique(values: Iterable<string>): string[] { return [...new Set([...values].filter(Boolean))]; }

function documentFromSlide(slide: SlideDocument, approved: Set<string>, tags: string[]): SlideSearchDocument {
  const fields = {
    title: slide.title,
    takeaway: slide.semantic.takeaway,
    question: slide.semantic.questionAnswered,
    purpose: slide.semantic.purpose,
    narrative: slide.semantic.narrativeRole,
    text: slide.scene.flatMap(textFromElement).join(" "),
    archetype: slide.archetype,
    tags: tags.join(" "),
    claims: slide.semantic.claimIds.join(" "),
    evidence: slide.semantic.evidenceRefs.join(" "),
  };
  return {
    slideId: slide.id,
    order: slide.order,
    title: slide.title,
    archetype: slide.archetype,
    sectionId: slide.sectionId,
    approved: approved.has(slide.id),
    tags: unique(tags.map(normalizeSearchText)),
    claimIds: unique(slide.semantic.claimIds),
    evidenceRefs: unique(slide.semantic.evidenceRefs),
    hasMedia: slide.scene.some((element) => element.type === "image" || element.type === "video" || element.type === "icon"),
    hasChart: slide.scene.some((element) => element.type === "chart"),
    hasTable: slide.scene.some((element) => element.type === "table"),
    fields,
    tokensByField: Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, tokenizeSearchText(value)])),
  };
}

export function buildSlideSearchIndex(deck: DeckDocument, context: SlideSearchContext = {}): SlideSearchIndex {
  const approved = new Set(context.approvedSlideIds ?? []);
  const documents = [...deck.slides].sort((a, b) => a.order - b.order).map((slide) => documentFromSlide(slide, approved, context.tagsBySlideId?.[slide.id] ?? []));
  const df = new Map<string, number>();
  for (const document of documents) {
    const terms = new Set(Object.values(document.tokensByField).flat());
    for (const term of terms) df.set(term, (df.get(term) ?? 0) + 1);
  }
  return { schemaVersion: "0.1", deckId: deck.id, documents, documentFrequency: Object.fromEntries([...df.entries()].sort(([a], [b]) => a.localeCompare(b))) };
}

function intersects(values: string[], required: string[] | undefined): boolean {
  if (!required?.length) return true;
  const set = new Set(values);
  return required.some((value) => set.has(value));
}

function matchesFilters(document: SlideSearchDocument, filters: SlideSearchFilters): boolean {
  if (filters.archetypes?.length && !filters.archetypes.includes(document.archetype)) return false;
  if (filters.sectionIds?.length && (!document.sectionId || !filters.sectionIds.includes(document.sectionId))) return false;
  if (filters.approved !== undefined && document.approved !== filters.approved) return false;
  if (filters.hasMedia !== undefined && document.hasMedia !== filters.hasMedia) return false;
  if (filters.hasChart !== undefined && document.hasChart !== filters.hasChart) return false;
  if (filters.hasTable !== undefined && document.hasTable !== filters.hasTable) return false;
  if (!intersects(document.claimIds, filters.claimIds)) return false;
  if (!intersects(document.evidenceRefs, filters.evidenceRefs)) return false;
  return true;
}

function termFrequency(tokens: string[], query: string): { exact: number; prefix: number } {
  let exact = 0, prefix = 0;
  for (const token of tokens) {
    if (token === query) exact += 1;
    else if (token.startsWith(query) || query.startsWith(token)) prefix += 1;
  }
  return { exact, prefix };
}

function round(value: number): number { return Math.round(value * 1000) / 1000; }

export function searchSlides(index: SlideSearchIndex, query: string, filters: SlideSearchFilters = {}, limit = 20): SlideSearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  const queryTokens = unique(tokenizeSearchText(query));
  if (!normalizedQuery && !Object.keys(filters).length) return index.documents.slice(0, Math.max(0, limit)).map((document) => ({ slideId: document.slideId, order: document.order, title: document.title, archetype: document.archetype, score: 0, approved: document.approved, takeaway: document.fields.takeaway, reasons: [] }));
  const n = Math.max(1, index.documents.length);
  const results: SlideSearchResult[] = [];

  for (const document of index.documents) {
    if (!matchesFilters(document, filters)) continue;
    let score = 0;
    const reasons: SlideSearchReason[] = [];
    for (const [field, tokens] of Object.entries(document.tokensByField)) {
      const weight = FIELD_WEIGHTS[field] ?? 1;
      let fieldScore = 0;
      for (const queryToken of queryTokens) {
        const tf = termFrequency(tokens, queryToken);
        if (!tf.exact && !tf.prefix) continue;
        const df = index.documentFrequency[queryToken] ?? 0;
        const idf = Math.log(1 + (n + 1) / (df + 1));
        fieldScore += weight * idf * (tf.exact + tf.prefix * .42);
      }
      const normalizedField = normalizeSearchText(document.fields[field as keyof typeof document.fields]);
      if (normalizedQuery && normalizedField.includes(normalizedQuery)) {
        const phraseBoost = weight * 2.4;
        fieldScore += phraseBoost;
        reasons.push({ field, contribution: round(phraseBoost), detail: `Phrase match in ${field}` });
      }
      if (fieldScore > 0) {
        score += fieldScore;
        reasons.push({ field, contribution: round(fieldScore), detail: `Term relevance in ${field}` });
      }
    }
    if (!queryTokens.length) score = 1;
    if (document.approved) { score *= 1.08; if (score > 0) reasons.push({ field: "approval", contribution: round(score * .08), detail: "Current approved slide" }); }
    if (score <= 0 && queryTokens.length) continue;
    results.push({ slideId: document.slideId, order: document.order, title: document.title, archetype: document.archetype, score: round(score), approved: document.approved, takeaway: document.fields.takeaway, reasons: reasons.sort((a, b) => b.contribution - a.contribution).slice(0, 6) });
  }

  return results.sort((a, b) => b.score - a.score || Number(b.approved) - Number(a.approved) || a.order - b.order).slice(0, Math.max(0, limit));
}
