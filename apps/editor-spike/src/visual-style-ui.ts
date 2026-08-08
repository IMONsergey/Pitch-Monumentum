type AnyRecord = Record<string, any>;

type PitchEditorRuntime = {
  getProject(): AnyRecord | null;
  getSelectedIds(): string[];
  command(input: AnyRecord): Promise<AnyRecord>;
};

const styleCss = `
  .pitch-style-section select{width:100%;height:29px;border:1px solid var(--line);border-radius:6px;background:#101419;color:var(--text);padding:0 7px;font-size:11px}
  .pitch-style-row{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px}
  .pitch-style-toggle{display:flex;align-items:center;gap:6px;font-size:10px;color:#9ba5b3;margin:4px 0 7px}
  .pitch-style-toggle input{accent-color:#c7ff5e}
  .pitch-style-apply{width:100%;height:30px;border:1px solid #47515f;border-radius:7px;background:#161c23;color:var(--text);font-size:11px;cursor:pointer;margin-top:9px}
  .pitch-style-apply:hover{border-color:#697587}
`;

function runtime(): PitchEditorRuntime | undefined {
  return (window as any).__pitchEditorRuntime as PitchEditorRuntime | undefined;
}

function selectedElement(): AnyRecord | null {
  const editor = runtime();
  const project = editor?.getProject();
  const ids = editor?.getSelectedIds() ?? [];
  if (!project || ids.length !== 1) return null;
  for (const slide of project.deck.slides ?? []) {
    const element = slide.scene.find((item: AnyRecord) => item.id === ids[0]);
    if (element) return element;
  }
  return null;
}

function safeColor(value: unknown, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(String(value ?? "")) ? String(value) : fallback;
}

function field(root: HTMLElement, key: string): HTMLInputElement | HTMLSelectElement {
  const node = root.querySelector(`[data-visual=${key}]`) as HTMLInputElement | HTMLSelectElement | null;
  if (!node) throw new Error(`Missing visual field ${key}`);
  return node;
}

function num(root: HTMLElement, key: string): number {
  const value = Number(field(root, key).value);
  if (!Number.isFinite(value)) throw new Error(`${key} must be numeric`);
  return value;
}

function checked(root: HTMLElement, key: string): boolean {
  return (field(root, key) as HTMLInputElement).checked;
}

function shapeControls(element: AnyRecord): string {
  const stroke = element.stroke ?? { color: "#111111", widthDU: 1, dash: "solid" };
  const hasFill = Boolean(element.fill);
  const hasStroke = Boolean(element.stroke);
  return `
    <label class="pitch-style-toggle"><input type="checkbox" data-visual=fillEnabled ${hasFill ? "checked" : ""}> Fill</label>
    <div class="pitch-field"><label>Fill color</label><input type=color data-visual=fill value="${safeColor(element.fill, "#e9edf2")}"></div>
    <label class="pitch-style-toggle"><input type="checkbox" data-visual=strokeEnabled ${hasStroke ? "checked" : ""}> Stroke</label>
    <div class="pitch-style-row"><div class="pitch-field"><label>Stroke</label><input type=color data-visual=strokeColor value="${safeColor(stroke.color, "#111111")}"></div><div class="pitch-field"><label>Width · DU</label><input type=number min=0 step=.5 data-visual=strokeWidth value="${stroke.widthDU ?? 1}"></div></div>
    <div class="pitch-style-row"><div class="pitch-field"><label>Dash</label><select data-visual=dash><option value=solid ${stroke.dash === "solid" || !stroke.dash ? "selected" : ""}>Solid</option><option value=dash ${stroke.dash === "dash" ? "selected" : ""}>Dash</option><option value=dot ${stroke.dash === "dot" ? "selected" : ""}>Dot</option></select></div><div class="pitch-field"><label>Radius · DU</label><input type=number min=0 step=1 data-visual=radius value="${element.radiusDU ?? 0}"></div></div>
    ${element.type === "frame" ? `<label class="pitch-style-toggle"><input type="checkbox" data-visual=clipContent ${element.clipContent ? "checked" : ""}> Clip content</label>` : ""}`;
}

function imageControls(element: AnyRecord): string {
  return `
    <div class="pitch-style-row"><div class="pitch-field"><label>Fit</label><select data-visual=fit><option value=cover ${element.fit === "cover" ? "selected" : ""}>Cover</option><option value=contain ${element.fit === "contain" ? "selected" : ""}>Contain</option><option value=stretch ${element.fit === "stretch" ? "selected" : ""}>Stretch</option></select></div><div class="pitch-field"><label>Radius · DU</label><input type=number min=0 step=1 data-visual=radius value="${element.cornerRadiusDU ?? 0}"></div></div>`;
}

function lineControls(element: AnyRecord): string {
  const stroke = element.stroke ?? { color: "#111111", widthDU: 2, dash: "solid" };
  return `
    <div class="pitch-style-row"><div class="pitch-field"><label>Stroke</label><input type=color data-visual=strokeColor value="${safeColor(stroke.color, "#111111")}"></div><div class="pitch-field"><label>Width · DU</label><input type=number min=.1 step=.5 data-visual=strokeWidth value="${stroke.widthDU ?? 2}"></div></div>
    <div class="pitch-style-row"><div class="pitch-field"><label>Dash</label><select data-visual=dash><option value=solid ${stroke.dash === "solid" || !stroke.dash ? "selected" : ""}>Solid</option><option value=dash ${stroke.dash === "dash" ? "selected" : ""}>Dash</option><option value=dot ${stroke.dash === "dot" ? "selected" : ""}>Dot</option></select></div><div class="pitch-field"><label>Start</label><select data-visual=startMarker><option value=none ${!element.startMarker || element.startMarker === "none" ? "selected" : ""}>None</option><option value=arrow ${element.startMarker === "arrow" ? "selected" : ""}>Arrow</option><option value=dot ${element.startMarker === "dot" ? "selected" : ""}>Dot</option></select></div></div>
    <div class="pitch-field" style="margin-top:7px"><label>End marker</label><select data-visual=endMarker><option value=none ${!element.endMarker || element.endMarker === "none" ? "selected" : ""}>None</option><option value=arrow ${element.endMarker === "arrow" ? "selected" : ""}>Arrow</option><option value=dot ${element.endMarker === "dot" ? "selected" : ""}>Dot</option></select></div>`;
}

function applyDomVisuals(): void {
  const editor = runtime();
  const project = editor?.getProject();
  if (!project) return;
  for (const slide of project.deck.slides ?? []) {
    for (const element of slide.scene ?? []) {
      const node = document.querySelector<HTMLElement>(`#spikeScene [data-id="${CSS.escape(element.id)}"]`);
      if (!node) continue;
      if (element.type === "frame") {
        node.style.background = element.fill ?? "transparent";
        node.style.border = element.stroke ? `${Math.max(.5, element.stroke.widthDU)}px ${element.stroke.dash === "dot" ? "dotted" : element.stroke.dash === "dash" ? "dashed" : "solid"} ${element.stroke.color}` : "1px dashed rgba(110,125,145,.35)";
        node.style.borderRadius = `${element.radiusDU ?? 0}px`;
        node.style.overflow = element.clipContent ? "hidden" : "visible";
      } else if (element.type === "image") {
        node.style.borderRadius = `${element.cornerRadiusDU ?? 0}px`;
        node.style.overflow = "hidden";
      } else if (element.type === "line") {
        node.style.borderColor = element.stroke?.color ?? "#111111";
        node.style.borderStyle = element.stroke?.dash === "dot" ? "dotted" : element.stroke?.dash === "dash" ? "dashed" : "solid";
      }
    }
  }
}

async function applyStyle(section: HTMLElement, element: AnyRecord): Promise<void> {
  const editor = runtime();
  if (!editor) return;
  let style: AnyRecord;
  if (element.type === "shape" || element.type === "frame") {
    const stroke = checked(section, "strokeEnabled") ? {
      color: field(section, "strokeColor").value,
      widthDU: Math.max(0, num(section, "strokeWidth")),
      dash: field(section, "dash").value,
    } : null;
    style = {
      kind: element.type,
      fill: checked(section, "fillEnabled") ? field(section, "fill").value : null,
      stroke,
      radiusDU: Math.max(0, num(section, "radius")),
      ...(element.type === "frame" ? { clipContent: checked(section, "clipContent") } : {}),
    };
  } else if (element.type === "image") {
    style = { kind: "image", fit: field(section, "fit").value, cornerRadiusDU: Math.max(0, num(section, "radius")) };
  } else {
    style = {
      kind: "line",
      stroke: { color: field(section, "strokeColor").value, widthDU: Math.max(.1, num(section, "strokeWidth")), dash: field(section, "dash").value },
      startMarker: field(section, "startMarker").value,
      endMarker: field(section, "endMarker").value,
    };
  }
  await editor.command({ command: "setStyle", elementId: element.id, style });
}

function render(): void {
  applyDomVisuals();
  const panel = document.querySelector<HTMLElement>(".spike-right.pitch-inspector");
  if (!panel || panel.querySelector(".pitch-style-section")) return;
  const element = selectedElement();
  if (!element || !["shape", "frame", "image", "line"].includes(element.type)) return;
  const section = document.createElement("div");
  section.className = "pitch-section pitch-style-section";
  section.innerHTML = `<h4>Visual style</h4>${element.type === "shape" || element.type === "frame" ? shapeControls(element) : element.type === "image" ? imageControls(element) : lineControls(element)}<button class="pitch-style-apply">Apply visual style</button><div class="pitch-inspector-note">Style is stored in SceneGraph and exported natively where the target format supports it.</div>`;
  const applyButton = section.querySelector<HTMLButtonElement>(".pitch-style-apply")!;
  applyButton.addEventListener("click", () => void applyStyle(section, element).catch((error) => {
    const status = document.getElementById("spikeStatus");
    if (status) status.textContent = `Visual style failed: ${error instanceof Error ? error.message : String(error)}`;
  }));
  const applyAnchor = panel.querySelector("[data-inspector-action=apply]");
  panel.insertBefore(section, applyAnchor ?? null);
}

export function installPitchVisualStyleUI(): void {
  const styleNode = document.createElement("style");
  styleNode.textContent = styleCss;
  document.head.appendChild(styleNode);
  window.addEventListener("pitch:editor-state", () => requestAnimationFrame(render));
  requestAnimationFrame(render);
}
