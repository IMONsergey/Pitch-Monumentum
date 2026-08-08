import type { DeckDocument, SceneElement, TextParagraph } from "../../deck-model/src/index.js";
import { vectorPathDataToSvgPath } from "../../vector-path/src/index.js";

export interface FigmaBridgeAsset {
  assetId: string;
  mimeType: "image/png" | "image/jpeg";
  base64: string;
  width?: number;
  height?: number;
}

export interface FigmaBridgeNode {
  pitchId: string;
  type: SceneElement["type"];
  name: string;
  semanticRole: SceneElement["semanticRole"];
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  locked: boolean;
  groupId?: string;
  childIds?: string[];
  tokenBindings?: Record<string, string>;
  componentInstanceId?: string;
  componentId?: string;
  masterId?: string;
  masterSourceId?: string;
  placeholderId?: string;
  payload: Record<string, unknown>;
}

export interface FigmaBridgeSlide {
  slideId: string;
  order: number;
  title: string;
  width: number;
  height: number;
  nodes: FigmaBridgeNode[];
}

export interface FigmaBridgeDocument {
  schemaVersion: "0.1";
  kind: "pitch-figma-bridge";
  deckId: string;
  title: string;
  canvas: DeckDocument["canvas"];
  exportedAt: string;
  slides: FigmaBridgeSlide[];
  assets: Record<string, FigmaBridgeAsset>;
  theme?: unknown;
  slideMasters?: unknown;
  warnings: string[];
}

function tag(element: SceneElement, prefix: string): string | undefined {
  return element.tags?.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function textPayload(paragraphs: TextParagraph[]) {
  let offset = 0;
  const ranges: Array<Record<string, unknown>> = [];
  const paragraphsOut = paragraphs.map((paragraph, paragraphIndex) => {
    const start = offset;
    const runs = paragraph.runs.map((run) => {
      const runStart = offset;
      offset += run.text.length;
      const end = offset;
      ranges.push({ start: runStart, end, paragraphIndex, bold: Boolean(run.bold), italic: Boolean(run.italic), underline: Boolean(run.underline), color: run.color, fontFamily: run.fontFamily, fontSizePt: run.fontSizePt, letterSpacingPt: run.letterSpacingPt });
      return run.text;
    });
    const value = runs.join("");
    const end = offset;
    if (paragraphIndex < paragraphs.length - 1) offset += 1;
    return { start, end, text: value, align: paragraph.align, bullet: paragraph.bullet, lineSpacing: paragraph.lineSpacing, spaceBeforePt: paragraph.spaceBeforePt, spaceAfterPt: paragraph.spaceAfterPt };
  });
  return { characters: paragraphsOut.map((paragraph) => paragraph.text).join("\n"), paragraphs: paragraphsOut, ranges };
}

function nodePayload(element: SceneElement): Record<string, unknown> {
  if (element.type === "text") return { ...textPayload(element.paragraphs), verticalAlign: element.verticalAlign, insetsDU: element.insetsDU, fitPolicy: element.fitPolicy };
  if (element.type === "image") return { assetId: element.assetId, fit: element.fit, crop: element.crop, focalPoint: element.focalPoint, clipShape: element.clipShape, cornerRadiusDU: element.cornerRadiusDU, alt: element.alt };
  if (element.type === "shape") {
    const svgPath = element.svgPath ?? (element.pathData ? vectorPathDataToSvgPath(element.pathData) : undefined);
    return { shape: element.shape, fill: element.fill, fillPaint: element.fillPaint, stroke: element.stroke, radiusDU: element.radiusDU, pathData: element.pathData, svgPath, effects: element.effects };
  }
  if (element.type === "line") return { start: element.start, end: element.end, stroke: element.stroke, startMarker: element.startMarker, endMarker: element.endMarker };
  if (element.type === "frame") return { childIds: element.childIds, layout: element.layout, fill: element.fill, fillPaint: element.fillPaint, stroke: element.stroke, radiusDU: element.radiusDU, clipContent: element.clipContent, effects: element.effects };
  if (element.type === "group") return { childIds: element.childIds, layout: element.layout };
  if (element.type === "table") return { rows: element.rows, columnWidths: element.columnWidths };
  if (element.type === "chart") return { chart: element.chart, themeTokenRefs: element.themeTokenRefs };
  if (element.type === "icon") return { assetId: element.assetId, tint: element.tint };
  if (element.type === "diagram") return { diagramType: element.diagramType, nodes: element.nodes, edges: element.edges };
  return { assetId: element.assetId, posterAssetId: element.posterAssetId };
}

function toNode(element: SceneElement): FigmaBridgeNode {
  return {
    pitchId: element.id,
    type: element.type,
    name: element.name || element.id,
    semanticRole: element.semanticRole,
    x: element.geometry.x,
    y: element.geometry.y,
    width: element.geometry.width,
    height: element.geometry.height,
    rotation: element.geometry.rotation ?? 0,
    opacity: element.opacity ?? 1,
    zIndex: element.zIndex,
    locked: Boolean(element.locked),
    groupId: element.groupId,
    childIds: element.type === "frame" || element.type === "group" ? [...element.childIds] : undefined,
    tokenBindings: structuredClone((element as any).tokenBindings),
    componentInstanceId: tag(element, "component:"),
    componentId: tag(element, "component-def:"),
    masterId: tag(element, "slide-master:"),
    masterSourceId: tag(element, "slide-master-source:"),
    placeholderId: tag(element, "slide-placeholder:"),
    payload: nodePayload(element),
  };
}

export function createFigmaBridgeDocument(deck: DeckDocument, assets: Record<string, FigmaBridgeAsset>): FigmaBridgeDocument {
  const warnings: string[] = [];
  for (const slide of deck.slides) for (const element of slide.scene) {
    if ((element.type === "image" || element.type === "icon") && !assets[element.assetId]) warnings.push(`${slide.id}:${element.id} references asset ${element.assetId} without embedded bridge bytes`);
    if (element.type === "video") warnings.push(`${slide.id}:${element.id} video exports as metadata/poster reference; native Figma video parity is not guaranteed`);
    if (element.type === "chart" || element.type === "table" || element.type === "diagram") warnings.push(`${slide.id}:${element.id} ${element.type} remains structured bridge data; importer may expand it into editable primitives`);
  }
  return {
    schemaVersion: "0.1",
    kind: "pitch-figma-bridge",
    deckId: deck.id,
    title: deck.title,
    canvas: structuredClone(deck.canvas),
    exportedAt: new Date().toISOString(),
    slides: [...deck.slides].sort((a, b) => a.order - b.order).map((slide) => ({ slideId: slide.id, order: slide.order, title: slide.title, width: deck.canvas.widthDU, height: deck.canvas.heightDU, nodes: [...slide.scene].sort((a, b) => a.zIndex - b.zIndex).map(toNode) })),
    assets: structuredClone(assets),
    theme: structuredClone((deck as any).theme),
    slideMasters: structuredClone((deck as any).slideMasters),
    warnings: [...new Set(warnings)],
  };
}
