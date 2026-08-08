import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright";
import { createWorkspaceServer } from "../apps/workspace/src/server.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7rAAAAAASUVORK5CYII=", "base64");

interface Harness { root: string; base: string; browser: Browser; page: Page; close(): Promise<void>; }
async function harness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "pitch-advanced-media-e2e-"));
  execFileSync(process.execPath, ["dist/apps/cli/src/index.js", "demo", root], { stdio: "inherit" });
  const { server } = createWorkspaceServer(root);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  return { root, base, browser, page, async close() { await browser.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(root, { recursive: true, force: true }); } };
}

async function state(base: string): Promise<any> { return fetch(`${base}/api/project`).then(response => response.json()); }

async function importAndInsert(base: string): Promise<{ assetId: string; imageId: string }> {
  const imported = await fetch(`${base}/api/assets/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: "pixel.png", mimeType: "image/png", dataBase64: PNG.toString("base64"), source: "upload" }) }).then(response => response.json());
  const before = await state(base); const slideId = before.deck.slides[0].id;
  const response = await fetch(`${base}/api/editor-command`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: "insertImage", slideId, assetId: imported.asset.id, geometry: { x: 600, y: 300, width: 600, height: 420 }, fit: "cover", expectedDeckHash: before.deckHash }) });
  const inserted = await response.json(); if (!response.ok) throw new Error(inserted.error);
  return { assetId: imported.asset.id, imageId: inserted.nextSelectionIds[0] };
}

test("selected image enters Crop Mode, crop/focal drags commit canonical state, and ellipse clip renders", async () => {
  const h = await harness();
  try {
    const { imageId } = await importAndInsert(h.base);
    await h.page.goto(`${h.base}/editor-spike`, { waitUntil: "networkidle" });
    const frame = h.page.locator(`#spikeScene [data-id="${imageId}"]`);
    await frame.waitFor({ state: "visible" });
    await frame.click();
    await frame.dblclick();
    await h.page.locator("#pitchCropOverlay.open").waitFor({ state: "visible", timeout: 10_000 });

    const focal = h.page.locator("#pitchCropOverlay .pitch-focal-handle");
    let overlay = await h.page.locator("#pitchCropOverlay").boundingBox();
    const focalBox = await focal.boundingBox();
    assert(overlay && focalBox);
    await h.page.mouse.move(focalBox.x + focalBox.width / 2, focalBox.y + focalBox.height / 2);
    await h.page.mouse.down();
    await h.page.mouse.move(overlay.x + overlay.width * .82, overlay.y + overlay.height * .35, { steps: 6 });
    await h.page.mouse.up();

    await h.page.waitForFunction(async (id) => {
      const project = await fetch("/api/project").then(response => response.json());
      const image = project.deck.slides.flatMap((slide: any) => slide.scene).find((element: any) => element.id === id);
      return image?.focalPoint?.x > .75 && image?.focalPoint?.y > .25 && image?.focalPoint?.y < .45;
    }, imageId, { timeout: 10_000 });

    await h.page.locator("#pitchCropOverlay.open").waitFor({ state: "visible" });
    overlay = await h.page.locator("#pitchCropOverlay").boundingBox();
    const leftHandle = await h.page.locator("#pitchCropOverlay [data-edge=left]").boundingBox();
    assert(overlay && leftHandle);
    await h.page.mouse.move(leftHandle.x + leftHandle.width / 2, leftHandle.y + leftHandle.height / 2);
    await h.page.mouse.down();
    await h.page.mouse.move(leftHandle.x + leftHandle.width / 2 + overlay.width * .12, leftHandle.y + leftHandle.height / 2, { steps: 6 });
    await h.page.mouse.up();

    await h.page.waitForFunction(async (id) => {
      const project = await fetch("/api/project").then(response => response.json());
      const image = project.deck.slides.flatMap((slide: any) => slide.scene).find((element: any) => element.id === id);
      return image?.crop?.left > .05;
    }, imageId, { timeout: 10_000 });

    await h.page.locator("#pitchCropOverlay [data-crop-done]").click();
    await h.page.locator("#pitchCropOverlay.open").waitFor({ state: "hidden" });

    const clipSelect = h.page.locator(".pitch-media-section [data-media=clip]");
    await clipSelect.selectOption("ellipse");
    await h.page.locator(".pitch-media-section [data-media-action=apply]").click();
    await h.page.waitForFunction(async (id) => {
      const project = await fetch("/api/project").then(response => response.json());
      return project.deck.slides.flatMap((slide: any) => slide.scene).find((element: any) => element.id === id)?.clipShape === "ellipse";
    }, imageId, { timeout: 10_000 });

    await frame.waitFor({ state: "visible" });
    assert.match(await frame.evaluate((node: HTMLElement) => node.style.clipPath), /ellipse/);
    const objectPosition = await frame.locator("img.pitch-asset-image").evaluate((node: HTMLImageElement) => node.style.objectPosition);
    assert.match(objectPosition, /%/);
  } finally { await h.close(); }
});
