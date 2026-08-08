import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const path = "scripts/verify-desktop-full-dmg.sh";

test("Desktop Full DMG verifier mounts the actual disk image and checks the packaged app", async () => {
  const source = await readFile(path, "utf8");
  assert.match(source, /hdiutil attach/);
  assert.match(source, /\.app/);
  assert.match(source, /Contents\/MacOS\/Pitch Monumentum/);
  assert.match(source, /file \"\$BIN\"/);
  assert.match(source, /grep -q 'x86_64'/);
  assert.match(source, /hdiutil detach/);
});

test("DMG verifier checks Full runtime surfaces inside the mounted app", async () => {
  const source = await readFile(path, "utf8");
  for (const expected of [
    "dist/apps/desktop-full/src/main.js",
    "dist/apps/desktop-runtime/src/main.js",
    "dist/apps/workspace/src/full-server.js",
    "dist/apps/system-health/src/runtime.js",
    "dist/apps/pitch-mcp-full/src/server.js",
    "apps/workspace/public/delivery-ui.js",
    "apps/workspace/public/system-health-ui.js",
  ]) assert(source.includes(expected), `DMG verifier must require ${expected}`);
});

test("DMG verifier emits architecture checksum and verification evidence", async () => {
  const source = await readFile(path, "utf8");
  assert.match(source, /DMG-VERIFICATION\.txt/);
  assert.match(source, /SHA256SUMS\.txt/);
  assert.match(source, /ARCHITECTURE\.txt/);
  assert.match(source, /shasum -a 256/);
  assert.match(source, /CFBundleIdentifier/);
  assert.match(source, /CFBundleShortVersionString/);
});
