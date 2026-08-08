import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { createCreativeDirectorWorkspaceServer } from "../apps/workspace/src/creative-director-server.js";

interface Harness { root: string; base: string; browser: Browser; page: Page; close(): Promise<void>; }
async function harness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "pitch-director-e2e-"));
  execFileSync(process.execPath, ["dist/apps/cli/src/index.js", "demo", root], { stdio: "ignore" });
  const { server } = createCreativeDirectorWorkspaceServer(root);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1520, height: 980 } });
  return { root, base, browser, page, async close() { await browser.close(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await rm(root, { recursive: true, force: true }); } };
}

async function project(base: string): Promise<any> { return fetch(`${base}/api/project`).then((response) => response.json()); }

test("Creative Director drawer reviews the live deck, issues a guarded plan and marks it stale after an intervening edit", async () => {
  const h = await harness();
  try {
    await h.page.goto(`${h.base}/editor-spike`, { waitUntil: "networkidle" });
    await h.page.getByRole("button", { name: "Director", exact: true }).click();
    await h.page.locator("#pitchDirectorDrawer.open").waitFor({ state: "visible", timeout: 10_000 });
    await h.page.waitForFunction(() => document.querySelectorAll(".pitch-director-lane").length >= 7);
    const scoreText = await h.page.locator(".pitch-director-score").textContent();
    assert(scoreText && /^\d+$/.test(scoreText.trim()), `Expected numeric production score, got ${scoreText}`);

    await h.page.locator("[data-director-instruction]").fill("Polish the current slide layout and brand treatment without changing its message.");
    await h.page.locator("[data-director-scope]").selectOption("slide");
    await h.page.locator("[data-director-intent=layout]").click();
    await h.page.locator("[data-director-intent=brand]").click();
    await h.page.locator("[data-director-plan]").click();
    await h.page.locator(".pitch-director-plan-head").waitFor({ state: "visible", timeout: 10_000 });
    const requestId = (await h.page.locator(".pitch-director-plan-head b").textContent())?.trim();
    assert(requestId?.startsWith("creative_"));
    assert((await h.page.locator(".pitch-director-step").count()) >= 4);

    await h.page.evaluate(() => {
      (window as any).__creativePlanEvent = null;
      window.addEventListener("pitch:creative-plan-ready", (event: any) => { (window as any).__creativePlanEvent = event.detail; }, { once: true });
    });
    await h.page.locator("[data-director-agent]").click();
    await h.page.waitForFunction(() => Boolean((window as any).__creativePlanEvent?.requestId));
    assert.equal(await h.page.evaluate(() => (window as any).__creativePlanEvent.requestId), requestId);

    const statusBefore = await h.page.request.get(`${h.base}/api/creative-plan-status?requestId=${encodeURIComponent(requestId!)}`);
    assert.equal(statusBefore.ok(), true);
    assert.equal((await statusBefore.json()).stale, false);

    const before = await project(h.base);
    const slide = before.deck.slides[0];
    const editable = slide.scene.find((element: any) => !element.locked);
    assert(editable, "Demo deck requires an editable object");
    const mutation = await h.page.request.post(`${h.base}/api/editor-command`, { data: { command: "nudge", slideId: slide.id, selectedIds: [editable.id], dx: 2, dy: 0, expectedDeckHash: before.deckHash } });
    assert.equal(mutation.ok(), true, await mutation.text());

    const statusAfter = await h.page.request.get(`${h.base}/api/creative-plan-status?requestId=${encodeURIComponent(requestId!)}`);
    assert.equal(statusAfter.ok(), true);
    assert.equal((await statusAfter.json()).stale, true, "intervening deck edit must invalidate the server-issued plan");
  } finally { await h.close(); }
});
