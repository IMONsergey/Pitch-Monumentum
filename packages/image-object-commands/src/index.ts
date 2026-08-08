import type { DeckDocument, ImageElement } from "../../deck-model/src/index.js";
import { cropForAspect, normalizeCrop, type FocalPoint, type ImageFit, type NormalizedCrop } from "../../image-editing/src/index.js";
import type { AssetRecord } from "../../assets/src/index.js";

export type ImageObjectCommand =
  | { command: "setCrop"; crop: Partial<NormalizedCrop> }
  | { command: "resetCrop" }
  | { command: "cropToAspect"; aspect: number; focal?: FocalPoint }
  | { command: "setFit"; fit: ImageFit }
  | { command: "setAlt"; alt: string }
  | { command: "setCornerRadius"; radiusDU?: number };

export interface ImageObjectCommandResult {
  deck: DeckDocument;
  changed: boolean;
  slideId: string;
  elementId: string;
  reason: string;
  impact: {
    affectedSlideIds: string[];
    affectedElementIds: string[];
    staleArtifacts: Array<"qa:visual" | "qa:readability" | "export">;
    evidenceRisk: false;
  };
}

function replaceImage(deck: DeckDocument, slideId: string, elementId: string, replacement: ImageElement): DeckDocument {
  return {
    ...deck,
    updatedAt: new Date().toISOString(),
    slides: deck.slides.map((slide) => slide.id === slideId ? {
      ...slide,
      status: "draft",
      scene: slide.scene.map((element) => element.id === elementId ? replacement : element),
    } : slide),
  };
}

function same(a: ImageElement, b: ImageElement): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function executeImageObjectCommand(
  deck: DeckDocument,
  slideId: string,
  elementId: string,
  command: ImageObjectCommand,
  asset?: Pick<AssetRecord, "id" | "width" | "height">,
): ImageObjectCommandResult {
  const slide = deck.slides.find((item) => item.id === slideId);
  if (!slide) throw new Error(`Unknown slide: ${slideId}`);
  const element = slide.scene.find((item) => item.id === elementId);
  if (!element) throw new Error(`Unknown element ${elementId} on slide ${slideId}`);
  if (element.type !== "image") throw new Error(`Element ${elementId} is not an image`);
  const next: ImageElement = structuredClone(element);

  if (command.command === "setCrop") {
    next.crop = normalizeCrop(command.crop);
  } else if (command.command === "resetCrop") {
    delete next.crop;
  } else if (command.command === "cropToAspect") {
    if (!asset) throw new Error("cropToAspect requires source asset dimensions");
    if (asset.id !== element.assetId) throw new Error(`Asset ${asset.id} does not match image element asset ${element.assetId}`);
    next.crop = cropForAspect(asset.width, asset.height, command.aspect, command.focal);
  } else if (command.command === "setFit") {
    if (!["cover", "contain", "stretch"].includes(command.fit)) throw new Error(`Unsupported image fit ${command.fit}`);
    next.fit = command.fit;
  } else if (command.command === "setAlt") {
    next.alt = command.alt.trim();
  } else {
    if (command.radiusDU === undefined) delete next.cornerRadiusDU;
    else {
      if (!Number.isFinite(command.radiusDU) || command.radiusDU < 0) throw new Error("Image corner radius must be a non-negative finite number");
      next.cornerRadiusDU = command.radiusDU;
    }
  }

  next.origin = "user";
  const changed = !same(element, next);
  return {
    deck: changed ? replaceImage(deck, slideId, elementId, next) : deck,
    changed,
    slideId,
    elementId,
    reason: `Edit image ${elementId}: ${command.command}`,
    impact: {
      affectedSlideIds: [slideId],
      affectedElementIds: [elementId],
      staleArtifacts: ["qa:visual", "qa:readability", "export"],
      evidenceRisk: false,
    },
  };
}
