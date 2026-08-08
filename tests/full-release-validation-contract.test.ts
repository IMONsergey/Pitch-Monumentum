import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const validatePath = "scripts/full-release-validate.mjs";
const workflowPath = ".github/workflows/full-validation.yml";

test("Full release validation runs source preflight TypeScript tests E2E and runtime smoke", async () => {
  const source = await readFile(validatePath, "utf8");
  assert.match(source, /release-preflight-full\.mjs/);
  assert.match(source, /npm.*run.*typecheck/s);
  assert.match(source, /npm.*run.*test/s);
  assert.match(source, /test:editor-e2e/);
  assert.match(source, /full-runtime-smoke\.mjs/);
  assert.match(source, /failedStep/);
});

test("Full validation workflow is manual-only and installs real Chromium before E2E", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.match(workflow, /workflow_dispatch/);
  assert.equal(/^\s*push\s*:/m.test(workflow), false);
  assert.equal(/^\s*pull_request\s*:/m.test(workflow), false);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /npx playwright install --with-deps chromium/);
  assert.match(workflow, /node scripts\/full-release-validate\.mjs/);
});
