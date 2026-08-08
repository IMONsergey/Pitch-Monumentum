import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { createDeliveryWorkspaceServer } from "../apps/workspace/src/delivery-server.js";

interface Harness { root: string; base: string; browser: Browser; page: Page; close(): Promise<void>; }

function fixture(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "deck_delivery_e2e", title: "Delivery E2E", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 160, aspectRatio: "16:9" },
    briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z",
    slides: [{ id: "s1", order: 0, title: "Delivery", archetype: "closing", semantic: { purpose: "Conclude", takeaway: "Deliver editable outputs", questionAnswered: "What is delivered?", narrativeRole: "closing", claimIds: [], evidenceRefs: [], audienceRelevance: "All", density: "sparse" }, scene: [
      { id: "title", type: "text", paragraphs: [{ runs: [{ text: "Deliver editable outputs", fontFamily: "Inter", fontSizePt: 44, color: "#111111", bold: true }] }], semanticRole: "title", geometry: { x: 160, y: 160, width: 1280, height: 180 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [] },
      { id: "shape", type: "shape", shape: "roundRect", fill: "#E9EDF5", radiusDU: 24, semanticRole: "visual", geometry: { x: 160, y: 410, width: 900, height: 340 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [] },
    ], status: "draft", qaIssueIds: [], dependencyIds: [] }],
  };
}

async function harness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "pitch-delivery-e2e-"));
  const store = new ArtifactStore(root); await store.init("Delivery E2E", "delivery_e2e_project"); await store.write({ id: "deck", kind: "deck", payload: fixture(), producer: { type: "deterministic" } });
  const created = createDeliveryWorkspaceServer(root);
  await new Promise<void>((resolve) => created.server.listen(0, "127.0.0.1", resolve));
  const address = created.server.address(); assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 1520, height: 980 } });
  return { root, base, browser, page, async close() { await browser.close(); await new Promise<void>((resolve, reject) => created.server.close((error) => error ? reject(error) : resolve())); await rm(root, { recursive: true, force: true }); } };
}

test("Delivery Center writes downloadable Standalone Web and Figma Bridge artifacts through one preflight", async () => {
  const h = await harness();
  try {
    await h.page.goto(`${h.base}/editor-spike`, { waitUntil: "networkidle" });
    await h.page.getByRole("button", { name: "Deliver", exact: true }).click();
    await h.page.locator("#pitchDeliveryDrawer.open").waitFor({ state: "visible", timeout: 10_000 });
    await h.page.waitForFunction(() => (document.querySelector('#pitchDeliveryDrawer')?.textContent || '').includes('Figma Bridge'));
    const state = await h.page.request.get(`${h.base}/api/delivery-state`).then((response) => response.json());
    if (!state.formats.web.ready || !state.formats.figma.ready) assert.fail(`Delivery E2E fixture is unexpectedly blocked: ${JSON.stringify({ web: state.formats.web, figma: state.formats.figma })}`);

    await h.page.locator('[data-deliver="web"]').click();
    await h.page.waitForFunction(() => [...document.querySelectorAll('.pitch-delivery-artifact b')].some((node) => /standalone\.html/.test(node.textContent || '')), undefined, { timeout: 15_000 });
    let artifact = h.page.locator('.pitch-delivery-artifact').filter({ hasText: 'standalone.html' });
    const webHref = await artifact.locator('a').getAttribute('href');
    assert(webHref);
    const webResponse = await h.page.request.get(`${h.base}${webHref}`);
    assert.equal(webResponse.ok(), true);
    assert.equal(webResponse.headers()['content-type']?.startsWith('text/html'), true);
    assert.match(await webResponse.text(), /data-pitch-id="title"/);

    await h.page.locator('[data-deliver="figma"]').click();
    await h.page.waitForFunction(() => [...document.querySelectorAll('.pitch-delivery-artifact b')].some((node) => /figma-bridge\.json/.test(node.textContent || '')), undefined, { timeout: 15_000 });
    artifact = h.page.locator('.pitch-delivery-artifact').filter({ hasText: 'figma-bridge.json' });
    const figmaHref = await artifact.locator('a').getAttribute('href'); assert(figmaHref);
    const figmaResponse = await h.page.request.get(`${h.base}${figmaHref}`);
    assert.equal(figmaResponse.ok(), true);
    const bridge = await figmaResponse.json();
    assert.equal(bridge.kind, 'pitch-figma-bridge');
    assert.equal(bridge.slides[0].nodes.some((node: any) => node.pitchId === 'title'), true);

    assert.match((await h.page.locator('#pitchDeliveryDrawer').textContent()) || '', /sha256/);
    assert.match((await h.page.locator('#pitchDeliveryDrawer').textContent()) || '', /Keynote/);
  } finally { await h.close(); }
});
