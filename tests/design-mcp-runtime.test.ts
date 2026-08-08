import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PitchWorkspaceService } from "../apps/workspace/src/server.js";
import { bootstrapThemeFromDesignSystem, readDesignState } from "../apps/design-mcp/src/server.js";
import { executeWorkspaceDesignCommand } from "../apps/workspace/src/design-runtime.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pitch-design-mcp-"));
  execFileSync(process.execPath, ["dist/apps/cli/src/index.js", "demo", root], { stdio: "ignore" });
  return { root, service: new PitchWorkspaceService(root) };
}

test("Design MCP state suggests canonical bootstrap theme and then exposes migration binding suggestions", async () => {
  const { root, service } = await fixture();
  try {
    const before = await readDesignState(service);
    assert.equal(before.theme, null);
    assert(before.suggestedTheme);
    assert.equal(before.sourceDesignSystem?.id, "design_demo");

    const bootstrapped = await bootstrapThemeFromDesignSystem(service, before.deckHash);
    assert.equal((bootstrapped.deck as any).theme.name, "PitchOS Dark");

    const after = await readDesignState(service);
    assert(after.theme);
    assert(after.bindingSuggestions.some((item: any) => item.elementId === "bg" && item.target === "fill" && item.token === "canvas"));
    assert(after.bindingSuggestions.some((item: any) => item.elementId === "kicker" && item.target === "textColor" && item.token === "accent"));

    const bound = await executeWorkspaceDesignCommand(service, { command: "bindToken", slideId: "slide_01", elementIds: ["bg"], target: "fill", token: "canvas", expectedDeckHash: after.deckHash });
    assert.equal((bound.deck.slides[0].scene.find((element: any) => element.id === "bg") as any).tokenBindings.fill, "canvas");
  } finally { await rm(root, { recursive: true, force: true }); }
});
