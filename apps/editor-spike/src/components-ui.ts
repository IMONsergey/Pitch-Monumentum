type AnyRecord = Record<string, any>;
type Runtime = { getProject(): AnyRecord | null; getSlide(): AnyRecord | undefined; getSelectedIds(): string[]; reload(): Promise<void> };

const css = `
  .pitch-components-toggle{border-color:#364c63!important;color:#b8d8ff!important}.pitch-components-popover{position:fixed;top:52px;right:310px;width:390px;max-height:min(680px,calc(100vh - 90px));overflow:auto;display:none;background:#101419f7;border:1px solid #303844;border-radius:10px;box-shadow:0 22px 70px #0009;z-index:520;padding:10px;backdrop-filter:blur(16px)}.pitch-components-popover.open{display:block}
  .pitch-components-title{display:flex;align-items:center;gap:7px;margin-bottom:9px}.pitch-components-title b{font-size:11px}.pitch-components-title small{color:var(--muted);margin-left:auto}.pitch-component-create{display:grid;grid-template-columns:1fr auto;gap:6px;margin-bottom:10px}.pitch-component-create input{height:30px;border:1px solid var(--line);border-radius:7px;background:#0c1015;color:var(--text);padding:0 8px;font-size:10px}.pitch-component-btn{height:30px;border:1px solid #3c5168;border-radius:7px;background:#131b24;color:#b8d8ff;padding:0 9px;font-size:10px;cursor:pointer;white-space:nowrap}.pitch-component-btn:disabled{opacity:.35;cursor:default}.pitch-component-btn.danger{border-color:#583a40;background:#211419;color:#e9a4ae}.pitch-component-btn.secondary{border-color:#343d48;background:#151a20;color:#aab3bf}
  .pitch-instance-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px;border:1px solid #29323d;border-radius:8px;background:#0c1117;margin-bottom:8px}.pitch-instance-actions small{grid-column:1/-1;color:#728093;font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pitch-component-card{border-top:1px solid #252c35;padding:9px 0}.pitch-component-main{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.pitch-component-card b{display:block;font-size:10px}.pitch-component-card small{display:block;color:#717c8b;font-size:9px;line-height:1.45}.pitch-component-card-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-top:7px}.pitch-component-card-actions .pitch-component-btn{height:27px;padding:0 6px;font-size:9px}.pitch-component-empty{color:#697484;font-size:10px;line-height:1.5;padding:8px 2px}
`;
let open = false;

function runtime(): Runtime | undefined { return (window as any).__pitchEditorRuntime as Runtime | undefined; }
function status(message: string): void { const node = document.getElementById("spikeStatus"); if (node) node.textContent = message; }
function esc(value: unknown): string { return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[char] ?? char); }
function selectedInstance(): { instanceId: string; componentId: string } | undefined {
  const editor = runtime(); const slide = editor?.getSlide(); const ids = editor?.getSelectedIds() ?? [];
  if (!slide || ids.length !== 1) return undefined;
  const element = slide.scene.find((item: AnyRecord) => item.id === ids[0]);
  const instanceId = element?.tags?.find((tag: string) => tag.startsWith("component:"))?.slice("component:".length);
  const componentId = element?.tags?.find((tag: string) => tag.startsWith("component-def:"))?.slice("component-def:".length);
  return instanceId && componentId ? { instanceId, componentId } : undefined;
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
  const components = project.components ?? []; const selected = editor?.getSelectedIds() ?? []; const instance = selectedInstance();
  root.innerHTML = `<div class="pitch-components-title"><b>Components 2.0</b><small>${components.length} masters · ${project.componentInstances?.length ?? 0} instances</small></div>
    <div class="pitch-component-create"><input data-component-name placeholder="Component name" value="New component"><button class="pitch-component-btn" data-component-create ${selected.length ? "" : "disabled"}>Create from ${selected.length} selected</button></div>
    ${instance ? `<div class="pitch-instance-actions"><small>Selected instance · ${esc(instance.instanceId)}</small><button class="pitch-component-btn secondary" data-component-reset>Reset to master</button><button class="pitch-component-btn danger" data-component-detach>Detach instance</button></div>` : ""}
    ${components.length ? components.map((component: AnyRecord) => `<div class="pitch-component-card"><div class="pitch-component-main"><div><b>${esc(component.name)}</b><small>${Math.round(component.widthDU)} × ${Math.round(component.heightDU)} DU · ${component.slots?.length ?? 0} slots · v${component.version}<br>${component.instanceCount ?? 0} linked instance${component.instanceCount === 1 ? "" : "s"}</small></div></div><div class="pitch-component-card-actions"><button class="pitch-component-btn" data-component-insert="${esc(component.id)}">Insert</button><button class="pitch-component-btn secondary" data-component-sync="${esc(component.id)}" ${component.instanceCount ? "" : "disabled"}>Sync all</button><button class="pitch-component-btn secondary" data-component-update="${esc(component.id)}" ${selected.length ? "" : "disabled"}>Update master</button></div></div>`).join("") : `<div class="pitch-component-empty">Create a component from a selected object tree. Linked instances keep their local text/image/fill/stroke overrides when the master changes. Update Master propagates structural and visual master changes to every linked instance.</div>`}`;
  root.querySelector("[data-component-create]")?.addEventListener("click", () => {
    const name = (root.querySelector("[data-component-name]") as HTMLInputElement).value.trim();
    if (!name) { status("Component name is required"); return; }
    void run({ command: "createFromSelection", slideId: slide.id, selectedIds: editor?.getSelectedIds() ?? [], name });
  });
  root.querySelector("[data-component-reset]")?.addEventListener("click", () => { if (instance) void run({ command: "resetInstance", componentId: instance.componentId, instanceId: instance.instanceId }); });
  root.querySelector("[data-component-detach]")?.addEventListener("click", () => { if (instance) void run({ command: "detach", slideId: slide.id, instanceId: instance.instanceId }); });
  root.querySelectorAll<HTMLElement>("[data-component-insert]").forEach((button) => button.addEventListener("click", () => {
    const component = components.find((item: AnyRecord) => item.id === button.dataset.componentInsert); if (!component) return;
    const x = Math.round((project.deck.canvas.widthDU - component.widthDU) / 2); const y = Math.round((project.deck.canvas.heightDU - component.heightDU) / 2);
    void run({ command: "insert", slideId: slide.id, componentId: component.id, transform: { x, y, scaleX: 1, scaleY: 1 } });
  }));
  root.querySelectorAll<HTMLElement>("[data-component-sync]").forEach((button) => button.addEventListener("click", () => {
    const componentId = button.dataset.componentSync; if (componentId) void run({ command: "refreshInstances", componentId });
  }));
  root.querySelectorAll<HTMLElement>("[data-component-update]").forEach((button) => button.addEventListener("click", () => {
    const componentId = button.dataset.componentUpdate; const ids = editor?.getSelectedIds() ?? []; if (!componentId || !ids.length) return;
    void run({ command: "updateFromSelection", slideId: slide.id, componentId, selectedIds: ids });
  }));
}

export function installPitchComponentsUI(): void {
  const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);
  const top = document.querySelector<HTMLElement>(".spike-top"); const spacer = top?.querySelector<HTMLElement>(".spacer");
  if (top && spacer) { const button = document.createElement("button"); button.className = "spike-btn pitch-components-toggle"; button.textContent = "Components"; button.addEventListener("click", () => { open = !open; render(); }); top.insertBefore(button, spacer); }
  const root = document.createElement("div"); root.id = "pitchComponentsPopover"; root.className = "pitch-components-popover"; document.body.appendChild(root);
  window.addEventListener("pitch:editor-state", render); render();
}
