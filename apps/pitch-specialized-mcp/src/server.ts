import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PitchSpecializedRuntime } from "../../../packages/pitch-specialized-runtime/src/index.js";

function response(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
    isError,
  };
}

const geometry = z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(), rotation: z.number().optional() });
const stroke = z.object({ color: z.string().regex(/^#[0-9A-Fa-f]{6}$/), widthDU: z.number().nonnegative(), dash: z.enum(["solid", "dash", "dot"]).optional() });

const chartEdit = z.discriminatedUnion("command", [
  z.object({ command: z.literal("setChartType"), chartType: z.enum(["bar", "column", "line", "area", "pie", "doughnut", "scatter"]) }),
  z.object({ command: z.literal("setInsight"), insightStatement: z.string() }),
  z.object({ command: z.literal("setCategories"), categories: z.array(z.string()).min(1) }),
  z.object({ command: z.literal("setNumberFormat"), numberFormat: z.string().optional() }),
  z.object({ command: z.literal("setLegend"), showLegend: z.boolean() }),
  z.object({ command: z.literal("addSeries"), series: z.object({ name: z.string(), values: z.array(z.number()) }), index: z.number().int().nonnegative().optional() }),
  z.object({ command: z.literal("removeSeries"), seriesIndex: z.number().int().nonnegative() }),
  z.object({ command: z.literal("renameSeries"), seriesIndex: z.number().int().nonnegative(), name: z.string() }),
  z.object({ command: z.literal("setValue"), seriesIndex: z.number().int().nonnegative(), valueIndex: z.number().int().nonnegative(), value: z.number() }),
  z.object({ command: z.literal("replaceSeries"), series: z.array(z.object({ name: z.string(), values: z.array(z.number()) })).min(1) }),
  z.object({ command: z.literal("replaceData"), categories: z.array(z.string()).min(1), series: z.array(z.object({ name: z.string(), values: z.array(z.number()) })).min(1), dataSourceRefs: z.array(z.string()).optional() }),
]);

const tableEdit = z.discriminatedUnion("command", [
  z.object({ command: z.literal("setCellText"), row: z.number().int().nonnegative(), column: z.number().int().nonnegative(), text: z.string() }),
  z.object({ command: z.literal("insertRow"), index: z.number().int().nonnegative() }),
  z.object({ command: z.literal("deleteRow"), index: z.number().int().nonnegative() }),
  z.object({ command: z.literal("insertColumn"), index: z.number().int().nonnegative() }),
  z.object({ command: z.literal("deleteColumn"), index: z.number().int().nonnegative() }),
  z.object({ command: z.literal("setColumnWidths"), widths: z.array(z.number().positive()).min(1) }),
  z.object({ command: z.literal("mergeCells"), fromRow: z.number().int().nonnegative(), fromColumn: z.number().int().nonnegative(), toRow: z.number().int().nonnegative(), toColumn: z.number().int().nonnegative() }),
  z.object({ command: z.literal("unmergeCell"), row: z.number().int().nonnegative(), column: z.number().int().nonnegative() }),
  z.object({ command: z.literal("replaceData"), rows: z.array(z.array(z.string()).min(1)).min(1) }),
]);

export function createPitchSpecializedMcpServer(projectRoot: string): McpServer {
  const runtime = new PitchSpecializedRuntime(resolve(projectRoot));
  const server = new McpServer(
    { name: "pitch-monumentum-specialized", version: "0.1.0" },
    { instructions: "Use pitch_read_objects before specialized edits. Preserve exact object scope and current deckHash. Use pitch_insert_vector rather than raw SVG/image mutation. Use pitch_edit_chart/table to preserve canonical data structure and QA invalidation. All writes create normal branch-local Pitch versions." },
  );

  server.registerTool(
    "pitch_read_objects",
    {
      title: "Read selected Pitch objects",
      description: "Read exact bounded contents of selected object handles: TextRuns, chart data, table cells, crop, vector path, dependencies and slide semantic contract without dumping the full deck.",
      inputSchema: { slideId: z.string().min(1), elementIds: z.array(z.string().min(1)).min(1).max(50), maxElements: z.number().int().min(1).max(50).optional(), maxTextChars: z.number().int().min(500).max(100000).optional() },
    },
    async (args) => {
      try { return response({ ok: true, context: await runtime.readObjects(args) }); }
      catch (error) { return response({ ok: false, error: error instanceof Error ? error.message : String(error) }, true); }
    },
  );

  server.registerTool(
    "pitch_insert_vector",
    {
      title: "Insert editable Pitch vector",
      description: "Insert one canonical custom SVG path object on a slide. The command validates path/style, produces one version, renders as SVG in Pitch/Figma and exports as vector SVG media in PowerPoint.",
      inputSchema: { slideId: z.string().min(1), geometry, svgPath: z.string().min(1), fill: z.string().optional(), stroke: stroke.optional(), name: z.string().optional(), expectedDeckHash: z.string().optional() },
    },
    async (args) => {
      try {
        const { slideId, expectedDeckHash, ...vector } = args;
        const result = await runtime.insertVector({ slideId, expectedDeckHash, vector });
        return response({ ok: true, deckHash: result.deckHash, insertedElementId: result.insertedElementId, nextSelectionIds: result.nextSelectionIds, impact: result.impact });
      } catch (error) { return response({ ok: false, error: error instanceof Error ? error.message : String(error) }, true); }
    },
  );

  server.registerTool(
    "pitch_edit_chart",
    {
      title: "Edit native Pitch chart",
      description: "Edit chart type, insight, categories, series, values, legend or number format without replacing the chart object or losing data-source references.",
      inputSchema: { slideId: z.string().min(1), elementId: z.string().min(1), edit: chartEdit, expectedDeckHash: z.string().optional() },
    },
    async (args) => {
      try {
        const result = await runtime.editDataObject({ expectedDeckHash: args.expectedDeckHash, edit: { command: "chart", slideId: args.slideId, elementId: args.elementId, edit: args.edit } });
        return response({ ok: true, changed: result.changed, deckHash: result.deckHash, warnings: result.warnings, impact: result.impact });
      } catch (error) { return response({ ok: false, error: error instanceof Error ? error.message : String(error) }, true); }
    },
  );

  server.registerTool(
    "pitch_edit_table",
    {
      title: "Edit native Pitch table",
      description: "Edit cells, rows, columns, widths, merge/unmerge or replace rectangular table data while preserving one canonical TableElement.",
      inputSchema: { slideId: z.string().min(1), elementId: z.string().min(1), edit: tableEdit, expectedDeckHash: z.string().optional() },
    },
    async (args) => {
      try {
        const result = await runtime.editDataObject({ expectedDeckHash: args.expectedDeckHash, edit: { command: "table", slideId: args.slideId, elementId: args.elementId, edit: args.edit } });
        return response({ ok: true, changed: result.changed, deckHash: result.deckHash, warnings: result.warnings, impact: result.impact });
      } catch (error) { return response({ ok: false, error: error instanceof Error ? error.message : String(error) }, true); }
    },
  );

  server.registerTool("pitch_specialized_undo", { title: "Undo specialized Pitch edit", description: "Undo the latest canonical branch version.", inputSchema: {} }, async () => {
    try { const state = await runtime.undo(); return response({ ok: true, deckHash: state.deckHash }); }
    catch (error) { return response({ ok: false, error: error instanceof Error ? error.message : String(error) }, true); }
  });
  server.registerTool("pitch_specialized_redo", { title: "Redo specialized Pitch edit", description: "Redo the next canonical branch version.", inputSchema: {} }, async () => {
    try { const state = await runtime.redo(); return response({ ok: true, deckHash: state.deckHash }); }
    catch (error) { return response({ ok: false, error: error instanceof Error ? error.message : String(error) }, true); }
  });
  return server;
}

export async function runPitchSpecializedMcpServer(projectRoot: string): Promise<void> {
  const server = createPitchSpecializedMcpServer(projectRoot);
  await server.connect(new StdioServerTransport());
}

if (process.argv[1]?.endsWith("server.js")) {
  runPitchSpecializedMcpServer(process.argv[2] ?? ".pitch-demo").catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
