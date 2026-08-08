import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const codePath = "integrations/figma-plugin/code.js";
const uiPath = "integrations/figma-plugin/ui.html";
const manifestPath = "integrations/figma-plugin/manifest.example.json";

test("Figma importer main source is syntactically valid JavaScript", async () => {
  const code = await readFile(codePath, "utf8");
  assert.doesNotThrow(() => new Function("figma", "__html__", "atob", code));
  assert.match(code, /figma\.createSlide\(/);
  assert.match(code, /figma\.createImage\(/);
  assert.match(code, /figma\.loadFontAsync\(/);
  assert.match(code, /layoutMode/);
});

test("Figma importer UI and manifest are local-only and support Design plus Slides", async () => {
  const ui = await readFile(uiPath, "utf8");
  assert.match(ui, /\.pitch-figma\.json/);
  assert.match(ui, /IMPORT_PITCH_BUNDLE/);

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(manifest.editorType, ["figma", "slides"]);
  assert.equal(manifest.documentAccess, "dynamic-page");
  assert.deepEqual(manifest.networkAccess.allowedDomains, ["none"]);
  assert.match(manifest.id, /REPLACE_WITH_FIGMA_ASSIGNED_PLUGIN_ID/);
});
