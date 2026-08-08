type AnyRecord = Record<string, any>;
type Runtime = {
  getProject(): AnyRecord | null;
  getSlide(): AnyRecord | undefined;
  getSelectedIds(): string[];
  command(input: AnyRecord): Promise<AnyRecord>;
  reload(): Promise<void>;
};

const css = `
  .pitch-assets-toggle{border-color:#4a445f!important;color:#d9ceff!important}
  .pitch-assets-popover{position:fixed;top:52px;right:310px;width:390px;max-height:min(680px,calc(100vh - 100px));overflow:auto;display:none;background:#0e1217f8;border:1px solid #303844;border-radius:11px;box-shadow:0 24px 80px #000b;z-index:530;padding:10px;backdrop-filter:blur(18px)}
  .pitch-assets-popover.open{display:block}.pitch-assets-head{display:flex;align-items:center;gap:7px;margin-bottom:8px}.pitch-assets-head b{font-size:11px}.pitch-assets-head small{margin-left:auto;color:#727d8b;font-size:9px}
  .pitch-assets-actions{display:grid;grid-template-columns:1fr auto;gap:6px;margin-bottom:8px}.pitch-assets-search{height:30px;border:1px solid var(--line);border-radius:7px;background:#0a0e13;color:var(--text);padding:0 8px;font-size:10px}.pitch-assets-button{height:30px;border:1px solid #51496b;border-radius:7px;background:#171524;color:#d9ceff;padding:0 10px;font-size:10px;cursor:pointer}.pitch-assets-button.secondary{border-color:var(--line);background:#151a20;color:#aab3bf}.pitch-assets-button.danger{border-color:#583a40;background:#211419;color:#e9a4ae}
  .pitch-assets-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.pitch-asset-card{min-width:0;border:1px solid #272e37;border-radius:9px;overflow:hidden;background:#11161c}.pitch-asset-thumb{height:104px;background:#090c10;display:grid;place-items:center;overflow:hidden}.pitch-asset-thumb img{width:100%;height:100%;object-fit:cover}.pitch-asset-info{padding:7px}.pitch-asset-info b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:9px}.pitch-asset-info small{display:block;color:#6d7887;font-size:8px;margin-top:2px}.pitch-asset-card-actions{display:flex;gap:4px;margin-top:6px}.pitch-asset-card-actions button{flex:1;height:25px;border:1px solid #343c47;border-radius:5px;background:#171c22;color:#bcc4cf;font-size:9px;cursor:pointer}.pitch-asset-card-actions button.primary{border-color:#51496b;color:#d9ceff;background:#191626}.pitch-asset-empty{padding:24px 12px;text-align:center;color:#727d8b;font-size:10px;line-height:1.55;border:1px dashed #303844;border-radius:9px}.pitch-asset-drop-active::after{content:"Drop image to insert";position:absolute;inset:18px;z-index:999;border:3px dashed #aa97ff;border-radius:12px;background:#6b57a62b;color:#4f4278;display:grid;place-items:center;font:700 34px/1 ui-sans-serif,system-ui;pointer-events:none}
`;

let open = false;
let search = "";

function runtime(): Runtime | undefined { return (window as any).__pitchEditorRuntime as Runtime | undefined; }
function status(message: string): void { const node = document.getElementById("spikeStatus"); if (node) node.textContent = message; }
function esc(value: unknown): string { return String(value ?? "").replace(/[&<>\"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[char] ?? char); }
function assetUrl(id: string): string { return `/api/assets/${encodeURIComponent(id)}/content`; }
function imageFiles(files: FileList | File[]): File[] { return Array.from(files).filter(file => file.type === "image/png" || file.type === "image/jpeg"); }
function editorImageSelection(): AnyRecord | undefined {
  const editor = runtime(); const slide = editor?.getSlide(); const ids = editor?.getSelectedIds() ?? [];
  if (!slide || ids.length !== 1) return undefined;
  return slide.scene.find((element: AnyRecord) => element.id === ids[0] && element.type === "image");
}

async function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("File read failed"));
    reader.onload = () => {
      const value = String(reader.result ?? ""); const comma = value.indexOf(",");
      if (comma < 0) reject(new Error("Invalid file data URL")); else resolve(value.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

async function dimensions(file: File): Promise<{ width?: number; height?: number }> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Image decode failed")); image.src = url; });
    return { width: image.naturalWidth || undefined, height: image.naturalHeight || undefined };
  } catch { return {}; }
  finally { URL.revokeObjectURL(url); }
}

async function upload(file: File, source: "upload" | "clipboard" = "upload"): Promise<AnyRecord> {
  const editor = runtime(); if (!editor) throw new Error("Editor is not ready");
  const size = await dimensions(file);
  const response = await fetch("/api/assets/import", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: file.name || "pasted-image.png", mimeType: file.type, dataBase64: await fileBase64(file), ...size, source }),
  });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || response.statusText);
  await editor.reload();
  status(`Assets · imported ${data.asset.filename}`);
  return data.asset;
}

function defaultGeometry(asset: AnyRecord, point?: { x: number; y: number }, order = 0): AnyRecord {
  const project = runtime()?.getProject(); const canvas = project?.deck.canvas ?? { widthDU: 1920, heightDU: 1080 };
  const ratio = asset.width && asset.height ? asset.width / asset.height : 16 / 10;
  let width = Math.min(820, canvas.widthDU * .48); let height = width / ratio;
  if (height > 620) { height = 620; width = height * ratio; }
  width = Math.max(120, width); height = Math.max(90, height);
  const centerX = point?.x ?? canvas.widthDU / 2; const centerY = point?.y ?? canvas.heightDU / 2;
  return { x: Math.max(0, Math.min(canvas.widthDU - width, centerX - width / 2 + order * 24)), y: Math.max(0, Math.min(canvas.heightDU - height, centerY - height / 2 + order * 24)), width, height };
}

async function insert(asset: AnyRecord, point?: { x: number; y: number }, order = 0): Promise<void> {
  const editor = runtime(); if (!editor) return;
  await editor.command({ command: "insertImage", assetId: asset.id, alt: asset.filename, name: asset.filename, fit: "cover", geometry: defaultGeometry(asset, point, order) });
  status(`Assets · inserted ${asset.filename}`);
}

async function replaceSelected(asset: AnyRecord): Promise<void> {
  const editor = runtime(); const slide = editor?.getSlide(); const selected = editorImageSelection(); if (!editor || !slide || !selected) return;
  const project = editor.getProject();
  const response = await fetch("/api/media-command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: "setImageProperties", slideId: slide.id, elementId: selected.id, changes: { assetId: asset.id, alt: asset.filename }, expectedDeckHash: project?.deckHash }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || response.statusText);
  await editor.reload(); status(`Assets · replaced selected image with ${asset.filename}`);
}

async function removeAsset(asset: AnyRecord): Promise<void> {
  if (asset.usageCount) { status(`Asset is used by ${asset.usageCount} object(s)`); return; }
  const response = await fetch(`/api/assets/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || response.statusText);
  await runtime()?.reload(); status(`Assets · removed ${asset.filename}`);
}

async function importAndInsert(files: File[], point?: { x: number; y: number }, source: "upload" | "clipboard" = "upload"): Promise<void> {
  for (const [index, file] of files.entries()) {
    try { const asset = await upload(file, source); await insert(asset, point, index); }
    catch (error) { status(`Asset import failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
}

function render(): void {
  const root = document.getElementById("pitchAssetsPopover"); if (!root) return;
  root.classList.toggle("open", open); if (!open) return;
  const editor = runtime(); const project = editor?.getProject(); if (!project) return;
  const assets = (project.assets ?? []).filter((asset: AnyRecord) => !search || `${asset.filename} ${asset.id}`.toLowerCase().includes(search.toLowerCase()));
  const selectedImage = editorImageSelection();
  root.innerHTML = `<div class="pitch-assets-head"><b>Assets</b><small>${project.assets?.length ?? 0} project images</small></div>
    <div class="pitch-assets-actions"><input class="pitch-assets-search" data-assets-search placeholder="Search assets…" value="${esc(search)}"><button class="pitch-assets-button" data-assets-upload>+ Import</button></div>
    <input data-assets-file type=file accept="image/png,image/jpeg" multiple hidden>
    ${assets.length ? `<div class="pitch-assets-grid">${assets.map((asset: AnyRecord) => `<article class="pitch-asset-card"><div class="pitch-asset-thumb"><img src="${assetUrl(asset.id)}" alt=""></div><div class="pitch-asset-info"><b title="${esc(asset.filename)}">${esc(asset.filename)}</b><small>${asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ""}${Math.max(1, Math.round(asset.bytes / 1024))} KB · ${asset.usageCount || 0} used</small><div class="pitch-asset-card-actions"><button class="primary" data-asset-insert="${esc(asset.id)}">Insert</button>${selectedImage ? `<button data-asset-replace="${esc(asset.id)}">Replace</button>` : ""}${!asset.usageCount ? `<button data-asset-delete="${esc(asset.id)}">×</button>` : ""}</div></div></article>`).join("")}</div>` : `<div class="pitch-asset-empty">Drop PNG/JPEG files directly onto the slide, paste an image from the clipboard, or import files here.<br><br>Assets live inside the Pitch project and export to PowerPoint as native pictures.</div>`}`;

  const fileInput = root.querySelector<HTMLInputElement>("[data-assets-file]")!;
  root.querySelector("[data-assets-upload]")?.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => void importAndInsert(imageFiles(fileInput.files ?? [])));
  root.querySelector<HTMLInputElement>("[data-assets-search]")?.addEventListener("input", event => { search = (event.target as HTMLInputElement).value; render(); });
  root.querySelectorAll<HTMLElement>("[data-asset-insert]").forEach(button => button.addEventListener("click", () => { const asset = (project.assets ?? []).find((item: AnyRecord) => item.id === button.dataset.assetInsert); if (asset) void insert(asset); }));
  root.querySelectorAll<HTMLElement>("[data-asset-replace]").forEach(button => button.addEventListener("click", () => { const asset = (project.assets ?? []).find((item: AnyRecord) => item.id === button.dataset.assetReplace); if (asset) void replaceSelected(asset); }));
  root.querySelectorAll<HTMLElement>("[data-asset-delete]").forEach(button => button.addEventListener("click", () => { const asset = (project.assets ?? []).find((item: AnyRecord) => item.id === button.dataset.assetDelete); if (asset) void removeAsset(asset); }));
}

function pointOnStage(event: DragEvent): { x: number; y: number } | undefined {
  const stage = document.getElementById("spikeStage"); const project = runtime()?.getProject(); if (!stage || !project) return undefined;
  const rect = stage.getBoundingClientRect(); if (!rect.width || !rect.height) return undefined;
  return { x: (event.clientX - rect.left) * project.deck.canvas.widthDU / rect.width, y: (event.clientY - rect.top) * project.deck.canvas.heightDU / rect.height };
}

function installDropAndPaste(): void {
  const stage = document.getElementById("spikeStage"); if (!stage) return;
  stage.addEventListener("dragenter", event => { if (imageFiles(event.dataTransfer?.files ?? []).length) { event.preventDefault(); stage.classList.add("pitch-asset-drop-active"); } });
  stage.addEventListener("dragover", event => { if (event.dataTransfer?.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; stage.classList.add("pitch-asset-drop-active"); } });
  stage.addEventListener("dragleave", event => { if (!stage.contains(event.relatedTarget as Node | null)) stage.classList.remove("pitch-asset-drop-active"); });
  stage.addEventListener("drop", event => { const files = imageFiles(event.dataTransfer?.files ?? []); stage.classList.remove("pitch-asset-drop-active"); if (!files.length) return; event.preventDefault(); void importAndInsert(files, pointOnStage(event)); });
  window.addEventListener("paste", event => {
    const target = event.target as HTMLElement | null; if (target?.matches("input,textarea,[contenteditable=true]") || document.querySelector("[data-pitch-text-editing=true]")) return;
    const files = imageFiles(event.clipboardData?.files ?? []); if (!files.length) return; event.preventDefault(); void importAndInsert(files, undefined, "clipboard");
  }, true);
}

export function installPitchAssetsUI(): void {
  const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);
  const top = document.querySelector<HTMLElement>(".spike-top"); const spacer = top?.querySelector<HTMLElement>(".spacer");
  if (top && spacer) { const button = document.createElement("button"); button.className = "spike-btn pitch-assets-toggle"; button.textContent = "Assets"; button.addEventListener("click", () => { open = !open; render(); }); top.insertBefore(button, spacer); }
  const root = document.createElement("div"); root.id = "pitchAssetsPopover"; root.className = "pitch-assets-popover"; document.body.appendChild(root);
  installDropAndPaste();
  window.addEventListener("pitch:editor-state", render); render();
}
