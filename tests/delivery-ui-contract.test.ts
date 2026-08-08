import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const path = "apps/workspace/public/delivery-ui.js";

test("Delivery UI exposes Desktop PDF and PNG only through the protected preload bridge", async () => {
  const source = await readFile(path, "utf8");
  assert.match(source, /pdf:'PDF'/);
  assert.match(source, /png:'PNG Slides'/);
  assert.match(source, /pitchDesktop\?\.exportPdf/);
  assert.match(source, /pitchDesktop\?\.exportPng/);
  assert.match(source, /pitchDesktop\?\.reveal/);
  assert.match(source, /desktopOnly:true/);
  assert.match(source, /Desktop static renderer/);
});

test("Delivery UI surfaces branch deck review and motion snapshot identifiers", async () => {
  const source = await readFile(path, "utf8");
  assert.match(source, /activeBranchId/);
  assert.match(source, /deckHash/);
  assert.match(source, /reviewHash/);
  assert.match(source, /motionHash/);
  assert.match(source, /sameSnapshot/);
  assert.match(source, /invalidateStaleArtifacts/);
});

test("Delivery UI does not offer browser download for package-directory or Desktop-only artifacts", async () => {
  const source = await readFile(path, "utf8");
  assert.match(source, /a\.filesystemKind==='directory'/);
  assert.match(source, /!a\.desktopOnly&&!isDirectory/);
  assert.match(source, /Desktop only/);
  assert.match(source, /fileCount/);
  assert.match(source, /sha256/);
});
