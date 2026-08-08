import { BrowserWindow } from "electron";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DeliveryPreflight, DeliveryRuntime } from "../../delivery/src/runtime.js";
import { inspectFilesystemArtifact } from "../../../packages/fs-artifact/src/index.js";

export interface DesktopStaticExportResult {
  format: "pdf" | "png";
  path: string;
  filename: string;
  files?: string[];
  slideCount: number;
  sourceWebPath: string;
  bytes: number;
  sha256: string;
  filesystemKind: "file" | "directory";
  fileCount: number;
  warnings: string[];
  snapshot: {
    activeBranchId: string;
    deckHash: string;
    reviewHash?: string;
    motionHash?: string;
  };
}

function sameOptionalHash(a?: string, b?: string): boolean { return (a ?? "") === (b ?? ""); }

async function assertSnapshot(delivery: DeliveryRuntime, expected: DeliveryPreflight): Promise<void> {
  const current = await delivery.preflight();
  const problems: string[] = [];
  if (current.activeBranchId !== expected.activeBranchId) problems.push(`branch ${expected.activeBranchId} → ${current.activeBranchId}`);
  if (current.deckHash !== expected.deckHash) problems.push(`deck ${expected.deckHash.slice(0, 10)} → ${current.deckHash.slice(0, 10)}`);
  if (!sameOptionalHash(current.reviewHash, expected.reviewHash)) problems.push("review document changed");
  if (!sameOptionalHash(current.motionHash, expected.motionHash)) problems.push("motion document changed");
  if (problems.length) throw new Error(`Desktop static delivery snapshot is stale: ${problems.join("; ")}. Re-export from the current project state.`);
}

function snapshot(preflight: DeliveryPreflight): DesktopStaticExportResult["snapshot"] {
  return { activeBranchId: preflight.activeBranchId, deckHash: preflight.deckHash, reviewHash: preflight.reviewHash, motionHash: preflight.motionHash };
}

function printCss(widthDU: number, heightDU: number, duPerInch: number): string {
  const widthIn = widthDU / duPerInch;
  const heightIn = heightDU / duPerInch;
  return `
@page { size: ${widthIn}in ${heightIn}in; margin: 0; }
html, body { background: white !important; }
.pitch-ui { display: none !important; }
.pitch-slide { box-shadow: none !important; }
.pitch-build-hidden { opacity: 1 !important; }
.pitch-pulse { animation: none !important; }
`;
}

function captureCss(widthDU: number, heightDU: number): string {
  return `
.pitch-ui { display: none !important; }
html, body { background: white !important; }
.pitch-viewport { inset: 0 !important; }
.pitch-stage { transform: none !important; width: ${widthDU}px !important; height: ${heightDU}px !important; }
.pitch-slide { box-shadow: none !important; }
.pitch-pulse { animation: none !important; }
`;
}

async function createRenderer(webPath: string, width: number, height: number): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    show: false,
    width: Math.max(1, Math.ceil(width)),
    height: Math.max(1, Math.ceil(height)),
    useContentSize: true,
    backgroundColor: "#FFFFFF",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await window.loadFile(webPath);
  window.setContentSize(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
  await window.webContents.executeJavaScript(`Promise.all([
    document.fonts?.ready || Promise.resolve(),
    Promise.all([...document.images].map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => { image.addEventListener('load', resolve, {once:true}); image.addEventListener('error', resolve, {once:true}); })))
  ]).then(() => true)`);
  return window;
}

export async function exportDesktopPdf(delivery: DeliveryRuntime): Promise<DesktopStaticExportResult> {
  const web = await delivery.exportWeb();
  await assertSnapshot(delivery, web.preflight);
  const state = await delivery.service.state();
  if (state.deckHash !== web.preflight.deckHash || state.manifest.activeBranchId !== web.preflight.activeBranchId) throw new Error("Desktop PDF source changed after Web export; retry.");
  const { widthDU, heightDU, duPerInch } = state.deck.canvas;
  const output = join(delivery.root, ".project", "exports", `${state.deck.id}.pdf`);
  const window = await createRenderer(web.artifact.path, widthDU, heightDU);
  try {
    await window.webContents.insertCSS(printCss(widthDU, heightDU, duPerInch));
    const bytes = await window.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
    await writeFile(output, bytes);
    await assertSnapshot(delivery, web.preflight);
    const inspected = await inspectFilesystemArtifact(output);
    return {
      format: "pdf", path: inspected.path, filename: inspected.path.split(/[\\/]/).pop() || inspected.path,
      slideCount: state.deck.slides.length, sourceWebPath: web.artifact.path, bytes: inspected.bytes, sha256: inspected.sha256,
      filesystemKind: inspected.kind, fileCount: inspected.fileCount, warnings: web.artifact.warnings, snapshot: snapshot(web.preflight),
    };
  } catch (error) {
    await rm(output, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

export async function exportDesktopPngSlides(delivery: DeliveryRuntime): Promise<DesktopStaticExportResult> {
  const web = await delivery.exportWeb();
  await assertSnapshot(delivery, web.preflight);
  const state = await delivery.service.state();
  if (state.deckHash !== web.preflight.deckHash || state.manifest.activeBranchId !== web.preflight.activeBranchId) throw new Error("Desktop PNG source changed after Web export; retry.");
  const { widthDU, heightDU } = state.deck.canvas;
  const width = Math.max(1, Math.ceil(widthDU));
  const height = Math.max(1, Math.ceil(heightDU));
  const dir = join(delivery.root, ".project", "exports", `${state.deck.id}-png`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const window = await createRenderer(web.artifact.path, width, height);
  const files: string[] = [];
  try {
    await window.webContents.insertCSS(captureCss(widthDU, heightDU));
    const count = state.deck.slides.length;
    for (let index = 0; index < count; index += 1) {
      await assertSnapshot(delivery, web.preflight);
      await window.webContents.executeJavaScript(`(() => {
        const slides = [...document.querySelectorAll('.pitch-slide')];
        slides.forEach((slide, i) => slide.classList.toggle('active', i === ${index}));
        document.querySelectorAll('.pitch-el').forEach((node) => {
          node.classList.remove('pitch-build-hidden', 'pitch-pulse');
          node.style.removeProperty('opacity');
        });
        return slides.length;
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 25));
      const image = await window.webContents.capturePage({ x: 0, y: 0, width, height });
      const filename = `slide-${String(index + 1).padStart(3, "0")}.png`;
      const path = join(dir, filename);
      await writeFile(path, image.toPNG());
      files.push(path);
    }
    await assertSnapshot(delivery, web.preflight);
    const inspected = await inspectFilesystemArtifact(dir);
    return {
      format: "png", path: inspected.path, filename: inspected.path.split(/[\\/]/).pop() || inspected.path,
      files, slideCount: count, sourceWebPath: web.artifact.path, bytes: inspected.bytes, sha256: inspected.sha256,
      filesystemKind: inspected.kind, fileCount: inspected.fileCount, warnings: web.artifact.warnings, snapshot: snapshot(web.preflight),
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}
