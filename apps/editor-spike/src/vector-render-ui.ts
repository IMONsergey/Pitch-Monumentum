type AnyRecord = Record<string, any>;

let observer: MutationObserver | null = null;
let scheduled = false;

async function project(): Promise<any> {
  const response = await fetch("/api/project", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function sceneIndex(state: AnyRecord): Map<string, AnyRecord> {
  return new Map((state.deck?.slides ?? []).flatMap((slide: AnyRecord) => slide.scene ?? []).map((element: AnyRecord) => [element.id, element]));
}

function color(value: unknown, fallback: string): string {
  const text = String(value ?? "");
  return text && text !== "transparent" ? text : fallback;
}

async function hydrateVectors(): Promise<void> {
  scheduled = false;
  const scene = document.getElementById("spikeScene");
  if (!scene) return;
  const state = await project();
  const index = sceneIndex(state);
  scene.querySelectorAll<HTMLElement>(".spike-el[data-id]").forEach((node) => {
    const id = node.dataset.id;
    const element = id ? index.get(id) : undefined;
    if (!element || element.type !== "shape" || element.shape !== "custom" || !element.svgPath) return;
    const signature = JSON.stringify([element.svgPath, element.fill, element.stroke]);
    if (node.dataset.pitchVectorSignature === signature) return;
    node.dataset.pitchVectorSignature = signature;
    node.innerHTML = "";
    node.style.background = "transparent";
    node.style.border = "0";
    node.style.overflow = "visible";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${Math.max(0.01, element.geometry.width)} ${Math.max(0.01, element.geometry.height)}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.display = "block";
    svg.style.overflow = "visible";
    svg.style.pointerEvents = "none";
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", element.svgPath);
    path.setAttribute("fill", element.fill === "transparent" ? "none" : color(element.fill, "none"));
    path.setAttribute("stroke", element.stroke?.color || "none");
    path.setAttribute("stroke-width", String(element.stroke?.widthDU ?? 0));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    if (element.stroke?.dash === "dash") path.setAttribute("stroke-dasharray", `${Math.max(1, (element.stroke.widthDU || 1) * 4)} ${Math.max(1, (element.stroke.widthDU || 1) * 2)}`);
    if (element.stroke?.dash === "dot") path.setAttribute("stroke-dasharray", `${Math.max(1, element.stroke.widthDU || 1)} ${Math.max(1, (element.stroke.widthDU || 1) * 1.5)}`);
    svg.appendChild(path);
    node.appendChild(svg);
  });
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => void hydrateVectors().catch(() => { scheduled = false; }));
}

export function installPitchVectorRenderer(): void {
  const scene = document.getElementById("spikeScene");
  if (!scene) return;
  observer?.disconnect();
  observer = new MutationObserver(schedule);
  observer.observe(scene, { childList: true, subtree: false });
  window.addEventListener("pitch:editor-state", schedule);
  schedule();
}
