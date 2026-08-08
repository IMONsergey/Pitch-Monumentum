import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { DeckDocument } from "../../deck-model/src/index.js";
import { compileDeckWithAppearance } from "../../pptx-appearance/src/index.js";
import type { RichAssetMap } from "../../pptx-rich/src/index.js";
import { readZipMap, writeZipMap } from "../../source-ingest/src/zip.js";

const MARKER_PREFIX = "__pitch_scene_id__";
const DESCR_PREFIX = "pitch:id:";

function markerFor(id: string): string {
  return `${MARKER_PREFIX}${Buffer.from(id, "utf8").toString("base64url")}`;
}

function xmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface MarkerInfo {
  elementId: string;
  displayName: string;
}

function markDeck(deck: DeckDocument): { deck: DeckDocument; markers: Map<string, MarkerInfo> } {
  const marked = structuredClone(deck);
  const markers = new Map<string, MarkerInfo>();
  for (let slideIndex = 0; slideIndex < marked.slides.length; slideIndex += 1) {
    const originalSlide = deck.slides[slideIndex];
    const markedSlide = marked.slides[slideIndex];
    for (let elementIndex = 0; elementIndex < markedSlide.scene.length; elementIndex += 1) {
      const original = originalSlide.scene[elementIndex];
      const element = markedSlide.scene[elementIndex];
      const marker = markerFor(element.id);
      markers.set(marker, { elementId: element.id, displayName: original.name ?? original.id });
      element.name = marker;
    }
  }
  return { deck: marked, markers };
}

function restoreIdentity(slideXml: string, markers: Map<string, MarkerInfo>): string {
  return slideXml.replace(/<p:cNvPr\s+([^>]*)\/>/g, (whole, attributes: string) => {
    const nameMatch = attributes.match(/(?:^|\s)name="([^"]*)"/);
    if (!nameMatch) return whole;
    const info = markers.get(nameMatch[1]);
    if (!info) return whole;
    let next = attributes.replace(/(?:^|\s)name="[^"]*"/, (match: string) => {
      const prefix = match.startsWith(" ") ? " " : "";
      return `${prefix}name="${xmlAttribute(info.displayName)}"`;
    });
    next = next.replace(/\sdescr="[^"]*"/g, "");
    return `<p:cNvPr ${next} descr="${xmlAttribute(`${DESCR_PREFIX}${info.elementId}`)}"/>`;
  });
}

export function pitchIdFromDescription(description: string | undefined): string | undefined {
  return description?.startsWith(DESCR_PREFIX) ? description.slice(DESCR_PREFIX.length) : undefined;
}

export async function compileDeckWithIdentity(deck: DeckDocument, outputPath: string, assets: RichAssetMap = {}) {
  const marked = markDeck(deck);
  const compiled = await compileDeckWithAppearance(marked.deck, outputPath, assets);
  const entries = readZipMap(await readFile(outputPath));
  for (let index = 0; index < deck.slides.length; index += 1) {
    const path = `ppt/slides/slide${index + 1}.xml`;
    const source = entries.get(path)?.toString("utf8");
    if (!source) throw new Error(`Missing ${path} during identity pass`);
    entries.set(path, Buffer.from(restoreIdentity(source, marked.markers), "utf8"));
  }
  const output = writeZipMap(entries);
  await writeFile(outputPath, output);
  return {
    ...compiled,
    outputPath,
    contentHash: createHash("sha256").update(output).digest("hex"),
  };
}
