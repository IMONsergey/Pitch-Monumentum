import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const configPath = "electron-builder.full.yml";
const workflowPath = ".github/workflows/desktop-full-macos.yml";
const packageScriptPath = "scripts/package-desktop-full.mjs";

test("full desktop builder uses stable full entry without a guessed Electron version", async () => {
  const config = await readFile(configPath, "utf8");
  assert.match(config, /main: dist\/apps\/desktop-full\/src\/main\.js/);
  assert.match(config, /arch:\s*\n\s*- x64/);
  assert.equal(/electronVersion\s*:/.test(config), false);
  assert.match(config, /asar: false/);
});

test("full package script verifies stable runtime and full-stack compiled entries before electron-builder", async () => {
  const source = await readFile(packageScriptPath, "utf8");
  for (const entry of [
    "dist/apps/desktop-full/src/main.js",
    "dist/apps/desktop-runtime/src/main.js",
    "dist/apps/desktop-runtime/src/preload.js",
    "dist/apps/desktop-runtime/src/static-render.js",
    "dist/apps/workspace/src/full-server.js",
    "dist/apps/workspace/src/delivery-server.js",
    "dist/apps/review/src/runtime.js",
    "dist/apps/versions/src/runtime.js",
    "dist/apps/creative-director/src/runtime.js",
    "dist/apps/pitch-mcp-full/src/server.js",
  ]) assert(source.includes(entry), `missing package build guard for ${entry}`);
  assert.equal(source.includes("dist/apps/desktop-next/src/main.js"), false);
  assert.match(source, /npm.*run.*build/s);
  assert.match(source, /electron-builder\.full\.yml/);
});

test("full macOS workflow is manual-only and hard-fails unless packaged executable is x86_64", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.match(workflow, /workflow_dispatch/);
  assert.equal(/pull_request\s*:/.test(workflow), false);
  assert.equal(/push\s*:/.test(workflow), false);
  assert.match(workflow, /runs-on: macos-15-intel/);
  assert.match(workflow, /file \"\$APP_BIN\"/);
  assert.match(workflow, /grep -q 'x86_64'/);
  assert.match(workflow, /shasum -a 256/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
});
