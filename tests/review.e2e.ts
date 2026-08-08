import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { createReviewWorkspaceServer } from "../apps/workspace/src/review-server.js";
import type { PitchWorkspaceService } from "../apps/workspace/src/server.js";

interface Harness { root: string; base: string; browser: Browser; page: Page; service: PitchWorkspaceService; close(): Promise<void>; }
async function harness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "pitch-review-e2e-"));
  execFileSync(process.execPath, ["dist/apps/cli/src/index.js", "demo", root], { stdio: "ignore" });
  const created = createReviewWorkspaceServer(root);
  await new Promise<void>((resolve) => created.server.listen(0, "127.0.0.1", resolve));
  const address = created.server.address(); assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1520, height: 980 } });
  return { root, base, browser, page, service: created.service, async close() { await browser.close(); await new Promise<void>((resolve, reject) => created.server.close((error) => error ? reject(error) : resolve())); await rm(root, { recursive: true, force: true }); } };
}

function editableTarget(state: Awaited<ReturnType<PitchWorkspaceService["state"]>>) {
  for (const slide of state.deck.slides) {
    const element = slide.scene.find((item) => !item.locked);
    if (element) return { slide, element };
  }
  throw new Error("Demo project has no editable object");
}

async function reviewState(base: string): Promise<any> {
  const response = await fetch(`${base}/api/review-state`); const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
}

test("blocking object review creates a canvas pin and blocks export; human resolution/approval then becomes stale after edit", async () => {
  const h = await harness();
  try {
    const before = await h.service.state();
    const { slide, element } = editableTarget(before);
    await h.page.goto(`${h.base}/editor-spike`, { waitUntil: "networkidle" });
    if (slide.id !== before.deck.slides[0].id) await h.page.locator(`[data-slide="${slide.id}"]`).click();
    await h.page.locator(`#spikeScene [data-id="${element.id}"]`).click();
    await h.page.getByRole("button", { name: "Comments", exact: true }).click();
    await h.page.locator("#pitchReviewDrawer.open").waitFor({ state: "visible", timeout: 10_000 });
    await h.page.locator("[data-review-type]").selectOption("changeRequest");
    await h.page.locator("[data-review-priority]").selectOption("blocking");
    await h.page.locator("[data-review-body]").fill("Please review this object before delivery.");
    await h.page.locator("[data-review-add]").click();
    await h.page.waitForFunction(async () => (await fetch('/api/review-state').then(r=>r.json())).summary?.blockingThreads === 1);
    await h.page.locator(".pitch-review-pin.blocking").waitFor({ state: "visible", timeout: 10_000 });

    let exported = await h.page.request.post(`${h.base}/api/export`);
    assert.equal(exported.status(), 409);
    const blocked = await exported.json();
    assert.equal(blocked.reviewGate.ready, false);
    assert(blocked.reviewGate.issues.some((issue: any) => issue.code === "blocking-thread"));

    await h.page.locator("[data-thread-toggle]").click();
    await h.page.waitForFunction(async () => (await fetch('/api/review-state').then(r=>r.json())).summary?.blockingThreads === 0);
    await h.page.locator("[data-review-approve-slide]").click();
    await h.page.waitForFunction(async () => (await fetch('/api/review-state').then(r=>r.json())).summary?.slideApprovalsCurrent === 1);
    let review = await reviewState(h.base);
    assert.equal(review.delivery.ready, true);

    const deckState = await h.service.state();
    await h.service.editorCommand({ command: "nudge", slideId: slide.id, selectedIds: [element.id], dx: 5, dy: 0, expectedDeckHash: deckState.deckHash });
    review = await reviewState(h.base);
    assert.equal(review.summary.slideApprovalsStale, 1);
    assert.equal(review.delivery.ready, false);
    assert(review.delivery.issues.some((issue: any) => issue.code === "slide-approval-stale"));
    exported = await h.page.request.post(`${h.base}/api/export`);
    assert.equal(exported.status(), 409, "stale previously-approved slide must block production export");

    await h.page.reload({ waitUntil: "networkidle" });
    await h.page.getByRole("button", { name: "Comments", exact: true }).click();
    await h.page.locator(".pitch-approval-state.stale").waitFor({ state: "visible", timeout: 10_000 });
    await h.page.locator("[data-review-approve-slide]").click();
    await h.page.waitForFunction(async () => (await fetch('/api/review-state').then(r=>r.json())).summary?.slideApprovalsCurrent === 1 && (await fetch('/api/review-state').then(r=>r.json())).summary?.slideApprovalsStale === 0);
    review = await reviewState(h.base);
    assert.equal(review.delivery.ready, true);
  } finally { await h.close(); }
});
