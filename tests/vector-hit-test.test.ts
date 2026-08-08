import test from "node:test";
import assert from "node:assert/strict";
import { splitVectorSegment } from "../packages/vector-path/src/edit.js";
import { nearestVectorSegment } from "../packages/vector-path/src/hit-test.js";
import { parseSvgPathData, vectorPathBounds } from "../packages/vector-path/src/index.js";

function close(actual: number, expected: number, tolerance = 0.01): void {
  assert(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);
}

test("nearestVectorSegment identifies the intended cubic and parameter near its midpoint", () => {
  const path = parseSvgPathData("M 0 0 C 0 100 100 100 100 0 L 180 0");
  const hit = nearestVectorSegment(path, { x: 50, y: 76 }, 64);
  assert(hit);
  assert.equal(hit!.commandIndex, 1);
  close(hit!.t, 0.5, 0.04);
  assert(hit!.distance < 2);
});

test("double-click style split at hit parameter preserves cubic curve bounds", () => {
  const path = parseSvgPathData("M 0 0 C 0 100 100 100 100 0");
  const hit = nearestVectorSegment(path, { x: 47, y: 74 }, 64);
  assert(hit);
  const split = splitVectorSegment(path, hit!.commandIndex, hit!.t);
  const before = vectorPathBounds(path);
  const after = vectorPathBounds(split);
  assert.deepEqual(split.commands.map((command) => command.command), ["M", "C", "C"]);
  close(before.left, after.left, 0.001);
  close(before.top, after.top, 0.001);
  close(before.right, after.right, 0.001);
  close(before.bottom, after.bottom, 0.001);
});

test("hit testing chooses a later line segment when pointer is closer to it", () => {
  const path = parseSvgPathData("M 0 0 L 100 0 L 100 100 L 0 100");
  const hit = nearestVectorSegment(path, { x: 99, y: 70 }, 16);
  assert(hit);
  assert.equal(hit!.commandIndex, 2);
  assert(hit!.distance < 2);
});
