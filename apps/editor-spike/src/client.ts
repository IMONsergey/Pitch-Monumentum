import Moveable from "moveable";
import Selecto from "selecto";
import Guides from "@scena/guides";
import InfiniteViewer from "infinite-viewer";

type AnyRecord = Record<string, any>;
type ProjectState = AnyRecord & { deck: AnyRecord; deckHash: string };

const state: {
  project: ProjectState | null;
  slideId: string | null;
  selectedIds: string[];
  moveable: Moveable | null;
  selecto: Selecto | null;
  viewer: InfiniteViewer | null;
  horizontalGuide: Guides | null;
  verticalGuide: Guides | null;
} = {
  project: null,
  slideId: null,
  selectedIds: [],
  moveable: null,
  selecto: null,
  viewer: null,
  horizontalGuide: null,
  verticalGuide: null,
};

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector(selector) as T;
const esc = (value: unknown) => String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[char] ?? char);

async function api(path: string, options: RequestInit = {}): Promise<any> {
  const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function currentSlide(): AnyRecord | undefined {
  return state.project?.deck.slides.find((slide: AnyRecord) => slide.id === state.slideId) ?? state.project?.deck.slides[0];
}

function styleFor(element: AnyRecord): string {
  const g = element.geometry;
  return [
    `left:${g.x}px`, `top:${g.y}px`, `width:${g.width}px`, `height:${g.height}px`,
    `z-index:${element.zIndex}`, `opacity:${element.opacity ?? 1}`,
    `transform:rotate(${g.rotation || 0}deg)`,
  ].join(";");
}

function textStyle(run: AnyRecord): string {
  return [
    `font-family:${esc(run.fontFamily || "Inter, sans-serif")}`,
    `font-size:${(run.fontSizePt || 18) * 96 / 72}px`,
    `color:${esc(run.color || "#111111")}`,
    `font-weight:${run.bold ? 700 : 400}`,
    `font-style:${run.italic ? "italic" : "normal"}`,
    run.underline ? "text-decoration:underline" : "",
  ].join(";");
}

function draw(element: AnyRecord): string {
  const selected = state.selectedIds.includes(element.id) ? " selected" : "";
  const common = `class="spike-el selectable${selected}" data-id="${esc(element.id)}" data-rotation="${element.geometry.rotation || 0}" style="${styleFor(element)}"`;
  if (element.type === "text") {
    const body = element.paragraphs.map((paragraph: AnyRecord) => `<div style="text-align:${esc(paragraph.align || "left")};line-height:${paragraph.lineSpacing || 1.2}">${paragraph.runs.map((run: AnyRecord) => `<span style="${textStyle(run)}">${esc(run.text)}</span>`).join("")}</div>`).join("");
    return `<div ${common}>${body}</div>`;
  }
  if (element.type === "shape") {
    const border = element.stroke ? `${Math.max(1, element.stroke.widthDU)}px solid ${esc(element.stroke.color)}` : "none";
    const radius = element.shape === "ellipse" ? "50%" : `${element.radiusDU || 0}px`;
    return `<div ${common} style="${styleFor(element)};background:${esc(element.fill || "transparent")};border:${border};border-radius:${radius}"></div>`;
  }
  if (element.type === "image") {
    return `<div ${common} style="${styleFor(element)};background:#dfe4ea;display:grid;place-items:center;color:#4d5968;font:24px system-ui">IMAGE · ${esc(element.assetId)}</div>`;
  }
  return `<div ${common} style="${styleFor(element)};border:2px dashed #8a94a4;display:grid;place-items:center;color:#667085;font:22px system-ui">${esc(element.type)}</div>`;
}

function renderStoryboard(): void {
  const slides = state.project?.deck.slides ?? [];
  $("#spikeSlides").innerHTML = slides.map((slide: AnyRecord, index: number) => `<button class="spike-thumb ${slide.id === currentSlide()?.id ? "active" : ""}" data-slide="${esc(slide.id)}"><small>${String(index + 1).padStart(2, "0")} · ${esc(slide.archetype)}</small><b>${esc(slide.title)}</b></button>`).join("");
  document.querySelectorAll<HTMLElement>("[data-slide]").forEach((button) => button.onclick = () => {
    state.slideId = button.dataset.slide ?? null;
    state.selectedIds = [];
    renderAll();
  });
}

function renderScene(): void {
  const slide = currentSlide();
  if (!slide) return;
  $("#spikeScene").innerHTML = [...slide.scene].sort((a: AnyRecord, b: AnyRecord) => a.zIndex - b.zIndex).map(draw).join("");
  $("#spikeSlideLabel").textContent = `${slide.order + 1} / ${state.project!.deck.slides.length} · ${slide.title}`;
}

function selectedTargets(): HTMLElement[] {
  return state.selectedIds.map((id) => document.querySelector<HTMLElement>(`#spikeScene [data-id="${CSS.escape(id)}"]`)).filter((element): element is HTMLElement => Boolean(element));
}

function updateSelection(ids: string[]): void {
  state.selectedIds = [...new Set(ids)];
  document.querySelectorAll<HTMLElement>("#spikeScene .selectable").forEach((element) => element.classList.toggle("selected", state.selectedIds.includes(element.dataset.id ?? "")));
  if (state.moveable) state.moveable.target = selectedTargets();
  $("#spikeSelection").textContent = state.selectedIds.length ? `${state.selectedIds.length} selected · ${state.selectedIds.join(", ")}` : "Nothing selected";
}

function geometryFromNode(node: HTMLElement): AnyRecord {
  return {
    x: Math.round(parseFloat(node.style.left) || 0),
    y: Math.round(parseFloat(node.style.top) || 0),
    width: Math.round(parseFloat(node.style.width) || node.offsetWidth),
    height: Math.round(parseFloat(node.style.height) || node.offsetHeight),
    rotation: Math.round(parseFloat(node.dataset.rotation || "0") || 0),
  };
}

async function commitSelection(reason: string): Promise<void> {
  const slide = currentSlide();
  if (!slide || !state.project || !state.selectedIds.length) return;
  const operations = selectedTargets().map((node) => ({
    op: "updateGeometry",
    slideId: slide.id,
    elementId: node.dataset.id,
    geometry: geometryFromNode(node),
  }));
  $("#spikeStatus").textContent = `Committing ${operations.length} scoped transform(s)…`;
  state.project = await api("/api/mutate", {
    method: "POST",
    body: JSON.stringify({ reason, operations, expectedDeckHash: state.project.deckHash }),
  });
  renderAll();
  $("#spikeStatus").textContent = `${reason} committed through DeckMutation · artifact version updated`;
}

function installInteractionEngine(): void {
  state.moveable?.destroy();
  state.selecto?.destroy();

  const stage = $("#spikeStage") as HTMLElement;
  const scene = $("#spikeScene") as HTMLElement;
  const selectable = Array.from(scene.querySelectorAll<HTMLElement>(".selectable"));

  state.moveable = new Moveable(stage, {
    target: selectedTargets(),
    draggable: true,
    resizable: true,
    rotatable: true,
    scalable: false,
    origin: false,
    snappable: true,
    snapThreshold: 8,
    elementGuidelines: selectable,
    bounds: { left: 0, top: 0, right: 1920, bottom: 1080 },
    keepRatio: false,
  });

  state.moveable
    .on("drag", ({ target, left, top }) => {
      const node = target as HTMLElement;
      node.style.left = `${Math.round(left)}px`;
      node.style.top = `${Math.round(top)}px`;
    })
    .on("dragEnd", () => void commitSelection("Move selection"))
    .on("resize", ({ target, width, height, drag }) => {
      const node = target as HTMLElement;
      node.style.width = `${Math.max(1, Math.round(width))}px`;
      node.style.height = `${Math.max(1, Math.round(height))}px`;
      if (drag) {
        node.style.left = `${Math.round(drag.left)}px`;
        node.style.top = `${Math.round(drag.top)}px`;
      }
    })
    .on("resizeEnd", () => void commitSelection("Resize selection"))
    .on("rotate", ({ target, beforeRotate }) => {
      const node = target as HTMLElement;
      node.dataset.rotation = String(beforeRotate);
      node.style.transform = `rotate(${beforeRotate}deg)`;
    })
    .on("rotateEnd", () => void commitSelection("Rotate selection"))
    .on("dragGroup", ({ events }) => {
      events.forEach(({ target, left, top }) => {
        const node = target as HTMLElement;
        node.style.left = `${Math.round(left)}px`;
        node.style.top = `${Math.round(top)}px`;
      });
    })
    .on("dragGroupEnd", () => void commitSelection("Move selection group"))
    .on("resizeGroup", ({ events }) => {
      events.forEach(({ target, width, height, drag }) => {
        const node = target as HTMLElement;
        node.style.width = `${Math.max(1, Math.round(width))}px`;
        node.style.height = `${Math.max(1, Math.round(height))}px`;
        if (drag) {
          node.style.left = `${Math.round(drag.left)}px`;
          node.style.top = `${Math.round(drag.top)}px`;
        }
      });
    })
    .on("resizeGroupEnd", () => void commitSelection("Resize selection group"))
    .on("rotateGroup", ({ events }) => {
      events.forEach(({ target, beforeRotate }) => {
        const node = target as HTMLElement;
        node.dataset.rotation = String(beforeRotate);
        node.style.transform = `rotate(${beforeRotate}deg)`;
      });
    })
    .on("rotateGroupEnd", () => void commitSelection("Rotate selection group"));

  state.selecto = new Selecto({
    container: stage,
    dragContainer: stage,
    selectableTargets: ["#spikeScene .selectable"],
    selectByClick: true,
    selectFromInside: false,
    toggleContinueSelect: "shift",
    hitRate: 20,
  });
  state.selecto.on("selectEnd", ({ selected }) => {
    updateSelection(selected.map((element) => (element as HTMLElement).dataset.id).filter((id): id is string => Boolean(id)));
  });
}

function installViewportAndGuides(): void {
  state.viewer?.destroy();
  state.horizontalGuide?.destroy();
  state.verticalGuide?.destroy();

  const viewer = $("#spikeViewer") as HTMLElement;
  const stage = $("#spikeStage") as HTMLElement;
  state.viewer = new InfiniteViewer(viewer, stage, {
    margin: 200,
    threshold: 0,
    zoom: 0.55,
    rangeX: [-600, 2600],
    rangeY: [-500, 1600],
  });

  state.horizontalGuide = new Guides($("#spikeGuideX") as HTMLElement, { type: "horizontal", zoom: 0.55, unit: 100 });
  state.verticalGuide = new Guides($("#spikeGuideY") as HTMLElement, { type: "vertical", zoom: 0.55, unit: 100 });

  state.viewer.on("scroll", () => {
    const x = state.viewer?.getScrollLeft() ?? 0;
    const y = state.viewer?.getScrollTop() ?? 0;
    state.horizontalGuide?.scroll(x);
    state.verticalGuide?.scroll(y);
  });
}

function renderAll(): void {
  renderStoryboard();
  renderScene();
  requestAnimationFrame(() => {
    installInteractionEngine();
    updateSelection(state.selectedIds);
  });
}

async function load(): Promise<void> {
  state.project = await api("/api/project");
  state.slideId = state.project.deck.slides[0]?.id ?? null;
  renderAll();
  installViewportAndGuides();
  $("#spikeStatus").textContent = "Daybrush engine attached to live Pitch SceneGraph";
}

$("#spikeClearSelection").addEventListener("click", () => updateSelection([]));
$("#spikeRefresh").addEventListener("click", () => void load());

load().catch((error) => {
  $("#spikeStatus").textContent = `Editor spike failed: ${error instanceof Error ? error.message : String(error)}`;
});
