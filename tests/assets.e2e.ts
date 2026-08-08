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
  const root = await mkdtemp(join(tmpdir(), "pitch-assets-e2e-"));
  execFileSync(process.execPath, ["dist/apps/cli/src/index.js", "demo", root], { stdio: "inherit" });
  const { server } = createWorkspaceServer(root);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  return { root, base, browser, page, async close() { await browser.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(root, { recursive: true, force: true }); } };
}
async function project(base: string): Promise<any> { return fetch(`${base}/api/project`).then(response => response.json()); }

test("Assets UI imports a PNG, inserts canonical ImageElement and renders real bytes", async () => {
  const h = await harness();
  try {
    const before = await project(h.base);
    await h.page.goto(`${h.base}/editor-spike`, { waitUntil: "networkidle" });
    await h.page.getByRole("button", { name: "Assets", exact: true }).click();
    await h.page.locator("#pitchAssetsPopover.open").waitFor();
    await h.page.locator("[data-assets-file]").setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: PNG });

    await h.page.waitForFunction(async () => {
      const state = await fetch("/api/project").then(response => response.json());
      return state.assets?.length === 1 && state.deck.slides.some((slide: any) => slide.scene.some((element: any) => element.type === "image" && element.assetId === state.assets[0].id));
    }, undefined, { timeout: 15_000 });

    const after = await project(h.base);
    assert.notEqual(after.deckHash, before.deckHash);
    assert.equal(after.assets.length, 1);
    assert.equal(after.assets[0].usageCount, 1);
    const image = after.deck.slides.flatMap((slide: any) => slide.scene).find((element: any) => element.type === "image" && element.assetId === after.assets[0].id);
    assert(image, "Expected inserted ImageElement");
    const node = h.page.locator(`#spikeScene [data-id="${image.id}"] img.pitch-asset-image`);
    await node.waitFor({ state: "visible", timeout: 10_000 });
    assert.equal(await node.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), true);
    const assetResponse = await h.page.request.get(`${h.base}${after.assets[0].contentUrl}`);
    assert.equal(assetResponse.ok(), true);
    assert.equal(assetResponse.headers()["content-type"], "image/png");
    assert((await assetResponse.body()).length > 0);
  } finally { await h.close(); }
});
