import { effectsToCssBoxShadow, effectsToCssDropShadow, effectiveFillPaint, paintToCss } from "../../../packages/appearance/src/index.js";

type AnyRecord = Record<string, any>;

type PitchEditorRuntime = {
  getProject(): AnyRecord | null;
  getSelectedIds(): string[];
  command(input: AnyRecord): Promise<AnyRecord>;
};

const appearanceCss = `
  .pitch-appearance-section select{width:100%;height:29px;border:1px solid var(--line);border-radius:6px;background:#101419;color:var(--text);padding:0 7px;font-size:11px}
  .pitch-appearance-row{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px}
  .pitch-appearance-triple{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:7px}
  .pitch-gradient-fields.hidden,.pitch-solid-fields.hidden,.pitch-shadow-fields.hidden{display:none}
  .pitch-appearance-toggle{display:flex;align-items:center;gap:6px;font-size:10px;color:#9ba5b3;margin:8px 0 5px}
  .pitch-appearance-toggle input{accent-color:#c7ff5e}
  .pitch-appearance-apply{width:100%;height:30px;border:1px solid #5b6d45;border-radius:7px;background:#171d14;color:#d9f5a2;font-size:11px;cursor:pointer;margin-top:9px}
  .pitch-appearance-apply:hover{border-color:#809c5a}
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

function input(root: HTMLElement, key: string): HTMLInputElement {
  const node = root.querySelector(`[data-appearance=${key}]`) as HTMLInputElement | null;
  if (!node) throw new Error(`Missing appearance field ${key}`);
  return node;
}

function select(root: HTMLElement, key: string): HTMLSelectElement {
  const node = root.querySelector(`[data-appearance=${key}]`) as HTMLSelectElement | null;
  if (!node) throw new Error(`Missing appearance field ${key}`);
  return node;
}

function number(root: HTMLElement, key: string): number {
  const value = Number(input(root, key).value);
  if (!Number.isFinite(value)) throw new Error(`${key} must be numeric`);
  return value;
}

function dropShadow(element: AnyRecord): AnyRecord {
  return element.effects?.find((effect: AnyRecord) => effect.kind === "dropShadow") ?? {
    kind: "dropShadow",
    color: "#000000",
    opacity: 0.22,
    blurDU: 24,
    offsetXDU: 0,
    offsetYDU: 10,
  };
}

function paintOf(element: AnyRecord): AnyRecord {
  return effectiveFillPaint(element as any) ?? { kind: "none" };
}

function fillControls(element: AnyRecord): string {
  if (element.type !== "shape" && element.type !== "frame") return "";
  const paint = paintOf(element);
  const solidColor = paint.kind === "solid" ? paint.color : (element.fill ?? "#E9EDF2");
  const start = paint.kind === "linearGradient" ? paint.stops[0] : { color: "#111111", opacity: 1 };
  const end = paint.kind === "linearGradient" ? paint.stops[paint.stops.length - 1] : { color: "#C7FF5E", opacity: 1 };
  const angle = paint.kind === "linearGradient" ? paint.angleDeg : 0;
  return `
    <div class="pitch-field"><label>Fill type</label><select data-appearance=fillKind>
      <option value=none ${paint.kind === "none" ? "selected" : ""}>None</option>
      <option value=solid ${paint.kind === "solid" ? "selected" : ""}>Solid</option>
      <option value=linearGradient ${paint.kind === "linearGradient" ? "selected" : ""}>Linear gradient</option>
    </select></div>
    <div class="pitch-solid-fields ${paint.kind === "solid" ? "" : "hidden"}" style="margin-top:7px">
      <div class="pitch-appearance-row"><div class="pitch-field"><label>Color</label><input type=color data-appearance=solidColor value="${safeColor(solidColor, "#E9EDF2")}"></div><div class="pitch-field"><label>Opacity · %</label><input type=number min=0 max=100 step=1 data-appearance=solidOpacity value="${Math.round((paint.kind === "solid" ? paint.opacity ?? 1 : 1) * 100)}"></div></div>
    </div>
    <div class="pitch-gradient-fields ${paint.kind === "linearGradient" ? "" : "hidden"}">
      <div class="pitch-appearance-row"><div class="pitch-field"><label>Start</label><input type=color data-appearance=gradientStart value="${safeColor(start.color, "#111111")}"></div><div class="pitch-field"><label>End</label><input type=color data-appearance=gradientEnd value="${safeColor(end.color, "#C7FF5E")}"></div></div>
      <div class="pitch-appearance-triple"><div class="pitch-field"><label>Angle · °</label><input type=number step=1 data-appearance=gradientAngle value="${angle}"></div><div class="pitch-field"><label>Start · %</label><input type=number min=0 max=100 step=1 data-appearance=gradientStartOpacity value="${Math.round((start.opacity ?? 1) * 100)}"></div><div class="pitch-field"><label>End · %</label><input type=number min=0 max=100 step=1 data-appearance=gradientEndOpacity value="${Math.round((end.opacity ?? 1) * 100)}"></div></div>
    </div>`;
}

function shadowControls(element: AnyRecord): string {
  const shadow = dropShadow(element);
  const enabled = Boolean(element.effects?.some((effect: AnyRecord) => effect.kind === "dropShadow"));
  return `
    <label class="pitch-appearance-toggle"><input type=checkbox data-appearance=shadowEnabled ${enabled ? "checked" : ""}> Drop shadow</label>
    <div class="pitch-shadow-fields ${enabled ? "" : "hidden"}">
      <div class="pitch-appearance-row"><div class="pitch-field"><label>Color</label><input type=color data-appearance=shadowColor value="${safeColor(shadow.color, "#000000")}"></div><div class="pitch-field"><label>Opacity · %</label><input type=number min=0 max=100 step=1 data-appearance=shadowOpacity value="${Math.round((shadow.opacity ?? .22) * 100)}"></div></div>
      <div class="pitch-appearance-triple"><div class="pitch-field"><label>Blur · DU</label><input type=number min=0 step=1 data-appearance=shadowBlur value="${shadow.blurDU ?? 24}"></div><div class="pitch-field"><label>X · DU</label><input type=number step=1 data-appearance=shadowX value="${shadow.offsetXDU ?? 0}"></div><div class="pitch-field"><label>Y · DU</label><input type=number step=1 data-appearance=shadowY value="${shadow.offsetYDU ?? 10}"></div></div>
    </div>`;
}

function applyDomAppearance(): void {
  const editor = runtime();
  const project = editor?.getProject();
  if (!project) return;
  for (const slide of project.deck.slides ?? []) {
    for (const element of slide.scene ?? []) {
      const node = document.querySelector<HTMLElement>(`#spikeScene [data-id="${CSS.escape(element.id)}"]`);
      if (!node) continue;
      if (element.type === "shape" || element.type === "frame") {
        const paint = effectiveFillPaint(element as any);
        node.style.background = paintToCss(paint);
      }
      if (element.type === "text") {
        node.style.textShadow = effectsToCssBoxShadow(element.effects).replace(/\b0px 0px /g, "0 0 ");
      } else if (element.type === "line") {
        node.style.filter = effectsToCssDropShadow(element.effects);
      } else {
        node.style.boxShadow = effectsToCssBoxShadow(element.effects);
      }
    }
  }
}

function refreshConditionalFields(section: HTMLElement): void {
  const fillKind = section.querySelector<HTMLSelectElement>("[data-appearance=fillKind]")?.value;
  section.querySelector<HTMLElement>(".pitch-solid-fields")?.classList.toggle("hidden", fillKind !== "solid");
  section.querySelector<HTMLElement>(".pitch-gradient-fields")?.classList.toggle("hidden", fillKind !== "linearGradient");
  const shadowEnabled = section.querySelector<HTMLInputElement>("[data-appearance=shadowEnabled]")?.checked ?? false;
  section.querySelector<HTMLElement>(".pitch-shadow-fields")?.classList.toggle("hidden", !shadowEnabled);
}

async function applyAppearance(section: HTMLElement, element: AnyRecord): Promise<void> {
  const editor = runtime();
  if (!editor) return;
  const appearance: AnyRecord = {};

  if (element.type === "shape" || element.type === "frame") {
    const kind = select(section, "fillKind").value;
    if (kind === "none") appearance.fillPaint = { kind: "none" };
    else if (kind === "solid") appearance.fillPaint = {
      kind: "solid",
      color: input(section, "solidColor").value,
      opacity: Math.max(0, Math.min(1, number(section, "solidOpacity") / 100)),
    };
    else appearance.fillPaint = {
      kind: "linearGradient",
      angleDeg: number(section, "gradientAngle"),
      stops: [
        { position: 0, color: input(section, "gradientStart").value, opacity: Math.max(0, Math.min(1, number(section, "gradientStartOpacity") / 100)) },
        { position: 1, color: input(section, "gradientEnd").value, opacity: Math.max(0, Math.min(1, number(section, "gradientEndOpacity") / 100)) },
      ],
    };
  }

  const shadowEnabled = input(section, "shadowEnabled").checked;
  appearance.effects = shadowEnabled ? [{
    kind: "dropShadow",
    color: input(section, "shadowColor").value,
    opacity: Math.max(0, Math.min(1, number(section, "shadowOpacity") / 100)),
    blurDU: Math.max(0, number(section, "shadowBlur")),
    offsetXDU: number(section, "shadowX"),
    offsetYDU: number(section, "shadowY"),
  }] : [];

  await editor.command({ command: "setAppearance", elementId: element.id, appearance });
}

function render(): void {
  applyDomAppearance();
  const panel = document.querySelector<HTMLElement>(".spike-right.pitch-inspector");
  if (!panel || panel.querySelector(".pitch-appearance-section")) return;
  const element = selectedElement();
  if (!element || element.type === "group") return;
  const section = document.createElement("div");
  section.className = "pitch-section pitch-appearance-section";
  section.innerHTML = `<h4>Appearance</h4>${fillControls(element)}${shadowControls(element)}<button class="pitch-appearance-apply">Apply appearance</button><div class="pitch-inspector-note">Paint and effects are canonical Pitch objects. Browser, Codex and exporters consume the same values.</div>`;
  section.querySelector("[data-appearance=fillKind]")?.addEventListener("change", () => refreshConditionalFields(section));
  section.querySelector("[data-appearance=shadowEnabled]")?.addEventListener("change", () => refreshConditionalFields(section));
  section.querySelector(".pitch-appearance-apply")?.addEventListener("click", () => void applyAppearance(section, element).catch((error) => {
    const status = document.getElementById("spikeStatus");
    if (status) status.textContent = `Appearance failed: ${error instanceof Error ? error.message : String(error)}`;
  }));
  const anchor = panel.querySelector("[data-inspector-action=apply]");
  panel.insertBefore(section, anchor ?? null);
  refreshConditionalFields(section);
}

export function installPitchAppearanceUI(): void {
  const style = document.createElement("style");
  style.textContent = appearanceCss;
  document.head.appendChild(style);
  window.addEventListener("pitch:editor-state", () => requestAnimationFrame(render));
  requestAnimationFrame(render);
}
