import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const path = "apps/workspace/public/full-command-registry-ui.js";

test("Full command registry exposes an extensible global API", async () => {
  const source = await readFile(path, "utf8");
  assert.match(source, /__pitchCommandRegistry/);
  assert.match(source, /register/);
  assert.match(source, /unregister/);
  assert.match(source, /list/);
  assert.match(source, /execute/);
  assert.match(source, /pitch:command-registry-ready/);
  assert.match(source, /pitch:command-registry-change/);
});

test("Full Cmd+K surface covers editor system AI project delivery and health", async () => {
  const source = await readFile(path, "utf8");
  for (const label of ["Editor commands", "Assets", "Motion", "Components", "Present", "Design System", "Slide Layouts", "Creative Director", "Versions", "Comments & Review", "Delivery Center", "System Health"]) {
    assert(source.includes(label), `Full command registry must include ${label}`);
  }
  assert.match(source, /metaKey \|\| event\.ctrlKey/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.match(source, /openLegacyPalette/);
});

test("Full registry remains additive and delegates core object commands to the existing Pro Editor palette", async () => {
  const source = await readFile(path, "utf8");
  assert.match(source, /buttonByLabel\('Commands'\)/);
  assert.match(source, /bypassLegacy/);
  assert.match(source, /Object, slide, arrange, alignment, undo\/redo and insert commands/);
  assert.equal(/__pitchEditorRuntime\s*=/.test(source), false, "Full registry must not replace the canonical editor runtime");
});
