type AnyRecord = Record<string, any>;

type PitchEditorRuntime = {
  getProject(): AnyRecord | null;
  getSlide(): AnyRecord | undefined;
  getSelectedIds(): string[];
  command(input: AnyRecord): Promise<AnyRecord>;
};

const inspectorStyle = `
  .pitch-inspector{height:100%;overflow:auto;padding:12px}.pitch-inspector-empty{color:var(--muted);font-size:11px;line-height:1.5;padding:10px 4px}
  .pitch-inspector-head{display:flex;align-items:center;gap:8px;margin-bottom:12px}.pitch-inspector-type{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#7f8998}.pitch-inspector-id{font-size:10px;color:#606b7a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pitch-section{border-top:1px solid var(--line);padding-top:10px;margin-top:10px}.pitch-section:first-of-type{border-top:0;margin-top:0;padding-top:0}.pitch-section h4{margin:0 0 8px;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#8c96a5}
  .pitch-field{display:flex;flex-direction:column;gap:3px;min-width:0}.pitch-field label{font-size:9px;color:#717c8b}.pitch-field input{width:100%;height:29px;border:1px solid var(--line);border-radius:6px;background:#101419;color:var(--text);padding:0 7px;font-size:11px;min-width:0}.pitch-field input[type=color]{padding:3px}
  .pitch-field-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.pitch-field-grid.five{grid-template-columns:repeat(2,1fr)}
  .pitch-checks{display:flex;gap:5px;flex-wrap:wrap}.pitch-check{display:flex;align-items:center;gap:5px;border:1px solid var(--line);padding:5px 7px;border-radius:6px;font-size:10px;color:#9ba5b3}.pitch-check input{accent-color:#c7ff5e}
  .pitch-inspector-apply{width:100%;height:32px;border:0;border-radius:7px;background:#c7ff5e;color:#090b0e;font-weight:700;font-size:11px;cursor:pointer;margin-top:12px}.pitch-inspector-apply:hover{filter:brightness(1.04)}
  .pitch-inspector-note{font-size:9px;color:#687382;line-height:1.45;margin-top:7px}
`;

function runtime(): PitchEditorRuntime | undefined {
  return (window as any).__pitchEditorRuntime as PitchEditorRuntime | undefined;
}

function selectedElement(): { slide: AnyRecord; element: AnyRecord } | null {
  const editor = runtime();
  const project = editor?.getProject();
  const selected = editor?.getSelectedIds() ?? [];
  if (!project || selected.length !== 1) return null;
  for (const slide of project.deck.slides as AnyRecord[]) {
    const element = slide.scene.find((item: AnyRecord) => item.id === selected[0]);
    if (element) return { slide, element };
  }
  return null;
}

function htmlEscape(value: unknown): string {
  return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[char] ?? char);
}

function numberValue(root: HTMLElement, name: string): number {
  const value = Number((root.querySelector(`[data-inspector=${name}]`) as HTMLInputElement).value);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}

function stringValue(root: HTMLElement, name: string): string {
  return (root.querySelector(`[data-inspector=${name}]`) as HTMLInputElement).value;
}

function checked(root: HTMLElement, name: string): boolean {
  return (root.querySelector(`[data-inspector=${name}]`) as HTMLInputElement).checked;
}

function firstTextRun(element: AnyRecord): AnyRecord {
  return element.paragraphs?.flatMap((paragraph: AnyRecord) => paragraph.runs ?? [])[0] ?? {};
}

function renderInspector(): void {
  const panel = document.querySelector<HTMLElement>(".spike-right");
  if (!panel) return;
  panel.classList.add("pitch-inspector");
  const editor = runtime();
  const selected = editor?.getSelectedIds() ?? [];
  const found = selectedElement();
  if (!found) {
    panel.innerHTML = `<div class="pitch-inspector-empty">${selected.length > 1 ? `<b>${selected.length} objects selected</b><br>Use the top alignment/distribution tools for multi-selection. Exact Inspector values are available for one object at a time.` : `<b>Inspector</b><br>Select an object to edit exact geometry, opacity, name and typography.`}</div>`;
    return;
  }

  const { element } = found;
  const g = element.geometry;
  const run = element.type === "text" ? firstTextRun(element) : null;
  panel.innerHTML = `
    <div class="pitch-inspector-head"><div><b>${htmlEscape(element.name || element.id)}</b><div class="pitch-inspector-id">${htmlEscape(element.id)}</div></div><span class="spacer"></span><span class="pitch-inspector-type">${htmlEscape(element.type)}</span></div>
    <div class="pitch-section"><h4>Object</h4>
      <div class="pitch-field"><label>Name</label><input data-inspector=name value="${htmlEscape(element.name || "")}"></div>
      <div class="pitch-field-grid" style="margin-top:7px"><div class="pitch-field"><label>Opacity · %</label><input data-inspector=opacity type=number min=0 max=100 step=1 value="${Math.round((element.opacity ?? 1) * 100)}"></div><label class="pitch-check" style="margin-top:14px"><input data-inspector=locked type=checkbox ${element.locked ? "checked" : ""}> Locked</label></div>
    </div>
    <div class="pitch-section"><h4>Geometry · DU</h4><div class="pitch-field-grid">
      <div class="pitch-field"><label>X</label><input data-inspector=x type=number step=1 value="${g.x}"></div>
      <div class="pitch-field"><label>Y</label><input data-inspector=y type=number step=1 value="${g.y}"></div>
      <div class="pitch-field"><label>W</label><input data-inspector=width type=number min=1 step=1 value="${g.width}"></div>
      <div class="pitch-field"><label>H</label><input data-inspector=height type=number min=1 step=1 value="${g.height}"></div>
      <div class="pitch-field"><label>Rotation</label><input data-inspector=rotation type=number step=1 value="${g.rotation ?? 0}"></div>
    </div></div>
    ${run ? `<div class="pitch-section"><h4>Typography · whole text box</h4>
      <div class="pitch-field-grid"><div class="pitch-field"><label>Font</label><input data-inspector=fontFamily value="${htmlEscape(run.fontFamily || "Inter")}"></div><div class="pitch-field"><label>Size · pt</label><input data-inspector=fontSize type=number min=1 step=.5 value="${run.fontSizePt ?? 18}"></div></div>
      <div class="pitch-field-grid" style="margin-top:7px"><div class="pitch-field"><label>Color</label><input data-inspector=color type=color value="${/^#[0-9a-f]{6}$/i.test(run.color || "") ? run.color : "#111111"}"></div><div class="pitch-field"><label>Tracking · pt</label><input data-inspector=tracking type=number step=.05 value="${run.letterSpacingPt ?? 0}"></div></div>
      <div class="pitch-checks" style="margin-top:8px"><label class="pitch-check"><input data-inspector=bold type=checkbox ${run.bold ? "checked" : ""}> Bold</label><label class="pitch-check"><input data-inspector=italic type=checkbox ${run.italic ? "checked" : ""}> Italic</label><label class="pitch-check"><input data-inspector=underline type=checkbox ${run.underline ? "checked" : ""}> Underline</label></div>
      <div class="pitch-inspector-note">This applies typography to the whole text box. Double-click the text on canvas for mixed inline formatting.</div>
    </div>` : ""}
    <button class="pitch-inspector-apply" data-inspector-action=apply>Apply · one version</button>
    <div class="pitch-inspector-note">Inspector changes use the same canonical command engine as Codex, keyboard and Layers. Auto Layout parents reflow automatically.</div>`;

  panel.querySelector("[data-inspector-action=apply]")?.addEventListener("click", () => void applyInspector(panel));
}

async function applyInspector(panel: HTMLElement): Promise<void> {
  const editor = runtime();
  const found = selectedElement();
  if (!editor || !found) return;
  const { element } = found;
  try {
    const geometry: AnyRecord = {};
    const geometryInputs: Array<[string, number]> = [
      ["x", numberValue(panel, "x")], ["y", numberValue(panel, "y")], ["width", numberValue(panel, "width")], ["height", numberValue(panel, "height")], ["rotation", numberValue(panel, "rotation")],
    ];
    for (const [key, value] of geometryInputs) if (value !== (element.geometry[key] ?? (key === "rotation" ? 0 : undefined))) geometry[key] = value;

    const presentation: AnyRecord = {};
    const name = stringValue(panel, "name");
    const opacity = Math.max(0, Math.min(100, numberValue(panel, "opacity"))) / 100;
    const locked = checked(panel, "locked");
    if (name !== (element.name || "")) presentation.name = name;
    if (opacity !== (element.opacity ?? 1)) presentation.opacity = opacity;
    if (locked !== Boolean(element.locked)) presentation.locked = locked;

    let textStyle: AnyRecord | undefined;
    if (element.type === "text") {
      const current = firstTextRun(element);
      const desired = {
        fontFamily: stringValue(panel, "fontFamily"),
        fontSizePt: numberValue(panel, "fontSize"),
        color: stringValue(panel, "color"),
        letterSpacingPt: numberValue(panel, "tracking"),
        bold: checked(panel, "bold"),
        italic: checked(panel, "italic"),
        underline: checked(panel, "underline"),
      };
      textStyle = {};
      for (const [key, value] of Object.entries(desired)) {
        const baseline = key === "fontFamily" ? (current[key] || "Inter") : key === "color" ? (current[key] || "#111111") : key === "letterSpacingPt" ? (current[key] ?? 0) : key === "fontSizePt" ? (current[key] ?? 18) : Boolean(current[key]);
        if (value !== baseline) textStyle[key] = value;
      }
    }

    if (!Object.keys(geometry).length && !Object.keys(presentation).length && (!textStyle || !Object.keys(textStyle).length)) {
      const status = document.getElementById("spikeStatus"); if (status) status.textContent = "Inspector · no changes";
      return;
    }
    await editor.command({ command: "setInspector", elementId: element.id, geometry, presentation, textStyle });
  } catch (error) {
    const status = document.getElementById("spikeStatus");
    if (status) status.textContent = `Inspector failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function installPitchInspectorUI(): void {
  const style = document.createElement("style");
  style.textContent = inspectorStyle;
  document.head.appendChild(style);
  window.addEventListener("pitch:editor-state", renderInspector);
  renderInspector();
}
