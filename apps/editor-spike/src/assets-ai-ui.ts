type AnyRecord = Record<string, any>;

type PitchEditorRuntime = {
  getProject(): AnyRecord | null;
  getSlide(): AnyRecord | undefined;
  reload(): Promise<void>;
};

const style = `
  .pitch-e3-group{display:flex;align-items:center;gap:4px;padding-right:7px;margin-right:4px;border-right:1px solid var(--line)}
  .pitch-e3-btn{height:30px;border:1px solid var(--line);background:#151a20;color:var(--text);border-radius:7px;padding:0 9px;cursor:pointer;font-size:11px;white-space:nowrap}.pitch-e3-btn:hover{border-color:#4d5868;background:#1c222a}
  .pitch-modal-backdrop{position:fixed;inset:0;background:rgba(4,7,10,.68);backdrop-filter:blur(5px);z-index:10000;display:grid;place-items:center;padding:24px}.pitch-modal{width:min(760px,94vw);max-height:82vh;overflow:auto;border:1px solid #303845;background:#11161c;border-radius:14px;box-shadow:0 28px 80px rgba(0,0,0,.42);padding:18px}.pitch-modal-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px}.pitch-modal-head h3{margin:0;font-size:15px}.pitch-modal-head p{margin:3px 0 0;color:#818c9b;font-size:10px}.pitch-modal-close{margin-left:auto;border:1px solid var(--line);border-radius:7px;background:#171c23;color:#aeb7c4;height:28px;width:28px;cursor:pointer}
  .pitch-asset-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:9px}.pitch-asset-card{border:1px solid #2b333e;border-radius:9px;background:#0c1015;overflow:hidden}.pitch-asset-preview{aspect-ratio:4/3;background:#1a2028;display:grid;place-items:center;overflow:hidden}.pitch-asset-preview img{width:100%;height:100%;object-fit:contain}.pitch-asset-meta{padding:8px}.pitch-asset-meta b{display:block;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pitch-asset-meta small{display:block;color:#75808f;font-size:9px;margin:3px 0 7px}.pitch-asset-insert{width:100%;height:27px;border:1px solid #394351;background:#171d25;color:#d4d9e0;border-radius:6px;cursor:pointer;font-size:10px}
  .pitch-ai-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}.pitch-ai-field{display:flex;flex-direction:column;gap:4px}.pitch-ai-field label{font-size:9px;color:#7f8a98}.pitch-ai-field textarea,.pitch-ai-field select{border:1px solid #303844;background:#0d1217;color:var(--text);border-radius:7px;padding:8px;font:11px system-ui}.pitch-ai-field textarea{min-height:116px;resize:vertical}.pitch-ai-field.full{grid-column:1/-1}.pitch-ai-generate{height:34px;border:0;background:#c7ff5e;color:#080b0e;border-radius:7px;font-weight:700;cursor:pointer}.pitch-ai-status{min-height:16px;color:#8c97a5;font-size:10px;margin-top:9px;white-space:pre-wrap}
`;

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector(selector) as T | null;

function runtime(): PitchEditorRuntime | undefined {
  return (window as any).__pitchEditorRuntime as PitchEditorRuntime | undefined;
}

async function api(path: string, options: RequestInit = {}): Promise<any> {
  const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

async function project(): Promise<any> {
  return api("/api/project");
}

async function refreshEditor(): Promise<void> {
  const editor = runtime();
  if (editor?.reload) { await editor.reload(); return; }
  $("#spikeRefresh")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function status(message: string): void {
  const node = $("#spikeStatus");
  if (node) node.textContent = message;
}

function currentSlideId(state: AnyRecord): string | undefined {
  return runtime()?.getSlide()?.id ?? state.deck?.slides?.[0]?.id;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[char] ?? char);
}

function openModal(content: string): HTMLElement {
  closeModal();
  const backdrop = document.createElement("div");
  backdrop.className = "pitch-modal-backdrop";
  backdrop.id = "pitchE3Modal";
  backdrop.innerHTML = `<div class="pitch-modal">${content}</div>`;
  document.body.appendChild(backdrop);
  backdrop.addEventListener("mousedown", (event) => { if (event.target === backdrop) closeModal(); });
  backdrop.querySelector("[data-modal-close]")?.addEventListener("click", closeModal);
  return backdrop;
}

function closeModal(): void {
  document.getElementById("pitchE3Modal")?.remove();
}

async function showAssets(): Promise<void> {
  const state = await project();
  const assets = state.assets ?? [];
  const modal = openModal(`
    <div class="pitch-modal-head"><div><h3>Assets</h3><p>Content-addressed originals. Pitch does not silently recompress uploads.</p></div><button class="pitch-modal-close" data-modal-close>×</button></div>
    <div class="pitch-asset-grid">${assets.length ? assets.map((asset: AnyRecord) => `
      <div class="pitch-asset-card">
        <div class="pitch-asset-preview"><img src="/api/assets/${encodeURIComponent(asset.id)}" alt=""></div>
        <div class="pitch-asset-meta"><b title="${escapeHtml(asset.originalName)}">${escapeHtml(asset.originalName)}</b><small>${asset.width}×${asset.height}px · ${(asset.byteLength / 1024).toFixed(0)} KB · ${escapeHtml(asset.provenance?.at(-1)?.source || "asset")}</small><button class="pitch-asset-insert" data-insert-asset="${escapeHtml(asset.id)}">Insert on slide</button></div>
      </div>`).join("") : `<div style="color:#7e8998;font-size:11px">No image assets yet. Use Upload Image or AI Image.</div>`}</div>`);
  modal.querySelectorAll<HTMLButtonElement>("[data-insert-asset]").forEach((button) => button.addEventListener("click", async () => {
    try {
      status("Inserting original asset…");
      await api("/api/assets/insert", { method: "POST", body: JSON.stringify({ assetId: button.dataset.insertAsset, slideId: currentSlideId(state), expectedDeckHash: state.deckHash }) });
      await refreshEditor();
      closeModal();
      status("Asset inserted · canonical image object created");
    } catch (error) { status(`Asset insert failed: ${error instanceof Error ? error.message : String(error)}`); }
  }));
}

function dataUrlBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
    reader.onerror = () => reject(reader.error || new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

async function uploadFile(file: File): Promise<void> {
  if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error("Only PNG and JPEG are supported");
  const state = await project();
  status(`Uploading ${file.name} without recompression…`);
  const result = await api("/api/assets/upload", {
    method: "POST",
    body: JSON.stringify({ bytesBase64: await dataUrlBase64(file), originalName: file.name, mimeType: file.type, slideId: currentSlideId(state), expectedDeckHash: state.deckHash }),
  });
  await refreshEditor();
  status(`Original asset inserted · ${result.asset?.width ?? "?"}×${result.asset?.height ?? "?"}px`);
}

async function showAiImage(): Promise<void> {
  const state = await project();
  const modal = openModal(`
    <div class="pitch-modal-head"><div><h3>AI Image</h3><p>Generation runs server-side. Result is stored as an original Asset Registry blob and inserted as a normal ImageElement.</p></div><button class="pitch-modal-close" data-modal-close>×</button></div>
    <div class="pitch-ai-grid">
      <div class="pitch-ai-field full"><label>Prompt</label><textarea data-ai=prompt placeholder="Describe the visual, material, lighting, camera, composition…"></textarea></div>
      <div class="pitch-ai-field"><label>Aspect</label><select data-ai=aspect><option value=landscape>Landscape</option><option value=square>Square</option><option value=portrait>Portrait</option></select></div>
      <div class="pitch-ai-field"><label>Quality</label><select data-ai=quality><option value=standard>Standard</option><option value=high>High</option><option value=draft>Draft</option></select></div>
      <div class="pitch-ai-field"><label>Background</label><select data-ai=background><option value=auto>Auto</option><option value=transparent>Transparent</option><option value=opaque>Opaque</option></select></div>
      <button class="pitch-ai-generate full" data-ai-action=generate>Generate and insert</button>
    </div><div class="pitch-ai-status" data-ai-status></div>`);
  const button = modal.querySelector<HTMLButtonElement>("[data-ai-action=generate]")!;
  button.addEventListener("click", async () => {
    const prompt = (modal.querySelector<HTMLTextAreaElement>("[data-ai=prompt]")?.value || "").trim();
    if (!prompt) { modal.querySelector<HTMLElement>("[data-ai-status]")!.textContent = "Prompt is required."; return; }
    const output = modal.querySelector<HTMLElement>("[data-ai-status]")!;
    button.disabled = true;
    output.textContent = "Generating image…";
    try {
      const result = await api("/api/images/generate", { method: "POST", body: JSON.stringify({
        prompt,
        aspectRatio: modal.querySelector<HTMLSelectElement>("[data-ai=aspect]")?.value,
        quality: modal.querySelector<HTMLSelectElement>("[data-ai=quality]")?.value,
        background: modal.querySelector<HTMLSelectElement>("[data-ai=background]")?.value,
        slideId: currentSlideId(state),
        expectedDeckHash: state.deckHash,
      }) });
      output.textContent = `Inserted · ${result.generation?.model || "image model"} · original stored ${result.asset?.width || "?"}×${result.asset?.height || "?"}px`;
      await refreshEditor();
      status(`AI Image inserted · ${result.generation?.model || "OpenAI image model"}`);
    } catch (error) {
      output.textContent = error instanceof Error ? error.message : String(error);
    } finally { button.disabled = false; }
  });
}

export function installPitchAssetsAiUI(): void {
  const styleNode = document.createElement("style");
  styleNode.textContent = style;
  document.head.appendChild(styleNode);
  const top = $(".spike-top");
  const spacer = top?.querySelector<HTMLElement>(".spacer");
  if (!top || !spacer) return;
  const group = document.createElement("div");
  group.className = "pitch-e3-group";
  group.innerHTML = `<button class="pitch-e3-btn" data-e3=assets>Assets</button><button class="pitch-e3-btn" data-e3=upload>Upload Image</button><button class="pitch-e3-btn" data-e3=ai>AI Image</button><input type=file data-e3-file accept="image/png,image/jpeg" hidden>`;
  top.insertBefore(group, spacer);
  group.querySelector("[data-e3=assets]")?.addEventListener("click", () => void showAssets());
  const fileInput = group.querySelector<HTMLInputElement>("[data-e3-file]")!;
  group.querySelector("[data-e3=upload]")?.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file) void uploadFile(file).catch(error => status(`Upload failed: ${error instanceof Error ? error.message : String(error)}`));
  });
  group.querySelector("[data-e3=ai]")?.addEventListener("click", () => void showAiImage());
}
