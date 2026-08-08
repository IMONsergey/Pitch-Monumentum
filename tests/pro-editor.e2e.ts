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

function deckHead(state: any): any {
  return Object.values(state.manifest.branches[state.manifest.activeBranchId].heads).find((head: any) => head.kind === "deck");
}

test("Pro Editor keyboard, history, Inspector, Layers, lock and structured clipboard mutate canonical project state", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-pro-editor-e2e-"));
  execFileSync(process.execPath, ["dist/apps/cli/src/index.js", "demo", root], { stdio: "inherit" });
  const { server } = createWorkspaceServer(root);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  try {
    const before = await project(base);
    const bodyBefore = before.deck.slides[0].scene.find((element: any) => element.id === "body");
    assert(bodyBefore, "Demo fixture must expose the body text object");

    await page.goto(`${base}/editor-spike`, { waitUntil: "networkidle" });
    await page.getByText("Pitch pointer engine + Daybrush controls attached to live SceneGraph").waitFor();
    await page.locator("[data-pitch-action=insertShape]").waitFor();

    await page.locator('#spikeScene [data-id="body"]').click();
    await page.locator("#spikeSelection").getByText("1 selected", { exact: false }).waitFor();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(async (x) => {
      const next = await fetch("/api/project").then((response) => response.json());
      return next.deck.slides[0].scene.find((element: any) => element.id === "body")?.geometry.x === x + 1;
    }, bodyBefore.geometry.x);

    await page.keyboard.press("Control+Z");
    await page.waitForFunction(async (x) => {
      const next = await fetch("/api/project").then((response) => response.json());
      return next.deck.slides[0].scene.find((element: any) => element.id === "body")?.geometry.x === x;
    }, bodyBefore.geometry.x);
    await page.keyboard.press("Control+Shift+Z");
    await page.waitForFunction(async (x) => {
      const next = await fetch("/api/project").then((response) => response.json());
      return next.deck.slides[0].scene.find((element: any) => element.id === "body")?.geometry.x === x + 1;
    }, bodyBefore.geometry.x);

    const beforeInspector = await project(base);
    const beforeInspectorVersion = deckHead(beforeInspector).version;
    await page.locator('[data-inspector="x"]').fill(String(bodyBefore.geometry.x + 21));
    await page.locator('[data-inspector="fontSize"]').fill("31.5");
    await page.locator('[data-inspector-action="apply"]').click();
    await page.waitForFunction(async ({ x, size }) => {
      const next = await fetch("/api/project").then((response) => response.json());
      const body = next.deck.slides[0].scene.find((element: any) => element.id === "body");
      const firstRun = body?.paragraphs?.[0]?.runs?.[0];
      return body?.geometry?.x === x && firstRun?.fontSizePt === size;
    }, { x: bodyBefore.geometry.x + 21, size: 31.5 });
    const afterInspector = await project(base);
    assert.equal(deckHead(afterInspector).version, beforeInspectorVersion + 1, "Inspector Apply must create exactly one version");

    const sceneCountAfterInspector = afterInspector.deck.slides[0].scene.length;
    await page.keyboard.press("Control+D");
    await page.waitForFunction(async (count) => {
      const next = await fetch("/api/project").then((response) => response.json());
      return next.deck.slides[0].scene.length === count + 1;
    }, sceneCountAfterInspector);

    const afterDuplicate = await project(base);
    const duplicate = afterDuplicate.deck.slides[0].scene.find((element: any) => element.id.startsWith("body_copy_"));
    assert(duplicate, "Duplicate command must create a new stable element id");
    assert.equal(duplicate.geometry.x, bodyBefore.geometry.x + 21 + 32);
    assert.equal(duplicate.paragraphs[0].runs[0].fontSizePt, 31.5);

    await page.locator('[data-side-tab="layers"]').click();
    await page.locator(`#pitchLayers [data-layer-id="${duplicate.id}"]`).waitFor();
    await page.locator(`#pitchLayers [data-lock-id="${duplicate.id}"]`).click();
    await page.waitForFunction(async (id) => {
      const next = await fetch("/api/project").then((response) => response.json());
      return next.deck.slides[0].scene.find((element: any) => element.id === id)?.locked === true;
    }, duplicate.id);
    assert.equal(await page.locator(`#spikeScene [data-id="${duplicate.id}"]`).getAttribute("data-locked"), "true");
    assert.equal(await page.locator(`#spikeScene [data-id="${duplicate.id}"]`).evaluate((node) => node.classList.contains("selectable")), false);

    const beforeInsert = await project(base);
    await page.locator('[data-pitch-action="insertShape"]').click();
    await page.waitForFunction(async (count) => {
      const next = await fetch("/api/project").then((response) => response.json());
      return next.deck.slides[0].scene.length === count + 1;
    }, beforeInsert.deck.slides[0].scene.length);
    const afterInsert = await project(base);
    const inserted = afterInsert.deck.slides[0].scene.find((element: any) => element.id.startsWith("shape_"));
    assert(inserted, "Insert Shape must create a canonical shape element");

    await page.evaluate((id) => (window as any).__pitchEditorRuntime.select([id]), inserted.id);
    await page.keyboard.press("Control+C");
    const beforePaste = await project(base);
    await page.keyboard.press("Control+V");
    await page.waitForFunction(async (count) => {
      const next = await fetch("/api/project").then((response) => response.json());
      return next.deck.slides[0].scene.length === count + 1;
    }, beforePaste.deck.slides[0].scene.length);
    const afterPaste = await project(base);
    assert(afterPaste.deck.slides[0].scene.some((element: any) => element.id.startsWith(`${inserted.id}_paste_`)));
    assert.notEqual(afterPaste.deckHash, before.deckHash);
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
