import test from "node:test";
import assert from "node:assert/strict";
import type { ShapeElement } from "../packages/deck-model/src/index.js";
import { exchangeToVector, validateVectorExchange, vectorExchangeToSvg, vectorToExchange } from "../packages/vector-exchange/src/index.js";
import { parseSvgPathData } from "../packages/vector-path/src/index.js";

test("VectorExchange preserves structured path, paint, stroke and effects without leaking editor internals", () => {
  const pathData = parseSvgPathData("M 0 0 C 20 80 80 80 100 0 L 100 100 L 0 100 Z");
  const source: ShapeElement = {
    id: "vector_exchange",
    type: "shape",
    shape: "custom",
    name: "Exchange vector",
    semanticRole: "visual",
    geometry: { x: 100, y: 120, width: 360, height: 240 },
    zIndex: 2,
    origin: "user",
    exportStrategy: "vector",
    dependencies: [],
    pathData,
    fillPaint: {
      kind: "linearGradient",
      angleDeg: 45,
      stops: [
        { position: 0, color: "#112233", opacity: 1 },
        { position: 1, color: "#C7FF5E", opacity: 0.8 },
      ],
    },
    stroke: { color: "#001122", widthDU: 3, dash: "dash" },
    effects: [{ kind: "dropShadow", color: "#000000", opacity: 0.2, blurDU: 18, offsetXDU: 3, offsetYDU: 8 }],
  };

  const exchange = vectorToExchange(source);
  validateVectorExchange(exchange);
  assert.equal(exchange.schemaVersion, "1");
  assert.equal(exchange.pathData.commands.length, pathData.commands.length);
  assert.equal(exchange.fillPaint?.kind, "linearGradient");
  assert.equal(exchange.effects?.[0]?.kind, "dropShadow");

  const restored = exchangeToVector(exchange, { x: 500, y: 400 }, { id: "restored", origin: "import", zIndex: 9 });
  assert.equal(restored.id, "restored");
  assert.equal(restored.geometry.x, 500);
  assert.equal(restored.geometry.y, 400);
  assert.deepEqual(restored.pathData, pathData);
  assert.deepEqual(restored.fillPaint, source.fillPaint);
  assert.deepEqual(restored.stroke, source.stroke);
  assert.deepEqual(restored.effects, source.effects);
  assert(!JSON.stringify(exchange).includes("selection"));
  assert(!JSON.stringify(exchange).includes("moveable"));
});

test("VectorExchange standalone SVG keeps canonical path and basic stroke/fill", () => {
  const pathData = parseSvgPathData("M 0 0 L 120 0 L 120 80 L 0 80 Z");
  const source: ShapeElement = {
    id: "vector_svg",
    type: "shape",
    shape: "custom",
    semanticRole: "visual",
    geometry: { x: 0, y: 0, width: 240, height: 160 },
    zIndex: 1,
    origin: "user",
    exportStrategy: "vector",
    dependencies: [],
    pathData,
    fill: "#ABCDEF",
    stroke: { color: "#123456", widthDU: 2, dash: "dot" },
  };
  const svg = vectorExchangeToSvg(vectorToExchange(source));
  assert.match(svg, /viewBox="0 0 120 80"/);
  assert.match(svg, /fill="#ABCDEF"/);
  assert.match(svg, /stroke="#123456"/);
  assert.match(svg, /stroke-dasharray=/);
});
