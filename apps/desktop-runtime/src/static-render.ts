import { BrowserWindow } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DeliveryRuntime } from "../../delivery/src/runtime.js";

export interface DesktopStaticExportResult {
  format: "pdf" | "png";
  path: string;
  files?: string[];
  slideCount: number;
  sourceWebPath: string;
  warnings: string[];
}

function printCss(widthDU: number, heightDU: number, duPerInch: number): string {
  const widthIn = widthDU / duPerInch;
  const heightIn = heightDU / duPerInch;
  return `
@page { size: ${widthIn}in ${heightIn}in; margin: 0; }
html, body { background: white !important; }
.pitch-ui { display: none !important; }
.pitch-slide { box-shadow: none !important; }
`;
}

function captureCss(widthDU: number, heightDU: number): string {
  return `
.pitch-ui { display: none !important; }
html, body { background: white !important; }
.pitch-viewport { inset: 0 !important; }
.pitch-stage { transform: none !important; width: ${widthDU}px !important; height: ${heightDU}px !important; }
.pitch-slide { box-shadow: none !important; }
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
  return window;
}

export async function exportDesktopPdf(delivery: DeliveryRuntime): Promise<DesktopStaticExportResult> {
  const web = await delivery.exportWeb();
  const state = await delivery.service.state();
  const { widthDU, heightDU, duPerInch } = state.deck.canvas;
  const output = join(delivery.root, ".project", "exports", `${state.deck.id}.pdf`);
  const window = await createRenderer(web.artifact.path, widthDU, heightDU);
  try {
    await window.webContents.insertCSS(printCss(widthDU, heightDU, duPerInch));
    const bytes = await window.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    });
    await writeFile(output, bytes);
    return { format: "pdf", path: output, slideCount: state.deck.slides.length, sourceWebPath: web.artifact.path, warnings: web.artifact.warnings };
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

export async function exportDesktopPngSlides(delivery: DeliveryRuntime): Promise<DesktopStaticExportResult> {
  const web = await delivery.exportWeb();
  const state = await delivery.service.state();
  const { widthDU, heightDU } = state.deck.canvas;
  const width = Math.max(1, Math.ceil(widthDU));
  const height = Math.max(1, Math.ceil(heightDU));
  const dir = join(delivery.root, ".project", "exports", `${state.deck.id}-png`);
  await mkdir(dir, { recursive: true });
  const window = await createRenderer(web.artifact.path, width, height);
  const files: string[] = [];
  try {
    await window.webContents.insertCSS(captureCss(widthDU, heightDU));
    const count = state.deck.slides.length;
    for (let index = 0; index < count; index += 1) {
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
    return { format: "png", path: dir, files, slideCount: count, sourceWebPath: web.artifact.path, warnings: web.artifact.warnings };
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}
