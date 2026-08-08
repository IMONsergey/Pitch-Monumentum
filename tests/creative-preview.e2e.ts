import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { createCreativeDirectorWorkspaceServer } from "../apps/workspace/src/creative-director-server.js";
import type { PitchWorkspaceService } from "../apps/workspace/src/server.js";

interface Harness { root: string; base: string; browser: Browser; page: Page; service: PitchWorkspaceService; close(): Promise<void>; }
async function harness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "pitch-creative-preview-e2e-"));
  execFileSync(process.execPath, ["dist/apps/cli/src/index.js", "demo", root], { stdio: "ignore" });
  const created = createCreativeDirectorWorkspaceServer(root);
  await new Promise<void>((resolve) => created.server.listen(0, "127.0.0.1", resolve));
  const address = created.server.address(); assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1520, height: 980 } });
  return { root, base, browser, page, service: created.service, async close() { await browser.close(); await new Promise<void>((resolve, reject) => created.server.close((error) => error ? reject(error) : resolve())); await rm(root, { recursive: true, force: true }); } };
}

function editableTarget(state: Awaited<ReturnType<PitchWorkspaceService["state"]>>) {
  for (const slide of state.deck.slides) {
    const element = slide.scene.find((item) => !item.locked);
    if (element) return { slide, element };
  }
  throw new Error("Demo project has no editable object");
}

test("Creative Preview bar accepts one preview into original and returns from another without applying it", async () => {
  const h = await harness();
  try {
    const original = await h.service.state();
    const targetBranchId = original.manifest.activeBranchId;
    const { slide, element } = editableTarget(original);
    const originalX = element.geometry.x;
    const originalY = element.geometry.y;

    const firstFork = await h.service.fork("E2E Accept Preview");
    const acceptPreviewId = firstFork.manifest.activeBranchId;
    let previewState = await h.service.state();
    await h.service.editorCommand({ command: "nudge", slideId: slide.id, selectedIds: [element.id], dx: 40, dy: 0, expectedDeckHash: previewState.deckHash });

    await h.page.goto(`${h.base}/editor-spike`, { waitUntil: "networkidle" });
    await h.page.locator("#pitchPreviewBar.open").waitFor({ state: "visible", timeout: 10_000 });
    assert((await h.page.locator("#pitchPreviewBar").textContent())?.includes("E2E Accept Preview"));
    await h.page.locator("[data-preview-accept]").click();
    await h.page.locator("#pitchPreviewBar.open").waitFor({ state: "hidden", timeout: 10_000 });
    let accepted = await h.service.state();
    assert.equal(accepted.manifest.activeBranchId, targetBranchId);
    assert.equal((accepted.deck.slides.find((item) => item.id === slide.id)!.scene.find((item) => item.id === element.id)!).geometry.x, originalX + 40);

    const secondFork = await h.service.fork("E2E Return Preview");
    const returnPreviewId = secondFork.manifest.activeBranchId;
    previewState = await h.service.state();
    await h.service.editorCommand({ command: "nudge", slideId: slide.id, selectedIds: [element.id], dx: 0, dy: 60, expectedDeckHash: previewState.deckHash });
    await h.page.reload({ waitUntil: "networkidle" });
    await h.page.locator("#pitchPreviewBar.open").waitFor({ state: "visible", timeout: 10_000 });
    assert((await h.page.locator("#pitchPreviewBar").textContent())?.includes("E2E Return Preview"));
    await h.page.locator("[data-preview-discard]").click();
    await h.page.locator("#pitchPreviewBar.open").waitFor({ state: "hidden", timeout: 10_000 });

    const returned = await h.service.state();
    assert.equal(returned.manifest.activeBranchId, targetBranchId);
    const returnedElement = returned.deck.slides.find((item) => item.id === slide.id)!.scene.find((item) => item.id === element.id)!;
    assert.equal(returnedElement.geometry.x, originalX + 40, "accepted first preview must stay in original");
    assert.equal(returnedElement.geometry.y, originalY, "returned second preview must not change original");

    const manifest = await h.service.store.readManifest();
    assert(manifest.branches[acceptPreviewId], "accepted preview branch remains available for audit");
    assert(manifest.branches[returnPreviewId], "returned preview branch remains available for audit");
  } finally { await h.close(); }
});
