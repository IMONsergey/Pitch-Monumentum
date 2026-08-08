import test from "node:test";
import assert from "node:assert/strict";
import { importSvgPaths, layoutImportedSvg } from "../packages/svg-import/src/index.js";
import { vectorPathBounds } from "../packages/vector-path/src/index.js";

test("SVG importer converts paths and common primitives into editable canonical vectors", () => {
  const svg = `
    <svg viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#112233"/>
          <stop offset="100%" style="stop-color:#C7FF5E;stop-opacity:.7"/>
        </linearGradient>
      </defs>
      <rect id="card" x="10" y="10" width="60" height="40" rx="8" fill="url(#g)"/>
      <circle id="dot" cx="110" cy="30" r="20" fill="#ff0000"/>
      <polygon id="tri" points="150,10 190,50 150,50" fill-rule="evenodd"/>
      <path id="curve" d="M 20 90 q 30 -30 60 0 t 60 0" fill="none" stroke="#123456" stroke-width="3"/>
    </svg>`;
  const imported = importSvgPaths(svg);
  assert.equal(imported.paths.length, 4);
  assert.equal(imported.warnings.length, 0);

  const card = imported.paths.find((path) => path.name === "card")!;
  assert(card.pathData.commands.some((command) => command.command === "C"), "rounded rect should become Bezier geometry");
  assert.equal(card.fillPaint?.kind, "linearGradient");
  if (card.fillPaint?.kind !== "linearGradient") throw new Error("expected gradient");
  assert.equal(card.fillPaint.stops.length, 2);
  assert.equal(card.fillPaint.stops[1].opacity, 0.7);

  const dot = imported.paths.find((path) => path.name === "dot")!;
  assert.equal(dot.fillPaint?.kind, "solid");
  assert.equal(dot.sourceBounds.width, 40);
  assert.equal(dot.sourceBounds.height, 40);

  const tri = imported.paths.find((path) => path.name === "tri")!;
  assert.equal(tri.pathData.fillRule, "evenodd");
  assert.equal(tri.fillPaint?.kind, "solid");
  if (tri.fillPaint?.kind !== "solid") throw new Error("expected default solid SVG fill");
  assert.equal(tri.fillPaint.color, "#000000", "SVG default fill must be black");

  const curve = imported.paths.find((path) => path.name === "curve")!;
  assert.equal(curve.fillPaint?.kind, "none");
  assert.equal(curve.stroke?.color, "#123456");
  assert(curve.pathData.commands.some((command) => command.command === "Q"));
});

test("SVG layout preserves path placement inside the original viewBox", () => {
  const imported = importSvgPaths(`<svg viewBox="0 0 100 100"><rect id="a" x="10" y="20" width="20" height="10"/><rect id="b" x="60" y="70" width="30" height="20"/></svg>`);
  const positioned = layoutImportedSvg(imported, { x: 200, y: 100, width: 500, height: 500 });
  const a = positioned.find((path) => path.name === "a")!;
  const b = positioned.find((path) => path.name === "b")!;
  assert.deepEqual(a.geometry, { x: 250, y: 200, width: 100, height: 50 });
  assert.deepEqual(b.geometry, { x: 500, y: 450, width: 150, height: 100 });
});

test("SVG importer refuses group transforms and clipping rather than silently corrupting geometry", () => {
  assert.throws(() => importSvgPaths(`<svg viewBox="0 0 100 100"><g transform="translate(10 0)"><path d="M0 0 L10 10"/></g></svg>`), /group transforms/);
  assert.throws(() => importSvgPaths(`<svg viewBox="0 0 100 100"><defs><clipPath id="c"><rect width="10" height="10"/></clipPath></defs><path clip-path="url(#c)" d="M0 0 L20 20"/></svg>`), /clipPath\/mask/);
});

test("unsupported SVG arc is skipped with warning when another editable path remains", () => {
  const imported = importSvgPaths(`<svg viewBox="0 0 100 100"><path id="arc" d="M0 0 A20 20 0 0 1 40 40"/><path id="ok" d="M0 80 L80 80" fill="none" stroke="#000"/></svg>`);
  assert.equal(imported.paths.length, 1);
  assert.equal(imported.paths[0].name, "ok");
  assert(imported.warnings.some((warning) => warning.includes("arc commands")));
  assert.deepEqual(vectorPathBounds(imported.paths[0].pathData), { left: 0, top: 80, right: 80, bottom: 80, width: 80, height: 0 });
});
