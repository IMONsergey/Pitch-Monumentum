type EditorRuntime = {
  reload(): Promise<void>;
  getSlide(): { id: string } | undefined;
  getSelectedIds(): string[];
  select(ids: string[]): void;
};

const PATCH_FLAG = "__pitchContextPreserverInstalled";

function restoreSlide(slideId: string | undefined): void {
  if (!slideId) return;
  const button = Array.from(document.querySelectorAll<HTMLElement>("[data-slide]")).find((node) => node.dataset.slide === slideId);
  button?.click();
}

export function installPitchContextPreserver(): void {
  const host = window as any;
  if (host[PATCH_FLAG]) return;
  const editor = host.__pitchEditorRuntime as EditorRuntime | undefined;
  if (!editor) return;
  host[PATCH_FLAG] = true;

  const originalReload = editor.reload.bind(editor);
  editor.reload = async () => {
    const slideId = editor.getSlide()?.id;
    const selectedIds = [...editor.getSelectedIds()];
    await originalReload();
    restoreSlide(slideId);
    const existing = new Set(
      Array.from(document.querySelectorAll<HTMLElement>("#spikeScene [data-id]"))
        .map((node) => node.dataset.id)
        .filter((id): id is string => Boolean(id)),
    );
    editor.select(selectedIds.filter((id) => existing.has(id)));
  };
}
