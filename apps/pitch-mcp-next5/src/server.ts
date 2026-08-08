import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createPitchMcpNext4Server } from "../../pitch-mcp-next4/src/server.js";
import { VersionWorkspaceRuntime } from "../../versions/src/runtime.js";

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as any };
}

export function createPitchMcpNext5Server(projectRoot: string) {
  const root = resolve(projectRoot);
  const server = createPitchMcpNext4Server(root);
  const versions = new VersionWorkspaceRuntime(root);

  server.registerTool("pitch_versions_state", {
    title: "Read Pitch branches and named checkpoints",
    description: "Read active branch, branch ancestry/base tracking, deck hashes and immutable named checkpoints. Use before branch/checkpoint operations.",
    inputSchema: {},
  }, async () => result(await versions.state()));

  server.registerTool("pitch_checkpoint_create", {
    title: "Save named Pitch checkpoint",
    description: "Save the active branch's exact artifact heads as an immutable named checkpoint. This does not mutate the deck.",
    inputSchema: { name: z.string().min(1), description: z.string().optional() },
  }, async ({ name, description }) => result({ checkpoint: await versions.createCheckpoint(name, description), versions: await versions.state() }));

  server.registerTool("pitch_checkpoint_remove", {
    title: "Remove named Pitch checkpoint",
    description: "Remove checkpoint metadata only. The deck/artifact versions it referenced are not deleted.",
    inputSchema: { checkpointId: z.string().min(1) },
  }, async ({ checkpointId }) => { await versions.removeCheckpoint(checkpointId); return result(await versions.state()); });

  server.registerTool("pitch_checkpoint_restore", {
    title: "Restore Pitch checkpoint into a new branch",
    description: "Non-destructively restore a checkpoint by creating and checking out a new branch from its saved artifact heads. Never rewinds or overwrites the current source branch.",
    inputSchema: { checkpointId: z.string().min(1), branchName: z.string().optional() },
  }, async ({ checkpointId, branchName }) => {
    const restored = await versions.restoreCheckpoint(checkpointId, branchName);
    return result({ checkpoint: restored.checkpoint, restoredBranchId: restored.restoredBranchId, deckHash: restored.state.deckHash, activeBranchId: restored.state.manifest.activeBranchId, versions: await versions.state() });
  });

  server.registerTool("pitch_branch_create", {
    title: "Fork Pitch branch",
    description: "Create a branch from the current project state and check it out. Fork base heads are recorded for conflict-safe review.",
    inputSchema: { name: z.string().min(1) },
  }, async ({ name }) => {
    const state = await versions.createBranch(name);
    return result({ deckHash: state.deckHash, activeBranchId: state.manifest.activeBranchId, versions: await versions.state() });
  });

  server.registerTool("pitch_branch_checkout", {
    title: "Checkout Pitch branch",
    description: "Switch the active Pitch project branch. Re-read project state after checkout because canonical deck/motion/component heads may change.",
    inputSchema: { branchId: z.string().min(1) },
  }, async ({ branchId }) => {
    const state = await versions.checkout(branchId);
    return result({ deckHash: state.deckHash, activeBranchId: state.manifest.activeBranchId, versions: await versions.state() });
  });

  server.registerTool("pitch_branch_compare", {
    title: "Compare two Pitch branches",
    description: "Return semantic/object deck diff plus changed artifact kinds between two branches. Diff preserves stable slide/object identities and reports geometry/presentation/content facets plus theme/master system changes.",
    inputSchema: { beforeBranchId: z.string().min(1), afterBranchId: z.string().min(1) },
  }, async ({ beforeBranchId, afterBranchId }) => result(await versions.compareBranches(beforeBranchId, afterBranchId)));

  server.registerTool("pitch_checkpoint_compare", {
    title: "Compare checkpoint with branch",
    description: "Compare an immutable named checkpoint against a branch (default current branch) without restoring it.",
    inputSchema: { checkpointId: z.string().min(1), branchId: z.string().optional() },
  }, async ({ checkpointId, branchId }) => result(await versions.compareCheckpoint(checkpointId, branchId)));

  return server;
}

export async function runPitchMcpNext5Server(projectRoot: string): Promise<void> {
  await createPitchMcpNext5Server(projectRoot).connect(new StdioServerTransport());
}

if (process.argv[1]?.endsWith("server.js")) runPitchMcpNext5Server(process.argv[2] ?? ".pitch-demo").catch((error) => { console.error(error); process.exitCode = 1; });
