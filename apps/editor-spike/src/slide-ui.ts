type AnyRecord = Record<string, any>;

type PitchEditorRuntime = {
  getProject(): AnyRecord | null;
  getSlide(): AnyRecord | undefined;
  getSelectedIds(): string[];
  command(input: AnyRecord): Promise<AnyRecord>;
};

const style = `
  .pitch-slide-tools{display:grid;grid-template-columns:1fr auto auto auto;gap:4px;margin:0 0 8px}
  .pitch-slide-name{min-width:0;height:29px;border:1px solid var(--line);border-radius:6px;background:#101419;color:var(--text);padding:0 7px;font-size:10px}
  .pitch-slide-action{height:29px;min-width:29px;border:1px solid var(--line);border-radius:6px;background:#151a20;color:var(--text);cursor:pointer;font-size:11px;padding:0 7px}
  .pitch-slide-action:hover{border-color:#4a5566;background:#1b222a}.pitch-slide-action.danger:hover{border-color:#7b3940;color:#ff9ba4}
  .spike-thumb[draggable=true]{cursor:grab}.spike-thumb.pitch-drag-over{outline:1px solid #c7ff5e;outline-offset:-1px}.spike-thumb.pitch-dragging{opacity:.45}
`;

let draggedSlideId: string | null = null;

function runtime(): PitchEditorRuntime | undefined {
  return (window as any).__pitchEditorRuntime as PitchEditorRuntime | undefined;
}

function status(message: string): void {
  const node = document.getElementById("spikeStatus");
  if (node) node.textContent = message;
}

function selectSlideAfterCommand(slideId?: string): void {
  if (!slideId) return;
  requestAnimationFrame(() => {
    const target = document.querySelector<HTMLButtonElement>(`#spikeSlides [data-slide="${CSS.escape(slideId)}"]`);
    target?.click();
  });
}

async function command(input: AnyRecord): Promise<AnyRecord | null> {
  const editor = runtime();
  if (!editor) return null;
  try {
    const result = await editor.command(input);
    selectSlideAfterCommand(result.nextSlideId);
    return result;
  } catch (error) {
    status(`Slide command failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function wireSlideControls(): void {
  const editor = runtime();
  const slide = editor?.getSlide();
  const bar = document.querySelector<HTMLElement>("#pitchSlideTools");
  if (!slide || !bar) return;
  const name = bar.querySelector<HTMLInputElement>("[data-slide-name]");
  if (name && document.activeElement !== name) name.value = slide.title || "";
  const project = editor?.getProject();
  const deleteButton = bar.querySelector<HTMLButtonElement>("[data-slide-action=delete]");
  if (deleteButton) deleteButton.disabled = (project?.deck?.slides?.length ?? 0) <= 1;
}

function wireStoryboardDrag(): void {
  const editor = runtime();
  const project = editor?.getProject();
  if (!project) return;
  document.querySelectorAll<HTMLButtonElement>("#spikeSlides .spike-thumb[data-slide]").forEach((thumb) => {
    thumb.draggable = true;
    thumb.ondragstart = (event) => {
      draggedSlideId = thumb.dataset.slide ?? null;
      thumb.classList.add("pitch-dragging");
      if (draggedSlideId) event.dataTransfer?.setData("text/pitch-slide", draggedSlideId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    };
    thumb.ondragend = () => {
      draggedSlideId = null;
      document.querySelectorAll(".pitch-dragging,.pitch-drag-over").forEach((node) => node.classList.remove("pitch-dragging", "pitch-drag-over"));
    };
    thumb.ondragover = (event) => {
      if (!draggedSlideId || draggedSlideId === thumb.dataset.slide) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      thumb.classList.add("pitch-drag-over");
    };
    thumb.ondragleave = () => thumb.classList.remove("pitch-drag-over");
    thumb.ondrop = (event) => {
      event.preventDefault();
      thumb.classList.remove("pitch-drag-over");
      const sourceId = draggedSlideId || event.dataTransfer?.getData("text/pitch-slide");
      const targetId = thumb.dataset.slide;
      if (!sourceId || !targetId || sourceId === targetId) return;
      const latest = runtime()?.getProject();
      const toIndex = latest?.deck?.slides?.findIndex((item: AnyRecord) => item.id === targetId) ?? -1;
      if (toIndex < 0) return;
      void command({ command: "moveSlide", slideId: sourceId, toIndex });
    };
  });
}

function refresh(): void {
  wireSlideControls();
  wireStoryboardDrag();
}

export function installPitchSlideUI(): void {
  const styleNode = document.createElement("style");
  styleNode.textContent = style;
  document.head.appendChild(styleNode);

  const slides = document.querySelector<HTMLElement>("#spikeSlides");
  if (!slides) return;
  const bar = document.createElement("div");
  bar.id = "pitchSlideTools";
  bar.className = "pitch-slide-tools";
  bar.innerHTML = `
    <input class="pitch-slide-name" data-slide-name aria-label="Slide name" title="Rename slide · Enter to apply">
    <button class="pitch-slide-action" data-slide-action="new" title="New slide after current">＋</button>
    <button class="pitch-slide-action" data-slide-action="duplicate" title="Duplicate current slide">⧉</button>
    <button class="pitch-slide-action danger" data-slide-action="delete" title="Delete current slide">−</button>`;
  slides.insertAdjacentElement("beforebegin", bar);

  bar.querySelector<HTMLButtonElement>("[data-slide-action=new]")?.addEventListener("click", () => {
    const current = runtime()?.getSlide();
    void command({ command: "newSlide", afterSlideId: current?.id, title: "Untitled slide" });
  });
  bar.querySelector<HTMLButtonElement>("[data-slide-action=duplicate]")?.addEventListener("click", () => {
    const current = runtime()?.getSlide();
    if (current) void command({ command: "duplicateSlide", slideId: current.id });
  });
  bar.querySelector<HTMLButtonElement>("[data-slide-action=delete]")?.addEventListener("click", () => {
    const current = runtime()?.getSlide();
    if (current) void command({ command: "deleteSlide", slideId: current.id });
  });
  const name = bar.querySelector<HTMLInputElement>("[data-slide-name]");
  const commitName = () => {
    const current = runtime()?.getSlide();
    const title = name?.value.trim();
    if (current && title && title !== current.title) void command({ command: "renameSlide", slideId: current.id, title });
  };
  name?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); name.blur(); commitName(); }
    if (event.key === "Escape") { event.preventDefault(); name.value = runtime()?.getSlide()?.title || ""; name.blur(); }
  });
  name?.addEventListener("change", commitName);

  window.addEventListener("pitch:editor-state", refresh);
  refresh();
}
