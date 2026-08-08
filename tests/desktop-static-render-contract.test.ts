import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const runtimePath = "apps/desktop-runtime/src/static-render.ts";

test("desktop PDF derives page size from canonical canvas and duPerInch", async () => {
  const source = await readFile(runtimePath, "utf8");
  assert.match(source, /widthDU\s*\/\s*duPerInch/);
  assert.match(source, /heightDU\s*\/\s*duPerInch/);
  assert.match(source, /preferCSSPageSize:\s*true/);
  assert.match(source, /printCss\(widthDU, heightDU, duPerInch\)/);
});

test("desktop PNG capture uses canonical canvas dimensions instead of 1920x1080 constants", async () => {
  const source = await readFile(runtimePath, "utf8");
  assert.match(source, /Math\.ceil\(widthDU\)/);
  assert.match(source, /Math\.ceil\(heightDU\)/);
  assert.match(source, /capturePage\(\{ x: 0, y: 0, width, height \}\)/);
  assert.equal(/\b1920\b/.test(source), false);
  assert.equal(/\b1080\b/.test(source), false);
});
