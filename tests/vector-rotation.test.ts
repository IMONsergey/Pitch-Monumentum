import test from "node:test";
import assert from "node:assert/strict";
import type { Geometry } from "../packages/deck-model/src/index.js";
import { fitEditedVectorPath } from "../packages/vector-path/src/fit.js";
import { moveVectorAnchor, parseSvgPathData, vectorPathBounds } from "../packages/vector-path/src/index.js";

function center(geometry: Geometry) {
  return { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 };
}

function close(actual: number, expected: number, tolerance = 0.001): void {
  assert(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);
}

test("fitEditedVectorPath rebases unrotated vectors without moving unchanged world points", () => {
  const before = parseSvgPathData("M 0 0 L 100 0 L 100 50 L 0 50 Z");
  const edited = moveVectorAnchor(before, 0, -50, 0, true);
  const geometry: Geometry = { x: 400, y: 300, width: 200, height: 100, rotation: 0 };
  const fitted = fitEditedVectorPath(before, edited, geometry);
  assert.deepEqual(fitted.geometry, { x: 300, y: 300, width: 300, height: 100, rotation: 0 });
  const bounds = vectorPathBounds(fitted.pathData);
  close(bounds.left, 0);
  close(bounds.top, 0);
  close(bounds.width, 150);
  close(bounds.height, 50);
});

test("local x-bound extension of a 90-degree vector shifts its world center along rotated y axis", () => {
  const before = parseSvgPathData("M 0 0 L 100 0 L 100 50 L 0 50 Z");
  const edited = moveVectorAnchor(before, 0, -50, 0, true);
  const geometry: Geometry = { x: 400, y: 300, width: 200, height: 100, rotation: 90 };
  const oldCenter = center(geometry);
  const fitted = fitEditedVectorPath(before, edited, geometry);
  const newCenter = center(fitted.geometry);

  close(fitted.geometry.width, 300);
  close(fitted.geometry.height, 100);
  close(fitted.geometry.rotation ?? 0, 90);
  // The intrinsic center moved -25 local x units. At sx=2 this is -50 DU,
  // rotated +90° => 0 DU in world X and -50 DU in world Y.
  close(newCenter.x, oldCenter.x);
  close(newCenter.y, oldCenter.y - 50);
  const bounds = vectorPathBounds(fitted.pathData);
  close(bounds.left, 0);
  close(bounds.width, 150);
});

test("rotation-aware fit preserves arbitrary angle and scales new intrinsic bounds independently", () => {
  const before = parseSvgPathData("M 0 0 L 100 0 L 100 100 L 0 100 Z");
  let edited = moveVectorAnchor(before, 0, -20, -40, true);
  edited = moveVectorAnchor(edited, 2, 130, 120, true);
  const geometry: Geometry = { x: 300, y: 200, width: 500, height: 300, rotation: 37 };
  const fitted = fitEditedVectorPath(before, edited, geometry);
  const bounds = vectorPathBounds(fitted.pathData);
  close(fitted.geometry.width, 750); // new width 150 × original sx 5
  close(fitted.geometry.height, 480); // new height 160 × original sy 3
  close(fitted.geometry.rotation ?? 0, 37);
  close(bounds.left, 0);
  close(bounds.top, 0);
  close(bounds.width, 150);
  close(bounds.height, 160);
});
