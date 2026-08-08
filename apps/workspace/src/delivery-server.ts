import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createReviewWorkspaceServer } from "./review-server.js";
import { DeliveryRuntime, type DeliveryFormat, type DeliveryManifest } from "../../delivery/src/runtime.js";
import { SystemHealthRuntime } from "../../system-health/src/runtime.js";
import type { ReviewDeliveryPolicy } from "../../../packages/review-engine/src/delivery.js";
import { inspectFilesystemArtifact } from "../../../packages/fs-artifact/src/index.js";

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

async function body(req: IncomingMessage, limit = 1024 * 1024): Promise<any> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > limit) throw new Error("Delivery request body exceeds 1 MB"); chunks.push(buffer); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function editorBundle(): Promise<string> {
  const names = ["editor-spike.js", "design-system-ui.js", "slide-masters-ui.js", "creative-director-ui.js", "creative-preview-ui.js", "creative-runs-ui.js", "versions-ui.js", "review-ui.js", "review-governance-ui.js", "delivery-ui.js", "system-health-ui.js"];
  const parts = await Promise.all(names.map((name) => readFile(resolve("apps", "workspace", "public", name), "utf8")));
  return `${parts.join("\n;\n")}\n`;
}

function mime(filename: string): string {
  if (filename.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (filename.endsWith(".json")) return "application/json; charset=utf-8";
  if (filename.endsWith(".html")) return "text/html; charset=utf-8";
  if (filename.endsWith(".key")) return "application/octet-stream";
  return "application/octet-stream";
}

function sameOptionalHash(a?: string, b?: string): boolean { return (a ?? "") === (b ?? ""); }

export function createDeliveryWorkspaceServer(projectRoot: string) {
  const root = resolve(projectRoot);
  const inner = createReviewWorkspaceServer(root);
  const delivery = new DeliveryRuntime(root);
  const health = new SystemHealthRuntime(root, { service: inner.service, delivery, review: inner.review, versions: inner.versions, director: inner.director });
  const exportDir = join(root, ".project", "exports");

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://local");
      if (req.method === "GET" && url.pathname === "/editor-spike.js") {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" }); res.end(await editorBundle()); return;
      }
      if (req.method === "GET" && url.pathname === "/api/system-health") {
        json(res, 200, await health.snapshot()); return;
      }
      if (req.method === "GET" && url.pathname === "/api/delivery-state") {
        json(res, 200, await delivery.preflight()); return;
      }
      if (req.method === "POST" && url.pathname === "/api/delivery-export") {
        const input = await body(req) as { formats?: DeliveryFormat[]; policy?: ReviewDeliveryPolicy };
        const formats = Array.isArray(input.formats) ? input.formats.filter((value): value is DeliveryFormat => ["pptx", "figma", "web", "keynote"].includes(value)) : [];
        if (!formats.length) throw new Error("At least one delivery format is required");
        json(res, 200, await delivery.exportBundle(formats, input.policy ?? {})); return;
      }
      if (req.method === "GET" && url.pathname === "/api/delivery-download") {
        const requested = url.searchParams.get("file") ?? "";
        const filename = basename(requested);
        if (!filename || filename !== requested || filename.includes("..")) throw new Error("Invalid delivery artifact filename");

        const current = await delivery.preflight();
        const manifestPath = join(exportDir, `${current.deckId}-delivery-manifest.json`);
        let manifest: DeliveryManifest;
        try { manifest = JSON.parse(await readFile(manifestPath, "utf8")) as DeliveryManifest; }
        catch {
          json(res, 409, { error: "No current Delivery manifest authorizes browser download. Re-export from Delivery Center.", filename });
          return;
        }
        const snapshotMatches =
          manifest.deckId === current.deckId &&
          manifest.deckHash === current.deckHash &&
          manifest.preflight.activeBranchId === current.activeBranchId &&
          sameOptionalHash(manifest.preflight.reviewHash, current.reviewHash) &&
          sameOptionalHash(manifest.preflight.motionHash, current.motionHash);
        if (!snapshotMatches) {
          json(res, 409, { error: "Delivery artifact belongs to a stale project/review/motion snapshot. Re-export before download.", filename });
          return;
        }
        const artifact = manifest.artifacts.find((item) => item.filename === filename);
        if (!artifact) {
          json(res, 404, { error: "Artifact is not part of the current Delivery manifest.", filename });
          return;
        }
        const formatState = current.formats[artifact.format];
        if (!formatState?.ready) {
          json(res, 409, { error: "Current Delivery preflight no longer permits this format.", filename, blockers: formatState?.blockers ?? [] });
          return;
        }

        const path = join(exportDir, filename);
        const info = await stat(path);
        if (!info.isFile()) {
          json(res, 409, { error: "This delivery artifact is a package/directory and cannot be downloaded by the browser endpoint. Open/reveal it from the desktop shell instead.", filename });
          return;
        }
        const inspected = await inspectFilesystemArtifact(path);
        if (inspected.sha256 !== artifact.sha256 || inspected.bytes !== artifact.bytes || inspected.kind !== artifact.filesystemKind) {
          json(res, 409, { error: "Delivery artifact bytes no longer match the signed manifest metadata. Re-export before download.", filename });
          return;
        }
        const bytes = await readFile(path);
        res.writeHead(200, { "content-type": mime(filename), "content-length": String(bytes.length), "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, "cache-control": "no-store" });
        res.end(bytes); return;
      }
      inner.server.emit("request", req, res);
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  return { server, service: inner.service, review: inner.review, versions: inner.versions, director: inner.director, delivery, health };
}

if (process.argv[1]?.endsWith("delivery-server.js")) {
  const root = process.argv[2] ?? ".pitch-demo"; const port = Number(process.argv[3] ?? "4173");
  const { server } = createDeliveryWorkspaceServer(root);
  server.listen(port, "127.0.0.1", () => console.log(`Pitch Monumentum Delivery Workspace: http://127.0.0.1:${port}/editor-spike`));
}
