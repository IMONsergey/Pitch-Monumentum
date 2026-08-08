import { importSvgPaths, layoutImportedSvg } from "../../../packages/svg-import/src/index.js";
import { vectorPathToSvg } from "../../../packages/vector-path/src/index.js";

type AnyRecord = Record<string, any>;
type Runtime = {
  getProject(): AnyRecord | null;
  getSlide(): AnyRecord | undefined;
  select(ids: string[]): void;
  reload(): Promise<void>;
};

function runtime(): Runtime | undefined {
  return (window as any).__pitchEditorRuntime as Runtime | undefined;
}

function status(message: string): void {
  const node = document.getElementById("spikeStatus");
  if (node) node.textContent = message;
}

async function mutate(operations: AnyRecord[], reason: string, expectedDeckHash: string): Promise<any> {
  const response = await fetch("/api/mutate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operations, reason, expectedDeckHash }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function targetBox(document: ReturnType<typeof importSvgPaths>): { x: number; y: number; width: number; height: number } {
  const maxWidth = 900;
  const maxHeight = 620;
  const scale = Math.min(maxWidth / document.viewBox.width, maxHeight / document.viewBox.height, 1);
  const width = document.viewBox.width * scale;
  const height = document.viewBox.height * scale;
  return { x: (1920 - width) / 2, y: (1080 - height) / 2, width, height };
}

async function restoreSlideAndSelection(slideId: string, ids: string[]): Promise<void> {
  const editor = runtime();
  if (!editor) return;
  await editor.reload();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const slideButton = document.querySelector<HTMLElement>(`[data-slide="${CSS.escape(slideId)}"]`);
  slideButton?.click();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  editor.select(ids);
}

async function importFile(file: File): Promise<void> {
  const editor = runtime();
  const project = editor?.getProject();
  const slide = editor?.getSlide();
  if (!editor || !project || !slide) throw new Error("Editor is not ready");
  const text = await file.text();
  const parsed = importSvgPaths(text);
  const positioned = layoutImportedSvg(parsed, targetBox(parsed));
  let z = Math.max(0, ...slide.scene.map((element: AnyRecord) => Number(element.zIndex) || 0));
  const ids: string[] = [];
  const operations = positioned.map((item) => {
    const id = `vector_${crypto.randomUUID()}`;
    ids.push(id);
    return {
      op: "addElement",
      slideId: slide.id,
      element: {
        id,
        type: "shape",
        shape: "custom",
        name: item.name,
        semanticRole: "visual",
        geometry: item.geometry,
        zIndex: ++z,
        origin: "import",
        exportStrategy: "vector",
        dependencies: [],
        pathData: item.pathData,
        svgPath: vectorPathToSvg(item.pathData),
        fillPaint: item.fillPaint,
        fill: item.fill,
        stroke: item.stroke,
      },
    };
  });
  if (!operations.length) throw new Error("SVG contains no editable vector paths");
  await mutate(operations, `Import SVG ${file.name} · ${operations.length} vector path(s)`, project.deckHash);
  await restoreSlideAndSelection(slide.id, ids);
  status(`SVG imported · ${ids.length} editable vector path(s) · one version${parsed.warnings.length ? ` · ${parsed.warnings.length} warning(s)` : ""}`);
  if (parsed.warnings.length) console.warn("Pitch SVG import warnings", parsed.warnings);
}

export function installPitchSvgImportUI(): void {
  const top = document.querySelector<HTMLElement>(".spike-top");
  const spacer = top?.querySelector<HTMLElement>(".spacer");
  if (!top || !spacer) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".svg,image/svg+xml";
  input.hidden = true;
  document.body.appendChild(input);

  const button = document.createElement("button");
  button.className = "pitch-vector-tool";
  button.textContent = "Import SVG";
  button.title = "Import SVG paths as editable Pitch vectors";
  top.insertBefore(button, spacer);
  button.addEventListener("click", () => { input.value = ""; input.click(); });
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    void importFile(file).catch((error) => status(`SVG import failed: ${error instanceof Error ? error.message : String(error)}`));
  });
}
