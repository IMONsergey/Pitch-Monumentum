import { createPitchRichTextSession, type PitchRichTextSession } from "../../../packages/rich-text/src/index.js";

type AnyRecord = Record<string, any>;

interface EditingState {
  session: PitchRichTextSession;
  root: HTMLElement;
  slideId: string;
  elementId: string;
  deckHash: string;
  originalParagraphs: AnyRecord[];
}

let editing: EditingState | null = null;

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector(selector) as T | null;

async function api(path: string, options: RequestInit = {}): Promise<any> {
  const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function installStyles(): void {
  if (document.getElementById("pitch-rich-text-style")) return;
  const style = document.createElement("style");
  style.id = "pitch-rich-text-style";
  style.textContent = `
    .pitch-text-toolbar{position:fixed;z-index:10000;display:none;align-items:center;gap:4px;padding:6px;background:#111419f2;border:1px solid #313845;border-radius:10px;box-shadow:0 12px 40px #0008;color:#f3f5f7;backdrop-filter:blur(14px)}
    .pitch-text-toolbar.visible{display:flex}.pitch-text-toolbar button,.pitch-text-toolbar select,.pitch-text-toolbar input{font:12px Inter,system-ui,sans-serif;color:#f3f5f7;background:#1a1f27;border:1px solid #313845;border-radius:6px;height:30px}
    .pitch-text-toolbar button{min-width:30px;padding:0 8px;cursor:pointer}.pitch-text-toolbar button:hover{border-color:#667085}.pitch-text-toolbar select{padding:0 24px 0 8px}.pitch-text-toolbar input[type=number]{width:58px;padding:0 7px}.pitch-text-toolbar input[type=color]{width:32px;padding:3px}.pitch-text-toolbar .sep{width:1px;height:20px;background:#313845;margin:0 2px}.pitch-text-toolbar .done{background:#c7ff5e;color:#090b0e;border-color:#c7ff5e;font-weight:700}.pitch-text-toolbar .cancel{color:#a8b0bd}
    .spike-el.pitch-text-editing{cursor:text!important;user-select:text!important;touch-action:auto!important;overflow:visible;outline:2px solid #78a9ff!important;outline-offset:4px}.spike-el.pitch-text-editing *{user-select:text!important}.spike-el.pitch-text-editing:focus{outline:2px solid #78a9ff!important}
  `;
  document.head.appendChild(style);
}

function installToolbar(): HTMLElement {
  let toolbar = document.getElementById("pitchTextToolbar") as HTMLElement | null;
  if (toolbar) return toolbar;
  toolbar = document.createElement("div");
  toolbar.id = "pitchTextToolbar";
  toolbar.className = "pitch-text-toolbar";
  toolbar.innerHTML = `
    <select data-text-action="fontFamily" title="Font family"><option>Inter</option><option>Arial</option><option>Helvetica Neue</option><option>Georgia</option><option>Times New Roman</option><option>Courier New</option></select>
    <input data-text-action="fontSize" type="number" min="6" max="240" step="1" value="24" title="Font size, pt">
    <button data-text-action="bold" title="Bold"><b>B</b></button>
    <button data-text-action="italic" title="Italic"><i>I</i></button>
    <button data-text-action="underline" title="Underline"><u>U</u></button>
    <input data-text-action="color" type="color" value="#111111" title="Text color">
    <div class="sep"></div>
    <button data-text-action="left" title="Align left">L</button>
    <button data-text-action="center" title="Align center">C</button>
    <button data-text-action="right" title="Align right">R</button>
    <button data-text-action="bullet" title="Bullet list">•</button>
    <button data-text-action="number" title="Numbered list">1.</button>
    <div class="sep"></div>
    <button data-text-action="cancel" class="cancel">Esc</button>
    <button data-text-action="commit" class="done">Done</button>
  `;
  document.body.appendChild(toolbar);

  toolbar.addEventListener("pointerdown", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("button")) event.preventDefault();
  });
  toolbar.addEventListener("click", (event) => {
    const control = (event.target as HTMLElement).closest<HTMLElement>("[data-text-action]");
    const action = control?.dataset.textAction;
    if (!action || !editing) return;
    if (action === "bold" || action === "italic" || action === "underline") editing.session.toggleFormat(action);
    else if (action === "left" || action === "center" || action === "right") editing.session.setAlignment(action);
    else if (action === "bullet") editing.session.toggleBulletList();
    else if (action === "number") editing.session.toggleNumberedList();
    else if (action === "commit") void commitEditing();
    else if (action === "cancel") cancelEditing();
    editing?.session.focus();
  });
  toolbar.querySelector<HTMLSelectElement>("[data-text-action=fontFamily]")?.addEventListener("change", (event) => {
    if (!editing) return;
    editing.session.setFontFamily((event.target as HTMLSelectElement).value);
    editing.session.focus();
  });
  toolbar.querySelector<HTMLInputElement>("[data-text-action=fontSize]")?.addEventListener("change", (event) => {
    if (!editing) return;
    editing.session.setFontSizePt(Number((event.target as HTMLInputElement).value));
    editing.session.focus();
  });
  toolbar.querySelector<HTMLInputElement>("[data-text-action=color]")?.addEventListener("input", (event) => {
    if (!editing) return;
    editing.session.setColor((event.target as HTMLInputElement).value);
  });
  return toolbar;
}

function positionToolbar(root: HTMLElement): void {
  const toolbar = installToolbar();
  const box = root.getBoundingClientRect();
  toolbar.style.left = `${Math.max(12, Math.min(window.innerWidth - toolbar.offsetWidth - 12, box.left))}px`;
  toolbar.style.top = `${Math.max(12, box.top - 46)}px`;
}

function hideToolbar(): void {
  document.getElementById("pitchTextToolbar")?.classList.remove("visible");
}

function finishDomMode(): void {
  if (!editing) return;
  editing.session.destroy();
  editing.root.removeAttribute("data-pitch-text-editing");
  editing.root.removeAttribute("contenteditable");
  editing.root.classList.remove("pitch-text-editing");
  editing = null;
  hideToolbar();
}

async function commitEditing(): Promise<void> {
  if (!editing) return;
  const current = editing;
  const paragraphs = current.session.readParagraphs();
  const result = await api("/api/mutate", {
    method: "POST",
    body: JSON.stringify({
      reason: "Edit rich text in canvas",
      expectedDeckHash: current.deckHash,
      operations: [{ op: "replaceText", slideId: current.slideId, elementId: current.elementId, paragraphs }],
    }),
  });
  finishDomMode();
  (document.getElementById("spikeStatus") as HTMLElement | null)!.textContent = `Rich text committed · deck v${result.manifest?.artifacts?.[result.deck?.id]?.latestVersion ?? "next"}`;
  (document.getElementById("spikeRefresh") as HTMLButtonElement | null)?.click();
}

function cancelEditing(): void {
  if (!editing) return;
  finishDomMode();
  (document.getElementById("spikeStatus") as HTMLElement | null)!.textContent = "Rich text edit cancelled";
  (document.getElementById("spikeRefresh") as HTMLButtonElement | null)?.click();
}

async function enterTextEditing(root: HTMLElement): Promise<void> {
  const elementId = root.dataset.id;
  if (!elementId) return;
  if (editing?.elementId === elementId) return;
  if (editing) cancelEditing();

  const project = await api("/api/project");
  let foundSlide: AnyRecord | undefined;
  let foundElement: AnyRecord | undefined;
  for (const slide of project.deck.slides as AnyRecord[]) {
    const element = slide.scene.find((item: AnyRecord) => item.id === elementId);
    if (element) { foundSlide = slide; foundElement = element; break; }
  }
  if (!foundSlide || !foundElement || foundElement.type !== "text" || foundElement.locked) return;

  (document.getElementById("spikeClearSelection") as HTMLButtonElement | null)?.click();
  root.dataset.pitchTextEditing = "true";
  root.contentEditable = "true";
  root.spellcheck = true;
  root.classList.add("pitch-text-editing");

  const session = createPitchRichTextSession(root, foundElement.paragraphs, {
    namespace: `Pitch:${project.deck.id}:${foundElement.id}`,
    historyDelayMs: 200,
  });
  editing = {
    session,
    root,
    slideId: foundSlide.id,
    elementId: foundElement.id,
    deckHash: project.deckHash,
    originalParagraphs: structuredClone(foundElement.paragraphs),
  };

  const toolbar = installToolbar();
  toolbar.classList.add("visible");
  requestAnimationFrame(() => {
    positionToolbar(root);
    session.focus();
  });
  (document.getElementById("spikeStatus") as HTMLElement | null)!.textContent = "Rich text mode · Esc cancels · Cmd/Ctrl+Enter commits";
}

export function installPitchRichTextUI(): void {
  installStyles();
  installToolbar();

  const scene = document.getElementById("spikeScene");
  if (!scene) return;

  scene.addEventListener("pointerdown", (event) => {
    const editingRoot = (event.target as Element | null)?.closest<HTMLElement>("[data-pitch-text-editing=true]");
    if (!editingRoot) return;
    event.stopImmediatePropagation();
  }, true);

  scene.addEventListener("dblclick", (event) => {
    const root = (event.target as Element | null)?.closest<HTMLElement>("#spikeScene .spike-el[data-id]");
    if (!root) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void enterTextEditing(root);
  }, true);

  window.addEventListener("keydown", (event) => {
    if (!editing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void commitEditing();
    }
  }, true);

  window.addEventListener("resize", () => { if (editing) positionToolbar(editing.root); });
}
