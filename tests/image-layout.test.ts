import test from "node:test";
import assert from "node:assert/strict";
import type { ImageElement } from "../packages/deck-model/src/index.js";
import { containGeometryForImage, coverCropForImage, effectiveImageClipShape, normalizedImageFocalPoint } from "../packages/image-layout/src/index.js";

function image(overrides: Partial<ImageElement> = {}): ImageElement {
  return {
    id: "image", type: "image", assetId: "asset", fit: "cover", semanticRole: "visual",
    geometry: { x: 100, y: 200, width: 600, height: 600 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [],
    ...overrides,
  };
}

function near(actual: number, expected: number, epsilon = 1e-6): void {
  assert(Math.abs(actual - expected) <= epsilon, `${actual} should be close to ${expected}`);
}

test("cover crop uses focal point for a wide source", () => {
  const crop = coverCropForImage(image({ focalPoint: { x: .8, y: .5 } }), { width: 2000, height: 1000 });
  near(crop.left, .5);
  near(crop.right, 0);
  near(crop.top, 0);
  near(crop.bottom, 0);
});

test("cover crop respects an authored crop as the initial source window", () => {
  const crop = coverCropForImage(image({ crop: { left: .1, top: 0, right: .1, bottom: 0 }, focalPoint: { x: .5, y: .5 } }), { width: 2000, height: 1000 });
  near(crop.left, .25);
  near(crop.right, .25);
});

test("cover crop uses focal point vertically for a tall source", () => {
  const crop = coverCropForImage(image({ focalPoint: { x: .5, y: .2 } }), { width: 1000, height: 2000 });
  near(crop.left, 0);
  near(crop.right, 0);
  near(crop.top, 0);
  near(crop.bottom, .5);
});

test("contain geometry preserves source aspect and centers inside authored frame", () => {
  const geometry = containGeometryForImage(image({ fit: "contain", geometry: { x: 100, y: 200, width: 600, height: 600 } }), { width: 2000, height: 1000 });
  near(geometry.x, 100);
  near(geometry.width, 600);
  near(geometry.height, 300);
  near(geometry.y, 350);
});

test("focal point is constrained to the explicit source crop", () => {
  const focal = normalizedImageFocalPoint(image({ crop: { left: .2, top: .1, right: .3, bottom: .4 }, focalPoint: { x: .95, y: .02 } }));
  near(focal.x, .7);
  near(focal.y, .1);
});

test("legacy corner radius implies roundRect until a clip shape is explicit", () => {
  assert.equal(effectiveImageClipShape(image({ cornerRadiusDU: 24 })), "roundRect");
  assert.equal(effectiveImageClipShape(image({ cornerRadiusDU: 24, clipShape: "ellipse" })), "ellipse");
  assert.equal(effectiveImageClipShape(image()), "rect");
});
