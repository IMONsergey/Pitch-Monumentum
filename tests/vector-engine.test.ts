import test from "node:test";
import assert from "node:assert/strict";
import { buildFreehandVector, buildPenVector } from "../packages/vector-engine/src/index.js";

test("Pencil converts pressure samples into a closed local SVG custom shape", () => {
  const built = buildFreehandVector([
    { x: 100, y: 200, pressure: 0.2 },
    { x: 140, y: 190, pressure: 0.5 },
    { x: 190, y: 220, pressure: 0.9 },
    { x: 250, y: 205, pressure: 0.4 },
  ], { sizeDU: 20, thinning: 0.6, smoothing: 0.6, simulatePressure: false }, { fill: "#335CFF" });
  assert.equal(built.element.type, "shape");
  assert.equal(built.element.shape, "custom");
  assert.equal(built.element.exportStrategy, "vector");
  assert.equal(built.element.fill, "#335CFF");
  assert(built.element.geometry.width > 0);
  assert(built.element.geometry.height > 0);
  assert.match(built.element.svgPath ?? "", /^M /);
  assert.match(built.element.svgPath ?? "", / Q /);
  assert.match(built.element.svgPath ?? "", / Z$/);
  assert(!/\b1\d{2,3}(?:\.\d+)?\b/.test((built.element.svgPath ?? "").split(" ").slice(1, 3).join(" ")), "path coordinates should be local to its bounds, not raw page coordinates");
});

test("Pen emits cubic Bezier local path and preserves open stroke semantics", () => {
  const built = buildPenVector([
    { x: 300, y: 200, out: { x: 360, y: 140 } },
    { x: 500, y: 260, in: { x: 430, y: 310 }, out: { x: 560, y: 210 } },
    { x: 680, y: 220, in: { x: 620, y: 160 } },
  ], false, { stroke: { color: "#111111", widthDU: 4 } });
  assert.equal(built.element.fill, "transparent");
  assert.equal(built.element.stroke?.widthDU, 4);
  assert.match(built.element.svgPath ?? "", /^M /);
  assert.match(built.element.svgPath ?? "", / C /);
  assert.doesNotMatch(built.element.svgPath ?? "", / Z$/);
  assert.equal(built.element.geometry.x, 300);
  assert.equal(built.element.geometry.y, 140);
  assert.equal(built.element.geometry.width, 380);
  assert.equal(built.element.geometry.height, 170);
});

test("closed Pen path adds final segment and closes the custom shape", () => {
  const built = buildPenVector([
    { x: 20, y: 20 },
    { x: 220, y: 20 },
    { x: 220, y: 160 },
    { x: 20, y: 160 },
  ], true, { fill: "#C7FF5E" });
  assert.equal(built.element.fill, "#C7FF5E");
  assert.match(built.element.svgPath ?? "", / Z$/);
  assert.equal(built.element.geometry.x, 20);
  assert.equal(built.element.geometry.y, 20);
  assert.equal(built.element.geometry.width, 200);
  assert.equal(built.element.geometry.height, 140);
});

test("vector builders reject invalid input instead of creating corrupt geometry", () => {
  assert.throws(() => buildFreehandVector([{ x: 0, y: 0 }]), /at least two points/);
  assert.throws(() => buildPenVector([{ x: 0, y: 0 }]), /at least two anchors/);
  assert.throws(() => buildPenVector([{ x: 0, y: 0 }, { x: Number.NaN, y: 10 }]), /must be finite/);
});
