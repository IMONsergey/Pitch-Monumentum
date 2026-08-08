import { execFileSync } from "node:child_process";

const root = process.cwd();
const startedAt = new Date().toISOString();
const steps = [
  [process.execPath, ["scripts/release-preflight-full.mjs"], "source-tree preflight"],
  ["npm", ["run", "typecheck"], "TypeScript"],
  ["npm", ["run", "test"], "unit/integration tests"],
  ["npm", ["run", "test:editor-e2e"], "Chromium editor E2E"],
  [process.execPath, ["scripts/full-runtime-smoke.mjs"], "compiled Full runtime smoke"],
];

const completed = [];
try {
  for (const [file, args, label] of steps) {
    const stepStartedAt = Date.now();
    console.log(`\n== Pitch Full validation · ${label} ==`);
    execFileSync(file, args, { cwd: root, stdio: "inherit", env: process.env });
    completed.push({ label, durationMs: Date.now() - stepStartedAt });
  }
  console.log(JSON.stringify({ ok: true, startedAt, completed, finishedAt: new Date().toISOString() }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    startedAt,
    completed,
    failedStep: steps[completed.length]?.[2] ?? "unknown",
    error: error instanceof Error ? error.message : String(error),
    finishedAt: new Date().toISOString(),
  }, null, 2));
  process.exitCode = 1;
}
