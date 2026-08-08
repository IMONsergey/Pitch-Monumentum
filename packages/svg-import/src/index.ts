import type { Paint, StrokeStyle, VectorPathData } from "../../deck-model/src/index.js";
import { parseSvgPathData, vectorPathBounds } from "../../vector-path/src/index.js";

export interface SvgViewBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ImportedSvgPath {
  name: string;
  pathData: VectorPathData;
  fillPaint?: Paint;
  legacyFill?: string;
  stroke?: StrokeStyle;
  sourceBounds: ReturnType<typeof vectorPathBounds>;
}

export interface ImportedSvgDocument {
  viewBox: SvgViewBox;
  paths: ImportedSvgPath[];
  warnings: string[];
}

function attributes(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of source.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) result[match[1]] = match[2] ?? match[3] ?? "";
  return result;
}

function styleMap(style: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!style) return result;
  for (const part of style.split(";")) {
    const index = part.indexOf(":");
    if (index <= 0) continue;
    result[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return result;
}

function number(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseViewBox(svgOpenTag: string): SvgViewBox {
  const attrs = attributes(svgOpenTag);
  const raw = attrs.viewBox?.trim().split(/[\s,]+/).map(Number);
  if (raw?.length === 4 && raw.every(Number.isFinite) && raw[2] > 0 && raw[3] > 0) {
    return { left: raw[0], top: raw[1], width: raw[2], height: raw[3] };
  }
  const width = number(attrs.width);
  const height = number(attrs.height);
  if (width && height && width > 0 && height > 0) return { left: 0, top: 0, width, height };
  throw new Error("SVG import requires a valid viewBox or numeric width/height");
}

function hexChannel(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

function normalizeColor(value: string | undefined): string | undefined {
  if (!value || value === "none" || value === "transparent") return undefined;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) return `#${value.slice(1).split("").map((char) => `${char}${char}`).join("")}`.toUpperCase();
  const rgb = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgb) return `#${hexChannel(Number(rgb[1]))}${hexChannel(Number(rgb[2]))}${hexChannel(Number(rgb[3]))}`.toUpperCase();
  return undefined;
}

function parseOffset(value: string | undefined): number {
  if (!value) return 0;
  if (value.trim().endsWith("%")) return Math.max(0, Math.min(1, Number.parseFloat(value) / 100));
  return Math.max(0, Math.min(1, Number.parseFloat(value)));
}

function gradients(svg: string): Map<string, Paint> {
  const result = new Map<string, Paint>();
  for (const match of svg.matchAll(/<linearGradient\b([^>]*)>([\s\S]*?)<\/linearGradient>/gi)) {
    const attrs = attributes(match[1]);
    if (!attrs.id) continue;
    const x1 = number(attrs.x1) ?? 0;
    const y1 = number(attrs.y1) ?? 0;
    const x2 = number(attrs.x2) ?? 1;
    const y2 = number(attrs.y2) ?? 0;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const angleDeg = ((Math.atan2(dx, -dy) * 180 / Math.PI) % 360 + 360) % 360;
    const stops = [...match[2].matchAll(/<stop\b([^>]*)\/?\s*>/gi)].flatMap((stopMatch) => {
      const stopAttrs = attributes(stopMatch[1]);
      const style = styleMap(stopAttrs.style);
      const color = normalizeColor(stopAttrs["stop-color"] ?? style["stop-color"]);
      if (!color) return [];
      const opacity = number(stopAttrs["stop-opacity"] ?? style["stop-opacity"]) ?? 1;
      return [{ position: parseOffset(stopAttrs.offset), color, opacity: Math.max(0, Math.min(1, opacity)) }];
    }).sort((a, b) => a.position - b.position);
    if (stops.length >= 2) result.set(attrs.id, { kind: "linearGradient", angleDeg, stops });
  }
  return result;
}

function paint(attrs: Record<string, string>, style: Record<string, string>, gradientMap: Map<string, Paint>): { fillPaint?: Paint; legacyFill?: string } {
  const fill = attrs.fill ?? style.fill;
  if (!fill || fill === "none" || fill === "transparent") return { fillPaint: { kind: "none" } };
  const gradient = fill.match(/^url\(#([^\)]+)\)$/)?.[1];
  if (gradient && gradientMap.has(gradient)) return { fillPaint: structuredClone(gradientMap.get(gradient)!) };
  const color = normalizeColor(fill);
  if (color) {
    const opacity = number(attrs["fill-opacity"] ?? style["fill-opacity"] ?? attrs.opacity ?? style.opacity) ?? 1;
    return { fillPaint: { kind: "solid", color, opacity: Math.max(0, Math.min(1, opacity)) }, legacyFill: color };
  }
  return {};
}

function stroke(attrs: Record<string, string>, style: Record<string, string>): StrokeStyle | undefined {
  const color = normalizeColor(attrs.stroke ?? style.stroke);
  if (!color) return undefined;
  const widthDU = number(attrs["stroke-width"] ?? style["stroke-width"]) ?? 1;
  const dashSource = attrs["stroke-dasharray"] ?? style["stroke-dasharray"];
  const dash = dashSource && dashSource !== "none" ? "dash" : "solid";
  return { color, widthDU: Math.max(0, widthDU), dash };
}

export function importSvgPaths(svg: string): ImportedSvgDocument {
  const svgTag = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!svgTag) throw new Error("SVG root element not found");
  const viewBox = parseViewBox(svgTag);
  const gradientMap = gradients(svg);
  const warnings: string[] = [];
  const paths: ImportedSvgPath[] = [];
  let pathIndex = 0;

  for (const match of svg.matchAll(/<path\b([^>]*)\/?\s*>/gi)) {
    const attrs = attributes(match[1]);
    const d = attrs.d;
    if (!d) continue;
    const style = styleMap(attrs.style);
    if (attrs.transform || style.transform) {
      warnings.push(`Path ${pathIndex + 1} skipped: SVG transforms are not flattened by Vector Engine v1`);
      pathIndex += 1;
      continue;
    }
    try {
      const pathData = parseSvgPathData(d);
      const sourceBounds = vectorPathBounds(pathData);
      const fill = paint(attrs, style, gradientMap);
      paths.push({
        name: attrs.id || `SVG path ${pathIndex + 1}`,
        pathData,
        fillPaint: fill.fillPaint,
        legacyFill: fill.legacyFill,
        stroke: stroke(attrs, style),
        sourceBounds,
      });
    } catch (error) {
      warnings.push(`Path ${pathIndex + 1} skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
    pathIndex += 1;
  }

  if (!paths.length) {
    const detail = warnings.length ? ` ${warnings.join(" ")}` : "";
    throw new Error(`SVG contains no editable path supported by Vector Engine v1.${detail}`);
  }
  return { viewBox, paths, warnings };
}

export function layoutImportedSvg(document: ImportedSvgDocument, target: { x: number; y: number; width: number; height: number }) {
  const sx = target.width / document.viewBox.width;
  const sy = target.height / document.viewBox.height;
  return document.paths.map((path) => ({
    name: path.name,
    geometry: {
      x: target.x + (path.sourceBounds.left - document.viewBox.left) * sx,
      y: target.y + (path.sourceBounds.top - document.viewBox.top) * sy,
      width: Math.max(.01, path.sourceBounds.width * sx),
      height: Math.max(.01, path.sourceBounds.height * sy),
    },
    pathData: structuredClone(path.pathData),
    fillPaint: path.fillPaint ? structuredClone(path.fillPaint) : undefined,
    fill: path.legacyFill,
    stroke: path.stroke ? structuredClone(path.stroke) : undefined,
  }));
}
