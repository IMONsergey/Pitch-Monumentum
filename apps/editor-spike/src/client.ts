import * as MoveableModule from "moveable";
import * as SelectoModule from "selecto";
import * as GuidesModule from "@scena/guides";
import * as InfiniteViewerModule from "infinite-viewer";

type AnyRecord = Record<string, any>;
type ProjectState = AnyRecord & { deck: AnyRecord; deckHash: string };
type VendorInstance = any;
type VendorConstructor = new (...args: any[]) => VendorInstance;
type Geometry = { x: number; y: number; width: number; height: number; rotation?: number };

function vendorConstructor(module: AnyRecord): VendorConstructor {
  return (module.default ?? module) as VendorConstructor;
}

const Moveable = vendorConstructor(MoveableModule as AnyRecord);
const Selecto = vendorConstructor(SelectoModule as AnyRecord);
const Guides = vendorConstructor(GuidesModule as AnyRecord);
const InfiniteViewer = vendorConstructor(InfiniteViewerModule as AnyRecord);

const state: {
  project: ProjectState | null;
  slideId: string | null;
  selectedIds: string[];
  moveable: VendorInstance | null;
  selecto: VendorInstance | null;
  viewer: VendorInstance | null;
  horizontalGuide: VendorInstance | null;
  verticalGuide: VendorInstance | null;
  baseGeometry: Record<string, Geometry>;
  previewGeometry: Record<string, Geometry>;
  interactionKind: string | null;
} = {
  project: null,
  slideId: null,
  selectedIds: [],
  moveable: null,
  selecto: null,
  viewer: null,
  horizontalGuide: null,
  verticalGuide: null,
  baseGeometry: {},
  previewGeometry: {},
  interactionKind: null,
};

const debug: AnyRecord = {
  dragStarts: 0,
  dragEvents: 0,
  dragEnds: 0,
  resizeEvents: 0,
  rotateEvents: 0,
  lastDist: null,
  lastPreview: null,
  lastCommitOperations: 0,
  dragOwner: "pitch",
};
(window as any).__pitchEditorDebug = debug;

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

function sceneElement(elementId: string): AnyRecord | undefined {
  return currentSlide()?.scene.find((element: AnyRecord) => element.id === elementId);
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
  const common = `class="spike-el selectable${selected}" data-id="${esc(element.id)}" data-rotation="${element.geometry.rotation || 0}"`;
  if (element.type === "text") {
    const body = element.paragraphs.map((paragraph: AnyRecord) => `<div style="text-align:${esc(paragraph.align || "left")};line-height:${paragraph.lineSpacing || 1.2}">${paragraph.runs.map((run: AnyRecord) => `<span style="${textStyle(run)}">${esc(run.text)}</span>`).join("")}</div>`).join("");
    return `<div ${common} style="${styleFor(element)}">${body}</div>`;
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
  if (!slide || !state.project) return;
  $("#spikeScene").innerHTML = [...slide.scene].sort((a: AnyRecord, b: AnyRecord) => a.zIndex - b.zIndex).map(draw).join("");
  $("#spikeSlideLabel").textContent = `${slide.order + 1} / ${state.project.deck.slides.length} · ${slide.title}`;
}

function selectedTargets(): HTMLElement[] {
  return state.selectedIds.map((id) => document.querySelector<HTMLElement>(`#spikeScene [data-id="${CSS.escape(id)}"]`)).filter((element): element is HTMLElement => Boolean(element));
}

function beginInteraction(kind: string): void {
  state.interactionKind = kind;
  state.baseGeometry = {};
  state.previewGeometry = {};
  for (const id of state.selectedIds) {
    const model = sceneElement(id);
    if (!model) continue;
    const geometry: Geometry = structuredClone(model.geometry);
    state.baseGeometry[id] = geometry;
    state.previewGeometry[id] = structuredClone(geometry);
  }
  $("#spikeStatus").textContent = `${kind} preview · ${Object.keys(state.baseGeometry).length} object(s)`;
}

function resetInteraction(): void {
  state.baseGeometry = {};
  state.previewGeometry = {};
  state.interactionKind = null;
}

function applyGeometryPreview(elementId: string, changes: Partial<Geometry>): void {
  const base = state.baseGeometry[elementId] ?? sceneElement(elementId)?.geometry;
  if (!base) return;
  const geometry: Geometry = { ...base, ...(state.previewGeometry[elementId] ?? {}), ...changes };
  state.previewGeometry[elementId] = geometry;
  const node = document.querySelector<HTMLElement>(`#spikeScene [data-id="${CSS.escape(elementId)}"]`);
  if (node) {
    node.style.left = `${geometry.x}px`;
    node.style.top = `${geometry.y}px`;
    node.style.width = `${Math.max(1, geometry.width)}px`;
    node.style.height = `${Math.max(1, geometry.height)}px`;
    node.dataset.rotation = String(geometry.rotation ?? 0);
    node.style.transform = `rotate(${geometry.rotation ?? 0}deg)`;
  }
  debug.lastPreview = { elementId, ...geometry };
}

function updateSelection(ids: string[]): void {
  state.selectedIds = [...new Set(ids)];
  document.querySelectorAll<HTMLElement>("#spikeScene .selectable").forEach((element) => element.classList.toggle("selected", state.selectedIds.includes(element.dataset.id ?? "")));
  if (state.moveable) {
    state.moveable.target = selectedTargets();
    state.moveable.updateRect?.();
  }
  $("#spikeSelection").textContent = state.selectedIds.length ? `${state.selectedIds.length} selected · ${state.selectedIds.join(", ")}` : "Nothing selected";
}

function geometryChanged(a: Geometry, b: Geometry): boolean {
  return a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height || (a.rotation ?? 0) !== (b.rotation ?? 0);
}

async function commitInteraction(reason: string): Promise<void> {
  const slide = currentSlide();
  if (!slide || !state.project || !state.selectedIds.length) return;
  const entries = Object.entries(state.previewGeometry).filter(([id, geometry]) => {
    const base = state.baseGeometry[id];
    return base && geometryChanged(base, geometry);
  });
  debug.lastCommitOperations = entries.length;
  if (!entries.length) {
    $("#spikeStatus").textContent = `${reason} ended without geometry delta`;
    resetInteraction();
    return;
  }
  const operations = entries.map(([elementId, geometry]) => ({
    op: "updateGeometry",
    slideId: slide.id,
    elementId,
    geometry,
  }));
  $("#spikeStatus").textContent = `Committing ${operations.length} scoped transform(s)…`;
  state.project = await api("/api/mutate", {
    method: "POST",
    body: JSON.stringify({ reason, operations, expectedDeckHash: state.project.deckHash }),
  });
  resetInteraction();
  renderAll();
  $("#spikeStatus").textContent = `${reason} committed through DeckMutation · artifact version updated`;
}

function selectionMoveBounds(): { minDx: number; maxDx: number; minDy: number; maxDy: number } {
  const canvas = state.project?.deck.canvas ?? { widthDU: 1920, heightDU: 1080 };
  const geometries = Object.values(state.baseGeometry);
  if (!geometries.length) return { minDx: -Infinity, maxDx: Infinity, minDy: -Infinity, maxDy: Infinity };
  return {
    minDx: Math.max(...geometries.map((g) => -g.x)),
    maxDx: Math.min(...geometries.map((g) => canvas.widthDU - (g.x + g.width))),
    minDy: Math.max(...geometries.map((g) => -g.y)),
    maxDy: Math.min(...geometries.map((g) => canvas.heightDU - (g.y + g.height))),
  };
}

function installPitchPointerDrag(scene: HTMLElement, stage: HTMLElement): void {
  scene.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.button !== 0 || !state.selectedIds.length) return;
    const target = (event.target as Element | null)?.closest<HTMLElement>(".selectable");
    if (!target || !state.selectedIds.includes(target.dataset.id ?? "")) return;

    event.preventDefault();
    event.stopPropagation();
    debug.dragStarts += 1;
    beginInteraction("Move");

    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const stageRect = stage.getBoundingClientRect();
    const scaleX = stageRect.width / 1920 || 1;
    const scaleY = stageRect.height / 1080 || 1;
    const bounds = selectionMoveBounds();

    const onMove = (moveEvent: PointerEvent) => {
      debug.dragEvents += 1;
      let dx = (moveEvent.clientX - startClientX) / scaleX;
      let dy = (moveEvent.clientY - startClientY) / scaleY;
      dx = Math.max(bounds.minDx, Math.min(bounds.maxDx, dx));
      dy = Math.max(bounds.minDy, Math.min(bounds.maxDy, dy));
      debug.lastDist = [dx, dy];
      for (const [id, base] of Object.entries(state.baseGeometry)) {
        applyGeometryPreview(id, { x: Math.round(base.x + dx), y: Math.round(base.y + dy) });
      }
      state.moveable?.updateRect?.();
    };

    const onUp = () => {
      debug.dragEnds += 1;
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      void commitInteraction("Move selection");
    };

    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
  }, true);
}

function installInteractionEngine(): void {
  state.moveable?.destroy();
  state.selecto?.destroy();

  const stage = $("#spikeStage") as HTMLElement;
  const scene = $("#spikeScene") as HTMLElement;
  const selectable = Array.from(scene.querySelectorAll<HTMLElement>(".selectable"));

  state.moveable = new Moveable(stage, {
    target: selectedTargets(),
    draggable: false,
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
    .on("resizeStart", () => beginInteraction("Resize"))
    .on("resize", ({ target, width, height, drag }: AnyRecord) => {
      debug.resizeEvents += 1;
      const node = target as HTMLElement;
      const id = node.dataset.id;
      if (!id) return;
      const base = state.baseGeometry[id];
      if (!base) return;
      const distance = drag?.beforeDist ?? drag?.dist ?? [0, 0];
      applyGeometryPreview(id, {
        x: Math.round(base.x + distance[0]),
        y: Math.round(base.y + distance[1]),
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
      });
    })
    .on("resizeEnd", () => void commitInteraction("Resize selection"))
    .on("rotateStart", () => beginInteraction("Rotate"))
    .on("rotate", ({ target, rotation, beforeRotation, drag }: AnyRecord) => {
      debug.rotateEvents += 1;
      const node = target as HTMLElement;
      const id = node.dataset.id;
      if (!id) return;
      const base = state.baseGeometry[id];
      if (!base) return;
      const distance = drag?.beforeDist ?? drag?.dist ?? [0, 0];
      applyGeometryPreview(id, {
        x: Math.round(base.x + distance[0]),
        y: Math.round(base.y + distance[1]),
        rotation: Math.round(rotation ?? beforeRotation ?? base.rotation ?? 0),
      });
    })
    .on("rotateEnd", () => void commitInteraction("Rotate selection"))
    .on("resizeGroupStart", () => beginInteraction("Resize group"))
    .on("resizeGroup", ({ events }: AnyRecord) => {
      events.forEach((child: AnyRecord) => {
        const node = child.target as HTMLElement;
        const id = node.dataset.id;
        if (!id) return;
        const base = state.baseGeometry[id];
        if (!base) return;
        const distance = child.drag?.beforeDist ?? child.drag?.dist ?? [0, 0];
        applyGeometryPreview(id, {
          x: Math.round(base.x + distance[0]),
          y: Math.round(base.y + distance[1]),
          width: Math.max(1, Math.round(child.width)),
          height: Math.max(1, Math.round(child.height)),
        });
      });
    })
    .on("resizeGroupEnd", () => void commitInteraction("Resize selection group"))
    .on("rotateGroupStart", () => beginInteraction("Rotate group"))
    .on("rotateGroup", ({ events }: AnyRecord) => {
      events.forEach((child: AnyRecord) => {
        const node = child.target as HTMLElement;
        const id = node.dataset.id;
        if (!id) return;
        const base = state.baseGeometry[id];
        if (!base) return;
        const distance = child.drag?.beforeDist ?? child.drag?.dist ?? [0, 0];
        applyGeometryPreview(id, {
          x: Math.round(base.x + distance[0]),
          y: Math.round(base.y + distance[1]),
          rotation: Math.round(child.rotation ?? child.beforeRotation ?? base.rotation ?? 0),
        });
      });
    })
    .on("rotateGroupEnd", () => void commitInteraction("Rotate selection group"));

  state.selecto = new Selecto({
    container: stage,
    dragContainer: stage,
    selectableTargets: ["#spikeScene .selectable"],
    selectByClick: true,
    selectFromInside: false,
    toggleContinueSelect: "shift",
    hitRate: 20,
  });
  state.selecto
    .on("dragStart", (event: AnyRecord) => {
      const target = event.inputEvent?.target as Node | null;
      if (!target) return;
      const selected = selectedTargets();
      if (state.moveable?.isMoveableElement?.(target) || selected.some((element) => element === target || element.contains(target))) event.stop();
    })
    .on("selectEnd", (event: AnyRecord) => {
      const ids = (event.selected as Element[]).map((element) => (element as HTMLElement).dataset.id).filter((id): id is string => Boolean(id));
      updateSelection(ids);
    });

  installPitchPointerDrag(scene, stage);
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
    useMouseDrag: false,
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
  const project = await api("/api/project") as ProjectState;
  state.project = project;
  state.slideId = project.deck.slides[0]?.id ?? null;
  renderAll();
  installViewportAndGuides();
  $("#spikeStatus").textContent = "Pitch pointer engine + Daybrush controls attached to live SceneGraph";
}

$("#spikeClearSelection").addEventListener("click", () => updateSelection([]));
$("#spikeRefresh").addEventListener("click", () => void load());

load().catch((error) => {
  $("#spikeStatus").textContent = `Editor spike failed: ${error instanceof Error ? error.message : String(error)}`;
});
