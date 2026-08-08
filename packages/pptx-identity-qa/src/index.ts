import { readFile } from "node:fs/promises";
import type { DeckDocument, SceneElement } from "../../deck-model/src/index.js";
import { pitchIdFromDescription } from "../../pptx-identity/src/index.js";
import { readZipMap } from "../../source-ingest/src/zip.js";
import type { RoundTripIssue } from "../../pptx-roundtrip/src/index.js";

function xmlDecode(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function exportedPitchIds(xml: string): Set<string> {
  const ids = new Set<string>();
  for (const match of xml.matchAll(/<p:cNvPr\s+[^>]*descr="([^"]*)"/g)) {
    const id = pitchIdFromDescription(xmlDecode(match[1]));
    if (id) ids.add(id);
  }
  return ids;
}

function visualFrame(element: Extract<SceneElement, { type: "frame" }>): boolean {
  return Boolean(element.fill || element.stroke || (element.fillPaint && element.fillPaint.kind !== "none") || element.effects?.some(effect => effect.kind === "dropShadow"));
}

function requiresExportIdentity(element: SceneElement): boolean {
  if (element.type === "group") return false;
  if (element.type === "frame") return visualFrame(element);
  if (element.type === "text" || element.type === "shape" || element.type === "line" || element.type === "image" || element.type === "table" || element.type === "chart") return true;
  return false;
}

export async function validatePptxIdentity(deck: DeckDocument, path: string): Promise<RoundTripIssue[]> {
  const entries = readZipMap(await readFile(path));
  const issues: RoundTripIssue[] = [];
  for (let index = 0; index < deck.slides.length; index += 1) {
    const slide = deck.slides[index];
    const xml = entries.get(`ppt/slides/slide${index + 1}.xml`)?.toString("utf8");
    if (!xml) continue;
    const ids = exportedPitchIds(xml);
    for (const element of slide.scene) {
      if (!requiresExportIdentity(element)) continue;
      if (!ids.has(element.id)) {
        issues.push({
          severity: "critical",
          kind: "nativeStructure",
          slideId: slide.id,
          elementId: element.id,
          message: `Exported PowerPoint object is missing stable Pitch identity pitch:id:${element.id}`,
        });
      }
    }
  }
  return issues;
}
