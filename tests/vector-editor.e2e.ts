import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { createWorkspaceServer } from "../apps/workspace/src/server.js";

async function project(base: string): Promise<any> {
  return fetch(`${base}/api/project`).then((response) => response.json());
}

test("Pen creates a structured vector and node drag edits the same canonical object", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-vector-browser-"));
  execFileSync(process.execPath, ["dist/apps/cli/src/index.js", "demo", root], { stdio: "ignore" });
  const { server } = createWorkspaceServer(root);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  try {
    const before = await project(base);
    await page.goto(`${base}/editor-spike`, { waitUntil: "networkidle" });
    await page.locator('[data-vector-tool="pen"]').click();
    const overlay = page.locator(".pitch-vector-overlay");
    await overlay.waitFor({ state: "visible" });
    const box = await overlay.boundingBox();
    if (!box) throw new Error("Vector drawing overlay has no bounds");

    const points = [
      [box.x + box.width * .35, box.y + box.height * .38],
      [box.x + box.width * .48, box.y + box.height * .27],
      [box.x + box.width * .62, box.y + box.height * .44],
    ] as const;
    for (const [x, y] of points) await page.mouse.click(x, y);
    await page.keyboard.press("Enter");

    await page.waitForFunction(async (initialHash) => {
      const response = await fetch("/api/project");
      const state = await response.json();
      return state.deckHash !== initialHash && state.deck.slides.flatMap((slide: any) => slide.scene).some((element: any) => element.type === "shape" && element.shape === "custom" && element.pathData);
    }, before.deckHash, { timeout: 10_000 });

    const insertedState = await project(base);
    const inserted = insertedState.deck.slides.flatMap((slide: any) => slide.scene).find((element: any) => element.type === "shape" && element.shape === "custom" && element.pathData);
    assert(inserted, "Pen must create a structured custom vector");
    assert(Array.isArray(inserted.pathData.commands));
    assert(inserted.pathData.commands.length >= 3);
    const vectorId = inserted.id;
    const insertedPath = structuredClone(inserted.pathData);
    const insertedGeometry = structuredClone(inserted.geometry);

    const host = page.locator(`#spikeScene [data-id="${vectorId}"]`);
    await host.dblclick();
    const nodeOverlay = page.locator("#pitchVectorNodeOverlay");
    await nodeOverlay.waitFor({ state: "visible" });
    const anchor = nodeOverlay.locator('[data-vector-anchor="true"]').first();
    await anchor.waitFor({ state: "visible" });
    const anchorBox = await anchor.boundingBox();
    if (!anchorBox) throw new Error("Vector anchor has no browser bounds");

    const startX = anchorBox.x + anchorBox.width / 2;
    const startY = anchorBox.y + anchorBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 45, startY + 18, { steps: 8 });
    await page.mouse.up();

    await page.waitForFunction(async (hash) => {
      const response = await fetch("/api/project");
      const state = await response.json();
      return state.deckHash !== hash;
    }, insertedState.deckHash, { timeout: 10_000 });

    const after = await project(base);
    const edited = after.deck.slides.flatMap((slide: any) => slide.scene).find((element: any) => element.id === vectorId);
    assert(edited, "Edited vector must preserve its stable scene ID");
    assert.equal(edited.id, vectorId);
    assert.notDeepEqual(edited.pathData, insertedPath);
    const boundsChanged = edited.geometry.x !== insertedGeometry.x
      || edited.geometry.y !== insertedGeometry.y
      || edited.geometry.width !== insertedGeometry.width
      || edited.geometry.height !== insertedGeometry.height;
    assert(boundsChanged, "fitBounds node edit should update vector geometry when an extreme anchor moves");
    assert.notEqual(after.deckHash, insertedState.deckHash);
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
