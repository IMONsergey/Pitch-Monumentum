import type { DeckDocument, ImageElement } from "../../deck-model/src/index.js";
import type { DeckMutationOperation } from "../../mutations/src/index.js";

export type ImageCrop = NonNullable<ImageElement["crop"]>;

export type MediaCommand =
  | { command: "setImageFit"; slideId: string; elementId: string; fit: ImageElement["fit"] }
  | { command: "setImageCrop"; slideId: string; elementId: string; crop: ImageCrop | null }
  | { command: "replaceImageAsset"; slideId: string; elementId: string; assetId: string; alt?: string | null }
  | { command: "setImageCornerRadius"; slideId: string; elementId: string; cornerRadiusDU: number | null };

export interface MediaCommandResult {
  operations: DeckMutationOperation[];
  reason: string;
  nextSelectionIds: string[];
}

function image(deck: DeckDocument, slideId: string, elementId: string): ImageElement {
  const slide = deck.slides.find((item) => item.id === slideId);
  if (!slide) throw new Error(`Unknown slide: ${slideId}`);
  const element = slide.scene.find((item) => item.id === elementId);
  if (!element) throw new Error(`Unknown element ${elementId} on slide ${slideId}`);
  if (element.type !== "image") throw new Error(`Element ${elementId} is not an image`);
  return element;
}

export function validateImageCrop(crop: ImageCrop): void {
  for (const [key, value] of Object.entries(crop)) {
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error(`Image crop ${key} must be between 0 (inclusive) and 1 (exclusive)`);
  }
  if (crop.left + crop.right >= 1) throw new Error("Image crop left + right must leave visible width");
  if (crop.top + crop.bottom >= 1) throw new Error("Image crop top + bottom must leave visible height");
}

export function executeMediaCommand(deck: DeckDocument, command: MediaCommand): MediaCommandResult {
  image(deck, command.slideId, command.elementId);
  let operation: DeckMutationOperation;
  let reason: string;

  if (command.command === "setImageFit") {
    operation = { op: "updateElementStyle", slideId: command.slideId, elementId: command.elementId, style: { kind: "image", fit: command.fit } };
    reason = `Set image fit ${command.fit}`;
  } else if (command.command === "setImageCrop") {
    if (command.crop) validateImageCrop(command.crop);
    operation = { op: "updateElementStyle", slideId: command.slideId, elementId: command.elementId, style: { kind: "image", crop: command.crop } };
    reason = command.crop ? `Crop image ${command.elementId}` : `Reset image crop ${command.elementId}`;
  } else if (command.command === "replaceImageAsset") {
    if (!command.assetId.trim()) throw new Error("assetId is required");
    operation = {
      op: "updateElementStyle",
      slideId: command.slideId,
      elementId: command.elementId,
      style: { kind: "image", assetId: command.assetId.trim(), ...(command.alt !== undefined ? { alt: command.alt } : {}) },
    };
    reason = `Replace image asset on ${command.elementId}`;
  } else {
    if (command.cornerRadiusDU !== null && (!Number.isFinite(command.cornerRadiusDU) || command.cornerRadiusDU < 0)) throw new Error("Image corner radius must be non-negative");
    operation = { op: "updateElementStyle", slideId: command.slideId, elementId: command.elementId, style: { kind: "image", cornerRadiusDU: command.cornerRadiusDU } };
    reason = `Set image corner radius on ${command.elementId}`;
  }

  return { operations: [operation], reason, nextSelectionIds: [command.elementId] };
}
