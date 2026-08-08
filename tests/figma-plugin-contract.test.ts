import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifestPath = "apps/figma-bridge-plugin/manifest.json";
const codePath = "apps/figma-bridge-plugin/code.js";

test("Figma bridge plugin has no network allowlist and imports editable native node families", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const code = await readFile(codePath, "utf8");
  assert.deepEqual(manifest.networkAccess?.allowedDomains, []);
  assert.equal(manifest.editorType.includes("figma"), true);
  assert.match(code, /figma\.createText\(\)/);
  assert.match(code, /figma\.createRectangle\(\)/);
  assert.match(code, /figma\.createEllipse\(\)/);
  assert.match(code, /figma\.createVector\(\)/);
  assert.match(code, /figma\.createImage\(/);
  assert.match(code, /setPluginData\('pitchId'/);
  assert.equal(/fetch\s*\(/.test(code), false, "local importer should not require network fetches");
});

test("Figma importer preserves mixed rich-text ranges with loaded fonts", async () => {
  const code = await readFile(codePath, "utf8");
  assert.match(code, /figma\.loadFontAsync/);
  assert.match(code, /setRangeFontName/);
  assert.match(code, /setRangeFontSize/);
  assert.match(code, /setRangeFills/);
  assert.match(code, /setRangeTextDecoration/);
  assert.match(code, /fontStyle/);
  assert.match(code, /autoRename\s*=\s*false/);
});

test("Figma importer retains explicit structured fallbacks rather than pretending all nodes are native", async () => {
  const code = await readFile(codePath, "utf8");
  assert.match(code, /editable structured payload stored in plugin data/);
  assert.match(code, /pitchPayload/);
  assert.match(code, /pitchTokenBindings/);
  assert.match(code, /pitchMasterId/);
});
