import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDesktopPreviewProject } from "../dist/packages/project-bootstrap/src/index.js";
import { createPitchFullWorkspaceServer } from "../dist/apps/workspace/src/full-server.js";

const root = await mkdtemp(join(tmpdir(), "pitch-full-smoke-"));
let server;
const failures = [];

function expect(condition, message) { if (!condition) failures.push(message); }
async function json(base, path) {
  const response = await fetch(`${base}${path}`, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

try {
  await ensureDesktopPreviewProject(root);
  const created = createPitchFullWorkspaceServer(root);
  server = created.server;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Full runtime smoke could not resolve the local server address");
  const base = `http://127.0.0.1:${address.port}`;

  const health = await json(base, "/api/system-health");
  expect(health.schemaVersion === "0.1", "System Health schema is missing");
  expect(health.productVersion === "0.3.0-preview.1", `Unexpected product version in System Health: ${health.productVersion}`);
  expect(health.checks?.some((check) => check.id === "project" && check.status === "ok"), "Canonical project health check is not OK");
  expect(health.checks?.some((check) => check.id === "ui-layers" && check.status === "ok"), "Full UI layer health check is not OK");
  expect(health.checks?.some((check) => check.id === "compiled-entries" && check.status === "ok"), "Compiled Full entrypoint health check is not OK");
  expect(health.summary?.editingReady === true, "Desktop Preview project is not editing-ready in Full System Health");

  const delivery = await json(base, "/api/delivery-state");
  expect(delivery.deckId === "deck_desktop_preview", `Unexpected Desktop Preview deck id: ${delivery.deckId}`);
  expect(delivery.activeBranchId === "branch_main", `Unexpected Desktop Preview branch: ${delivery.activeBranchId}`);
  expect(delivery.formats?.pptx && delivery.formats?.figma && delivery.formats?.web && delivery.formats?.keynote, "Delivery preflight does not expose all four server formats");

  const project = await json(base, "/api/project");
  expect(project.deck?.slides?.length === 4, `Desktop Preview should contain four slides, got ${project.deck?.slides?.length}`);

  const htmlResponse = await fetch(`${base}/editor-spike`, { cache: "no-store" });
  expect(htmlResponse.ok, `/editor-spike returned ${htmlResponse.status}`);
  const bundleResponse = await fetch(`${base}/editor-spike.js`, { cache: "no-store" });
  const bundle = await bundleResponse.text();
  expect(bundleResponse.ok, `/editor-spike.js returned ${bundleResponse.status}`);
  for (const marker of [
    "__pitchEditorRuntime",
    "pitchDesignDrawer",
    "pitchLayoutDrawer",
    "pitchCreativeDrawer",
    "pitchVersionsDrawer",
    "pitchReviewDrawer",
    "pitchDeliveryDrawer",
    "pitchHealthDrawer",
  ]) expect(bundle.includes(marker), `Full editor bundle is missing ${marker}`);

  const result = {
    ok: failures.length === 0,
    productVersion: health.productVersion,
    projectId: health.projectId,
    branchId: health.activeBranchId,
    health: health.summary,
    readyFormats: delivery.readyFormats,
    bundleBytes: Buffer.byteLength(bundle),
    failures,
  };
  console.log(JSON.stringify(result, null, 2));
  if (failures.length) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), failures }, null, 2));
  process.exitCode = 1;
} finally {
  if (server?.listening) await new Promise((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}
