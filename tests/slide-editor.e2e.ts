import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createWorkspaceServer } from "../apps/workspace/src/server.js";

async function project(base: string): Promise<any> {
  return fetch(`${base}/api/project`).then((response) => response.json());
}

test("Storyboard controls create duplicate rename reorder delete and undo canonical slides", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-slide-editor-e2e-"));
  execFileSync(process.execPath, ["dist/apps/cli/src/index.js", "demo", root], { stdio: "inherit" });
  const { server } = createWorkspaceServer(root);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  try {
    const initial = await project(base);
    const original = initial.deck.slides[0];
    const originalElementIds = new Set(original.scene.map((element: any) => element.id));

    await page.goto(`${base}/editor-spike`, { waitUntil: "networkidle" });
    await page.getByText("Pitch pointer engine + Daybrush controls attached to live SceneGraph").waitFor();
    await page.locator("#pitchSlideTools").waitFor();

    await page.locator('[data-slide-action="duplicate"]').click();
    await page.waitForFunction(async () => (await fetch("/api/project").then(r => r.json())).deck.slides.length === 2);
    const duplicatedState = await project(base);
    const duplicated = duplicatedState.deck.slides[1];
    assert.notEqual(duplicated.id, original.id);
    assert(duplicated.scene.every((element: any) => !originalElementIds.has(element.id)), "Duplicated slide must not share scene IDs");
    await page.waitForFunction((slideId) => (window as any).__pitchEditorRuntime.getSlide()?.id === slideId, duplicated.id);

    const nameInput = page.locator('[data-slide-name]');
    await nameInput.fill("CFO version");
    await nameInput.press("Enter");
    await page.waitForFunction(async (slideId) => {
      const next = await fetch("/api/project").then(r => r.json());
      return next.deck.slides.find((slide: any) => slide.id === slideId)?.title === "CFO version";
    }, duplicated.id);

    await page.locator('[data-slide-action="new"]').click();
    await page.waitForFunction(async () => (await fetch("/api/project").then(r => r.json())).deck.slides.length === 3);
    const withNew = await project(base);
    const inserted = withNew.deck.slides[2];
    await page.waitForFunction((slideId) => (window as any).__pitchEditorRuntime.getSlide()?.id === slideId, inserted.id);

    const insertedThumb = page.locator(`#spikeSlides [data-slide="${inserted.id}"]`);
    const originalThumb = page.locator(`#spikeSlides [data-slide="${original.id}"]`);
    await insertedThumb.dragTo(originalThumb);
    await page.waitForFunction(async (slideId) => {
      const next = await fetch("/api/project").then(r => r.json());
      return next.deck.slides[0]?.id === slideId;
    }, inserted.id);
    const reordered = await project(base);
    assert.deepEqual(reordered.deck.slides.map((slide: any) => slide.order), [0, 1, 2]);

    await page.waitForFunction((slideId) => (window as any).__pitchEditorRuntime.getSlide()?.id === slideId, inserted.id);
    await page.locator('[data-slide-action="delete"]').click();
    await page.waitForFunction(async (deletedId) => {
      const next = await fetch("/api/project").then(r => r.json());
      return next.deck.slides.length === 2 && !next.deck.slides.some((slide: any) => slide.id === deletedId);
    }, inserted.id);

    await page.keyboard.press("Control+Z");
    await page.waitForFunction(async (restoredId) => {
      const next = await fetch("/api/project").then(r => r.json());
      return next.deck.slides.length === 3 && next.deck.slides.some((slide: any) => slide.id === restoredId);
    }, inserted.id);
    const restored = await project(base);
    assert.equal(restored.deck.slides[0].id, inserted.id, "Undo must restore prior slide order and deleted slide");
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
