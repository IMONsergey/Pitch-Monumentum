import type { DeckDocument, SceneElement, SlideDocument } from "../../deck-model/src/index.js";

export interface ScopedObjectReadRequest {
  slideId: string;
  elementIds: string[];
  maxElements?: number;
  maxTextChars?: number;
}

export interface ScopedObjectContext {
  deckId: string;
  slide: {
    id: string;
    order: number;
    title: string;
    archetype: string;
    semantic: SlideDocument["semantic"];
  };
  objects: unknown[];
  warnings: string[];
}

function slideById(deck: DeckDocument, slideId: string): SlideDocument {
  const slide = deck.slides.find((item) => item.id === slideId);
  if (!slide) throw new Error(`Unknown slide: ${slideId}`);
  return slide;
}

function base(element: SceneElement) {
  return {
    id: element.id,
    name: element.name,
    type: element.type,
    semanticRole: element.semanticRole,
    geometry: element.geometry,
    zIndex: element.zIndex,
    opacity: element.opacity ?? 1,
    locked: Boolean(element.locked),
    groupId: element.groupId,
    exportStrategy: element.exportStrategy,
    dependencies: element.dependencies,
  };
}

function truncate(text: string, budget: { remaining: number }, warnings: string[], label: string): string {
  if (text.length <= budget.remaining) {
    budget.remaining -= text.length;
    return text;
  }
  if (budget.remaining <= 0) {
    warnings.push(`${label} omitted because scoped text budget is exhausted.`);
    return "";
  }
  const value = `${text.slice(0, Math.max(0, budget.remaining - 1))}…`;
  budget.remaining = 0;
  warnings.push(`${label} truncated to scoped text budget.`);
  return value;
}

function serializeElement(element: SceneElement, budget: { remaining: number }, warnings: string[]): unknown {
  const common = base(element);
  if (element.type === "text") {
    return {
      ...common,
      verticalAlign: element.verticalAlign,
      insetsDU: element.insetsDU,
      fitPolicy: element.fitPolicy,
      paragraphs: element.paragraphs.map((paragraph, paragraphIndex) => ({
        ...paragraph,
        runs: paragraph.runs.map((run, runIndex) => ({ ...run, text: truncate(run.text, budget, warnings, `text ${element.id} paragraph ${paragraphIndex} run ${runIndex}`) })),
      })),
    };
  }
  if (element.type === "chart") return { ...common, chart: structuredClone(element.chart), themeTokenRefs: element.themeTokenRefs };
  if (element.type === "table") {
    return {
      ...common,
      rows: element.rows.map((row, rowIndex) => row.map((cell, columnIndex) => ({ ...cell, text: truncate(cell.text, budget, warnings, `table ${element.id} cell ${rowIndex},${columnIndex}`) }))),
      columnWidths: element.columnWidths,
    };
  }
  if (element.type === "image") return { ...common, assetId: element.assetId, crop: element.crop, fit: element.fit, alt: element.alt, cornerRadiusDU: element.cornerRadiusDU };
  if (element.type === "shape") return { ...common, shape: element.shape, fill: element.fill, stroke: element.stroke, radiusDU: element.radiusDU, svgPath: element.svgPath ? truncate(element.svgPath, budget, warnings, `vector path ${element.id}`) : undefined };
  if (element.type === "line") return { ...common, start: element.start, end: element.end, stroke: element.stroke, startMarker: element.startMarker, endMarker: element.endMarker };
  if (element.type === "frame" || element.type === "group") return { ...common, childIds: [...element.childIds], layout: element.layout, clipContent: element.type === "frame" ? element.clipContent : undefined };
  if (element.type === "diagram") return { ...common, diagramType: element.diagramType, nodes: element.nodes, edges: element.edges };
  if (element.type === "icon") return { ...common, assetId: element.assetId, tint: element.tint };
  if (element.type === "video") return { ...common, assetId: element.assetId, posterAssetId: element.posterAssetId };
  return common;
}

export function buildScopedObjectContext(deck: DeckDocument, request: ScopedObjectReadRequest): ScopedObjectContext {
  const slide = slideById(deck, request.slideId);
  const maxElements = Math.max(1, Math.min(50, Math.floor(request.maxElements ?? 20)));
  const budget = { remaining: Math.max(500, Math.min(100_000, Math.floor(request.maxTextChars ?? 20_000))) };
  const warnings: string[] = [];
  const uniqueIds = [...new Set(request.elementIds)];
  if (uniqueIds.length > maxElements) warnings.push(`Requested ${uniqueIds.length} objects; only the first ${maxElements} are returned.`);
  const ids = uniqueIds.slice(0, maxElements);
  const objects = ids.map((id) => {
    const element = slide.scene.find((item) => item.id === id);
    if (!element) throw new Error(`Unknown element ${id} on slide ${slide.id}`);
    return serializeElement(element, budget, warnings);
  });
  return {
    deckId: deck.id,
    slide: { id: slide.id, order: slide.order, title: slide.title, archetype: slide.archetype, semantic: structuredClone(slide.semantic) },
    objects,
    warnings,
  };
}
