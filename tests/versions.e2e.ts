import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { createVersionsWorkspaceServer } from "../apps/workspace/src/versions-server.js";
import type { PitchWorkspaceService } from "../apps/workspace/src/server.js";

interface Harness { root: string; base: string; browser: Browser; page: Page; service: PitchWorkspaceService; close(): Promise<void>; }
async function harness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "pitch-versions-e2e-"));
  execFileSync(process.execPath, ["dist/apps/cli/src/index.js", "demo", root], { stdio: "ignore" });
  const created = createVersionsWorkspaceServer(root);
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

test("Versions UI saves a checkpoint, compares changes, restores to a new branch and returns to newer main work", async () => {
  const h = await harness();
  try {
    const initial = await h.service.state();
    const sourceBranchId = initial.manifest.activeBranchId;
    const { slide, element } = editableTarget(initial);
    const originalX = element.geometry.x;

    await h.page.goto(`${h.base}/editor-spike`, { waitUntil: "networkidle" });
    await h.page.getByRole("button", { name: "Versions", exact: true }).click();
    await h.page.locator("#pitchVersionsDrawer.open").waitFor({ state: "visible", timeout: 10_000 });
    await h.page.locator("[data-checkpoint-name]").fill("Approved baseline");
    await h.page.locator("[data-checkpoint-create]").click();
    await h.page.waitForFunction(() => document.querySelectorAll('.pitch-checkpoint-card').length === 1);

    const beforeEdit = await h.service.state();
    await h.service.editorCommand({ command: "nudge", slideId: slide.id, selectedIds: [element.id], dx: 88, dy: 0, expectedDeckHash: beforeEdit.deckHash });
    await h.page.locator("[data-version-refresh]").click();
    await h.page.waitForTimeout(100);
    await h.page.locator("[data-checkpoint-compare]").click();
    await h.page.waitForFunction(() => (document.querySelector('.pitch-version-diff')?.textContent || '').includes('geometry'));
    assert((await h.page.locator(".pitch-version-diff").textContent())?.includes("shape") || (await h.page.locator(".pitch-version-diff").textContent())?.includes(element.id));

    await h.page.locator("[data-checkpoint-restore]").click();
    await h.page.waitForFunction((source) => (window as any).__pitchEditorRuntime?.getProject?.()?.manifest?.activeBranchId !== source, sourceBranchId);
    const restored = await h.service.state();
    const restoredBranchId = restored.manifest.activeBranchId;
    assert.notEqual(restoredBranchId, sourceBranchId);
    assert.equal(restored.deck.slides.find((item) => item.id === slide.id)!.scene.find((item) => item.id === element.id)!.geometry.x, originalX);

    await h.page.getByRole("button", { name: "Versions", exact: true }).click().catch(() => undefined);
    if (!(await h.page.locator("#pitchVersionsDrawer").evaluate((node) => node.classList.contains("open")))) await h.page.getByRole("button", { name: "Versions", exact: true }).click();
    const checkoutSource = h.page.locator(`[data-branch-checkout="${sourceBranchId}"]`);
    await checkoutSource.waitFor({ state: "visible", timeout: 10_000 });
    await checkoutSource.click();
    await h.page.waitForFunction((source) => (window as any).__pitchEditorRuntime?.getProject?.()?.manifest?.activeBranchId === source, sourceBranchId);
    const source = await h.service.state();
    assert.equal(source.manifest.activeBranchId, sourceBranchId);
    assert.equal(source.deck.slides.find((item) => item.id === slide.id)!.scene.find((item) => item.id === element.id)!.geometry.x, originalX + 88);
    assert(source.manifest.branches[restoredBranchId], "restored branch remains available for later compare/review");
  } finally { await h.close(); }
});
