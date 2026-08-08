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

const PRINT_CSS = `
@page { size: 13.333333in 7.5in; margin: 0; }
html, body { background: white !important; }
.pitch-ui { display: none !important; }
.pitch-slide { box-shadow: none !important; }
`;

const CAPTURE_CSS = `
.pitch-ui { display: none !important; }
html, body { background: white !important; }
.pitch-viewport { inset: 0 !important; }
.pitch-stage { transform: none !important; width: 1920px !important; height: 1080px !important; }
.pitch-slide { box-shadow: none !important; }
`;

async function createRenderer(webPath: string, width = 1920, height = 1080): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    backgroundColor: "#FFFFFF",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await window.loadFile(webPath);
  window.setContentSize(width, height);
  return window;
}

export async function exportDesktopPdf(delivery: DeliveryRuntime): Promise<DesktopStaticExportResult> {
  const web = await delivery.exportWeb();
  const state = await delivery.service.state();
  const output = join(delivery.root, ".project", "exports", `${state.deck.id}.pdf`);
  const window = await createRenderer(web.artifact.path);
  try {
    await window.webContents.insertCSS(PRINT_CSS);
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
  const dir = join(delivery.root, ".project", "exports", `${state.deck.id}-png`);
  await mkdir(dir, { recursive: true });
  const window = await createRenderer(web.artifact.path);
  const files: string[] = [];
  try {
    await window.webContents.insertCSS(CAPTURE_CSS);
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
      const image = await window.webContents.capturePage({ x: 0, y: 0, width: 1920, height: 1080 });
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
