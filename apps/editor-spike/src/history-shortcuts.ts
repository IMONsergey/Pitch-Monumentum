type AnyRecord = Record<string, any>;

type PitchEditorRuntime = {
  command(input: AnyRecord): Promise<AnyRecord>;
};

function runtime(): PitchEditorRuntime | undefined {
  return (window as any).__pitchEditorRuntime as PitchEditorRuntime | undefined;
}

function isTextEditing(): boolean {
  return Boolean(document.querySelector("[data-pitch-text-editing=true]"));
}

export function installPitchHistoryShortcuts(): void {
  window.addEventListener("keydown", async (event) => {
    if (isTextEditing()) return;
    const target = event.target as HTMLElement | null;
    if (target?.matches("input,textarea,select,[contenteditable=true]")) return;
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier) return;

    const key = event.key.toLowerCase();
    const undo = key === "z" && !event.shiftKey;
    const redo = (key === "z" && event.shiftKey) || (key === "y" && event.ctrlKey && !event.metaKey);
    if (!undo && !redo) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const editor = runtime();
    if (!editor) return;
    await editor.command({ command: redo ? "redo" : "undo" });
  }, true);
}
