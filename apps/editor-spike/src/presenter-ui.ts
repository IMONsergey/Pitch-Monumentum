import { advancePresenter, createPresenterState, jumpToSlide, presenterView, retreatPresenter, shouldAutoAdvance, type PresenterState } from "../../../packages/presenter-engine/src/index.js";
import { compileBuildPhases, sampleSlideMotion, type BuildPhase, type SlideMotion } from "../../../packages/motion-engine/src/index.js";

type AnyRecord = Record<string, any>;
type Runtime = { getProject(): AnyRecord | null; getSlide(): AnyRecord | undefined };

const css = `
.pitch-present-toggle{border-color:#55496f!important;color:#dccbff!important}.pitch-presenter{position:fixed;inset:0;display:none;background:#050607;z-index:1000;color:#fff}.pitch-presenter.open{display:grid;grid-template-rows:1fr 54px}.pitch-presenter-main{position:relative;display:grid;place-items:center;overflow:hidden;background:radial-gradient(circle at 50% 45%,#171b21 0,#080a0d 58%,#030405 100%)}.pitch-presenter-wrap{position:relative;box-shadow:0 35px 120px #000d;overflow:hidden;background:#fff}.pitch-presenter-stage{position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0;background:#fff;color:#111;overflow:hidden}.pitch-presenter-el{position:absolute;box-sizing:border-box;transform-origin:center center}.pitch-presenter-el[data-build-hidden=true]{visibility:hidden}
.pitch-presenter-el.build-fade-in{animation:pitchFadeIn var(--motion-duration,.4s) var(--motion-delay,0s) both}.pitch-presenter-el.build-fade-out{animation:pitchFadeOut var(--motion-duration,.4s) var(--motion-delay,0s) both}.pitch-presenter-el.build-scale-in{animation:pitchScaleIn var(--motion-duration,.4s) var(--motion-delay,0s) both}.pitch-presenter-el.build-scale-out{animation:pitchScaleOut var(--motion-duration,.4s) var(--motion-delay,0s) both}.pitch-presenter-el.build-slide-in{animation:pitchSlideElementIn var(--motion-duration,.4s) var(--motion-delay,0s) both}.pitch-presenter-el.build-slide-out{animation:pitchSlideElementOut var(--motion-duration,.4s) var(--motion-delay,0s) both}.pitch-presenter-el.build-wipe-in{animation:pitchWipeIn var(--motion-duration,.4s) var(--motion-delay,0s) both}.pitch-presenter-el.build-wipe-out{animation:pitchWipeOut var(--motion-duration,.4s) var(--motion-delay,0s) both}.pitch-presenter-el.build-pulse{animation:pitchPulse var(--motion-duration,.5s) var(--motion-delay,0s) both}
@keyframes pitchFadeIn{from{opacity:0}to{opacity:var(--base-opacity,1)}}@keyframes pitchFadeOut{from{opacity:var(--base-opacity,1)}to{opacity:0;visibility:hidden}}@keyframes pitchScaleIn{from{opacity:0;transform:translate(var(--track-x,0),var(--track-y,0)) rotate(var(--rotation,0deg)) scale(.72)}to{opacity:var(--base-opacity,1);transform:translate(var(--track-x,0),var(--track-y,0)) rotate(var(--rotation,0deg)) scale(var(--scale-x,1),var(--scale-y,1))}}@keyframes pitchScaleOut{from{opacity:var(--base-opacity,1)}to{opacity:0;transform:translate(var(--track-x,0),var(--track-y,0)) rotate(var(--rotation,0deg)) scale(.72);visibility:hidden}}@keyframes pitchSlideElementIn{from{opacity:0;transform:translate(calc(var(--track-x,0px) + var(--build-x,0px)),calc(var(--track-y,0px) + var(--build-y,42px))) rotate(var(--rotation,0deg)) scale(var(--scale-x,1),var(--scale-y,1))}to{opacity:var(--base-opacity,1);transform:translate(var(--track-x,0px),var(--track-y,0px)) rotate(var(--rotation,0deg)) scale(var(--scale-x,1),var(--scale-y,1))}}@keyframes pitchSlideElementOut{from{opacity:var(--base-opacity,1)}to{opacity:0;transform:translate(calc(var(--track-x,0px) + var(--build-x,0px)),calc(var(--track-y,0px) + var(--build-y,-42px))) rotate(var(--rotation,0deg)) scale(var(--scale-x,1),var(--scale-y,1));visibility:hidden}}@keyframes pitchWipeIn{from{clip-path:inset(0 100% 0 0);opacity:.3}to{clip-path:inset(0);opacity:var(--base-opacity,1)}}@keyframes pitchWipeOut{from{clip-path:inset(0);opacity:var(--base-opacity,1)}to{clip-path:inset(0 0 0 100%);opacity:0;visibility:hidden}}@keyframes pitchPulse{0%,100%{transform:translate(var(--track-x,0px),var(--track-y,0px)) rotate(var(--rotation,0deg)) scale(var(--scale-x,1),var(--scale-y,1))}50%{transform:translate(var(--track-x,0px),var(--track-y,0px)) rotate(var(--rotation,0deg)) scale(1.06)}}
.pitch-presenter-stage.transition-fade{animation:pitchStageFade var(--transition-duration,.35s) both}.pitch-presenter-stage.transition-push{animation:pitchStagePush var(--transition-duration,.35s) both}.pitch-presenter-stage.transition-wipe{animation:pitchStageWipe var(--transition-duration,.35s) both}.pitch-presenter-stage.transition-dissolve{animation:pitchStageDissolve var(--transition-duration,.35s) both}@keyframes pitchStageFade{from{opacity:0}to{opacity:1}}@keyframes pitchStagePush{from{opacity:.45;translate:130px 0}to{opacity:1;translate:0 0}}@keyframes pitchStageWipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0)}}@keyframes pitchStageDissolve{from{opacity:0;filter:blur(12px)}to{opacity:1;filter:none}}
.pitch-presenter-bar{display:flex;align-items:center;gap:8px;padding:0 14px;background:#0b0e12;border-top:1px solid #232932;font-size:11px}.pitch-presenter-bar button{height:30px;border:1px solid #303743;border-radius:7px;background:#151a21;color:#e9edf2;padding:0 10px;cursor:pointer}.pitch-presenter-bar b{font-size:11px}.pitch-presenter-progress{width:160px;height:3px;background:#252b33;border-radius:4px;overflow:hidden}.pitch-presenter-progress span{display:block;height:100%;background:#c7ff5e}.pitch-presenter-spacer{flex:1}.pitch-presenter-notes{position:absolute;right:18px;bottom:18px;width:min(440px,40vw);max-height:38vh;overflow:auto;display:none;padding:14px 16px;border:1px solid #303844;border-radius:10px;background:#0b0e12e8;color:#d4dae2;box-shadow:0 18px 60px #0009;font-size:12px;line-height:1.55;white-space:pre-wrap;backdrop-filter:blur(18px)}.pitch-presenter-notes.open{display:block}.pitch-presenter-hint{position:absolute;top:14px;right:16px;color:#7f8997;font-size:10px;background:#090b0eaa;padding:6px 8px;border-radius:6px}
`;

let state: PresenterState | null = null;
let opened = false;
let notesOpen = false;
let raf = 0;
let lastSlideId: string | null = null;

function runtime(): Runtime | undefined { return (window as any).__pitchEditorRuntime as Runtime | undefined; }
function esc(value: unknown): string { return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[char] ?? char); }
function motionFor(project: AnyRecord, slideId: string): SlideMotion | undefined { return project.motion?.slides?.find((item: AnyRecord) => item.slideId === slideId) as SlideMotion | undefined; }
function px(value: number): string { return `${Number.isFinite(value) ? value : 0}px`; }

function buildVector(phase?: BuildPhase): { x: string; y: string } {
  const d = phase?.distanceDU ?? 80;
  if (phase?.direction === "left") return { x: px(-d), y: "0px" };
  if (phase?.direction === "right") return { x: px(d), y: "0px" };
  if (phase?.direction === "up") return { x: "0px", y: px(-d) };
  return { x: "0px", y: px(d) };
}

function buildState(elementId: string, motion: SlideMotion | undefined, clickIndex: number): { hidden: boolean; className: string; phase?: BuildPhase } {
  if (!motion) return { hidden: false, className: "" };
  const phases = compileBuildPhases(motion.builds).filter((phase) => phase.elementIds.includes(elementId));
  const pendingEntrance = phases.some((phase) => phase.kind === "entrance" && phase.clickIndex > clickIndex);
  const completedExit = phases.some((phase) => phase.kind === "exit" && phase.clickIndex < clickIndex);
  const active = [...phases].reverse().find((phase) => phase.clickIndex === clickIndex);
  if (!active) return { hidden: pendingEntrance || completedExit, className: "" };
  const out = active.kind === "exit";
  let className = "";
  if (active.kind === "emphasis" || active.effect === "pulse") className = "build-pulse";
  else if (active.effect === "fade" || active.effect === "appear") className = out ? "build-fade-out" : "build-fade-in";
  else if (active.effect === "scale") className = out ? "build-scale-out" : "build-scale-in";
  else if (active.effect === "slide") className = out ? "build-slide-out" : "build-slide-in";
  else if (active.effect === "wipe") className = out ? "build-wipe-out" : "build-wipe-in";
  return { hidden: active.kind === "entrance" ? false : pendingEntrance || completedExit, className, phase: active };
}

function textHtml(element: AnyRecord): string {
  return (element.paragraphs ?? []).map((paragraph: AnyRecord) => `<div style="text-align:${esc(paragraph.align || "left")};line-height:${paragraph.lineSpacing || 1.2};margin:${paragraph.spaceBeforePt || 0}pt 0 ${paragraph.spaceAfterPt || 0}pt">${(paragraph.runs ?? []).map((run: AnyRecord) => `<span style="font-family:${esc(run.fontFamily || "Inter, sans-serif")};font-size:${(run.fontSizePt || 18) * 96 / 72}px;color:${esc(run.color || "#111111")};font-weight:${run.bold ? 700 : 400};font-style:${run.italic ? "italic" : "normal"};${run.underline ? "text-decoration:underline;" : ""}${run.letterSpacingPt !== undefined ? `letter-spacing:${run.letterSpacingPt * 96 / 72}px;` : ""}">${esc(run.text)}</span>`).join("")}</div>`).join("");
}

function presentation(element: AnyRecord, motion: SlideMotion | undefined, clickIndex: number) {
  const g = element.geometry;
  const build = buildState(element.id, motion, clickIndex);
  const vector = buildVector(build.phase);
  const attrs = `data-presenter-element="${esc(element.id)}" data-build-hidden="${build.hidden ? "true" : "false"}" class="pitch-presenter-el ${build.className}"`;
  const style = `left:${g.x}px;top:${g.y}px;width:${g.width}px;height:${g.height}px;z-index:${element.zIndex};--base-opacity:${element.opacity ?? 1};opacity:${element.opacity ?? 1};--rotation:${g.rotation || 0}deg;--scale-x:1;--scale-y:1;--track-x:0px;--track-y:0px;--build-x:${vector.x};--build-y:${vector.y};--motion-duration:${(build.phase?.durationMs ?? 400) / 1000}s;--motion-delay:${(build.phase?.relativeStartMs ?? 0) / 1000}s;transform:translate(var(--track-x),var(--track-y)) rotate(var(--rotation)) scale(var(--scale-x),var(--scale-y))`;
  return { attrs, style };
}

function elementHtml(element: AnyRecord, motion: SlideMotion | undefined, clickIndex: number): string {
  const { attrs, style } = presentation(element, motion, clickIndex);
  if (element.type === "text") return `<div ${attrs} style="${style};display:flex;flex-direction:column;justify-content:${element.verticalAlign === "middle" ? "center" : element.verticalAlign === "bottom" ? "flex-end" : "flex-start"};overflow:hidden">${textHtml(element)}</div>`;
  if (element.type === "shape" || element.type === "frame") {
    const fill = esc(element.fill || "transparent");
    const border = element.stroke ? `${element.stroke.widthDU}px solid ${esc(element.stroke.color)}` : "none";
    const radius = element.type === "shape" && element.shape === "ellipse" ? "50%" : `${element.radiusDU || 0}px`;
    return `<div ${attrs} style="${style};background:${fill};border:${border};border-radius:${radius};${element.clipContent ? "overflow:hidden" : ""}"></div>`;
  }
  if (element.type === "line") return `<svg ${attrs} style="${style};overflow:visible"><line x1="${element.start[0]}" y1="${element.start[1]}" x2="${element.end[0]}" y2="${element.end[1]}" stroke="${esc(element.stroke.color)}" stroke-width="${element.stroke.widthDU}"/></svg>`;
  if (element.type === "image") return `<div ${attrs} style="${style};border-radius:${element.cornerRadiusDU || 0}px;background:#1d232b;display:grid;place-items:center;color:#75808f;font:22px system-ui">IMAGE · ${esc(element.assetId)}</div>`;
  if (element.type === "table") return `<div ${attrs} style="${style};background:#fff;border:1px solid #d7dce3;padding:10px;font:18px system-ui;overflow:hidden">${(element.rows ?? []).map((row: AnyRecord[]) => `<div>${row.map((cell: AnyRecord) => esc(cell.text)).join(" · ")}</div>`).join("")}</div>`;
  if (element.type === "chart") return `<div ${attrs} style="${style};border:1px solid #d7dce3;padding:18px;font:20px system-ui">Chart · ${esc(element.chart?.chartType || "data")}</div>`;
  return `<div ${attrs} style="${style};border:1px dashed #9aa3af"></div>`;
}

function fitStage(): void {
  const wrap = document.querySelector<HTMLElement>(".pitch-presenter-wrap");
  const stage = document.getElementById("pitchPresenterStage");
  if (!wrap || !stage) return;
  const maxWidth = Math.min(window.innerWidth * .92, Math.max(320, window.innerHeight - 94) * (16 / 9));
  const scale = maxWidth / 1920;
  wrap.style.width = `${1920 * scale}px`;
  wrap.style.height = `${1080 * scale}px`;
  stage.style.transform = `scale(${scale})`;
}

function applyTracks(project: AnyRecord): void {
  if (!opened || !state) return;
  const view = presenterView(project.deck, project.motion, state, Date.now());
  const motion = motionFor(project, view.currentSlide.id);
  if (!motion) return;
  const sampled = sampleSlideMotion(motion, Math.max(0, Date.now() - state.slideEnteredAtMs));
  for (const [elementId, values] of sampled) {
    const node = document.querySelector<HTMLElement>(`#pitchPresenterStage [data-presenter-element="${CSS.escape(elementId)}"]`);
    if (!node) continue;
    if (values.geometry?.x !== undefined) node.style.left = `${values.geometry.x}px`;
    if (values.geometry?.y !== undefined) node.style.top = `${values.geometry.y}px`;
    if (values.geometry?.width !== undefined) node.style.width = `${Math.max(1, values.geometry.width)}px`;
    if (values.geometry?.height !== undefined) node.style.height = `${Math.max(1, values.geometry.height)}px`;
    if (values.geometry?.rotation !== undefined) node.style.setProperty("--rotation", `${values.geometry.rotation}deg`);
    if (values.opacity !== undefined) { node.style.setProperty("--base-opacity", String(values.opacity)); node.style.opacity = String(values.opacity); }
    if (values.scaleX !== undefined) node.style.setProperty("--scale-x", String(values.scaleX));
    if (values.scaleY !== undefined) node.style.setProperty("--scale-y", String(values.scaleY));
  }
}

function animationLoop(): void {
  cancelAnimationFrame(raf);
  const project = runtime()?.getProject();
  if (!opened || !project || !state) return;
  applyTracks(project);
  if (shouldAutoAdvance(project.deck, project.motion, state, Date.now())) {
    state = advancePresenter(project.deck, project.motion, state, Date.now());
    if (state.finished) { closePresenter(); return; }
    render();
    return;
  }
  raf = requestAnimationFrame(animationLoop);
}

function render(): void {
  const root = document.getElementById("pitchPresenter");
  const project = runtime()?.getProject();
  if (!root || !project) return;
  root.classList.toggle("open", opened);
  if (!opened) { cancelAnimationFrame(raf); return; }
  if (!state) state = createPresenterState(project.deck, Date.now());
  const view = presenterView(project.deck, project.motion, state, Date.now());
  const motion = motionFor(project, view.currentSlide.id);
  const slideChanged = lastSlideId !== view.currentSlide.id;
  lastSlideId = view.currentSlide.id;
  const transition = slideChanged ? motion?.transition : undefined;
  const transitionClass = transition && transition.type !== "none" ? ` transition-${transition.type}` : "";
  root.innerHTML = `<div class="pitch-presenter-main" data-presenter-advance><div class="pitch-presenter-wrap"><div id="pitchPresenterStage" class="pitch-presenter-stage${transitionClass}" style="--transition-duration:${(transition?.durationMs ?? 0) / 1000}s">${[...view.currentSlide.scene].sort((a: AnyRecord,b: AnyRecord) => a.zIndex-b.zIndex).map((element: AnyRecord) => elementHtml(element,motion,view.build.activeClickIndex)).join("")}</div></div><div class="pitch-presenter-hint">Click / → next · ← back · N notes · Esc close</div><div class="pitch-presenter-notes ${notesOpen ? "open" : ""}">${view.speakerNotes ? esc(view.speakerNotes) : "No speaker notes on this slide."}</div></div><div class="pitch-presenter-bar"><button data-presenter=back>←</button><button data-presenter=next>→</button><b>${view.slideNumber} / ${view.slideCount}</b><div class="pitch-presenter-progress"><span style="width:${view.progress * 100}%"></span></div><span>${esc(view.currentSlide.title)}</span><span>Build ${Math.max(0,view.build.activeClickIndex + 1)} / ${view.build.clickCount}</span><div class="pitch-presenter-spacer"></div><button data-presenter=notes>Notes</button><button data-presenter=fullscreen>Fullscreen</button><button data-presenter=close>Close</button></div>`;
  root.querySelector("[data-presenter-advance]")?.addEventListener("click", () => next());
  root.querySelector("[data-presenter=back]")?.addEventListener("click", (event) => { event.stopPropagation(); back(); });
  root.querySelector("[data-presenter=next]")?.addEventListener("click", (event) => { event.stopPropagation(); next(); });
  root.querySelector("[data-presenter=notes]")?.addEventListener("click", (event) => { event.stopPropagation(); notesOpen = !notesOpen; render(); });
  root.querySelector("[data-presenter=fullscreen]")?.addEventListener("click", (event) => { event.stopPropagation(); void root.requestFullscreen?.(); });
  root.querySelector("[data-presenter=close]")?.addEventListener("click", (event) => { event.stopPropagation(); closePresenter(); });
  requestAnimationFrame(fitStage);
  animationLoop();
}

function next(): void {
  const project = runtime()?.getProject();
  if (!project || !state) return;
  state = advancePresenter(project.deck, project.motion, state, Date.now());
  if (state.finished) { closePresenter(); return; }
  render();
}
function back(): void {
  const project = runtime()?.getProject();
  if (!project || !state) return;
  state = retreatPresenter(project.deck, project.motion, state, Date.now());
  render();
}
function closePresenter(): void {
  opened = false;
  state = null;
  lastSlideId = null;
  cancelAnimationFrame(raf);
  if (document.fullscreenElement) void document.exitFullscreen?.();
  render();
}
function openPresenter(): void {
  const editor = runtime();
  const project = editor?.getProject();
  const current = editor?.getSlide();
  if (!project) return;
  state = createPresenterState(project.deck, Date.now());
  const index = current ? project.deck.slides.findIndex((slide: AnyRecord) => slide.id === current.id) : 0;
  if (index > 0) state = jumpToSlide(project.deck, state, index, Date.now());
  opened = true;
  notesOpen = false;
  lastSlideId = null;
  render();
}

export function installPitchPresenterUI(): void {
  const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);
  const top = document.querySelector<HTMLElement>(".spike-top");
  const spacer = top?.querySelector<HTMLElement>(".spacer");
  if (top && spacer) {
    const button = document.createElement("button");
    button.className = "spike-btn pitch-present-toggle";
    button.textContent = "Present";
    button.addEventListener("click", openPresenter);
    top.insertBefore(button, spacer);
  }
  const root = document.createElement("div");
  root.id = "pitchPresenter";
  root.className = "pitch-presenter";
  document.body.appendChild(root);
  window.addEventListener("resize", fitStage);
  window.addEventListener("keydown", (event) => {
    if (!opened) return;
    if (event.key === "Escape") { event.preventDefault(); closePresenter(); }
    else if (event.key === "ArrowRight" || event.key === " " || event.key === "Enter") { event.preventDefault(); next(); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); back(); }
    else if (event.key.toLowerCase() === "n") { event.preventDefault(); notesOpen = !notesOpen; render(); }
  }, true);
}
