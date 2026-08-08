import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DeckDocument, ImageElement, SceneElement } from "../../deck-model/src/index.js";
import { AssetRegistry, type ImageMimeType } from "../../assets/src/index.js";

export interface FigmaBridgeAsset {
  id: string;
  mimeType: ImageMimeType;
  width: number;
  height: number;
  contentHash: string;
  bytesBase64: string;
}

export interface FigmaBridgeWarning {
  slideId: string;
  elementId: string;
  code: "unsupported-element" | "image-over-figma-limit";
  message: string;
}

export interface FigmaBridgeBundle {
  schemaVersion: "0.1";
  kind: "pitch-figma-bridge";
  createdAt: string;
  deck: DeckDocument;
  assets: Record<string, FigmaBridgeAsset>;
  warnings: FigmaBridgeWarning[];
}

const NATIVE_PLUGIN_TYPES = new Set<SceneElement["type"]>([
  "text",
  "image",
  "shape",
  "line",
  "frame",
  "group",
]);

function warningsFor(deck: DeckDocument, assetRecords: Map<string, { width: number; height: number }>): FigmaBridgeWarning[] {
  const warnings: FigmaBridgeWarning[] = [];
  for (const slide of deck.slides) {
    for (const element of slide.scene) {
      if (!NATIVE_PLUGIN_TYPES.has(element.type)) {
        warnings.push({
          slideId: slide.id,
          elementId: element.id,
          code: "unsupported-element",
          message: `Figma bridge does not yet have a native importer for ${element.type}`,
        });
      }
      if (element.type === "image") {
        const record = assetRecords.get(element.assetId);
        if (record && (record.width > 4096 || record.height > 4096)) {
          warnings.push({
            slideId: slide.id,
            elementId: element.id,
            code: "image-over-figma-limit",
            message: `Original image ${record.width}×${record.height}px exceeds Figma Plugin API's 4096px image limit; Pitch will not downscale it silently`,
          });
        }
      }
    }
  }
  return warnings;
}

export async function createFigmaBridgeBundle(deck: DeckDocument, registry: AssetRegistry): Promise<FigmaBridgeBundle> {
  const imageAssetIds = new Set(deck.slides.flatMap((slide) => slide.scene
    .filter((element): element is ImageElement => element.type === "image")
    .map((element) => element.assetId)));
  const assets: Record<string, FigmaBridgeAsset> = {};
  const assetRecords = new Map<string, { width: number; height: number }>();

  for (const assetId of imageAssetIds) {
    const record = await registry.get(assetId);
    const bytes = await registry.readBytes(assetId);
    assets[assetId] = {
      id: record.id,
      mimeType: record.mimeType,
      width: record.width,
      height: record.height,
      contentHash: record.contentHash,
      bytesBase64: bytes.toString("base64"),
    };
    assetRecords.set(assetId, { width: record.width, height: record.height });
  }

  return {
    schemaVersion: "0.1",
    kind: "pitch-figma-bridge",
    createdAt: new Date().toISOString(),
    deck: structuredClone(deck),
    assets,
    warnings: warningsFor(deck, assetRecords),
  };
}

export async function writeFigmaBridgeBundle(deck: DeckDocument, registry: AssetRegistry, outputPath: string): Promise<FigmaBridgeBundle> {
  const bundle = await createFigmaBridgeBundle(deck, registry);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(bundle)}\n`, "utf8");
  return bundle;
}
