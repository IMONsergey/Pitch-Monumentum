import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import type { DeckDocument, SceneElement } from "../../deck-model/src/index.js";

interface ZipEntry { name: string; method: number; compressedSize: number; uncompressedSize: number; localOffset: number; }
export interface PptxSlideInspection {
  index: number;
  path: string;
  text: string[];
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
  kind: "package" | "slideCount" | "textMissing" | "nativeStructure";
  slideId?: string;
  elementId?: string;
  message: string;
}

function u16(buffer: Buffer, offset: number): number { return buffer.readUInt16LE(offset); }
function u32(buffer: Buffer, offset: number): number { return buffer.readUInt32LE(offset); }
function parseCentralDirectory(buffer: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (u32(buffer, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("PPTX is not a valid ZIP package: EOCD not found");
  const count = u16(buffer, eocd + 10);
  let offset = u32(buffer, eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
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
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function matches(xml: string, pattern: RegExp): number { return [...xml.matchAll(pattern)].length; }
function extractText(xml: string): string[] {
  return [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((match) => xmlDecode(match[1]));
}
function slideNumber(name: string): number { return Number(name.match(/slide(\d+)\.xml$/)?.[1] ?? Number.MAX_SAFE_INTEGER); }

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
        shapeCount: matches(xml, /<p:sp(?:\s|>)/g),
        textBodyCount: matches(xml, /<p:txBody(?:\s|>)/g),
        pictureCount: matches(xml, /<p:pic(?:\s|>)/g),
        graphicFrameCount: matches(xml, /<p:graphicFrame(?:\s|>)/g),
        connectionShapeCount: matches(xml, /<p:cxnSp(?:\s|>)/g),
      };
    });
  return { entryNames: entries.map((entry) => entry.name), slides, hasPresentation: byName.has("ppt/presentation.xml"), hasContentTypes: byName.has("[Content_Types].xml") };
}

function expectedText(element: SceneElement): string[] {
  return element.type === "text" ? element.paragraphs.flatMap((p) => p.runs.map((r) => r.text).filter(Boolean)) : [];
}
export async function validatePptxRoundTrip(deck: DeckDocument, path: string): Promise<{ inspection: PptxInspection; issues: RoundTripIssue[] }> {
  const inspection = await inspectPptx(path);
  const issues: RoundTripIssue[] = [];
  if (!inspection.hasPresentation || !inspection.hasContentTypes) issues.push({ severity: "critical", kind: "package", message: "Required PowerPoint package roots are missing" });
  if (inspection.slides.length !== deck.slides.length) issues.push({ severity: "critical", kind: "slideCount", message: `Expected ${deck.slides.length} slides, exported package contains ${inspection.slides.length}` });
  for (let index = 0; index < Math.min(deck.slides.length, inspection.slides.length); index++) {
    const source = deck.slides[index]; const exported = inspection.slides[index];
    const joined = exported.text.join("\n");
    for (const element of source.scene) {
      for (const text of expectedText(element)) if (text && !joined.includes(text)) issues.push({ severity: "critical", kind: "textMissing", slideId: source.id, elementId: element.id, message: `Native text missing after export: ${text.slice(0, 100)}` });
    }
    const expectedNativeText = source.scene.filter((e) => e.type === "text" && e.exportStrategy === "native").length;
    if (exported.textBodyCount < expectedNativeText) issues.push({ severity: "major", kind: "nativeStructure", slideId: source.id, message: `Expected at least ${expectedNativeText} native text bodies, found ${exported.textBodyCount}` });
  }
  return { inspection, issues };
}
