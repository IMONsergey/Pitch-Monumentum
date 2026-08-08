import type { Geometry, ImageClipShape, ImageElement, ImageFocalPoint } from "../../deck-model/src/index.js";

export interface ImageAssetDimensions {
  width: number;
  height: number;
}

export interface NormalizedCrop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number`);
  return value;
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : .5));
}

export function normalizedImageFocalPoint(image: Pick<ImageElement, "focalPoint" | "crop">): ImageFocalPoint {
  const crop = normalizedImageCrop(image.crop);
  const point = image.focalPoint ?? { x: .5, y: .5 };
  return {
    x: Math.max(crop.left, Math.min(1 - crop.right, clamp01(point.x))),
    y: Math.max(crop.top, Math.min(1 - crop.bottom, clamp01(point.y))),
  };
}

export function normalizedImageCrop(crop?: ImageElement["crop"]): NormalizedCrop {
  if (!crop) return { left: 0, top: 0, right: 0, bottom: 0 };
  const next = {
    left: clamp01(crop.left),
    top: clamp01(crop.top),
    right: clamp01(crop.right),
    bottom: clamp01(crop.bottom),
  };
  if (next.left + next.right >= 1) {
    const total = next.left + next.right;
    const scale = .999 / Math.max(.001, total);
    next.left *= scale;
    next.right *= scale;
  }
  if (next.top + next.bottom >= 1) {
    const total = next.top + next.bottom;
    const scale = .999 / Math.max(.001, total);
    next.top *= scale;
    next.bottom *= scale;
  }
  return next;
}

export function effectiveImageClipShape(image: Pick<ImageElement, "clipShape" | "cornerRadiusDU">): ImageClipShape {
  if (image.clipShape) return image.clipShape;
  return (image.cornerRadiusDU ?? 0) > 0 ? "roundRect" : "rect";
}

function clampWindowStart(center: number, size: number, minimum: number, maximum: number): number {
  const maxStart = maximum - size;
  return Math.max(minimum, Math.min(maxStart, center - size / 2));
}

/**
 * Returns the source-space crop that should be used for a cover fit.
 * An authored crop is treated as the initial source window; cover may add
 * additional crop inside that window while honoring focalPoint.
 */
export function coverCropForImage(image: Pick<ImageElement, "geometry" | "crop" | "focalPoint" | "fit">, asset: ImageAssetDimensions): NormalizedCrop {
  const base = normalizedImageCrop(image.crop);
  if (image.fit !== "cover") return base;
  const assetWidth = finitePositive(asset.width, "asset width");
  const assetHeight = finitePositive(asset.height, "asset height");
  const frameWidth = finitePositive(image.geometry.width, "image frame width");
  const frameHeight = finitePositive(image.geometry.height, "image frame height");
  const baseWidth = 1 - base.left - base.right;
  const baseHeight = 1 - base.top - base.bottom;
  const sourceAspect = (assetWidth * baseWidth) / (assetHeight * baseHeight);
  const frameAspect = frameWidth / frameHeight;
  const focal = normalizedImageFocalPoint(image);

  if (Math.abs(sourceAspect - frameAspect) < 1e-9) return base;

  if (sourceAspect > frameAspect) {
    const visibleWidth = baseWidth * (frameAspect / sourceAspect);
    const left = clampWindowStart(focal.x, visibleWidth, base.left, 1 - base.right);
    return { left, top: base.top, right: Math.max(0, 1 - left - visibleWidth), bottom: base.bottom };
  }

  const visibleHeight = baseHeight * (sourceAspect / frameAspect);
  const top = clampWindowStart(focal.y, visibleHeight, base.top, 1 - base.bottom);
  return { left: base.left, top, right: base.right, bottom: Math.max(0, 1 - top - visibleHeight) };
}

/** Visual geometry for a contain fit. Explicit source crop changes source aspect before fitting. */
export function containGeometryForImage(image: Pick<ImageElement, "geometry" | "crop" | "fit">, asset: ImageAssetDimensions): Geometry {
  const geometry = { ...image.geometry };
  if (image.fit !== "contain") return geometry;
  const crop = normalizedImageCrop(image.crop);
  const sourceWidth = finitePositive(asset.width, "asset width") * (1 - crop.left - crop.right);
  const sourceHeight = finitePositive(asset.height, "asset height") * (1 - crop.top - crop.bottom);
  const sourceAspect = sourceWidth / sourceHeight;
  const frameAspect = finitePositive(geometry.width, "image frame width") / finitePositive(geometry.height, "image frame height");
  if (sourceAspect > frameAspect) {
    const height = geometry.width / sourceAspect;
    return { ...geometry, y: geometry.y + (geometry.height - height) / 2, height };
  }
  const width = geometry.height * sourceAspect;
  return { ...geometry, x: geometry.x + (geometry.width - width) / 2, width };
}

export function cropToPercent(crop: NormalizedCrop): { left: number; top: number; right: number; bottom: number } {
  return {
    left: Math.round(crop.left * 100000),
    top: Math.round(crop.top * 100000),
    right: Math.round(crop.right * 100000),
    bottom: Math.round(crop.bottom * 100000),
  };
}
