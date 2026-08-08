import test from "node:test";
import assert from "node:assert/strict";
import { buildFreehandVector, buildPenVector } from "../packages/vector-engine/src/index.js";
import { validateVectorPathData, vectorPathToSvg } from "../packages/vector-path/src/index.js";

test("Pencil converts pressure samples into canonical structured vector geometry", () => {
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
  assert(built.element.pathData);
  validateVectorPathData(built.element.pathData!);
  assert.equal(built.element.svgPath, vectorPathToSvg(built.element.pathData!));
  assert.equal(built.element.pathData!.commands.at(-1)?.command, "Z");
  assert(built.element.pathData!.commands.some((command) => command.command === "Q"));
});

test("Pen emits canonical cubic Bezier pathData and preserves open stroke semantics", () => {
  const built = buildPenVector([
    { x: 300, y: 200, out: { x: 360, y: 140 } },
    { x: 500, y: 260, in: { x: 430, y: 310 }, out: { x: 560, y: 210 } },
    { x: 680, y: 220, in: { x: 620, y: 160 } },
  ], false, { stroke: { color: "#111111", widthDU: 4 } });
  assert.equal(built.element.fill, "transparent");
  assert.equal(built.element.stroke?.widthDU, 4);
  assert(built.element.pathData);
  validateVectorPathData(built.element.pathData!);
  assert(built.element.pathData!.commands.some((command) => command.command === "C"));
  assert.notEqual(built.element.pathData!.commands.at(-1)?.command, "Z");
  assert.equal(built.element.svgPath, vectorPathToSvg(built.element.pathData!));
  assert.equal(built.element.geometry.x, 300);
  assert.equal(built.element.geometry.y, 140);
  assert.equal(built.element.geometry.width, 380);
  assert.equal(built.element.geometry.height, 170);
});

test("closed Pen path adds final segment and closes structured custom shape", () => {
  const built = buildPenVector([
    { x: 20, y: 20 },
    { x: 220, y: 20 },
    { x: 220, y: 160 },
    { x: 20, y: 160 },
  ], true, { fill: "#C7FF5E" });
  assert.equal(built.element.fill, "#C7FF5E");
  assert(built.element.pathData);
  assert.equal(built.element.pathData!.commands.at(-1)?.command, "Z");
  assert.equal(built.element.svgPath, vectorPathToSvg(built.element.pathData!));
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
