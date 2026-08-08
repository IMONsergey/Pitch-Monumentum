import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Figma importer builds one hierarchy from childIds and groupId with cycle protection", async () => {
  const source = await readFile("apps/figma-bridge-plugin/code.js", "utf8");
  assert.match(source, /function hierarchyForSlide/);
  assert.match(source, /childrenByParent/);
  assert.match(source, /spec\.groupId/);
  assert.match(source, /multiple parents/);
  assert.match(source, /hierarchy cycle detected/);
  assert.match(source, /failed to render hierarchy nodes/);
});
