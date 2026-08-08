import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DesignSystem } from "../../../packages/deck-model/src/index.js";
import { planDesignMigration } from "../../../packages/design-migration/src/index.js";
import { brandCoverage, runBrandQA } from "../../../packages/brand-qa/src/index.js";
import { inferTokenBindings } from "../../../packages/design-system-inference/src/index.js";
import { themeFromDesignSystem, type ThemedDeckDocument } from "../../../packages/design-system/src/index.js";
import { createWorkspaceServer, PitchWorkspaceService } from "./server.js";
import { executeWorkspaceDesignCommand, type WorkspaceDesignCommand } from "./design-runtime.js";

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

async function jsonBody(req: IncomingMessage, limitBytes = 1024 * 1024): Promise<any> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > limitBytes) throw new Error("Design command body exceeds 1 MB");
    chunks.push(buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function sourceDesignSystem(service: PitchWorkspaceService): Promise<DesignSystem | undefined> {
  const current = await service.state();
  const head = Object.values(current.manifest.branches[current.manifest.activeBranchId]?.heads ?? {}).find((item) => item.kind === "design");
  if (!head) return undefined;
  return (await service.store.read<DesignSystem>(head.id, head.version)).payload;
}

async function designState(service: PitchWorkspaceService) {
  const current = await service.state();
  const theme = (current.deck as ThemedDeckDocument).theme;
  const source = await sourceDesignSystem(service);
  const suggestedTheme = !theme && source ? themeFromDesignSystem({ id: `theme_${source.id}`, name: source.name, tokens: source.tokens }) : undefined;
  return {
    deckHash: current.deckHash,
    theme: theme ?? null,
    suggestedTheme: suggestedTheme ?? null,
    sourceDesignSystem: source ? { id: source.id, name: source.name, tokens: source.tokens, grid: source.grid } : null,
    coverage: brandCoverage(current.deck),
    issues: runBrandQA(current.deck, theme),
    suggestions: theme ? inferTokenBindings(current.deck, theme) : [],
  };
}

async function bootstrap(service: PitchWorkspaceService, expectedDeckHash?: string) {
  const current = await service.state();
  if ((current.deck as ThemedDeckDocument).theme) throw new Error("Deck theme is already initialized");
  const source = await sourceDesignSystem(service);
  if (!source) throw new Error("No active DesignSystem artifact is available");
  const theme = themeFromDesignSystem({ id: `theme_${source.id}`, name: source.name, tokens: source.tokens });
  return executeWorkspaceDesignCommand(service, { command: "initializeTheme", theme, expectedDeckHash: expectedDeckHash ?? current.deckHash });
}

async function enhancedEditorBundle(): Promise<string> {
  const [editor, design] = await Promise.all([
    readFile(resolve("apps", "workspace", "public", "editor-spike.js"), "utf8"),
    readFile(resolve("apps", "workspace", "public", "design-system-ui.js"), "utf8"),
  ]);
  return `${editor}\n;/* Pitch Design System 2.0 */\n${design}\n`;
}

export function createDesignWorkspaceServer(projectRoot: string) {
  const inner = createWorkspaceServer(projectRoot);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://local");
      if (req.method === "GET" && url.pathname === "/editor-spike.js") {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
        res.end(await enhancedEditorBundle());
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/design-state") { json(res, 200, await designState(inner.service)); return; }
      if (req.method === "POST" && url.pathname === "/api/design-bootstrap") {
        const input = await jsonBody(req);
        json(res, 200, await bootstrap(inner.service, input.expectedDeckHash));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/design-command") {
        const input = await jsonBody(req) as WorkspaceDesignCommand;
        json(res, 200, await executeWorkspaceDesignCommand(inner.service, input));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/design-migration-plan") {
        const input = await jsonBody(req);
        const current = await inner.service.state();
        const theme = (current.deck as ThemedDeckDocument).theme;
        if (!theme) throw new Error("Initialize the deck theme before planning migration");
        json(res, 200, planDesignMigration(current.deck, theme, input.minimumConfidence ?? .99));
        return;
      }
      // Delegate every existing route to the original workspace request handler.
      inner.server.emit("request", req, res);
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  return { server, service: inner.service };
}

if (process.argv[1]?.endsWith("design-server.js")) {
  const projectRoot = process.argv[2] ?? ".pitch-demo";
  const port = Number(process.argv[3] ?? "4173");
  const { server } = createDesignWorkspaceServer(projectRoot);
  server.listen(port, "127.0.0.1", () => console.log(`Pitch Monumentum Design Workspace: http://127.0.0.1:${port}/editor-spike`));
}
