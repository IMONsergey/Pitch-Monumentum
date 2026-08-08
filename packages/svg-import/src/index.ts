import type { Paint, StrokeStyle, VectorPathData } from "../../deck-model/src/index.js";
import { parseSvgPathData, validateVectorPathData, vectorPathBounds } from "../../vector-path/src/index.js";

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

function coordinate(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return value.trim().endsWith("%") ? parsed / 100 : parsed;
}

function parseViewBox(svgOpenTag: string): SvgViewBox {
  const attrs = attributes(svgOpenTag);
  const raw = attrs.viewBox?.trim().split(/[\s,]+/).map(Number);
  if (raw?.length === 4 && raw.every(Number.isFinite) && raw[2] > 0 && raw[3] > 0) return { left: raw[0], top: raw[1], width: raw[2], height: raw[3] };
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

function gradients(svg: string, warnings: string[]): Map<string, Paint> {
  const result = new Map<string, Paint>();
  for (const match of svg.matchAll(/<linearGradient\b([^>]*)>([\s\S]*?)<\/linearGradient>/gi)) {
    const attrs = attributes(match[1]);
    if (!attrs.id) continue;
    if (attrs.gradientTransform) {
      warnings.push(`Gradient ${attrs.id} ignored: gradientTransform is not flattened by Vector Engine v1`);
      continue;
    }
    const x1 = coordinate(attrs.x1, 0);
    const y1 = coordinate(attrs.y1, 0);
    const x2 = coordinate(attrs.x2, 1);
    const y2 = coordinate(attrs.y2, 0);
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
  // SVG defaults fill to black when no fill property is specified.
  const fill = attrs.fill ?? style.fill ?? "#000000";
  if (fill === "none" || fill === "transparent") return { fillPaint: { kind: "none" } };
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

function applyFillRule(pathData: VectorPathData, attrs: Record<string, string>, style: Record<string, string>): VectorPathData {
  const rule = attrs["fill-rule"] ?? style["fill-rule"];
  return { ...pathData, fillRule: rule === "evenodd" ? "evenodd" : "nonzero" };
}

function rectPath(attrs: Record<string, string>): VectorPathData {
  const x = number(attrs.x) ?? 0;
  const y = number(attrs.y) ?? 0;
  const width = number(attrs.width) ?? 0;
  const height = number(attrs.height) ?? 0;
  if (width <= 0 || height <= 0) throw new Error("Rectangle width/height must be positive");
  const rx = Math.max(0, Math.min(width / 2, number(attrs.rx) ?? number(attrs.ry) ?? 0));
  const ry = Math.max(0, Math.min(height / 2, number(attrs.ry) ?? rx));
  if (!rx && !ry) return { fillRule: "nonzero", commands: [
    { command: "M", x, y }, { command: "L", x: x + width, y }, { command: "L", x: x + width, y: y + height }, { command: "L", x, y: y + height }, { command: "Z" },
  ] };
  const k = 0.5522847498307936;
  return { fillRule: "nonzero", commands: [
    { command: "M", x: x + rx, y },
    { command: "L", x: x + width - rx, y },
    { command: "C", x1: x + width - rx + rx * k, y1: y, x2: x + width, y2: y + ry - ry * k, x: x + width, y: y + ry },
    { command: "L", x: x + width, y: y + height - ry },
    { command: "C", x1: x + width, y1: y + height - ry + ry * k, x2: x + width - rx + rx * k, y2: y + height, x: x + width - rx, y: y + height },
    { command: "L", x: x + rx, y: y + height },
    { command: "C", x1: x + rx - rx * k, y1: y + height, x2: x, y2: y + height - ry + ry * k, x, y: y + height - ry },
    { command: "L", x, y: y + ry },
    { command: "C", x1: x, y1: y + ry - ry * k, x2: x + rx - rx * k, y2: y, x: x + rx, y },
    { command: "Z" },
  ] };
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): VectorPathData {
  if (rx <= 0 || ry <= 0) throw new Error("Ellipse radii must be positive");
  const k = 0.5522847498307936;
  return { fillRule: "nonzero", commands: [
    { command: "M", x: cx + rx, y: cy },
    { command: "C", x1: cx + rx, y1: cy + ry * k, x2: cx + rx * k, y2: cy + ry, x: cx, y: cy + ry },
    { command: "C", x1: cx - rx * k, y1: cy + ry, x2: cx - rx, y2: cy + ry * k, x: cx - rx, y: cy },
    { command: "C", x1: cx - rx, y1: cy - ry * k, x2: cx - rx * k, y2: cy - ry, x: cx, y: cy - ry },
    { command: "C", x1: cx + rx * k, y1: cy - ry, x2: cx + rx, y2: cy - ry * k, x: cx + rx, y: cy },
    { command: "Z" },
  ] };
}

function pointsPath(raw: string | undefined, close: boolean): VectorPathData {
  const numbers = (raw ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (numbers.length < 4 || numbers.length % 2) throw new Error("Polygon/polyline points are invalid");
  const commands: VectorPathData["commands"] = [{ command: "M", x: numbers[0], y: numbers[1] }];
  for (let index = 2; index < numbers.length; index += 2) commands.push({ command: "L", x: numbers[index], y: numbers[index + 1] });
  if (close) commands.push({ command: "Z" });
  return { fillRule: "nonzero", commands };
}

function primitivePath(tag: string, attrs: Record<string, string>): VectorPathData {
  if (tag === "rect") return rectPath(attrs);
  if (tag === "circle") {
    const r = number(attrs.r) ?? 0;
    return ellipsePath(number(attrs.cx) ?? 0, number(attrs.cy) ?? 0, r, r);
  }
  if (tag === "ellipse") return ellipsePath(number(attrs.cx) ?? 0, number(attrs.cy) ?? 0, number(attrs.rx) ?? 0, number(attrs.ry) ?? 0);
  if (tag === "polygon") return pointsPath(attrs.points, true);
  if (tag === "polyline") return pointsPath(attrs.points, false);
  if (tag === "line") return { fillRule: "nonzero", commands: [
    { command: "M", x: number(attrs.x1) ?? 0, y: number(attrs.y1) ?? 0 },
    { command: "L", x: number(attrs.x2) ?? 0, y: number(attrs.y2) ?? 0 },
  ] };
  throw new Error(`Unsupported SVG primitive ${tag}`);
}

function addImported(paths: ImportedSvgPath[], warnings: string[], tag: string, attrs: Record<string, string>, pathData: VectorPathData, gradientMap: Map<string, Paint>, index: number): void {
  const style = styleMap(attrs.style);
  if (attrs.transform || style.transform) {
    warnings.push(`${tag} ${index + 1} skipped: SVG transforms are not flattened by Vector Engine v1`);
    return;
  }
  const normalizedPath = applyFillRule(pathData, attrs, style);
  validateVectorPathData(normalizedPath);
  const sourceBounds = vectorPathBounds(normalizedPath);
  const fill = tag === "line" ? { fillPaint: { kind: "none" } as Paint } : paint(attrs, style, gradientMap);
  paths.push({
    name: attrs.id || `${tag} ${index + 1}`,
    pathData: normalizedPath,
    fillPaint: fill.fillPaint,
    legacyFill: fill.legacyFill,
    stroke: stroke(attrs, style),
    sourceBounds,
  });
}

export function importSvgPaths(svg: string): ImportedSvgDocument {
  const svgTag = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!svgTag) throw new Error("SVG root element not found");
  if (/<g\b[^>]*\btransform\s*=/i.test(svg)) throw new Error("SVG group transforms are not flattened by Vector Engine v1; flatten transforms before importing");
  if (/<(?:clipPath|mask)\b/i.test(svg)) throw new Error("SVG clipPath/mask is not editable in Vector Engine v1; flatten clipping before importing");
  const viewBox = parseViewBox(svgTag);
  const warnings: string[] = [];
  const gradientMap = gradients(svg, warnings);
  const paths: ImportedSvgPath[] = [];
  const content = svg.replace(/<defs\b[\s\S]*?<\/defs>/gi, "");
  let index = 0;

  for (const match of content.matchAll(/<(path|rect|circle|ellipse|polygon|polyline|line)\b([^>]*)\/?\s*>/gi)) {
    const tag = match[1].toLowerCase();
    const attrs = attributes(match[2]);
    try {
      const pathData = tag === "path" ? parseSvgPathData(attrs.d ?? "") : primitivePath(tag, attrs);
      addImported(paths, warnings, tag, attrs, pathData, gradientMap, index);
    } catch (error) {
      warnings.push(`${tag} ${index + 1} skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
    index += 1;
  }

  if (!paths.length) {
    const detail = warnings.length ? ` ${warnings.join(" ")}` : "";
    throw new Error(`SVG contains no editable vector geometry supported by Vector Engine v1.${detail}`);
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
