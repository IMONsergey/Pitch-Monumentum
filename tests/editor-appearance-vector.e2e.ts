import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createWorkspaceServer } from "../apps/workspace/src/server.js";

async function harness(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  execFileSync(process.execPath, ["dist/apps/cli/src/index.js", "demo", root], { stdio: "ignore" });
  const { server } = createWorkspaceServer(root);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  return {
    root, base, page,
    async project() { return fetch(`${base}/api/project`).then(response => response.json()) as Promise<any>; },
    async close() {
      await browser.close();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("Appearance Inspector persists a canonical linear gradient and drop shadow", async () => {
  const h = await harness("pitch-appearance-e2e-");
  try {
    const before = await h.project();
    let slide: any, shape: any;
    for (const candidate of before.deck.slides) {
      const found = candidate.scene.find((element: any) => element.type === "shape" && element.shape !== "custom" && !element.locked);
      if (found) { slide = candidate; shape = found; break; }
    }
    assert(slide && shape, "Demo deck needs one editable native shape");

    await h.page.goto(`${h.base}/editor-spike`, { waitUntil: "networkidle" });
    const host = h.page.locator(`#spikeScene [data-id="${shape.id}"]`);
    await host.click();
    const section = h.page.locator(".pitch-appearance-section");
    await section.waitFor();
    await section.locator("[data-appearance=fillKind]").selectOption("linearGradient");
    await section.locator("[data-appearance=gradientStart]").fill("#102030");
    await section.locator("[data-appearance=gradientEnd]").fill("#C7FF5E");
    await section.locator("[data-appearance=gradientAngle]").fill("120");
    const shadow = section.locator("[data-appearance=shadowEnabled]");
    if (!(await shadow.isChecked())) await shadow.check();
    await section.locator("[data-appearance=shadowOpacity]").fill("22");
    await section.locator("[data-appearance=shadowBlur]").fill("24");
    await section.locator("[data-appearance=shadowX]").fill("6");
    await section.locator("[data-appearance=shadowY]").fill("12");
    await section.locator(".pitch-appearance-apply").click();

    await h.page.waitForFunction(async ({ hash, id }) => {
      const project = await fetch("/api/project").then(response => response.json());
      const element = project.deck.slides.flatMap((s: any) => s.scene).find((item: any) => item.id === id);
      return project.deckHash !== hash && element?.fillPaint?.kind === "linearGradient" && element?.effects?.[0]?.kind === "dropShadow";
    }, { hash: before.deckHash, id: shape.id }, { timeout: 10_000 });

    const after = await h.project();
    const changed = after.deck.slides.find((item: any) => item.id === slide.id).scene.find((item: any) => item.id === shape.id);
    assert.equal(changed.fillPaint.kind, "linearGradient");
    assert.equal(changed.fillPaint.angleDeg, 120);
    assert.equal(changed.fillPaint.stops[0].color.toUpperCase(), "#102030");
    assert.equal(changed.fillPaint.stops[1].color.toUpperCase(), "#C7FF5E");
    assert.equal(changed.effects[0].blurDU, 24);
    assert.equal(changed.effects[0].offsetXDU, 6);
    assert.equal(changed.effects[0].offsetYDU, 12);
  } finally {
    await h.close();
  }
});

test("Pen creates structured pathData and vector node drag commits the same stable object id", async () => {
  const h = await harness("pitch-vector-node-e2e-");
  try {
    await h.page.goto(`${h.base}/editor-spike`, { waitUntil: "networkidle" });
    await h.page.locator("[data-vector-tool=pen]").click();
    const stage = await h.page.locator("#spikeStage").boundingBox();
    if (!stage) throw new Error("Editor stage has no browser bounds");
    const point = async (x: number, y: number) => h.page.mouse.click(stage.x + stage.width * x, stage.y + stage.height * y);
    await point(.25, .28);
    await point(.48, .2);
    await point(.58, .48);
    await point(.34, .58);
    await h.page.keyboard.press("Enter");

    await h.page.waitForFunction(async () => {
      const project = await fetch("/api/project").then(response => response.json());
      return project.deck.slides.flatMap((s: any) => s.scene).some((element: any) => element.type === "shape" && element.shape === "custom" && element.pathData?.commands?.length >= 2);
    }, undefined, { timeout: 10_000 });
    const insertedState = await h.project();
    const vector = insertedState.deck.slides.flatMap((s: any) => s.scene).find((element: any) => element.type === "shape" && element.shape === "custom" && element.pathData);
    assert(vector);
    const originalPath = JSON.stringify(vector.pathData);
    const originalId = vector.id;

    await h.page.keyboard.press("v");
    const host = h.page.locator(`#spikeScene [data-id="${originalId}"]`);
    await host.dblclick();
    const anchor = h.page.locator("#pitchVectorNodeOverlay [data-vector-anchor=true]").first();
    await anchor.waitFor();
    const box = await anchor.boundingBox();
    if (!box) throw new Error("Vector anchor has no browser bounds");
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await h.page.mouse.move(x, y);
    await h.page.mouse.down();
    await h.page.mouse.move(x + 32, y + 18, { steps: 6 });
    await h.page.mouse.up();

    await h.page.waitForFunction(async ({ hash, id, path }) => {
      const project = await fetch("/api/project").then(response => response.json());
      const element = project.deck.slides.flatMap((s: any) => s.scene).find((item: any) => item.id === id);
      return project.deckHash !== hash && element && JSON.stringify(element.pathData) !== path;
    }, { hash: insertedState.deckHash, id: originalId, path: originalPath }, { timeout: 10_000 });

    const after = await h.project();
    const edited = after.deck.slides.flatMap((s: any) => s.scene).find((element: any) => element.id === originalId);
    assert(edited, "Node editing must preserve the stable vector id");
    assert.notEqual(JSON.stringify(edited.pathData), originalPath);
    assert.equal(edited.id, originalId);
  } finally {
    await h.close();
  }
});
