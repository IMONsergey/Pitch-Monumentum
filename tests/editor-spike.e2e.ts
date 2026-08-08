import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { createWorkspaceServer } from "../apps/workspace/src/server.js";

test("Pitch editor commits a real browser drag into the canonical deck", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-editor-e2e-"));
  execFileSync(process.execPath, ["dist/apps/cli/src/index.js", "demo", root], { stdio: "inherit" });

  const { server } = createWorkspaceServer(root);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;

  const before = await fetch(`${base}/api/project`).then((response) => response.json()) as any;
  const slide = before.deck.slides[0];
  assert(slide.scene.length > 0);
  const canvas = before.deck.canvas;
  const targetElement = slide.scene.find((element: any) => {
    const geometry = element.geometry;
    return !element.locked
      && geometry.width > 0
      && geometry.height > 0
      && geometry.x + geometry.width + 80 < canvas.widthDU
      && geometry.y + geometry.height + 60 < canvas.heightDU;
  });
  assert(targetElement, "Demo deck needs at least one movable scene element with free canvas space");
  const targetId = targetElement.id;
  const beforeGeometry = structuredClone(targetElement.geometry);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    await page.goto(`${base}/editor-spike`, { waitUntil: "networkidle" });
    await page.getByText("Pitch pointer engine + Daybrush controls attached to live SceneGraph").waitFor();

    const target = page.locator(`#spikeScene [data-id="${targetId}"]`);
    await target.click();
    await page.locator("#spikeSelection").getByText("1 selected", { exact: false }).waitFor();
    await page.locator(".moveable-control-box").waitFor({ state: "visible" });

    const box = await target.boundingBox();
    if (!box) throw new Error("Selected scene element did not produce a browser bounding box");
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 55, startY + 35, { steps: 8 });
    await page.mouse.up();

    try {
      await page.getByText("committed through DeckMutation", { exact: false }).waitFor({ timeout: 5_000 });
    } catch {
      const telemetry = await page.evaluate(() => (window as any).__pitchEditorDebug);
      const status = await page.locator("#spikeStatus").textContent();
      throw new Error(`Editor drag did not commit. status=${status}; telemetry=${JSON.stringify(telemetry)}`);
    }

    const after = await fetch(`${base}/api/project`).then((response) => response.json()) as any;
    const afterElement = after.deck.slides[0].scene.find((element: any) => element.id === targetId);
    assert(afterElement);
    const moved = afterElement.geometry.x !== beforeGeometry.x || afterElement.geometry.y !== beforeGeometry.y;
    if (!moved) {
      const telemetry = await page.evaluate(() => (window as any).__pitchEditorDebug);
      throw new Error(`Editor committed without x/y movement. before=${JSON.stringify(beforeGeometry)} after=${JSON.stringify(afterElement.geometry)} telemetry=${JSON.stringify(telemetry)}`);
    }
    assert.notEqual(after.deckHash, before.deckHash);
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
