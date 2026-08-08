import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { DesignSystem } from "../../../packages/deck-model/src/index.js";
import { brandCoverage, runBrandQA } from "../../../packages/brand-qa/src/index.js";
import { inferTokenBindings } from "../../../packages/design-system-inference/src/index.js";
import { themeFromDesignSystem, type DeckTheme, type DesignCommand, type ThemedDeckDocument } from "../../../packages/design-system/src/index.js";
import { PitchWorkspaceService } from "../../workspace/src/server.js";
import { executeWorkspaceDesignCommand, type WorkspaceDesignCommand } from "../../workspace/src/design-runtime.js";

const colorMapSchema = z.record(z.string(), z.string().regex(/^#[0-9A-Fa-f]{6}$/));
const stringMapSchema = z.record(z.string(), z.string().min(1));
const positiveMapSchema = z.record(z.string(), z.number().positive());
const nonNegativeMapSchema = z.record(z.string(), z.number().nonnegative());
const themeSchema = z.object({ schemaVersion: z.literal("0.1"), id: z.string().min(1), name: z.string().min(1), colors: colorMapSchema, fonts: stringMapSchema, typeScalePt: positiveMapSchema, spacingDU: nonNegativeMapSchema });
const targetSchema = z.enum(["fill", "strokeColor", "textColor", "fontFamily", "fontSizePt"]);
const categorySchema = z.enum(["colors", "fonts", "typeScalePt", "spacingDU"]);
const designCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("initializeTheme"), theme: themeSchema, expectedDeckHash: z.string().optional() }),
  z.object({ command: z.literal("renameTheme"), name: z.string().min(1), expectedDeckHash: z.string().optional() }),
  z.object({ command: z.literal("setToken"), category: categorySchema, token: z.string().min(1), value: z.union([z.string(), z.number()]), expectedDeckHash: z.string().optional() }),
  z.object({ command: z.literal("bindToken"), slideId: z.string().min(1), elementIds: z.array(z.string().min(1)).min(1), target: targetSchema, token: z.string().min(1), expectedDeckHash: z.string().optional() }),
  z.object({ command: z.literal("unbindToken"), slideId: z.string().min(1), elementIds: z.array(z.string().min(1)).min(1), target: targetSchema, expectedDeckHash: z.string().optional() }),
  z.object({ command: z.literal("deleteToken"), category: categorySchema, token: z.string().min(1), expectedDeckHash: z.string().optional() }),
]);

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as any };
}

async function sourceDesignSystem(service: PitchWorkspaceService): Promise<DesignSystem | undefined> {
  const current = await service.state();
  const head = Object.values(current.manifest.branches[current.manifest.activeBranchId]?.heads ?? {}).find((item) => item.kind === "design");
  if (!head) return undefined;
  return (await service.store.read<DesignSystem>(head.id, head.version)).payload;
}

export async function readDesignState(service: PitchWorkspaceService) {
  const current = await service.state();
  const theme = (current.deck as ThemedDeckDocument).theme;
  const sourceDesign = await sourceDesignSystem(service);
  const suggestedTheme = !theme && sourceDesign ? themeFromDesignSystem({ id: `theme_${sourceDesign.id}`, name: sourceDesign.name, tokens: sourceDesign.tokens }) : undefined;
  return {
    deckHash: current.deckHash,
    theme: theme ?? null,
    suggestedTheme: suggestedTheme ?? null,
    coverage: brandCoverage(current.deck),
    issues: runBrandQA(current.deck, theme),
    bindingSuggestions: theme ? inferTokenBindings(current.deck, theme) : [],
    sourceDesignSystem: sourceDesign ? { id: sourceDesign.id, name: sourceDesign.name, tokens: sourceDesign.tokens, grid: sourceDesign.grid } : null,
  };
}

export async function bootstrapThemeFromDesignSystem(service: PitchWorkspaceService, expectedDeckHash?: string) {
  const current = await service.state();
  if ((current.deck as ThemedDeckDocument).theme) throw new Error("Deck theme is already initialized");
  const design = await sourceDesignSystem(service);
  if (!design) throw new Error("No active DesignSystem artifact is available to initialize the deck theme");
  const theme = themeFromDesignSystem({ id: `theme_${design.id}`, name: design.name, tokens: design.tokens });
  return executeWorkspaceDesignCommand(service, { command: "initializeTheme", theme, expectedDeckHash: expectedDeckHash ?? current.deckHash });
}

export function createDesignMcpServer(projectRoot: string): McpServer {
  const service = new PitchWorkspaceService(resolve(projectRoot));
  const server = new McpServer(
    { name: "pitch-design-system", version: "0.1.0" },
    { instructions: [
      "Use pitch_design_state before editing to obtain deckHash, current theme, brand coverage, QA and token-binding suggestions.",
      "If theme is missing but suggestedTheme exists, use pitch_design_bootstrap rather than inventing a second theme.",
      "Use pitch_design_command for token definitions and bindings. A token edit and all propagated object changes are one ordinary deck version and use normal Pitch undo/redo.",
      "Prefer exact high-confidence binding suggestions for migration of existing hardcoded brand values. Do not auto-bind mixed rich-text boxes as one style token.",
      "Token bindings express intent while concrete values remain materialized in the scene for native Editor/Presenter/PPTX behavior.",
    ].join(" ") },
  );

  server.registerTool("pitch_design_state", { title: "Read Pitch design-system state", description: "Read live theme tokens, brand coverage/QA, source DesignSystem and migration binding suggestions.", inputSchema: {} }, async () => text(await readDesignState(service)));
  server.registerTool("pitch_design_bootstrap", { title: "Initialize deck theme", description: "Create the deck-local live theme from the active canonical DesignSystem artifact.", inputSchema: { expectedDeckHash: z.string().optional() } }, async ({ expectedDeckHash }) => text(await bootstrapThemeFromDesignSystem(service, expectedDeckHash)));
  server.registerTool("pitch_design_command", {
    title: "Edit Pitch Design System",
    description: "Rename theme, set/delete tokens, or bind/unbind selected scene objects. Token propagation is one canonical deck version.",
    inputSchema: {
      command: z.enum(["initializeTheme", "renameTheme", "setToken", "bindToken", "unbindToken", "deleteToken"]),
      theme: themeSchema.optional(), name: z.string().optional(), category: categorySchema.optional(), token: z.string().optional(), value: z.union([z.string(), z.number()]).optional(),
      slideId: z.string().optional(), elementIds: z.array(z.string()).optional(), target: targetSchema.optional(), expectedDeckHash: z.string().optional(),
    },
  }, async (args) => {
    const command = designCommandSchema.parse(args) as WorkspaceDesignCommand;
    return text(await executeWorkspaceDesignCommand(service, command));
  });
  return server;
}

export async function runDesignMcpServer(projectRoot: string): Promise<void> {
  const server = createDesignMcpServer(projectRoot);
  await server.connect(new StdioServerTransport());
}

if (process.argv[1]?.endsWith("server.js")) runDesignMcpServer(process.argv[2] ?? ".pitch-demo").catch((error) => { console.error(error); process.exitCode = 1; });
