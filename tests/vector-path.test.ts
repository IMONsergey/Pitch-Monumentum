import test from "node:test";
import assert from "node:assert/strict";
import { vectorPathCommandsToSvgPath, vectorPathDataToSvgPath } from "../packages/vector-path/src/index.js";

test("canonical vector path serializer preserves M L Q C Z geometry", () => {
  const value = vectorPathCommandsToSvgPath([
    { command: "M", x: 0, y: -0 },
    { command: "L", x: 12.5, y: 18 },
    { command: "Q", x1: 20, y1: 30, x: 40, y: 50 },
    { command: "C", x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 },
    { command: "Z" },
  ]);
  assert.equal(value, "M0 0 L12.5 18 Q20 30 40 50 C1 2 3 4 5 6 Z");
});

test("vector path data requires commands and rejects non-finite coordinates", () => {
  assert.throws(() => vectorPathDataToSvgPath({ commands: [] }), /at least one command/);
  assert.throws(() => vectorPathCommandsToSvgPath([{ command: "L", x: Number.NaN, y: 2 }]), /must be finite/);
});
