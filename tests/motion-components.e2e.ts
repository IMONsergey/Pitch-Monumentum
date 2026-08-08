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

async function createHarness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "pitch-motion-components-e2e-"));
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

test("Motion Studio, Components and Presenter are reachable and preserve editor context", async () => {
  const harness = await createHarness();
  const { base, page } = harness;
  try {
    const before = await project(base);
    const targetSlide = before.deck.slides.find((slide: any) => slide.scene.some((element: any) => !element.locked && element.type === "text"))
      ?? before.deck.slides.find((slide: any) => slide.scene.some((element: any) => !element.locked));
    assert(targetSlide, "Demo deck needs an editable scene object");
    const target = targetSlide.scene.find((element: any) => !element.locked && element.type === "text")
      ?? targetSlide.scene.find((element: any) => !element.locked);
    assert(target, "Demo deck needs an editable scene object");

    await page.goto(`${base}/editor-spike`, { waitUntil: "networkidle" });
    await page.locator(".spike-right.pitch-inspector").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Motion", exact: true }).waitFor();
    await page.getByRole("button", { name: "Components", exact: true }).waitFor();
    await page.getByRole("button", { name: "Present", exact: true }).waitFor();

    if (targetSlide.id !== before.deck.slides[0].id) {
      await page.locator(`[data-slide="${targetSlide.id}"]`).click();
    }
    const targetNode = page.locator(`#spikeScene [data-id="${target.id}"]`);
    await targetNode.click();
    await page.locator("#spikeSelection").filter({ hasText: "1 selected" }).waitFor();

    await page.getByRole("button", { name: "Motion", exact: true }).click();
    await page.locator("#pitchMotionDrawer.open").waitFor();
    await page.locator("[data-motion-action=build]").click();
    await page.waitForFunction(async ({ slideId, elementId }) => {
      const state = await fetch("/api/project").then((response) => response.json());
      return state.motion?.slides?.some((slide: any) => slide.slideId === slideId && slide.builds.some((build: any) => build.elementIds.includes(elementId)));
    }, { slideId: targetSlide.id, elementId: target.id }, { timeout: 10_000 });

    assert.equal(await page.locator(`[data-slide="${targetSlide.id}"]`).evaluate((node) => node.classList.contains("active")), true, "Motion reload must preserve current slide");
    assert.match((await page.locator("#spikeSelection").textContent()) ?? "", /1 selected/, "Motion reload must preserve valid selection");
    await page.locator("[data-motion-close]").click();

    await page.getByRole("button", { name: "Components", exact: true }).click();
    await page.locator("#pitchComponentsPopover.open").waitFor();
    await page.locator("[data-component-name]").fill("E2E reusable object");
    await page.locator("[data-component-create]").click();
    await page.waitForFunction(async () => {
      const state = await fetch("/api/project").then((response) => response.json());
      return state.components?.some((component: any) => component.name === "E2E reusable object");
    }, undefined, { timeout: 10_000 });

    assert.equal(await page.locator(`[data-slide="${targetSlide.id}"]`).evaluate((node) => node.classList.contains("active")), true, "Component reload must preserve current slide");
    assert.match((await page.locator("#spikeSelection").textContent()) ?? "", /1 selected/, "Component reload must preserve valid selection");

    await page.getByRole("button", { name: "Components", exact: true }).click();
    await page.getByRole("button", { name: "Present", exact: true }).click();
    await page.locator("#pitchPresenter.open").waitFor();
    await page.locator("#pitchPresenterStage").waitFor({ state: "visible" });
    const presenterBar = (await page.locator(".pitch-presenter-bar").textContent()) ?? "";
    assert(presenterBar.includes(targetSlide.title), "Presenter must start from the currently active slide");
    await page.locator("[data-presenter=close]").click();
    await page.locator("#pitchPresenter").waitFor({ state: "hidden" });
  } finally {
    await harness.close();
  }
});
