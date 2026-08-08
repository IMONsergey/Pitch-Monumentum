import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const path = "scripts/create-release-evidence.mjs";

test("release evidence recomputes DMG bytes instead of trusting checksum text", async () => {
  const source = await readFile(path, "utf8");
  assert.match(source, /readFile\(dmgPath\)/);
  assert.match(source, /createHash\("sha256"\)/);
  assert.match(source, /SHA256SUMS\.txt/);
  assert.match(source, /does not match the actual DMG bytes/);
});

test("release evidence requires mounted-DMG x86_64 and Full runtime proof", async () => {
  const source = await readFile(path, "utf8");
  assert.match(source, /ARCHITECTURE\.txt/);
  assert.match(source, /DMG-VERIFICATION\.txt/);
  assert.match(source, /x86_64/);
  assert.match(source, /desktop_full_entry=present/);
  assert.match(source, /system_health=present/);
  assert.match(source, /full_mcp=present/);
});

test("release evidence distinguishes artifact verification from external real-app gates", async () => {
  const source = await readFile(path, "utf8");
  assert.match(source, /realIntelMacSmoke: false/);
  assert.match(source, /figmaCorpus: false/);
  assert.match(source, /keynoteCorpus: false/);
  assert.match(source, /signed: false/);
  assert.match(source, /notarized: false/);
  assert.match(source, /RELEASE-EVIDENCE\.json/);
});
