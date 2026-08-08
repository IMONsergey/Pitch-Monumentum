import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createDesignWorkspaceServer } from "../apps/workspace/src/design-server.js";

async function state(base: string): Promise<any> { return fetch(`${base}/api/project`).then(response => response.json()); }
async function designState(base: string): Promise<any> { return fetch(`${base}/api/design-state`).then(response => response.json()); }

test("Design System panel bootstraps theme, binds selection, propagates token and standard undo restores previous value", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-design-e2e-"));
  execFileSync(process.execPath, ["dist/apps/cli/src/index.js", "demo", root], { stdio: "ignore" });
  const { server } = createDesignWorkspaceServer(root);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
  try {
    await page.goto(`${base}/editor-spike`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Design" }).click();
    await page.locator("#pitchDesignDrawer.open").waitFor({ state: "visible" });
    await page.getByRole("button", { name: /Initialize from/ }).click();
    await page.waitForFunction(async () => Boolean((await fetch('/api/design-state').then(r => r.json())).theme));

    const background = page.locator('#spikeScene [data-id="bg"]');
    await background.click({ force: true });
    await page.waitForFunction(() => (window as any).__pitchEditorRuntime?.getSelectedIds?.().includes("bg"));
    await page.locator('[data-bind-target]').selectOption('fill');
    await page.locator('[data-bind-token]').selectOption('canvas');
    await page.locator('[data-bind]').click();
    await page.waitForFunction(async () => {
      const project = await fetch('/api/project').then(r => r.json());
      return project.deck.slides[0].scene.find((element: any) => element.id === 'bg')?.tokenBindings?.fill === 'canvas';
    });

    const beforeTokenEdit = await state(base);
    const oldFill = beforeTokenEdit.deck.slides[0].scene.find((element: any) => element.id === 'bg').fill;
    const tokenValue = page.locator('[data-token-row="colors:canvas"] [data-token-value]');
    await tokenValue.fill('#334455');
    await tokenValue.dispatchEvent('change');
    await page.waitForFunction(async () => {
      const project = await fetch('/api/project').then(r => r.json());
      return project.deck.slides[0].scene.find((element: any) => element.id === 'bg')?.fill === '#334455';
    });
    assert.equal((await designState(base)).theme.colors.canvas, '#334455');

    const undoResponse = await fetch(`${base}/api/undo`, { method: 'POST' });
    assert.equal(undoResponse.ok, true);
    const afterUndo = await state(base);
    assert.equal(afterUndo.deck.slides[0].scene.find((element: any) => element.id === 'bg').fill, oldFill);
    assert.equal(afterUndo.deck.slides[0].scene.find((element: any) => element.id === 'bg').tokenBindings.fill, 'canvas');
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
