import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const text = (path: string) => readFileSync(path, "utf8");

test("full stack is the default npm product surface", () => {
  const pkg = JSON.parse(text("package.json"));
  assert.equal(pkg.version, "0.3.0-preview.1");
  assert.equal(pkg.main, "dist/apps/desktop-full/src/main.js");
  assert.match(pkg.scripts.workspace, /full-server\.js/);
  assert.match(pkg.scripts.desktop, /desktop-full\/src\/main\.js/);
  assert.match(pkg.scripts["package:mac:x64"], /package-desktop-full\.mjs/);
  assert.match(pkg.scripts["pitch:mcp"], /pitch-mcp-full\/src\/server\.js/);
  assert.match(pkg.scripts["release:preflight"], /release-preflight-full\.mjs/);
  assert.match(pkg.scripts["workspace:core"], /workspace\/src\/server\.js/);
  assert.match(pkg.scripts["desktop:core"], /desktop\/src\/main\.js/);
  assert.match(pkg.scripts["pitch:mcp:core"], /pitch-mcp\/src\/server\.js/);
  assert.match(pkg.scripts["package:mac:x64:core"], /electron-builder\.core\.yml/);
});

test("desktop full points at the stable desktop runtime", () => {
  assert.match(text("apps/desktop-full/src/main.ts"), /desktop-runtime\/src\/main\.js/);
  const runtime = text("apps/desktop-runtime/src/main.ts");
  assert.match(runtime, /createPitchFullWorkspaceServer/);
  assert.match(runtime, /desktop-runtime[\\\"', ]+.*preload\.js|desktop-runtime.*preload\.js/);
  assert.match(runtime, /exportDesktopPdf/);
  assert.match(runtime, /exportDesktopPngSlides/);
  assert(existsSync("apps/desktop-runtime/src/preload.ts"));
  assert(existsSync("apps/desktop-runtime/src/static-render.ts"));
});

test("only the Desktop Full packaging path remains authoritative", () => {
  assert(existsSync("electron-builder.full.yml"));
  assert(existsSync("scripts/package-desktop-full.mjs"));
  assert(existsSync("scripts/release-preflight-full.mjs"));
  assert(existsSync(".github/workflows/desktop-full-macos.yml"));
  for (const legacy of [
    "electron-builder.next.yml",
    "electron-builder.next.safe.yml",
    "scripts/package-desktop-next.mjs",
    "scripts/package-desktop-next-safe.mjs",
    ".github/workflows/desktop-next-macos.yml",
  ]) assert.equal(existsSync(legacy), false, `${legacy} must stay removed`);

  const packager = text("scripts/package-desktop-full.mjs");
  assert.match(packager, /release-preflight-full\.mjs/);
  assert.match(packager, /desktop-runtime\/src\/main\.js/);
  assert.match(packager, /desktop-runtime\/src\/preload\.js/);
  assert.match(packager, /pitch-mcp-full\/src\/server\.js/);
  assert.doesNotMatch(packager, /desktop-next\/src\/main\.js/);

  const workflow = text(".github/workflows/desktop-full-macos.yml");
  assert.match(workflow, /macos-15-intel/);
  assert.match(workflow, /x86_64/);
  assert.match(workflow, /shasum -a 256/);
  assert.match(workflow, /workflow_dispatch/);
});

test("legacy Core packaging remains explicit and cannot inherit Desktop Full main", () => {
  assert(existsSync("electron-builder.core.yml"));
  const core = text("electron-builder.core.yml");
  assert.match(core, /main:\s*dist\/apps\/desktop\/src\/main\.js/);
  assert.match(core, /output:\s*release-core/);
  assert.match(core, /Pitch-Monumentum-core/);
  assert.doesNotMatch(core, /desktop-full\/src\/main\.js/);
});
