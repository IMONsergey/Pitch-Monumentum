import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const preflightPath = "scripts/release-preflight-full.mjs";

test("Full release preflight checks authoritative runtime and packaging files", async () => {
  const source = await readFile(preflightPath, "utf8");
  for (const required of [
    "electron-builder.full.yml",
    "electron-builder.core.yml",
    "apps/workspace/src/full-server.ts",
    "apps/pitch-mcp-full/src/server.ts",
    "apps/desktop-full/src/main.ts",
    "apps/desktop-runtime/src/main.ts",
    "apps/desktop-runtime/src/preload.ts",
    "apps/delivery/src/runtime.ts",
    "packages/web-export/src/index.ts",
    "packages/keynote-export/src/index.ts",
  ]) assert(source.includes(required), `preflight must guard ${required}`);
  assert.match(source, /package:mac:x64:core/);
  assert.match(source, /electron-builder\.core\.yml/);
  assert.match(source, /x86_64/);
  assert.match(source, /shasum -a 256/);
});

test("Full release preflight forbids superseded Desktop Next packaging", async () => {
  const source = await readFile(preflightPath, "utf8");
  for (const forbidden of [
    "electron-builder.next.yml",
    "electron-builder.next.safe.yml",
    "scripts/package-desktop-next.mjs",
    "scripts/package-desktop-next-safe.mjs",
    ".github/workflows/desktop-next-macos.yml",
  ]) assert(source.includes(forbidden), `preflight must explicitly reject ${forbidden}`);
  assert.match(source, /Superseded packaging file must stay removed/);
});
