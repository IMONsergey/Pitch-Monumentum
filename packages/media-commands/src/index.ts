import type { DeckDocument, ImageElement, ImageFocalPoint, SlideDocument } from "../../deck-model/src/index.js";

export type ImageCrop = NonNullable<ImageElement["crop"]>;

export interface ImageMediaPatch {
  fit?: ImageElement["fit"];
  crop?: ImageCrop | null;
  focalPoint?: ImageFocalPoint | null;
  clipShape?: ImageElement["clipShape"] | null;
  assetId?: string;
  alt?: string | null;
  cornerRadiusDU?: number | null;
}

export type MediaCommand =
  | { command: "setImageProperties"; slideId: string; elementId: string; changes: ImageMediaPatch }
  | { command: "setImageFit"; slideId: string; elementId: string; fit: ImageElement["fit"] }
  | { command: "setImageCrop"; slideId: string; elementId: string; crop: ImageCrop | null }
  | { command: "setImageFocalPoint"; slideId: string; elementId: string; focalPoint: ImageFocalPoint | null }
  | { command: "setImageClipShape"; slideId: string; elementId: string; clipShape: ImageElement["clipShape"] | null }
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

export function validateImageFocalPoint(point: ImageFocalPoint): void {
  if (!Number.isFinite(point.x) || point.x < 0 || point.x > 1) throw new Error("Image focal point x must be between 0 and 1");
  if (!Number.isFinite(point.y) || point.y < 0 || point.y > 1) throw new Error("Image focal point y must be between 0 and 1");
}

function applyPatch(image: ImageElement, patch: ImageMediaPatch): ImageElement {
  const next = structuredClone(image);
  if (patch.fit !== undefined) next.fit = patch.fit;
  if (patch.crop !== undefined) {
    if (patch.crop) validateImageCrop(patch.crop);
    next.crop = patch.crop ? structuredClone(patch.crop) : undefined;
  }
  if (patch.focalPoint !== undefined) {
    if (patch.focalPoint) validateImageFocalPoint(patch.focalPoint);
    next.focalPoint = patch.focalPoint ? structuredClone(patch.focalPoint) : undefined;
  }
  if (patch.clipShape !== undefined) {
    if (patch.clipShape !== null && !["rect", "roundRect", "ellipse"].includes(patch.clipShape)) throw new Error(`Unsupported image clip shape: ${patch.clipShape}`);
    next.clipShape = patch.clipShape ?? undefined;
  }
  if (patch.assetId !== undefined) {
    if (!patch.assetId.trim()) throw new Error("assetId is required");
    next.assetId = patch.assetId.trim();
  }
  if (patch.alt !== undefined) next.alt = patch.alt ?? undefined;
  if (patch.cornerRadiusDU !== undefined) {
    if (patch.cornerRadiusDU !== null && (!Number.isFinite(patch.cornerRadiusDU) || patch.cornerRadiusDU < 0)) throw new Error("Image corner radius must be non-negative");
    next.cornerRadiusDU = patch.cornerRadiusDU ?? undefined;
  }
  return next;
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
  let patch: ImageMediaPatch;
  let reason: string;

  if (command.command === "setImageProperties") {
    patch = command.changes;
    reason = `Update image media ${command.elementId}`;
  } else if (command.command === "setImageFit") {
    patch = { fit: command.fit };
    reason = `Set image fit ${command.fit}`;
  } else if (command.command === "setImageCrop") {
    patch = { crop: command.crop };
    reason = command.crop ? `Crop image ${command.elementId}` : `Reset image crop ${command.elementId}`;
  } else if (command.command === "setImageFocalPoint") {
    patch = { focalPoint: command.focalPoint };
    reason = command.focalPoint ? `Set image focal point ${command.elementId}` : `Reset image focal point ${command.elementId}`;
  } else if (command.command === "setImageClipShape") {
    patch = { clipShape: command.clipShape };
    reason = `Set image clip shape ${command.clipShape ?? "rect"}`;
  } else if (command.command === "replaceImageAsset") {
    patch = { assetId: command.assetId, ...(command.alt !== undefined ? { alt: command.alt } : {}) };
    reason = `Replace image asset on ${command.elementId}`;
  } else {
    patch = { cornerRadiusDU: command.cornerRadiusDU };
    reason = `Set image corner radius on ${command.elementId}`;
  }

  const nextDeck = replaceImage(deck, slide, image, applyPatch(image, patch));
  return {
    deck: nextDeck,
    changed: nextDeck !== deck,
    reason,
    affectedSlideIds: [slide.id],
    affectedElementIds: [image.id],
    nextSelectionIds: [image.id],
  };
}
