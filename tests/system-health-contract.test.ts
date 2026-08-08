import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(path, "utf8");

test("System Health UI is read-only and surfaces environment plus readiness", async () => {
  const source = await read("apps/workspace/public/system-health-ui.js");
  assert.match(source, /\/api\/system-health/);
  assert.match(source, /editing ready/);
  assert.match(source, /delivery ready/);
  assert.match(source, /environment/);
  assert.match(source, /Copy JSON/);
  assert.equal(/method:'POST'/.test(source), false);
});

test("Full workspace bundles and serves System Health", async () => {
  const server = await read("apps/workspace/src/delivery-server.ts");
  assert.match(server, /SystemHealthRuntime/);
  assert.match(server, /system-health-ui\.js/);
  assert.match(server, /\/api\/system-health/);
  assert.match(server, /health\.snapshot\(\)/);
});

test("authoritative Full MCP exposes read-only pitch_system_health", async () => {
  const source = await read("apps/pitch-mcp-full/src/server.ts");
  assert.match(source, /pitch_system_health/);
  assert.match(source, /SystemHealthRuntime/);
  assert.match(source, /read-only/);
  assert.match(source, /health\.snapshot\(\)/);
});

test("Desktop Full packager treats System Health as a required build surface", async () => {
  const packager = await read("scripts/package-desktop-full.mjs");
  const preflight = await read("scripts/release-preflight-full.mjs");
  assert.match(packager, /dist\/apps\/system-health\/src\/runtime\.js/);
  assert.match(packager, /system-health-ui\.js/);
  assert.match(preflight, /apps\/system-health\/src\/runtime\.ts/);
  assert.match(preflight, /system-health-ui\.js/);
});
