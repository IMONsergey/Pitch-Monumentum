import test from "node:test";
import assert from "node:assert/strict";
import { computeImageViewport, cropForAspect, cropPercent, normalizeCrop } from "../packages/image-editing/src/index.js";

test("cover viewport applies crop to source before fitting the fixed box", () => {
  const view = computeImageViewport(2000, 1000, 800, 600, { left: 0.1, right: 0.1, top: 0, bottom: 0 }, "cover");
  assert.equal(view.visibleSourceWidth, 1600);
  assert.equal(view.visibleSourceHeight, 1000);
  assert.equal(view.scaleX, 0.6);
  assert.equal(view.scaleY, 0.6);
  assert.equal(view.imageWidth, 1200);
  assert.equal(view.imageHeight, 600);
  assert.equal(view.imageX, -200);
  assert.equal(view.imageY, 0);
});

test("contain viewport centers the cropped source without changing crop percentages", () => {
  const view = computeImageViewport(1000, 1000, 800, 400, { top: 0.25, bottom: 0.25 }, "contain");
  assert.equal(view.visibleSourceWidth, 1000);
  assert.equal(view.visibleSourceHeight, 500);
  assert.equal(view.scaleX, 0.8);
  assert.equal(view.scaleY, 0.8);
  assert.equal(view.imageWidth, 800);
  assert.equal(view.imageHeight, 800);
  assert.equal(view.imageX, 0);
  assert.equal(view.imageY, -200);
});

test("stretch may use different x/y scales but still preserves original bytes mathematically", () => {
  const view = computeImageViewport(1200, 800, 600, 600, { left: 0.25, right: 0.25 }, "stretch");
  assert.equal(view.visibleSourceWidth, 600);
  assert.equal(view.visibleSourceHeight, 800);
  assert.equal(view.scaleX, 1);
  assert.equal(view.scaleY, 0.75);
  assert.equal(view.imageX, -300);
  assert.equal(view.imageY, 0);
  assert.equal(view.imageWidth, 1200);
  assert.equal(view.imageHeight, 600);
});

test("cropForAspect centers or preserves focal point while matching target aspect", () => {
  const centered = cropForAspect(2000, 1000, 1);
  assert(Math.abs(centered.left - 0.25) < 1e-9);
  assert(Math.abs(centered.right - 0.25) < 1e-9);
  const rightFocus = cropForAspect(2000, 1000, 1, { x: 0.9, y: 0.5 });
  assert(rightFocus.left > rightFocus.right);
  assert(Math.abs((1 - rightFocus.left - rightFocus.right) * 2000 / 1000 - 1) < 1e-9);

  const portraitSource = cropForAspect(1000, 2000, 16 / 9, { x: 0.5, y: 0.2 });
  assert.equal(portraitSource.left, 0);
  assert.equal(portraitSource.right, 0);
  assert(portraitSource.bottom > portraitSource.top, "upper focal point should preserve more of the upper source");
});

test("crop normalization fails closed when margins remove the entire source", () => {
  assert.deepEqual(normalizeCrop(), { left: 0, top: 0, right: 0, bottom: 0 });
  assert.throws(() => normalizeCrop({ left: 0.6, right: 0.4 }), /leave some source image visible/);
  assert.throws(() => normalizeCrop({ top: 0.7, bottom: 0.31 }), /leave some source image visible/);
  assert.throws(() => computeImageViewport(0, 100, 100, 100), /assetWidth/);
});

test("cropPercent maps normalized source margins to OOXML-style percentage values", () => {
  assert.deepEqual(cropPercent({ left: 0.1, top: 0.2, right: 0.3, bottom: 0.4 }), { left: 10, top: 20, right: 30, bottom: 40 });
});
