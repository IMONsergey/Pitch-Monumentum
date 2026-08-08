type AnyRecord = Record<string, any>;
type Runtime = { getProject(): AnyRecord | null; getSlide(): AnyRecord | undefined; getSelectedIds(): string[]; reload(): Promise<void> };

const css = `
  .pitch-components-toggle{border-color:#364c63!important;color:#b8d8ff!important}.pitch-components-popover{position:fixed;top:52px;right:310px;width:330px;max-height:520px;overflow:auto;display:none;background:#101419f7;border:1px solid #303844;border-radius:10px;box-shadow:0 22px 70px #0009;z-index:520;padding:10px;backdrop-filter:blur(16px)}.pitch-components-popover.open{display:block}
  .pitch-components-title{display:flex;align-items:center;gap:7px;margin-bottom:9px}.pitch-components-title b{font-size:11px}.pitch-components-title small{color:var(--muted);margin-left:auto}.pitch-component-create{display:grid;grid-template-columns:1fr auto;gap:6px;margin-bottom:10px}.pitch-component-create input{height:30px;border:1px solid var(--line);border-radius:7px;background:#0c1015;color:var(--text);padding:0 8px;font-size:10px}.pitch-component-btn{height:30px;border:1px solid #3c5168;border-radius:7px;background:#131b24;color:#b8d8ff;padding:0 9px;font-size:10px;cursor:pointer}.pitch-component-btn:disabled{opacity:.35;cursor:default}.pitch-component-btn.danger{border-color:#583a40;background:#211419;color:#e9a4ae}
  .pitch-component-card{display:grid;grid-template-columns:1fr auto;gap:7px;align-items:center;border-top:1px solid #252c35;padding:8px 0}.pitch-component-card b{display:block;font-size:10px}.pitch-component-card small{display:block;color:#717c8b;font-size:9px}.pitch-component-empty{color:#697484;font-size:10px;line-height:1.5;padding:8px 2px}
`;
let open = false;

function runtime(): Runtime | undefined { return (window as any).__pitchEditorRuntime as Runtime | undefined; }
function status(message: string): void { const node = document.getElementById("spikeStatus"); if (node) node.textContent = message; }
function esc(value: unknown): string { return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[char] ?? char); }
function instanceIdOfSelection(): string | undefined {
  const editor = runtime(); const slide = editor?.getSlide(); const ids = editor?.getSelectedIds() ?? [];
  if (!slide || ids.length !== 1) return undefined;
  const element = slide.scene.find((item: AnyRecord) => item.id === ids[0]);
  return element?.tags?.find((tag: string) => tag.startsWith("component:"))?.slice("component:".length);
}
async function run(payload: AnyRecord): Promise<any> {
  const editor = runtime(); const project = editor?.getProject(); if (!editor || !project) return;
  try {
    const response = await fetch("/api/component-command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, expectedDeckHash: project.deckHash }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || response.statusText);
    await editor.reload(); render(); status(`Components · ${data.commandReason ?? payload.command}`); return data;
  } catch (error) { status(`Components failed: ${error instanceof Error ? error.message : String(error)}`); }
}

function render(): void {
  const root = document.getElementById("pitchComponentsPopover"); if (!root) return;
  root.classList.toggle("open", open); if (!open) return;
  const editor = runtime(); const project = editor?.getProject(); const slide = editor?.getSlide(); if (!project || !slide) return;
  const components = project.components ?? []; const selected = editor?.getSelectedIds() ?? []; const instanceId = instanceIdOfSelection();
  root.innerHTML = `<div class="pitch-components-title"><b>Components</b><small>${components.length} reusable</small></div>
    <div class="pitch-component-create"><input data-component-name placeholder="Component name" value="New component"><button class="pitch-component-btn" data-component-create ${selected.length ? "" : "disabled"}>Create from ${selected.length} selected</button></div>
    ${instanceId ? `<button class="pitch-component-btn danger" style="width:100%;margin-bottom:8px" data-component-detach>Detach instance · ${esc(instanceId)}</button>` : ""}
    ${components.length ? components.map((component: AnyRecord) => `<div class="pitch-component-card"><div><b>${esc(component.name)}</b><small>${Math.round(component.widthDU)} × ${Math.round(component.heightDU)} DU · ${component.slots?.length ?? 0} slots · v${component.version}</small></div><button class="pitch-component-btn" data-component-insert="${esc(component.id)}">Insert</button></div>`).join("") : `<div class="pitch-component-empty">Create a component from a selected object tree. Text and image slots are detected automatically, while the canonical scene stays editable after insertion.</div>`}`;
  root.querySelector("[data-component-create]")?.addEventListener("click", () => {
    const name = (root.querySelector("[data-component-name]") as HTMLInputElement).value.trim();
    if (!name) { status("Component name is required"); return; }
    void run({ command: "createFromSelection", slideId: slide.id, selectedIds: editor?.getSelectedIds() ?? [], name });
  });
  root.querySelector("[data-component-detach]")?.addEventListener("click", () => { if (instanceId) void run({ command: "detach", slideId: slide.id, instanceId }); });
  root.querySelectorAll<HTMLElement>("[data-component-insert]").forEach((button) => button.addEventListener("click", () => {
    const component = components.find((item: AnyRecord) => item.id === button.dataset.componentInsert); if (!component) return;
    const x = Math.round((project.deck.canvas.widthDU - component.widthDU) / 2); const y = Math.round((project.deck.canvas.heightDU - component.heightDU) / 2);
    void run({ command: "insert", slideId: slide.id, componentId: component.id, transform: { x, y, scaleX: 1, scaleY: 1 } });
  }));
}

export function installPitchComponentsUI(): void {
  const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);
  const top = document.querySelector<HTMLElement>(".spike-top"); const spacer = top?.querySelector<HTMLElement>(".spacer");
  if (top && spacer) { const button = document.createElement("button"); button.className = "spike-btn pitch-components-toggle"; button.textContent = "Components"; button.addEventListener("click", () => { open = !open; render(); }); top.insertBefore(button, spacer); }
  const root = document.createElement("div"); root.id = "pitchComponentsPopover"; root.className = "pitch-components-popover"; document.body.appendChild(root);
  window.addEventListener("pitch:editor-state", render); render();
}
