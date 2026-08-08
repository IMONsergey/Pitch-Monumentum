type AnyRecord = Record<string, any>;
type Runtime = { getProject(): AnyRecord | null; getSlide(): AnyRecord | undefined };

const style = `
  .pitch-asset-image{position:absolute;max-width:none;max-height:none;pointer-events:none;user-select:none;-webkit-user-drag:none}
  .pitch-asset-missing{display:grid!important;place-items:center;background:repeating-linear-gradient(135deg,#1b2027,#1b2027 12px,#222832 12px,#222832 24px)!important;color:#818b98!important;font:18px/1.3 ui-sans-serif,system-ui,sans-serif;text-align:center;padding:16px}
`;

function runtime(): Runtime | undefined { return (window as any).__pitchEditorRuntime as Runtime | undefined; }
function assetUrl(assetId: string): string { return `/api/assets/${encodeURIComponent(assetId)}/content`; }

function imageById(elementId: string): AnyRecord | undefined {
  const project = runtime()?.getProject();
  if (!project) return undefined;
  for (const slide of project.deck.slides as AnyRecord[]) {
    const element = slide.scene.find((item: AnyRecord) => item.id === elementId);
    if (element?.type === "image") return element;
  }
  return undefined;
}

function innerImageStyle(element: AnyRecord): string {
  const crop = element.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const visibleWidth = Math.max(.001, 1 - crop.left - crop.right);
  const visibleHeight = Math.max(.001, 1 - crop.top - crop.bottom);
  const left = -(crop.left / visibleWidth) * 100;
  const top = -(crop.top / visibleHeight) * 100;
  const width = 100 / visibleWidth;
  const height = 100 / visibleHeight;
  const fit = element.fit === "stretch" ? "fill" : element.fit || "cover";
  return `left:${left}%;top:${top}%;width:${width}%;height:${height}%;object-fit:${fit};object-position:center center`;
}

function decorate(node: HTMLElement, element: AnyRecord): void {
  const marker = `${element.assetId}:${JSON.stringify(element.crop ?? null)}:${element.fit}:${element.cornerRadiusDU ?? 0}`;
  if (node.dataset.pitchAssetMarker === marker) return;
  node.dataset.pitchAssetMarker = marker;
  node.classList.remove("pitch-asset-missing");
  node.style.background = "transparent";
  node.style.color = "transparent";
  node.style.display = "block";
  node.style.overflow = "hidden";
  node.style.borderRadius = `${element.cornerRadiusDU ?? 0}px`;
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
