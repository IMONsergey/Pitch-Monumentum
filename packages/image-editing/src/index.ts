export interface NormalizedCrop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type ImageFit = "cover" | "contain" | "stretch";

export interface ImageViewport {
  imageX: number;
  imageY: number;
  imageWidth: number;
  imageHeight: number;
  visibleSourceWidth: number;
  visibleSourceHeight: number;
  scaleX: number;
  scaleY: number;
}

export interface FocalPoint {
  x: number;
  y: number;
}

const EPSILON = 1e-6;

function clamp01(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return Math.max(0, Math.min(1, value));
}

export function normalizeCrop(crop?: Partial<NormalizedCrop> | null): NormalizedCrop {
  const next: NormalizedCrop = {
    left: clamp01(crop?.left ?? 0, "crop.left"),
    top: clamp01(crop?.top ?? 0, "crop.top"),
    right: clamp01(crop?.right ?? 0, "crop.right"),
    bottom: clamp01(crop?.bottom ?? 0, "crop.bottom"),
  };
  if (next.left + next.right >= 1 - EPSILON) throw new Error("Horizontal crop must leave some source image visible");
  if (next.top + next.bottom >= 1 - EPSILON) throw new Error("Vertical crop must leave some source image visible");
  return next;
}

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be greater than zero`);
  return value;
}

/**
 * Returns the original image's rendered rectangle inside a fixed scene box.
 * The scene box never changes; the original bytes never change.
 */
export function computeImageViewport(
  assetWidth: number,
  assetHeight: number,
  boxWidth: number,
  boxHeight: number,
  cropInput?: Partial<NormalizedCrop> | null,
  fit: ImageFit = "cover",
): ImageViewport {
  const aw = positive(assetWidth, "assetWidth");
  const ah = positive(assetHeight, "assetHeight");
  const bw = positive(boxWidth, "boxWidth");
  const bh = positive(boxHeight, "boxHeight");
  const crop = normalizeCrop(cropInput);
  const visibleSourceWidth = aw * (1 - crop.left - crop.right);
  const visibleSourceHeight = ah * (1 - crop.top - crop.bottom);

  let scaleX: number;
  let scaleY: number;
  if (fit === "stretch") {
    scaleX = bw / visibleSourceWidth;
    scaleY = bh / visibleSourceHeight;
  } else {
    const scale = fit === "contain"
      ? Math.min(bw / visibleSourceWidth, bh / visibleSourceHeight)
      : Math.max(bw / visibleSourceWidth, bh / visibleSourceHeight);
    scaleX = scale;
    scaleY = scale;
  }

  const visibleWidth = visibleSourceWidth * scaleX;
  const visibleHeight = visibleSourceHeight * scaleY;
  const visibleX = (bw - visibleWidth) / 2;
  const visibleY = (bh - visibleHeight) / 2;
  return {
    imageX: visibleX - aw * crop.left * scaleX,
    imageY: visibleY - ah * crop.top * scaleY,
    imageWidth: aw * scaleX,
    imageHeight: ah * scaleY,
    visibleSourceWidth,
    visibleSourceHeight,
    scaleX,
    scaleY,
  };
}

/** Create a centered/focal crop that makes the remaining source rectangle match an aspect ratio. */
export function cropForAspect(assetWidth: number, assetHeight: number, targetAspect: number, focal: FocalPoint = { x: 0.5, y: 0.5 }): NormalizedCrop {
  const aw = positive(assetWidth, "assetWidth");
  const ah = positive(assetHeight, "assetHeight");
  const aspect = positive(targetAspect, "targetAspect");
  const fx = clamp01(focal.x, "focal.x");
  const fy = clamp01(focal.y, "focal.y");
  const sourceAspect = aw / ah;

  if (Math.abs(sourceAspect - aspect) < EPSILON) return { left: 0, top: 0, right: 0, bottom: 0 };

  if (sourceAspect > aspect) {
    const visibleWidth = ah * aspect;
    const visibleFraction = visibleWidth / aw;
    const cropFraction = 1 - visibleFraction;
    const idealLeft = fx - visibleFraction / 2;
    const left = Math.max(0, Math.min(cropFraction, idealLeft));
    return normalizeCrop({ left, right: cropFraction - left, top: 0, bottom: 0 });
  }

  const visibleHeight = aw / aspect;
  const visibleFraction = visibleHeight / ah;
  const cropFraction = 1 - visibleFraction;
  const idealTop = fy - visibleFraction / 2;
  const top = Math.max(0, Math.min(cropFraction, idealTop));
  return normalizeCrop({ top, bottom: cropFraction - top, left: 0, right: 0 });
}

export function cropPercent(cropInput?: Partial<NormalizedCrop> | null): { left: number; top: number; right: number; bottom: number } {
  const crop = normalizeCrop(cropInput);
  return {
    left: crop.left * 100,
    top: crop.top * 100,
    right: crop.right * 100,
    bottom: crop.bottom * 100,
  };
}
