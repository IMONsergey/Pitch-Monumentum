import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readZipMap } from "../../source-ingest/src/zip.js";

export interface TemplateColor {
  role: string;
  hex: string;
}

export interface TemplateFontScheme {
  majorLatin?: string;
  minorLatin?: string;
  majorEastAsia?: string;
  minorEastAsia?: string;
  majorComplex?: string;
  minorComplex?: string;
}

export interface TemplateCanvas {
  widthDU: number;
  heightDU: number;
  aspectRatio: number;
}

export interface TemplateObjectGeometry {
  kind: "shape" | "image" | "graphic";
  xDU: number;
  yDU: number;
  widthDU: number;
  heightDU: number;
}

export interface TemplateSlideSignature {
  signature: string;
  count: number;
  slideNumbers: number[];
  objectCount: number;
  kinds: Record<string, number>;
  normalizedGeometry: string[];
}

export interface TemplateIntelligence {
  schemaVersion: "0.1";
  sourceHash: string;
  canvas: TemplateCanvas;
  theme: {
    name?: string;
    colors: TemplateColor[];
    fonts: TemplateFontScheme;
  };
  styleStats: {
    fontSizesPt: Array<{ value: number; count: number }>;
    colors: Array<{ value: string; count: number }>;
    textAlignments: Array<{ value: string; count: number }>;
  };
  layouts: TemplateSlideSignature[];
  recommendations: {
    primaryFonts: string[];
    palette: string[];
    typeScalePt: number[];
    dominantLayoutSignatures: string[];
  };
}

const EMU_PER_DU = 6350;

function xmlDecode(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function attr(xml: string, name: string): string | undefined {
  const match = xml.match(new RegExp(`${name}="([^"]*)"`));
  return match ? xmlDecode(match[1]) : undefined;
}

function hex(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(normalized) ? `#${normalized}` : undefined;
}

function lastColor(block: string): string | undefined {
  const srgb = block.match(/<a:srgbClr\b[^>]*val="([0-9A-Fa-f]{6})"/i)?.[1];
  const system = block.match(/<a:sysClr\b[^>]*lastClr="([0-9A-Fa-f]{6})"/i)?.[1];
  return hex(srgb ?? system);
}

function themeColors(themeXml: string): TemplateColor[] {
  const scheme = themeXml.match(/<a:clrScheme\b[^>]*>([\s\S]*?)<\/a:clrScheme>/)?.[1] ?? "";
  const roles = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  const result: TemplateColor[] = [];
  for (const role of roles) {
    const block = scheme.match(new RegExp(`<a:${role}\\b[^>]*>([\\s\\S]*?)<\\/a:${role}>`))?.[1];
    const color = block ? lastColor(block) : undefined;
    if (color) result.push({ role, hex: color });
  }
  return result;
}

function fontScheme(themeXml: string): TemplateFontScheme {
  const major = themeXml.match(/<a:majorFont>([\s\S]*?)<\/a:majorFont>/)?.[1] ?? "";
  const minor = themeXml.match(/<a:minorFont>([\s\S]*?)<\/a:minorFont>/)?.[1] ?? "";
  const read = (block: string, tag: string) => attr(block.match(new RegExp(`<a:${tag}\\b[^>]*\\/>`))?.[0] ?? "", "typeface");
  return {
    majorLatin: read(major, "latin") || undefined,
    minorLatin: read(minor, "latin") || undefined,
    majorEastAsia: read(major, "ea") || undefined,
    minorEastAsia: read(minor, "ea") || undefined,
    majorComplex: read(major, "cs") || undefined,
    minorComplex: read(minor, "cs") || undefined,
  };
}

function canvas(presentationXml: string): TemplateCanvas {
  const sldSz = presentationXml.match(/<p:sldSz\b[^>]*>/)?.[0];
  const cx = Number(sldSz ? attr(sldSz, "cx") : 0) || 12192000;
  const cy = Number(sldSz ? attr(sldSz, "cy") : 0) || 6858000;
  const widthDU = cx / EMU_PER_DU;
  const heightDU = cy / EMU_PER_DU;
  return { widthDU, heightDU, aspectRatio: widthDU / heightDU };
}

function inc(map: Map<string, number>, value: string): void {
  map.set(value, (map.get(value) ?? 0) + 1);
}

function sortedCounts(map: Map<string, number>): Array<{ value: string; count: number }> {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, count]) => ({ value, count }));
}

function fontSizeCounts(slideXmls: string[]): Array<{ value: number; count: number }> {
  const map = new Map<number, number>();
  for (const xml of slideXmls) {
    for (const match of xml.matchAll(/<(?:a:rPr|a:defRPr|a:endParaRPr)\b[^>]*\bsz="(\d+)"/g)) {
      const value = Math.round((Number(match[1]) / 100) * 100) / 100;
      if (value > 0) map.set(value, (map.get(value) ?? 0) + 1);
    }
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]).map(([value, count]) => ({ value, count }));
}

function colorCounts(slideXmls: string[], theme: TemplateColor[]): Array<{ value: string; count: number }> {
  const map = new Map<string, number>();
  for (const xml of slideXmls) {
    for (const match of xml.matchAll(/<a:srgbClr\b[^>]*val="([0-9A-Fa-f]{6})"/g)) {
      const value = hex(match[1]);
      if (value) inc(map, value);
    }
    for (const match of xml.matchAll(/<a:schemeClr\b[^>]*val="([^"]+)"/g)) {
      const resolved = theme.find(item => item.role === match[1])?.hex;
      if (resolved) inc(map, resolved);
    }
  }
  return sortedCounts(map);
}

function alignmentCounts(slideXmls: string[]): Array<{ value: string; count: number }> {
  const map = new Map<string, number>();
  for (const xml of slideXmls) {
    for (const match of xml.matchAll(/<a:pPr\b[^>]*\balgn="([^"]+)"/g)) inc(map, match[1]);
  }
  return sortedCounts(map);
}

function geometryFromBlock(block: string, kind: TemplateObjectGeometry["kind"]): TemplateObjectGeometry | undefined {
  const xfrm = block.match(/<a:xfrm\b[^>]*>[\s\S]*?<\/a:xfrm>/)?.[0];
  if (!xfrm) return undefined;
  const off = xfrm.match(/<a:off\b[^>]*>/)?.[0];
  const ext = xfrm.match(/<a:ext\b[^>]*>/)?.[0];
  if (!off || !ext) return undefined;
  const x = Number(attr(off, "x"));
  const y = Number(attr(off, "y"));
  const cx = Number(attr(ext, "cx"));
  const cy = Number(attr(ext, "cy"));
  if (![x, y, cx, cy].every(Number.isFinite)) return undefined;
  return { kind, xDU: x / EMU_PER_DU, yDU: y / EMU_PER_DU, widthDU: cx / EMU_PER_DU, heightDU: cy / EMU_PER_DU };
}

function slideGeometry(slideXml: string): TemplateObjectGeometry[] {
  const result: TemplateObjectGeometry[] = [];
  const patterns: Array<[RegExp, TemplateObjectGeometry["kind"]]> = [
    [/<p:sp\b[\s\S]*?<\/p:sp>/g, "shape"],
    [/<p:pic\b[\s\S]*?<\/p:pic>/g, "image"],
    [/<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g, "graphic"],
  ];
  for (const [pattern, kind] of patterns) {
    for (const match of slideXml.matchAll(pattern)) {
      const geometry = geometryFromBlock(match[0], kind);
      if (geometry && geometry.widthDU > 0 && geometry.heightDU > 0) result.push(geometry);
    }
  }
  return result;
}

function quant(value: number): number {
  return Math.round(value * 20) / 20;
}

function signatureFor(objects: TemplateObjectGeometry[], c: TemplateCanvas): { signature: string; normalizedGeometry: string[]; kinds: Record<string, number> } {
  const kinds: Record<string, number> = {};
  for (const object of objects) kinds[object.kind] = (kinds[object.kind] ?? 0) + 1;
  const normalizedGeometry = objects
    .map(object => `${object.kind}:${quant(object.xDU / c.widthDU)},${quant(object.yDU / c.heightDU)},${quant(object.widthDU / c.widthDU)},${quant(object.heightDU / c.heightDU)}`)
    .sort();
  return { signature: createHash("sha1").update(normalizedGeometry.join("|")).digest("hex").slice(0, 12), normalizedGeometry, kinds };
}

function layoutSignatures(slideXmls: string[], c: TemplateCanvas): TemplateSlideSignature[] {
  const map = new Map<string, TemplateSlideSignature>();
  slideXmls.forEach((xml, index) => {
    const objects = slideGeometry(xml);
    const signature = signatureFor(objects, c);
    const existing = map.get(signature.signature);
    if (existing) {
      existing.count += 1;
      existing.slideNumbers.push(index + 1);
    } else {
      map.set(signature.signature, { signature: signature.signature, count: 1, slideNumbers: [index + 1], objectCount: objects.length, kinds: signature.kinds, normalizedGeometry: signature.normalizedGeometry });
    }
  });
  return [...map.values()].sort((a, b) => b.count - a.count || b.objectCount - a.objectCount || a.signature.localeCompare(b.signature));
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map(value => value.trim()))];
}

export function analyzePptxTemplateBytes(bytes: Buffer): TemplateIntelligence {
  const entries = readZipMap(bytes);
  const presentationXml = entries.get("ppt/presentation.xml")?.toString("utf8") ?? "";
  const themeXml = entries.get("ppt/theme/theme1.xml")?.toString("utf8") ?? "";
  const slideNames = [...entries.keys()].filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => Number(a.match(/slide(\d+)/)?.[1]) - Number(b.match(/slide(\d+)/)?.[1]));
  if (!slideNames.length) throw new Error("PPTX contains no slides");
  const slideXmls = slideNames.map(name => entries.get(name)!.toString("utf8"));
  const c = canvas(presentationXml);
  const colors = themeColors(themeXml);
  const fonts = fontScheme(themeXml);
  const fontSizes = fontSizeCounts(slideXmls);
  const usedColors = colorCounts(slideXmls, colors);
  const layouts = layoutSignatures(slideXmls, c);
  const palette = unique([...usedColors.slice(0, 10).map(item => item.value), ...colors.filter(item => /^accent\d$/.test(item.role)).map(item => item.hex)]).slice(0, 12);
  const primaryFonts = unique([fonts.majorLatin, fonts.minorLatin, fonts.majorEastAsia, fonts.minorEastAsia]);
  const typeScalePt = fontSizes.slice(0, 10).map(item => item.value).sort((a, b) => b - a);
  return {
    schemaVersion: "0.1",
    sourceHash: createHash("sha256").update(bytes).digest("hex"),
    canvas: c,
    theme: { name: attr(themeXml.match(/<a:theme\b[^>]*>/)?.[0] ?? "", "name"), colors, fonts },
    styleStats: { fontSizesPt: fontSizes, colors: usedColors, textAlignments: alignmentCounts(slideXmls) },
    layouts,
    recommendations: { primaryFonts, palette, typeScalePt, dominantLayoutSignatures: layouts.filter(layout => layout.count > 1).slice(0, 8).map(layout => layout.signature) },
  };
}

export async function analyzePptxTemplate(path: string): Promise<TemplateIntelligence> {
  return analyzePptxTemplateBytes(await readFile(path));
}
