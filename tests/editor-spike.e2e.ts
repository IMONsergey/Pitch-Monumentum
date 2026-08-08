import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright";
import { createWorkspaceServer } from "../apps/workspace/src/server.js";

interface Harness {
  root: string;
  base: string;
  browser: Browser;
  page: Page;
  close(): Promise<void>;
}

async function createHarness(prefix: string): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  execFileSync(process.execPath, ["dist/apps/cli/src/index.js", "demo", root], { stdio: "inherit" });
  const { server } = createWorkspaceServer(root);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  return {
    root,
    base,
    browser,
    page,
    async close() {
      await browser.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function project(base: string): Promise<any> {
  return fetch(`${base}/api/project`).then((response) => response.json());
}

test("Pitch editor commits a real browser drag into the canonical deck", async () => {
  const harness = await createHarness("pitch-editor-e2e-");
  const { base, page } = harness;
  try {
    const before = await project(base);
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

    const after = await project(base);
    const afterElement = after.deck.slides[0].scene.find((element: any) => element.id === targetId);
    assert(afterElement);
    const moved = afterElement.geometry.x !== beforeGeometry.x || afterElement.geometry.y !== beforeGeometry.y;
    if (!moved) {
      const telemetry = await page.evaluate(() => (window as any).__pitchEditorDebug);
      throw new Error(`Editor committed without x/y movement. before=${JSON.stringify(beforeGeometry)} after=${JSON.stringify(afterElement.geometry)} telemetry=${JSON.stringify(telemetry)}`);
    }
    assert.notEqual(after.deckHash, before.deckHash);
  } finally {
    await harness.close();
  }
});

test("in-canvas Lexical editing persists mixed formatting as canonical TextRuns", async () => {
  const harness = await createHarness("pitch-text-e2e-");
  const { base, page } = harness;
  try {
    const before = await project(base);
    let slide: any;
    let textElement: any;
    for (const candidate of before.deck.slides) {
      const found = candidate.scene.find((element: any) => element.type === "text" && !element.locked);
      if (found) { slide = candidate; textElement = found; break; }
    }
    assert(slide && textElement, "Demo deck needs an unlocked text element");
    const originalText = textElement.paragraphs.flatMap((paragraph: any) => paragraph.runs.map((run: any) => run.text)).join("");

    await page.goto(`${base}/editor-spike`, { waitUntil: "networkidle" });
    const target = page.locator(`#spikeScene [data-id="${textElement.id}"]`);
    await target.dblclick();
    await page.locator(`#spikeScene [data-id="${textElement.id}"][data-pitch-text-editing="true"]`).waitFor();
    await page.locator("#pitchTextToolbar.visible").waitFor();

    await target.press("End");
    await target.pressSequentially(" EXTRA", { delay: 10 });
    await target.press("Control+Shift+ArrowLeft");
    await page.locator("[data-text-action=bold]").click();
    await page.locator("[data-text-action=commit]").click();

    await page.waitForFunction(async (beforeHash) => {
      const response = await fetch("/api/project");
      const next = await response.json();
      return next.deckHash !== beforeHash;
    }, before.deckHash, { timeout: 10_000 });

    const after = await project(base);
    const afterElement = after.deck.slides.find((item: any) => item.id === slide.id).scene.find((item: any) => item.id === textElement.id);
    assert(afterElement);
    const runs = afterElement.paragraphs.flatMap((paragraph: any) => paragraph.runs);
    const finalText = runs.map((run: any) => run.text).join("");
    assert.equal(finalText, `${originalText} EXTRA`);
    assert(runs.some((run: any) => run.text.includes("EXTRA") && run.bold === true), `Expected a bold appended run, got ${JSON.stringify(runs)}`);
    assert(runs.some((run: any) => run.text.includes(originalText) && !run.bold), `Expected original text to remain independently formatted, got ${JSON.stringify(runs)}`);
    assert(!JSON.stringify(afterElement).includes('"root"'), "Lexical editor state must not leak into canonical text element");
    assert.notEqual(after.deckHash, before.deckHash);
  } finally {
    await harness.close();
  }
});

test("Shift+A wraps a multi-selection in canonical Auto Layout and inspector updates it", async () => {
  const harness = await createHarness("pitch-layout-e2e-");
  const { base, page } = harness;
  try {
    const before = await project(base);
    const slide = before.deck.slides[0];
    const candidates = slide.scene
      .filter((element: any) => !element.locked && element.type !== "shape" && element.geometry.width > 0 && element.geometry.height > 0 && element.geometry.width < before.deck.canvas.widthDU * 0.9)
      .slice(0, 2);
    assert.equal(candidates.length, 2, "Demo deck needs at least two selectable bounded elements");
    const selectedIds = candidates.map((element: any) => element.id);

    await page.goto(`${base}/editor-spike`, { waitUntil: "networkidle" });
    const first = page.locator(`#spikeScene [data-id="${selectedIds[0]}"]`);
    const second = page.locator(`#spikeScene [data-id="${selectedIds[1]}"]`);
    await first.click();
    await second.click({ modifiers: ["Shift"] });
    await page.locator("#spikeSelection").getByText("2 selected", { exact: false }).waitFor();

    await page.keyboard.press("Shift+A");
    let created: any;
    try {
      await page.waitForFunction(async (ids) => {
        const response = await fetch("/api/project");
        const next = await response.json();
        return next.deck.slides.flatMap((slide: any) => slide.scene).some((element: any) => element.type === "frame" && ids.every((id: string) => element.childIds.includes(id)));
      }, selectedIds, { timeout: 10_000 });
      const wrapped = await project(base);
      created = wrapped.deck.slides[0].scene.find((element: any) => element.type === "frame" && selectedIds.every((id: string) => element.childIds.includes(id)));
    } catch {
      const telemetry = await page.evaluate(() => (window as any).__pitchAutoLayoutDebug);
      const status = await page.locator("#spikeStatus").textContent();
      throw new Error(`Shift+A did not create a canonical frame. status=${status}; telemetry=${JSON.stringify(telemetry)}`);
    }

    assert(created, `Expected frame containing ${selectedIds.join(", ")}`);
    assert.equal(created.layout.direction, "horizontal");
    assert.equal(created.layout.gapDU, 24);

    const wrapped = await project(base);
    const childGeometries = selectedIds.map((id: string) => wrapped.deck.slides[0].scene.find((element: any) => element.id === id).geometry);
    assert(childGeometries[1].x > childGeometries[0].x, "Yoga should place the second child after the first in horizontal layout");

    await page.locator(`#spikeScene [data-id="${created.id}"]`).waitFor({ timeout: 10_000 });
    await page.locator(`#spikeScene [data-id="${created.id}"]`).click();
    await page.locator("#pitchAutoLayoutButton").click();
    await page.locator("#pitchLayoutPanel.visible").waitFor();
    await page.locator("[data-layout=gap]").fill("40");
    await page.locator("[data-layout-action=apply]").click();

    try {
      await page.waitForFunction(async (frameId) => {
        const response = await fetch("/api/project");
        const next = await response.json();
        const frame = next.deck.slides.flatMap((slide: any) => slide.scene).find((element: any) => element.id === frameId);
        return frame?.layout?.gapDU === 40;
      }, created.id, { timeout: 10_000 });
    } catch {
      const telemetry = await page.evaluate(() => (window as any).__pitchAutoLayoutDebug);
      const status = await page.locator("#spikeStatus").textContent();
      throw new Error(`Auto Layout inspector did not commit gap=40. status=${status}; telemetry=${JSON.stringify(telemetry)}`);
    }

    const after = await project(base);
    const updated = after.deck.slides[0].scene.find((element: any) => element.id === created.id);
    assert.equal(updated.layout.gapDU, 40);
    assert.notEqual(after.deckHash, before.deckHash);
  } finally {
    await harness.close();
  }
});
