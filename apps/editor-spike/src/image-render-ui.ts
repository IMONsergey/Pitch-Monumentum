type AnyRecord = Record<string, any>;

let scheduled = false;
let observer: MutationObserver | null = null;

async function project(): Promise<any> {
  const response = await fetch("/api/project", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function sceneIndex(state: AnyRecord): Map<string, AnyRecord> {
  return new Map((state.deck?.slides ?? []).flatMap((slide: AnyRecord) => slide.scene ?? []).map((element: AnyRecord) => [element.id, element]));
}

function fitValue(value: string): string {
  if (value === "contain") return "contain";
  if (value === "stretch") return "fill";
  return "cover";
}

async function hydrateImages(): Promise<void> {
  scheduled = false;
  const scene = document.getElementById("spikeScene");
  if (!scene) return;
  const state = await project();
  const index = sceneIndex(state);
  scene.querySelectorAll<HTMLElement>(".spike-el[data-id]").forEach((node) => {
    const id = node.dataset.id;
    const element = id ? index.get(id) : undefined;
    if (!element || element.type !== "image") return;
    const current = node.querySelector<HTMLImageElement>("img[data-pitch-asset]");
    if (current?.dataset.pitchAsset === element.assetId) return;
    node.innerHTML = "";
    node.style.background = "transparent";
    node.style.overflow = "hidden";
    if (element.cornerRadiusDU != null) node.style.borderRadius = `${element.cornerRadiusDU}px`;
    const image = document.createElement("img");
    image.dataset.pitchAsset = element.assetId;
    image.src = `/api/assets/${encodeURIComponent(element.assetId)}`;
    image.alt = element.alt || element.name || "";
    image.draggable = false;
    image.style.width = "100%";
    image.style.height = "100%";
    image.style.display = "block";
    image.style.pointerEvents = "none";
    image.style.objectFit = fitValue(element.fit);
    image.style.userSelect = "none";
    node.appendChild(image);
  });
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => void hydrateImages().catch(() => { scheduled = false; }));
}

export function installPitchImageRenderer(): void {
  const scene = document.getElementById("spikeScene");
  if (!scene) return;
  observer?.disconnect();
  observer = new MutationObserver(schedule);
  observer.observe(scene, { childList: true, subtree: false });
  window.addEventListener("pitch:editor-state", schedule);
  schedule();
}
