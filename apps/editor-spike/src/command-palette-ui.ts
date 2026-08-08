type AnyRecord = Record<string, any>;

type Runtime = {
  getProject(): AnyRecord | null;
  getSlide(): AnyRecord | undefined;
  getSelectedIds(): string[];
  select(ids: string[]): void;
  command(input: AnyRecord): Promise<AnyRecord>;
};

interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  keywords: string;
  enabled(): boolean;
  run(): Promise<void> | void;
}

const css = `
  .pitch-command-backdrop{position:fixed;inset:0;z-index:1600;display:none;align-items:flex-start;justify-content:center;padding-top:11vh;background:#02030488;backdrop-filter:blur(5px)}
  .pitch-command-backdrop.open{display:flex}.pitch-command{width:min(620px,calc(100vw - 48px));max-height:72vh;display:grid;grid-template-rows:auto 1fr;border:1px solid #343d49;border-radius:14px;background:#0d1116f5;box-shadow:0 30px 110px #000d;overflow:hidden}
  .pitch-command-search{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #252c35}.pitch-command-search span{font-size:11px;color:#7d8795}.pitch-command-search input{flex:1;border:0;outline:0;background:transparent;color:#f2f5f7;font:14px/1.4 Inter,system-ui,sans-serif}.pitch-command-search kbd{border:1px solid #323a45;border-radius:5px;padding:2px 5px;color:#7d8795;font:9px system-ui;background:#151a20}
  .pitch-command-list{overflow:auto;padding:6px}.pitch-command-item{width:100%;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;border:0;border-radius:8px;padding:9px 10px;background:transparent;color:#e9edf2;text-align:left;cursor:pointer;font:11px/1.35 Inter,system-ui,sans-serif}.pitch-command-item:hover,.pitch-command-item.active{background:#1b222b}.pitch-command-item:disabled{opacity:.32;cursor:default;background:transparent}.pitch-command-main b{display:block;font-size:11px}.pitch-command-main small{display:block;margin-top:2px;color:#737f8e;font-size:9px}.pitch-command-hint{color:#697584;font-size:9px}.pitch-command-empty{padding:28px 18px;color:#697584;text-align:center;font-size:11px}
  .pitch-command-trigger{border-color:#3b4654!important;color:#c9d1db!important}
`;

let open = false;
let query = "";
let activeIndex = 0;

function runtime(): Runtime | undefined {
  return (window as any).__pitchEditorRuntime as Runtime | undefined;
}

function status(message: string): void {
  const node = document.getElementById("spikeStatus");
  if (node) node.textContent = message;
}

function selection(): string[] {
  return runtime()?.getSelectedIds() ?? [];
}

async function command(input: AnyRecord): Promise<void> {
  const editor = runtime();
  if (!editor) return;
  await editor.command(input);
}

function click(selector: string): void {
  (document.querySelector(selector) as HTMLElement | null)?.click();
}

function actions(): PaletteAction[] {
  const editor = runtime();
  const slide = editor?.getSlide();
  const selected = selection();
  const many = selected.length >= 2;
  return [
    { id: "insert-text", label: "Insert text", hint: "New editable text box", keywords: "insert add text typography", enabled: () => Boolean(slide), run: () => command({ command: "insertText", geometry: { x: 600, y: 440, width: 720, height: 120 }, text: "Text" }) },
    { id: "insert-shape", label: "Insert shape", hint: "Rectangle", keywords: "insert add shape rectangle", enabled: () => Boolean(slide), run: () => command({ command: "insertShape", geometry: { x: 760, y: 390, width: 400, height: 260 }, shape: "rect", fill: "#E9EDF2" }) },
    { id: "insert-frame", label: "Insert frame", hint: "Container", keywords: "insert add frame container", enabled: () => Boolean(slide), run: () => command({ command: "insertFrame", geometry: { x: 600, y: 300, width: 720, height: 480 } }) },
    { id: "assets", label: "Open Assets Library", hint: "Images · drag/drop · paste", keywords: "assets image photo media upload import library", enabled: () => Boolean(slide), run: () => click(".pitch-assets-toggle") },
    { id: "duplicate", label: "Duplicate selection", hint: "⌘D", keywords: "duplicate copy clone selection", enabled: () => selected.length > 0, run: () => command({ command: "duplicate", selectedIds: selected }) },
    { id: "delete", label: "Delete selection", hint: "⌫", keywords: "delete remove selection", enabled: () => selected.length > 0, run: () => command({ command: "delete", selectedIds: selected }) },
    { id: "group", label: "Group selection", hint: "⌘G", keywords: "group selection", enabled: () => many, run: () => command({ command: "group", selectedIds: selected }) },
    { id: "ungroup", label: "Ungroup selection", hint: "⇧⌘G", keywords: "ungroup selection", enabled: () => selected.length > 0, run: () => command({ command: "ungroup", selectedIds: selected }) },
    { id: "align-left", label: "Align left", hint: "Selection", keywords: "align left", enabled: () => many, run: () => command({ command: "align", selectedIds: selected, alignment: "left" }) },
    { id: "align-center", label: "Align horizontal centers", hint: "Selection", keywords: "align center horizontal", enabled: () => many, run: () => command({ command: "align", selectedIds: selected, alignment: "horizontalCenter" }) },
    { id: "align-right", label: "Align right", hint: "Selection", keywords: "align right", enabled: () => many, run: () => command({ command: "align", selectedIds: selected, alignment: "right" }) },
    { id: "new-slide", label: "New slide", hint: "After current", keywords: "new insert slide storyboard", enabled: () => Boolean(slide), run: () => command({ command: "newSlide", afterSlideId: slide?.id, title: "Untitled slide" }) },
    { id: "duplicate-slide", label: "Duplicate current slide", hint: "Storyboard", keywords: "duplicate clone slide storyboard", enabled: () => Boolean(slide), run: () => command({ command: "duplicateSlide", slideId: slide?.id }) },
    { id: "motion", label: "Open Motion Studio", hint: "Animation", keywords: "motion animation transition keyframe build", enabled: () => Boolean(slide), run: () => click(".pitch-motion-toggle") },
    { id: "components", label: "Open Components", hint: "Reusable objects", keywords: "components reusable instance library", enabled: () => Boolean(slide), run: () => click(".pitch-components-toggle") },
    { id: "present", label: "Present from current slide", hint: "Preview", keywords: "present presenter preview fullscreen slideshow", enabled: () => Boolean(slide), run: () => click(".pitch-present-toggle") },
    { id: "clear", label: "Clear selection", hint: "Esc", keywords: "clear deselect selection", enabled: () => selected.length > 0, run: () => editor?.select([]) },
    { id: "undo", label: "Undo deck edit", hint: "⌘Z", keywords: "undo history", enabled: () => Boolean(editor?.getProject()?.history?.canUndo), run: () => command({ command: "undo" }) },
    { id: "redo", label: "Redo deck edit", hint: "⇧⌘Z", keywords: "redo history", enabled: () => Boolean(editor?.getProject()?.history?.canRedo), run: () => command({ command: "redo" }) },
  ];
}

function filtered(): PaletteAction[] {
  const needle = query.trim().toLowerCase();
  const all = actions();
  if (!needle) return all;
  return all.filter((action) => `${action.label} ${action.keywords}`.toLowerCase().includes(needle));
}

function close(): void {
  open = false;
  query = "";
  activeIndex = 0;
  render();
}

async function runAction(action: PaletteAction): Promise<void> {
  if (!action.enabled()) return;
  close();
  try {
    await action.run();
    status(`Command · ${action.label}`);
  } catch (error) {
    status(`Command failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function render(): void {
  const root = document.getElementById("pitchCommandBackdrop");
  if (!root) return;
  root.classList.toggle("open", open);
  if (!open) return;
  const list = filtered();
  activeIndex = Math.max(0, Math.min(activeIndex, Math.max(0, list.length - 1)));
  root.innerHTML = `<div class="pitch-command" role="dialog" aria-label="Command Palette">
    <div class="pitch-command-search"><span>⌘K</span><input id="pitchCommandSearch" autocomplete="off" spellcheck="false" placeholder="Type a command…" value="${query.replace(/"/g, "&quot;")}"><kbd>ESC</kbd></div>
    <div class="pitch-command-list">${list.length ? list.map((action, index) => `<button class="pitch-command-item ${index === activeIndex ? "active" : ""}" data-command-id="${action.id}" ${action.enabled() ? "" : "disabled"}><span class="pitch-command-main"><b>${action.label}</b><small>${action.hint ?? action.keywords}</small></span><span class="pitch-command-hint">${action.enabled() ? "↵" : "Unavailable"}</span></button>`).join("") : `<div class="pitch-command-empty">No matching commands</div>`}</div>
  </div>`;
  const input = root.querySelector<HTMLInputElement>("#pitchCommandSearch");
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
  input?.addEventListener("input", () => { query = input.value; activeIndex = 0; render(); });
  root.querySelectorAll<HTMLButtonElement>("[data-command-id]").forEach((button) => button.addEventListener("click", () => {
    const action = list.find((item) => item.id === button.dataset.commandId);
    if (action) void runAction(action);
  }));
}

function openPalette(): void {
  open = true;
  query = "";
  activeIndex = 0;
  render();
}

export function installPitchCommandPaletteUI(): void {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  const backdrop = document.createElement("div");
  backdrop.id = "pitchCommandBackdrop";
  backdrop.className = "pitch-command-backdrop";
  backdrop.addEventListener("mousedown", (event) => { if (event.target === backdrop) close(); });
  document.body.appendChild(backdrop);

  const top = document.querySelector<HTMLElement>(".spike-top");
  const spacer = top?.querySelector<HTMLElement>(".spacer");
  if (top && spacer) {
    const button = document.createElement("button");
    button.className = "spike-btn pitch-command-trigger";
    button.textContent = "⌘K";
    button.title = "Command Palette";
    button.addEventListener("click", openPalette);
    top.insertBefore(button, spacer);
  }

  window.addEventListener("keydown", (event) => {
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === "k") {
      event.preventDefault();
      open ? close() : openPalette();
      return;
    }
    if (!open) return;
    const list = filtered();
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key === "ArrowDown") { event.preventDefault(); activeIndex = Math.min(list.length - 1, activeIndex + 1); render(); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); activeIndex = Math.max(0, activeIndex - 1); render(); return; }
    if (event.key === "Enter" && list[activeIndex]) { event.preventDefault(); void runAction(list[activeIndex]); }
  }, true);
}
