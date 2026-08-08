import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { createMasterDesignWorkspaceServer } from "../apps/workspace/src/master-design-server.js";
import { slideMasterId, slideMasterSourceId, slidePlaceholderId } from "../packages/slide-masters/src/index.js";

interface Harness { root: string; base: string; browser: Browser; page: Page; close(): Promise<void>; }
async function harness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "pitch-slide-masters-e2e-"));
  execFileSync(process.execPath, ["dist/apps/cli/src/index.js", "demo", root], { stdio: "ignore" });
  const { server } = createMasterDesignWorkspaceServer(root);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
  return { root, base, browser, page, async close() { await browser.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(root, { recursive: true, force: true }); } };
}

async function api(base: string, path: string, input?: unknown): Promise<any> {
  const response = await fetch(`${base}${path}`, input === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}
async function project(base: string): Promise<any> { return api(base, "/api/project"); }
async function masterState(base: string, slideId: string): Promise<any> { return api(base, `/api/master-state?slideId=${encodeURIComponent(slideId)}`); }

function masterOwnedTitle(slide: any): any {
  return slide.scene.find((element: any) => slideMasterSourceId(element) === "title") ?? slide.scene.find((element: any) => Boolean(slidePlaceholderId(element)) && element.semanticRole === "title");
}

async function openLayouts(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Layouts" }).click();
  await page.locator("#pitchLayoutDrawer.open").waitFor({ state: "visible", timeout: 10_000 });
}

async function clickSlide(page: Page, slideId: string): Promise<void> {
  const button = page.locator(`[data-slide="${slideId}"]`).first();
  await button.waitFor({ state: "visible", timeout: 10_000 });
  await button.click();
  await page.waitForFunction((id) => (window as any).__pitchEditorRuntime?.getSlide?.()?.id === id, slideId);
}

test("Slide Masters UI creates a layout, applies it, updates linked slides, and ordinary undo restores prior master state", async () => {
  const h = await harness();
  try {
    await h.page.goto(`${h.base}/editor-spike`, { waitUntil: "networkidle" });
    await openLayouts(h.page);

    h.page.once("dialog", dialog => dialog.accept("Demo Layout"));
    await h.page.getByRole("button", { name: "Create layout from slide" }).click();
    const sourceBefore = await project(h.base);
    const sourceSlideId = sourceBefore.deck.slides[0].id;
    await h.page.waitForFunction(async (id) => (await fetch(`/api/master-state?slideId=${encodeURIComponent(id)}`).then(r => r.json())).masters?.length === 1, sourceSlideId);
    let masters = await masterState(h.base, sourceSlideId);
    const masterId = masters.masters[0].id;
    assert.equal(masters.masters[0].name, "Demo Layout");

    const duplicate = await api(h.base, "/api/editor-command", { command: "duplicateSlide", slideId: sourceSlideId, expectedDeckHash: (await project(h.base)).deckHash });
    const duplicateSlideId = duplicate.nextSlideId;
    assert(duplicateSlideId);
    await (h.page.evaluate(() => (window as any).__pitchEditorRuntime?.reload?.()));
    await clickSlide(h.page, duplicateSlideId);

    await h.page.locator("#pitchLayoutDrawer").evaluate((node: HTMLElement) => node.classList.remove("open"));
    await openLayouts(h.page);
    const apply = h.page.locator(`[data-apply-master="${masterId}"]`);
    await apply.waitFor({ state: "visible" });
    await apply.click();
    await h.page.waitForFunction(async ({ slideId, masterId }) => {
      const p = await fetch("/api/project").then(r => r.json());
      const slide = p.deck.slides.find((item: any) => item.id === slideId);
      return slide?.scene?.some((element: any) => element.tags?.includes(`slide-master:${masterId}`));
    }, { slideId: duplicateSlideId, masterId });

    let afterApply = await project(h.base);
    const duplicateSlide = afterApply.deck.slides.find((slide: any) => slide.id === duplicateSlideId);
    const duplicateTitle = masterOwnedTitle(duplicateSlide);
    assert(duplicateTitle);
    const duplicateTitleId = duplicateTitle.id;
    const duplicateTitleText = duplicateTitle.paragraphs?.[0]?.runs?.map((run: any) => run.text).join("") ?? "";

    await clickSlide(h.page, duplicateSlideId);
    await h.page.locator(`#spikeScene [data-id="${duplicateTitleId}"]`).click();
    const editedX = duplicateTitle.geometry.x + 96;
    await h.page.evaluate(async ({ id, x }) => {
      const runtime = (window as any).__pitchEditorRuntime;
      await runtime.command({ command: "setGeometry", elementId: id, geometry: { x } });
    }, { id: duplicateTitleId, x: editedX });
    await h.page.waitForFunction(async ({ id, x }) => {
      const p = await fetch("/api/project").then(r => r.json());
      return p.deck.slides.flatMap((slide: any) => slide.scene).find((element: any) => element.id === id)?.geometry?.x === x;
    }, { id: duplicateTitleId, x: editedX });

    await h.page.locator("#pitchLayoutDrawer").evaluate((node: HTMLElement) => node.classList.remove("open"));
    await openLayouts(h.page);
    await h.page.getByRole("button", { name: "Update Master" }).click();
    await h.page.waitForFunction(async ({ masterId, x }) => {
      const p = await fetch("/api/project").then(r => r.json());
      const master = p.deck.slideMasters?.[masterId];
      return master?.elements?.find((element: any) => element.id === "title")?.geometry?.x === x;
    }, { masterId, x: editedX });

    const propagated = await project(h.base);
    const sourceSlide = propagated.deck.slides.find((slide: any) => slide.id === sourceSlideId);
    const sourceTitle = masterOwnedTitle(sourceSlide);
    const refreshedDuplicate = propagated.deck.slides.find((slide: any) => slide.id === duplicateSlideId);
    const refreshedDuplicateTitle = masterOwnedTitle(refreshedDuplicate);
    assert.equal(refreshedDuplicateTitle.id, duplicateTitleId);
    assert.equal(refreshedDuplicateTitle.geometry.x, editedX);
    assert.equal(refreshedDuplicateTitle.paragraphs?.[0]?.runs?.map((run: any) => run.text).join("") ?? "", duplicateTitleText);
    assert.equal(sourceTitle.geometry.x, editedX);

    const undo = await api(h.base, "/api/undo", {});
    const undoDuplicate = undo.deck.slides.find((slide: any) => slide.id === duplicateSlideId);
    assert.notEqual(masterOwnedTitle(undoDuplicate).geometry.x, editedX);
    assert.equal(masterOwnedTitle(undoDuplicate).id, duplicateTitleId);

    const current = await project(h.base);
    await api(h.base, "/api/master-command", { command: "detachMaster", slideId: duplicateSlideId, expectedDeckHash: current.deckHash });
    const detached = await project(h.base);
    const detachedSlide = detached.deck.slides.find((slide: any) => slide.id === duplicateSlideId);
    assert.equal(detachedSlide.scene.some((element: any) => Boolean(slideMasterId(element))), false);
    assert(detachedSlide.scene.some((element: any) => element.id === duplicateTitleId));
  } finally {
    await h.close();
  }
});
