type AnyRecord = Record<string, any>;
type Runtime = { getProject(): AnyRecord | null; getSlide(): AnyRecord | undefined };

const style = `
  .pitch-asset-image{position:absolute;max-width:none;max-height:none;pointer-events:none;user-select:none;-webkit-user-drag:none}
  .pitch-asset-missing{display:grid!important;place-items:center;background:repeating-linear-gradient(135deg,#1b2027,#1b2027 12px,#222832 12px,#222832 24px)!important;color:#818b98!important;font:18px/1.3 ui-sans-serif,system-ui,sans-serif;text-align:center;padding:16px}
`;

function runtime(): Runtime | undefined { return (window as any).__pitchEditorRuntime as Runtime | undefined; }
function assetUrl(assetId: string): string { return `/api/assets/${encodeURIComponent(assetId)}/content`; }
function clamp(value: number, min = 0, max = 1): number { return Math.max(min, Math.min(max, Number.isFinite(value) ? value : .5)); }

function imageById(elementId: string): AnyRecord | undefined {
  const project = runtime()?.getProject();
  if (!project) return undefined;
  for (const slide of project.deck.slides as AnyRecord[]) {
    const element = slide.scene.find((item: AnyRecord) => item.id === elementId);
    if (element?.type === "image") return element;
  }
  return undefined;
}

function imageCrop(element: AnyRecord) {
  return element.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
}

function innerImageStyle(element: AnyRecord): string {
  const crop = imageCrop(element);
  const visibleWidth = Math.max(.001, 1 - crop.left - crop.right);
  const visibleHeight = Math.max(.001, 1 - crop.top - crop.bottom);
  const left = -(crop.left / visibleWidth) * 100;
  const top = -(crop.top / visibleHeight) * 100;
  const width = 100 / visibleWidth;
  const height = 100 / visibleHeight;
  const fit = element.fit === "stretch" ? "fill" : element.fit || "cover";
  const focal = element.focalPoint ?? { x: .5, y: .5 };
  const sourceX = clamp(focal.x, crop.left, 1 - crop.right);
  const sourceY = clamp(focal.y, crop.top, 1 - crop.bottom);
  const positionX = clamp((sourceX - crop.left) / visibleWidth) * 100;
  const positionY = clamp((sourceY - crop.top) / visibleHeight) * 100;
  return `left:${left}%;top:${top}%;width:${width}%;height:${height}%;object-fit:${fit};object-position:${positionX}% ${positionY}%`;
}

function effectiveClip(element: AnyRecord): "rect" | "roundRect" | "ellipse" {
  if (element.clipShape === "ellipse" || element.clipShape === "roundRect" || element.clipShape === "rect") return element.clipShape;
  return (element.cornerRadiusDU ?? 0) > 0 ? "roundRect" : "rect";
}

function applyClip(node: HTMLElement, element: AnyRecord): void {
  const clip = effectiveClip(element);
  node.style.clipPath = "none";
  if (clip === "ellipse") {
    node.style.borderRadius = "50%";
    node.style.clipPath = "ellipse(50% 50% at 50% 50%)";
  } else if (clip === "roundRect") {
    node.style.borderRadius = `${Math.max(0, element.cornerRadiusDU ?? 0)}px`;
  } else {
    node.style.borderRadius = "0";
  }
}

function decorate(node: HTMLElement, element: AnyRecord): void {
  const marker = `${element.assetId}:${JSON.stringify(element.crop ?? null)}:${JSON.stringify(element.focalPoint ?? null)}:${element.fit}:${element.clipShape ?? "auto"}:${element.cornerRadiusDU ?? 0}`;
  if (node.dataset.pitchAssetMarker === marker) return;
  node.dataset.pitchAssetMarker = marker;
  node.classList.remove("pitch-asset-missing");
  node.style.background = "transparent";
  node.style.color = "transparent";
  node.style.display = "block";
  node.style.overflow = "hidden";
  applyClip(node, element);
  const img = document.createElement("img");
  img.className = "pitch-asset-image";
  img.alt = element.alt ?? "";
  img.draggable = false;
  img.src = assetUrl(element.assetId);
  img.style.cssText = innerImageStyle(element);
  img.addEventListener("error", () => {
    node.innerHTML = `<span>Missing asset<br>${element.assetId}</span>`;
    node.classList.add("pitch-asset-missing");
    node.style.color = "#818b98";
  }, { once: true });
  node.replaceChildren(img);
}

function applyCanvas(): void {
  const slide = runtime()?.getSlide();
  if (!slide) return;
  for (const element of slide.scene as AnyRecord[]) {
    if (element.type !== "image") continue;
    const node = document.querySelector<HTMLElement>(`#spikeScene [data-id="${CSS.escape(element.id)}"]`);
    if (node) decorate(node, element);
  }
}

function applyPresenter(): void {
  document.querySelectorAll<HTMLElement>("#pitchPresenterStage [data-presenter-element]").forEach(node => {
    const id = node.dataset.presenterElement;
    if (!id) return;
    const element = imageById(id);
    if (element) decorate(node, element);
  });
}

function apply(): void {
  applyCanvas();
  applyPresenter();
}

export function installPitchAssetRenderer(): void {
  const css = document.createElement("style"); css.textContent = style; document.head.appendChild(css);
  window.addEventListener("pitch:editor-state", () => requestAnimationFrame(apply));
  const observer = new MutationObserver(() => requestAnimationFrame(apply));
  observer.observe(document.body, { subtree: true, childList: true });
  requestAnimationFrame(apply);
}
