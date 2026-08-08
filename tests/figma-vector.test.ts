import test from "node:test";
import assert from "node:assert/strict";
import type { ShapeElement } from "../packages/deck-model/src/index.js";
import { pitchVectorToFigmaPayload } from "../packages/figma-vector/src/index.js";
import { parseSvgPathData, vectorPathToSvg } from "../packages/vector-path/src/index.js";

test("Figma vector payload preserves winding rule, path data and appearance separately", () => {
  const pathData = parseSvgPathData("M 0 0 L 100 0 L 100 100 L 0 100 Z");
  pathData.fillRule = "evenodd";
  const element: ShapeElement = {
    id: "figma_vector",
    name: "Figma vector",
    type: "shape",
    shape: "custom",
    semanticRole: "visual",
    geometry: { x: 200, y: 300, width: 500, height: 240 },
    zIndex: 3,
    origin: "user",
    exportStrategy: "vector",
    dependencies: [],
    pathData,
    fillPaint: { kind: "solid", color: "#335CFF", opacity: 0.85 },
    stroke: { color: "#111111", widthDU: 4, dash: "dash" },
    effects: [{ kind: "dropShadow", color: "#000000", opacity: 0.2, blurDU: 16, offsetXDU: 4, offsetYDU: 8 }],
  };
  const payload = pitchVectorToFigmaPayload(element);
  assert.equal(payload.pitchId, "figma_vector");
  assert.equal(payload.width, 500);
  assert.equal(payload.height, 240);
  assert.equal(payload.vectorPaths.length, 1);
  assert.equal(payload.vectorPaths[0].windingRule, "EVENODD");
  assert.equal(payload.vectorPaths[0].data, vectorPathToSvg(pathData));
  assert.deepEqual(payload.fillPaint, element.fillPaint);
  assert.deepEqual(payload.stroke, element.stroke);
  assert.deepEqual(payload.effects, element.effects);
});

test("Figma adapter refuses legacy-only SVG vectors so editable mapping is never guessed", () => {
  const legacy: ShapeElement = {
    id: "legacy",
    type: "shape",
    shape: "custom",
    semanticRole: "visual",
    geometry: { x: 0, y: 0, width: 100, height: 100 },
    zIndex: 1,
    origin: "import",
    exportStrategy: "vector",
    dependencies: [],
    svgPath: "M 0 0 A 50 50 0 0 1 100 100",
  };
  assert.throws(() => pitchVectorToFigmaPayload(legacy), /not a structured vector/);
});
