import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import type { DeckDocument, SceneElement, TextRun } from "../../deck-model/src/index.js";

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

export interface PptxTextRunInspection {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontSizePt?: number;
  letterSpacingPt?: number;
  fontFamily?: string;
  color?: string;
}

export interface PptxSlideInspection {
  index: number;
  path: string;
  text: string[];
  textRuns: PptxTextRunInspection[];
  shapeCount: number;
  textBodyCount: number;
  pictureCount: number;
  graphicFrameCount: number;
  connectionShapeCount: number;
}

export interface PptxInspection {
  entryNames: string[];
  slides: PptxSlideInspection[];
  hasPresentation: boolean;
  hasContentTypes: boolean;
}

export interface RoundTripIssue {
  severity: "minor" | "major" | "critical";
  kind: "package" | "slideCount" | "textMissing" | "textStyle" | "nativeStructure";
  slideId?: string;
  elementId?: string;
  message: string;
}

function u16(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset);
}

function u32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset);
}

function parseCentralDirectory(buffer: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index -= 1) {
    if (u32(buffer, index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error("PPTX is not a valid ZIP package: EOCD not found");

  const count = u16(buffer, eocd + 10);
  let offset = u32(buffer, eocd + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (u32(buffer, offset) !== 0x02014b50) throw new Error("Invalid ZIP central-directory entry");
    const method = u16(buffer, offset + 10);
    const compressedSize = u32(buffer, offset + 20);
    const uncompressedSize = u32(buffer, offset + 24);
    const nameLength = u16(buffer, offset + 28);
    const extraLength = u16(buffer, offset + 30);
    const commentLength = u16(buffer, offset + 32);
    const localOffset = u32(buffer, offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const offset = entry.localOffset;
  if (u32(buffer, offset) !== 0x04034b50) throw new Error(`Invalid ZIP local entry for ${entry.name}`);
  const nameLength = u16(buffer, offset + 26);
  const extraLength = u16(buffer, offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return inflateRawSync(compressed);
  throw new Error(`Unsupported ZIP compression method ${entry.method} for ${entry.name}`);
}

function xmlDecode(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function matches(xml: string, pattern: RegExp): number {
  return [...xml.matchAll(pattern)].length;
}

function extractText(xml: string): string[] {
  return [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((match) => xmlDecode(match[1]));
}

function attribute(source: string, name: string): string | undefined {
  return source.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
}

function extractTextRuns(xml: string): PptxTextRunInspection[] {
  const runs: PptxTextRunInspection[] = [];
  for (const match of xml.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)) {
    const body = match[1];
    const propertiesMatch = body.match(/<a:rPr\s+([^>]*)>([\s\S]*?)<\/a:rPr>/);
    const textMatch = body.match(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/);
    if (!textMatch) continue;
    const attributes = propertiesMatch?.[1] ?? "";
    const propertiesBody = propertiesMatch?.[2] ?? "";
    const size = attribute(attributes, "sz");
    const spacing = attribute(attributes, "spc");
    const underline = attribute(attributes, "u");
    const fontFamily = propertiesBody.match(/<a:latin\s+[^>]*typeface="([^"]*)"/)?.[1];
    const color = propertiesBody.match(/<a:srgbClr\s+[^>]*val="([0-9A-Fa-f]{6})"/)?.[1];
    runs.push({
      text: xmlDecode(textMatch[1]),
      bold: attribute(attributes, "b") === "1",
      italic: attribute(attributes, "i") === "1",
      underline: Boolean(underline && underline !== "none"),
      fontSizePt: size !== undefined ? Number(size) / 100 : undefined,
      letterSpacingPt: spacing !== undefined ? Number(spacing) / 100 : undefined,
      fontFamily: fontFamily ? xmlDecode(fontFamily) : undefined,
      color: color ? `#${color.toUpperCase()}` : undefined,
    });
  }
  return runs;
}

function slideNumber(name: string): number {
  return Number(name.match(/slide(\d+)\.xml$/)?.[1] ?? Number.MAX_SAFE_INTEGER);
}

export async function inspectPptx(path: string): Promise<PptxInspection> {
  const buffer = await readFile(path);
  const entries = parseCentralDirectory(buffer);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const slides = entries
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name))
    .sort((a, b) => slideNumber(a.name) - slideNumber(b.name))
    .map((entry, index) => {
      const xml = readEntry(buffer, entry).toString("utf8");
      return {
        index,
        path: entry.name,
        text: extractText(xml),
        textRuns: extractTextRuns(xml),
        shapeCount: matches(xml, /<p:sp(?:\s|>)/g),
        textBodyCount: matches(xml, /<p:txBody(?:\s|>)/g),
        pictureCount: matches(xml, /<p:pic(?:\s|>)/g),
        graphicFrameCount: matches(xml, /<p:graphicFrame(?:\s|>)/g),
        connectionShapeCount: matches(xml, /<p:cxnSp(?:\s|>)/g),
      };
    });
  return {
    entryNames: entries.map((entry) => entry.name),
    slides,
    hasPresentation: byName.has("ppt/presentation.xml"),
    hasContentTypes: byName.has("[Content_Types].xml"),
  };
}

function expectedText(element: SceneElement): string[] {
  return element.type === "text" ? element.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.text).filter(Boolean)) : [];
}

interface ExpectedRun {
  elementId: string;
  run: TextRun;
}

function expectedRuns(deckSlide: DeckDocument["slides"][number]): ExpectedRun[] {
  return [...deckSlide.scene]
    .sort((a, b) => a.zIndex - b.zIndex)
    .flatMap((element) => element.type === "text" && element.exportStrategy === "native"
      ? element.paragraphs.flatMap((paragraph) => paragraph.runs.filter((run) => run.text).map((run) => ({ elementId: element.id, run })))
      : []);
}

function approximately(a: number | undefined, b: number | undefined, tolerance = 0.011): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return Math.abs(a - b) <= tolerance;
}

function normalizedColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const raw = value.replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(raw) ? `#${raw}` : value.toUpperCase();
}

function styleDifferences(expected: TextRun, actual: PptxTextRunInspection): string[] {
  const differences: string[] = [];
  if (Boolean(expected.bold) !== actual.bold) differences.push(`bold expected=${Boolean(expected.bold)} actual=${actual.bold}`);
  if (Boolean(expected.italic) !== actual.italic) differences.push(`italic expected=${Boolean(expected.italic)} actual=${actual.italic}`);
  if (Boolean(expected.underline) !== actual.underline) differences.push(`underline expected=${Boolean(expected.underline)} actual=${actual.underline}`);
  if (expected.fontSizePt !== undefined && !approximately(expected.fontSizePt, actual.fontSizePt)) differences.push(`fontSizePt expected=${expected.fontSizePt} actual=${actual.fontSizePt}`);
  if (expected.letterSpacingPt !== undefined && !approximately(expected.letterSpacingPt, actual.letterSpacingPt)) differences.push(`letterSpacingPt expected=${expected.letterSpacingPt} actual=${actual.letterSpacingPt}`);
  if (expected.fontFamily && expected.fontFamily !== actual.fontFamily) differences.push(`fontFamily expected=${expected.fontFamily} actual=${actual.fontFamily}`);
  if (expected.color && normalizedColor(expected.color) !== normalizedColor(actual.color)) differences.push(`color expected=${normalizedColor(expected.color)} actual=${normalizedColor(actual.color)}`);
  return differences;
}

export async function validatePptxRoundTrip(deck: DeckDocument, path: string): Promise<{ inspection: PptxInspection; issues: RoundTripIssue[] }> {
  const inspection = await inspectPptx(path);
  const issues: RoundTripIssue[] = [];
  if (!inspection.hasPresentation || !inspection.hasContentTypes) {
    issues.push({ severity: "critical", kind: "package", message: "Required PowerPoint package roots are missing" });
  }
  if (inspection.slides.length !== deck.slides.length) {
    issues.push({ severity: "critical", kind: "slideCount", message: `Expected ${deck.slides.length} slides, exported package contains ${inspection.slides.length}` });
  }

  for (let index = 0; index < Math.min(deck.slides.length, inspection.slides.length); index += 1) {
    const source = deck.slides[index];
    const exported = inspection.slides[index];
    const joined = exported.text.join("\n");

    for (const element of source.scene) {
      for (const text of expectedText(element)) {
        if (text && !joined.includes(text)) {
          issues.push({ severity: "critical", kind: "textMissing", slideId: source.id, elementId: element.id, message: `Native text missing after export: ${text.slice(0, 100)}` });
        }
      }
    }

    const nativeTextCount = source.scene.filter((element) => element.type === "text" && element.exportStrategy === "native").length;
    if (exported.textBodyCount < nativeTextCount) {
      issues.push({ severity: "major", kind: "nativeStructure", slideId: source.id, message: `Expected at least ${nativeTextCount} native text bodies, found ${exported.textBodyCount}` });
    }

    const expected = expectedRuns(source);
    let cursor = 0;
    for (const expectedRun of expected) {
      let matchedIndex = -1;
      for (let actualIndex = cursor; actualIndex < exported.textRuns.length; actualIndex += 1) {
        if (exported.textRuns[actualIndex].text === expectedRun.run.text) {
          matchedIndex = actualIndex;
          break;
        }
      }
      if (matchedIndex < 0) continue;
      const actual = exported.textRuns[matchedIndex];
      cursor = matchedIndex + 1;
      const differences = styleDifferences(expectedRun.run, actual);
      if (differences.length) {
        issues.push({
          severity: "major",
          kind: "textStyle",
          slideId: source.id,
          elementId: expectedRun.elementId,
          message: `Native text style drift for "${expectedRun.run.text.slice(0, 60)}": ${differences.join("; ")}`,
        });
      }
    }
  }
  return { inspection, issues };
}
