import { randomUUID } from "node:crypto";
import type { DeckDocument, SceneElement, SlideDocument } from "../../deck-model/src/index.js";
import { reviewApprovalViews, slideReviewFingerprint, type ReviewDocument } from "../../review-engine/src/index.js";

export interface SlideLibraryItem {
  schemaVersion: "0.1";
  id: string;
  createdAt: string;
  title: string;
  description?: string;
  tags: string[];
  source: {
    deckId: string;
    slideId: string;
    activeBranchId: string;
    slideFingerprint: string;
    approvedAt?: string;
    approvedBy?: { kind: string; id?: string; displayName: string };
  };
  slide: SlideDocument;
  assetIds: string[];
  fontFamilies: string[];
  claimIds: string[];
  evidenceRefs: string[];
  componentIds: string[];
  masterIds: string[];
}

export interface CreateSlideLibraryItemOptions {
  id?: string;
  title?: string;
  description?: string;
  tags?: string[];
  requireCurrentApproval?: boolean;
}

export interface InstantiateSlideLibraryItemOptions {
  toIndex?: number;
  title?: string;
  reuseMode?: "detached" | "preserveSystems";
}

export interface InstantiateSlideLibraryResult {
  deck: DeckDocument;
  slideId: string;
  elementIdMap: Record<string, string>;
  detachedSystemTags: number;
}

const SYSTEM_TAG_PREFIXES = [
  "component:",
  "component-def:",
  "component-source:",
  "slide-master:",
  "slide-master-source:",
  "slide-master-instance:",
  "slide-placeholder:",
];

function unique(values: Iterable<string>): string[] { return [...new Set([...values].filter(Boolean))].sort(); }
function cleanTag(value: string): string { return value.trim().replace(/\s+/g, " "); }
function systemTag(value: string): boolean { return SYSTEM_TAG_PREFIXES.some((prefix) => value.startsWith(prefix)); }
function tagValue(element: SceneElement, prefix: string): string | undefined { return element.tags?.find((tag) => tag.startsWith(prefix))?.slice(prefix.length); }

function assets(slide: SlideDocument): string[] {
  const result: string[] = [];
  for (const element of slide.scene) {
    if (element.type === "image" || element.type === "icon" || element.type === "video") result.push(element.assetId);
    if (element.type === "video" && element.posterAssetId) result.push(element.posterAssetId);
    for (const dependency of element.dependencies) if (dependency.kind === "asset") result.push(dependency.id);
  }
  return unique(result);
}
function fonts(slide: SlideDocument): string[] {
  const values: string[] = [];
  for (const element of slide.scene) if (element.type === "text") for (const paragraph of element.paragraphs) for (const run of paragraph.runs) if (run.fontFamily) values.push(run.fontFamily.trim());
  return unique(values);
}
function components(slide: SlideDocument): string[] {
  return unique(slide.scene.flatMap((element) => [tagValue(element, "component-def:"), tagValue(element, "component:")].filter((value): value is string => Boolean(value))));
}
function masters(slide: SlideDocument): string[] { return unique(slide.scene.map((element) => tagValue(element, "slide-master:")).filter((value): value is string => Boolean(value))); }

export function currentSlideApproval(deck: DeckDocument, review: ReviewDocument, slideId: string) {
  return reviewApprovalViews(deck, review).find((approval) => approval.scope === "slide" && approval.slideId === slideId && approval.state === "current");
}

export function createSlideLibraryItem(deck: DeckDocument, review: ReviewDocument, slideId: string, options: CreateSlideLibraryItemOptions = {}): SlideLibraryItem {
  const slide = deck.slides.find((item) => item.id === slideId);
  if (!slide) throw new Error(`Unknown slide ${slideId}`);
  const approval = currentSlideApproval(deck, review, slideId);
  if (options.requireCurrentApproval !== false && !approval) throw new Error(`Slide ${slideId} must have a current human approval before publishing to the reusable library`);
  const id = options.id?.trim() || `slide_library_${randomUUID()}`;
  if (!id) throw new Error("Library item id is required");
  const tags = unique((options.tags ?? []).map(cleanTag));
  return {
    schemaVersion: "0.1",
    id,
    createdAt: new Date().toISOString(),
    title: options.title?.trim() || slide.title,
    description: options.description?.trim() || undefined,
    tags,
    source: {
      deckId: deck.id,
      slideId: slide.id,
      activeBranchId: deck.activeBranchId,
      slideFingerprint: slideReviewFingerprint(slide),
      approvedAt: approval?.approvedAt,
      approvedBy: approval ? structuredClone(approval.approvedBy) : undefined,
    },
    slide: structuredClone(slide),
    assetIds: assets(slide),
    fontFamilies: fonts(slide),
    claimIds: unique(slide.semantic.claimIds),
    evidenceRefs: unique(slide.semantic.evidenceRefs),
    componentIds: components(slide),
    masterIds: masters(slide),
  };
}

function remapElement(element: SceneElement, idMap: Map<string, string>, reuseMode: "detached" | "preserveSystems"): { element: SceneElement; detached: number } {
  const next: any = structuredClone(element);
  next.id = idMap.get(element.id)!;
  if (next.groupId) next.groupId = idMap.get(next.groupId) ?? undefined;
  if (next.type === "frame" || next.type === "group") next.childIds = next.childIds.map((id: string) => idMap.get(id) ?? id);
  let detached = 0;
  if (reuseMode === "detached" && Array.isArray(next.tags)) {
    const before = next.tags.length;
    next.tags = next.tags.filter((tag: string) => !systemTag(tag));
    detached = before - next.tags.length;
    if (!next.tags.length) next.tags = undefined;
  }
  return { element: next as SceneElement, detached };
}

export function instantiateSlideLibraryItem(deck: DeckDocument, item: SlideLibraryItem, options: InstantiateSlideLibraryItemOptions = {}): InstantiateSlideLibraryResult {
  if (item.schemaVersion !== "0.1") throw new Error(`Unsupported library item schema ${item.schemaVersion}`);
  const reuseMode = options.reuseMode ?? "detached";
  const slideId = `slide_${randomUUID()}`;
  const idMap = new Map(item.slide.scene.map((element) => [element.id, `element_${randomUUID()}`]));
  let detachedSystemTags = 0;
  const scene = item.slide.scene.map((element) => {
    const result = remapElement(element, idMap, reuseMode);
    detachedSystemTags += result.detached;
    return result.element;
  });
  const nextSlide: SlideDocument = {
    ...structuredClone(item.slide),
    id: slideId,
    order: 0,
    title: options.title?.trim() || item.slide.title,
    scene,
    status: "draft",
    qaIssueIds: [],
  };
  const target = Math.max(0, Math.min(deck.slides.length, options.toIndex ?? deck.slides.length));
  const slides = [...deck.slides]; slides.splice(target, 0, nextSlide);
  const ordered = slides.map((slide, order) => ({ ...slide, order }));
  return {
    deck: { ...deck, slides: ordered, updatedAt: new Date().toISOString() },
    slideId,
    elementIdMap: Object.fromEntries(idMap.entries()),
    detachedSystemTags,
  };
}
