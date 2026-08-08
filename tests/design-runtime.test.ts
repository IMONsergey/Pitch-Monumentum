import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PitchWorkspaceService } from "../apps/workspace/src/server.js";
import { executeWorkspaceDesignCommand } from "../apps/workspace/src/design-runtime.js";
import type { DeckTheme } from "../packages/design-system/src/index.js";

const theme: DeckTheme = {
  schemaVersion: "0.1", id: "theme_test", name: "Test theme",
  colors: { canvas: "#123456", accent: "#C7FF5E", text: "#F4F5F7" },
  fonts: { display: "Inter", body: "Inter" }, typeScalePt: { display: 58, body: 25 }, spacingDU: { m: 24, l: 48 },
};

function bg(deck: any): any { return deck.slides[0].scene.find((element: any) => element.id === "bg"); }

test("design token propagation is one normal deck version and standard undo restores previous materialized state", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-design-runtime-"));
  try {
    execFileSync(process.execPath, ["dist/apps/cli/src/index.js", "demo", root], { stdio: "ignore" });
    const service = new PitchWorkspaceService(root);
    const initial = await service.state();
    const originalFill = bg(initial.deck).fill;

    let state = await executeWorkspaceDesignCommand(service, { command: "initializeTheme", theme, expectedDeckHash: initial.deckHash });
    assert.equal((state.deck as any).theme.colors.canvas, "#123456");

    state = await executeWorkspaceDesignCommand(service, { command: "bindToken", slideId: state.deck.slides[0].id, elementIds: ["bg"], target: "fill", token: "canvas", expectedDeckHash: state.deckHash });
    assert.equal(bg(state.deck).fill, "#123456");
    assert.equal(bg(state.deck).tokenBindings.fill, "canvas");

    state = await executeWorkspaceDesignCommand(service, { command: "setToken", category: "colors", token: "canvas", value: "#ABCDEF", expectedDeckHash: state.deckHash });
    assert.equal(bg(state.deck).fill, "#ABCDEF");
    assert.equal((state.deck as any).theme.colors.canvas, "#ABCDEF");
    assert.equal(state.history.canUndo, true);

    const undoToken = await service.undo();
    assert.equal(bg(undoToken.deck).fill, "#123456");
    assert.equal((undoToken.deck as any).theme.colors.canvas, "#123456");
    assert.equal(bg(undoToken.deck).tokenBindings.fill, "canvas");

    const undoBinding = await service.undo();
    assert.equal(bg(undoBinding.deck).fill, originalFill);
    assert.equal(bg(undoBinding.deck).tokenBindings, undefined);
    assert.equal((undoBinding.deck as any).theme.name, "Test theme");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
