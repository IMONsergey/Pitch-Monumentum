import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import type { DeckDocument, ImageElement } from "../packages/deck-model/src/index.js";
import { compileRichDeckToPptx } from "../packages/pptx-rich/src/index.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7rAAAAAASUVORK5CYII=", "base64");

function u16(buffer: Buffer, offset: number): number { return buffer.readUInt16LE(offset); }
function u32(buffer: Buffer, offset: number): number { return buffer.readUInt32LE(offset); }
function zipEntry(buffer: Buffer, wanted: string): Buffer {
  let eocd = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index -= 1) if (u32(buffer, index) === 0x06054b50) { eocd = index; break; }
  if (eocd < 0) throw new Error("ZIP EOCD not found");
  const count = u16(buffer, eocd + 10); let offset = u32(buffer, eocd + 16);
  for (let index = 0; index < count; index += 1) {
    const method = u16(buffer, offset + 10); const compressedSize = u32(buffer, offset + 20); const nameLength = u16(buffer, offset + 28); const extraLength = u16(buffer, offset + 30); const commentLength = u16(buffer, offset + 32); const localOffset = u32(buffer, offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name === wanted) {
      const localNameLength = u16(buffer, localOffset + 26); const localExtraLength = u16(buffer, localOffset + 28); const start = localOffset + 30 + localNameLength + localExtraLength; const compressed = buffer.subarray(start, start + compressedSize);
      return method === 8 ? inflateRawSync(compressed) : Buffer.from(compressed);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`ZIP entry missing: ${wanted}`);
}

function deck(image: ImageElement): DeckDocument {
  return {
    schemaVersion: "0.1", id: "deck_image_layout", title: "Image layout", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [{ id: "s1", order: 0, title: "Image", archetype: "freeform", semantic: { purpose: "test", takeaway: "test", questionAnswered: "test", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" }, scene: [image], status: "draft", qaIssueIds: [], dependencyIds: [] }],
  };
}

function baseImage(overrides: Partial<ImageElement> = {}): ImageElement {
  return {
    id: "hero", type: "image", assetId: "asset_hero", fit: "cover", semanticRole: "visual", geometry: { x: 200, y: 200, width: 600, height: 600 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], ...overrides,
  };
}

test("PowerPoint picture exports focal cover crop and ellipse as native OOXML", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-pptx-image-layout-"));
  try {
    const assetPath = join(root, "image.png"); const output = join(root, "out.pptx"); await writeFile(assetPath, PNG);
    const image = baseImage({ focalPoint: { x: .8, y: .5 }, clipShape: "ellipse" });
    const result = await compileRichDeckToPptx(deck(image), output, { assets: { asset_hero: { path: assetPath, mimeType: "image/png", width: 2000, height: 1000 } } });
    assert.equal(result.richElementResults.find(item => item.elementId === "hero")?.strategy, "native");
    const xml = zipEntry(await readFile(output), "ppt/slides/slide1.xml").toString("utf8");
    assert.match(xml, /<a:srcRect l="50000" t="0" r="0" b="0"\/>/);
    assert.match(xml, /<a:prstGeom prst="ellipse">/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("PowerPoint contain fit letterboxes native picture geometry instead of stretching it", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-pptx-image-contain-"));
  try {
    const assetPath = join(root, "image.png"); const output = join(root, "out.pptx"); await writeFile(assetPath, PNG);
    const image = baseImage({ fit: "contain", geometry: { x: 200, y: 200, width: 600, height: 600 } });
    await compileRichDeckToPptx(deck(image), output, { assets: { asset_hero: { path: assetPath, mimeType: "image/png", width: 2000, height: 1000 } } });
    const xml = zipEntry(await readFile(output), "ppt/slides/slide1.xml").toString("utf8");
    const y = Math.round(350 * (914400 / 144)); const h = Math.round(300 * (914400 / 144));
    assert.match(xml, new RegExp(`<a:off x="${Math.round(200 * (914400 / 144))}" y="${y}"/><a:ext cx="${Math.round(600 * (914400 / 144))}" cy="${h}"/>`));
  } finally { await rm(root, { recursive: true, force: true }); }
});
