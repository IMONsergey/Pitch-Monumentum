import type { DeckDocument, ImageElement, SlideDocument } from "../../deck-model/src/index.js";

export type ImageCrop = NonNullable<ImageElement["crop"]>;

export type MediaCommand =
  | { command: "setImageFit"; slideId: string; elementId: string; fit: ImageElement["fit"] }
  | { command: "setImageCrop"; slideId: string; elementId: string; crop: ImageCrop | null }
  | { command: "replaceImageAsset"; slideId: string; elementId: string; assetId: string; alt?: string | null }
  | { command: "setImageCornerRadius"; slideId: string; elementId: string; cornerRadiusDU: number | null };

export interface MediaCommandResult {
  deck: DeckDocument;
  changed: boolean;
  reason: string;
  affectedSlideIds: string[];
  affectedElementIds: string[];
  nextSelectionIds: string[];
}

function resolveImage(deck: DeckDocument, slideId: string, elementId: string): { slide: SlideDocument; image: ImageElement } {
  const slide = deck.slides.find((item) => item.id === slideId);
  if (!slide) throw new Error(`Unknown slide: ${slideId}`);
  const element = slide.scene.find((item) => item.id === elementId);
  if (!element) throw new Error(`Unknown element ${elementId} on slide ${slideId}`);
  if (element.type !== "image") throw new Error(`Element ${elementId} is not an image`);
  return { slide, image: element };
}

export function validateImageCrop(crop: ImageCrop): void {
  for (const [key, value] of Object.entries(crop)) {
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error(`Image crop ${key} must be between 0 (inclusive) and 1 (exclusive)`);
  }
  if (crop.left + crop.right >= 1) throw new Error("Image crop left + right must leave visible width");
  if (crop.top + crop.bottom >= 1) throw new Error("Image crop top + bottom must leave visible height");
}

function replaceImage(deck: DeckDocument, slide: SlideDocument, image: ImageElement, nextImage: ImageElement): DeckDocument {
  if (JSON.stringify(image) === JSON.stringify(nextImage)) return deck;
  return {
    ...deck,
    slides: deck.slides.map((item) => item.id === slide.id ? {
      ...item,
      status: "draft",
      scene: item.scene.map((element) => element.id === image.id ? nextImage : element),
    } : item),
    updatedAt: new Date().toISOString(),
  };
}

export function executeMediaCommand(deck: DeckDocument, command: MediaCommand): MediaCommandResult {
  const { slide, image } = resolveImage(deck, command.slideId, command.elementId);
  let nextImage: ImageElement = structuredClone(image);
  let reason: string;

  if (command.command === "setImageFit") {
    nextImage.fit = command.fit;
    reason = `Set image fit ${command.fit}`;
  } else if (command.command === "setImageCrop") {
    if (command.crop) validateImageCrop(command.crop);
    nextImage.crop = command.crop ? structuredClone(command.crop) : undefined;
    reason = command.crop ? `Crop image ${command.elementId}` : `Reset image crop ${command.elementId}`;
  } else if (command.command === "replaceImageAsset") {
    if (!command.assetId.trim()) throw new Error("assetId is required");
    nextImage.assetId = command.assetId.trim();
    if (command.alt !== undefined) nextImage.alt = command.alt ?? undefined;
    reason = `Replace image asset on ${command.elementId}`;
  } else {
    if (command.cornerRadiusDU !== null && (!Number.isFinite(command.cornerRadiusDU) || command.cornerRadiusDU < 0)) throw new Error("Image corner radius must be non-negative");
    nextImage.cornerRadiusDU = command.cornerRadiusDU ?? undefined;
    reason = `Set image corner radius on ${command.elementId}`;
  }

  const nextDeck = replaceImage(deck, slide, image, nextImage);
  return {
    deck: nextDeck,
    changed: nextDeck !== deck,
    reason,
    affectedSlideIds: [slide.id],
    affectedElementIds: [image.id],
    nextSelectionIds: [image.id],
  };
}
