import { advancePresenter, createPresenterState, jumpToSlide, presenterView, retreatPresenter, shouldAutoAdvance, type PresenterState } from "../../../packages/presenter-engine/src/index.js";
import { compileBuildPhases, sampleSlideMotion, type BuildPhase, type SlideMotion } from "../../../packages/motion-engine/src/index.js";

type AnyRecord = Record<string, any>;
type Runtime = { getProject(): AnyRecord | null; getSlide(): AnyRecord | undefined };

const css = `
  .pitch-present-toggle{border-color:#55496f!important;color:#dccbff!important}
  .pitch-presenter{position:fixed;inset:0;display:none;background:#050607;z-index:1000;color:#fff}.pitch-presenter.open{display:grid;grid-template-rows:1fr 54px}
  .pitch-presenter-main{position:relative;display:grid;place-items:center;overflow:hidden;background:radial-gradient(circle at 50% 45%,#171b21 0,#080a0d 58%,#030405 100%)}
  .pitch-presenter-wrap{position:relative;box-shadow:0 35px 120px #000d;overflow:hidden;background:#fff}.pitch-presenter-stage{position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0;background:#fff;color:#111;overflow:hidden}
  .pitch-presenter-el{position:absolute;box-sizing:border-box;transform-origin:center center}.pitch-presenter-el p{margin:0}.pitch-presenter-el[data-build-hidden=true]{visibility:hidden}
  .pitch-presenter-el.build-fade-in{animation:pitchFadeIn var(--motion-duration,.4s) var(--motion-delay,0s) both}.pitch-presenter-el.build-fade-out{animation:pitchFadeOut var(--motion-duration,.4s) var(--motion-delay,0s) both}.pitch-presenter-el.build-scale-in{animation:pitchScaleIn var(--motion-duration,.4s) var(--motion-delay,0s) both}.pitch-presenter-el.build-scale-out{animation:pitchScaleOut var(--motion-duration,.4s) var(--motion-delay,0s) both}.pitch-presenter-el.build-slide-in{animation:pitchSlideElementIn var(--motion-duration,.4s) var(--motion-delay,0s) both}.pitch-presenter-el.build-slide-out{animation:pitchSlideElementOut var(--motion-duration,.4s) var(--motion-delay,0s) both}.pitch-presenter-el.build-wipe-in{animation:pitchWipeIn var(--motion-duration,.4s) var(--motion-delay,0s) both}.pitch-presenter-el.build-wipe-out{animation:pitchWipeOut var(--motion-duration,.4s) var(--motion-delay,0s) both}.pitch-presenter-el.build-pulse{animation:pitchPulse var(--motion-duration,.5s) var(--motion-delay,0s) both}
  @keyframes pitchFadeIn{from{opacity:0}to{opacity:var(--base-opacity,1)}}@keyframes pitchFadeOut{from{opacity:var(--base-opacity,1)}to{opacity:0;visibility:hidden}}@keyframes pitchScaleIn{from{opacity:0;transform:translate(var(--track-x,0),var(--track-y,0)) rotate(var(--rotation,0deg)) scale(.72)}to{opacity:var(--base-opacity,1);transform:translate(var(--track-x,0),var(--track-y,0)) rotate(var(--rotation,0deg)) scale(var(--scale-x,1),var(--scale-y,1))}}@keyframes pitchScaleOut{from{opacity:var(--base-opacity,1)}to{opacity:0;transform:translate(var(--track-x,0),var(--track-y,0)) rotate(var(--rotation,0deg)) scale(.72);visibility:hidden}}
  @keyframes pitchSlideElementIn{from{opacity:0;transform:translate(calc(var(--track-x,0) + var(--build-x,0px)),calc(var(--track-y,0) + var(--build-y,42px))) rotate(var(--rotation,0deg)) scale(var(--scale-x,1),var(--scale-y,1))}to{opacity:var(--base-opacity,1);transform:translate(var(--track-x,0),var(--track-y,0)) rotate(var(--rotation,0deg)) scale(var(--scale-x,1),var(--scale-y,1))}}@keyframes pitchSlideElementOut{from{opacity:var(--base-opacity,1)}to{opacity:0;transform:translate(calc(var(--track-x,0) + var(--build-x,0px)),calc(var(--track-y,0) + var(--build-y,-42px))) rotate(var(--rotation,0deg)) scale(var(--scale-x,1),var(--scale-y,1));visibility:hidden}}
  @keyframes pitchWipeIn{from{clip-path:inset(0 100% 0 0);opacity:.3}to{clip-path:inset(0);opacity:var(--base-opacity,1)}}@keyframes pitchWipeOut{from{clip-path:inset(0);opacity:var(--base-opacity,1)}to{clip-path:inset(0 0 0 100%);opacity:0;visibility:hidden}}@keyframes pitchPulse{0%,100%{transform:translate(var(--track-x,0),var(--track-y,0)) rotate(var(--rotation,0deg)) scale(var(--scale-x,1),var(--scale-y,1))}50%{transform:translate(var(--track-x,0),var(--track-y,0)) rotate(var(--rotation,0deg)) scale(1.06)}}
  .pitch-presenter-stage.transition-fade{animation:pitchStageFade var(--transition-duration,.35s) both}.pitch-presenter-stage.transition-push{animation:pitchStagePush var(--transition-duration,.35s) both}.pitch-presenter-stage.transition-wipe{animation:pitchStageWipe var(--transition-duration,.35s) both}.pitch-presenter-stage.transition-dissolve{animation:pitchStageDissolve var(--transition-duration,.35s) both}@keyframes pitchStageFade{from{opacity:0}to{opacity:1}}@keyframes pitchStagePush{from{opacity:.5;transform:translateX(130px)}to{opacity:1;transform:none}}@keyframes pitchStageWipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0)}}@keyframes pitchStageDissolve{from{opacity:0;filter:blur(12px)}to{opacity:1;filter:none}}
  .pitch-presenter-bar{display:flex;align-items:center;gap:8px;padding:0 14px;background:#0b0e12;border-top:1px solid #232932;font-size:11px}.pitch-presenter-bar button{height:30px;border:1px solid #303743;border-radius:7px;background:#151a21;color:#e9edf2;padding:0 10px;cursor:pointer}.pitch-presenter-bar b{font-size:11px}.pitch-presenter-progress{width:160px;height:3px;background:#252b33;border-radius:4px;overflow:hidden}.pitch-presenter-progress span{display:block;height:100%;background:#c7ff5e}.pitch-presenter-spacer{flex:1}.pitch-presenter-notes{position:absolute;right:18px;bottom:18px;width:min(440px,40vw);max-height:38vh;overflow:auto;display:none;padding:14px 16px;border:1px solid #303844;border-radius:10px;background:#0b0e12e8;color:#d4dae2;box-shadow:0 18px 60px #0009;font-size:12px;line-height:1.55;backdrop-filter:blur(18px)}.pitch-presenter-notes.open{display:block}.pitch-presenter-hint{position:absolute;top:14px;right:16px;color:#7f8997;font-size:10px;background:#090b0eaa;padding:6px 8px;border-radius:6px}
`;

let presenterState: PresenterState | null = null;
let open = false;
let notesOpen = false;
let raf = 0;
let lastRenderedSlideId: string | null = null;

function runtime(): Runtime | undefined { return (window as any).__pitchEditorRuntime as Runtime | undefined; }
function esc(value: unknown): string { return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[char] ?? char); }
function slideMotion(project: AnyRecord, slideId: string): SlideMotion | undefined { return project.motion?.slides?.find((item: AnyRecord) => item.slideId === slideId) as SlideMotion | undefined; }
function px(value: number): string { return `${Number.isFinite(value) ? value : 0}px`; }

function textHtml(element: AnyRecord): string {
  return (element.paragraphs ?? []).map((paragraph: AnyRecord) => `<div style="text-align:${esc(paragraph.align || "left")};line-height:${paragraph.lineSpacing || 1.2};margin-top:${paragraph.spaceBeforePt || 0}pt;margin-bottom:${paragraph.spaceAfterPt || 0}pt">${(paragraph.runs ?? []).map((run: AnyRecord) => `<span style="font-family:${esc(run.fontFamily || "Inter, sans-serif")};font-size:${(run.fontSizePt || 18) * 96 / 72}px;color:${esc(run.color || "#111111")};font-weight:${run.bold ? 700 : 400};font-style:${run.italic ? "italic" : "normal"};${run.underline ? "text-decoration:underline;" : ""}${run.letterSpacingPt !== undefined ? `letter-spacing:${run.letterSpacingPt * 96 / 72}px;` : ""}">${esc(run.text)}</span>`).join("")}</div>`).join("");
}

function buildVector(phase: BuildPhase | undefined): { x: string; y: string } {
  if (!phase) return { x: "0px", y: "42px" };
  const distance = phase.distanceDU ?? 80;
  if (phase.direction === "left") return { x: px(-distance), y: "0px" };
  if (phase.direction === "right") return { x: px(distance), y: "0px" };
  if (phase.direction === "up") return { x: "0px", y: px(-distance) };
  return { x: "0px", y: px(distance) };
}

function buildStateFor(elementId: string, motion: SlideMotion | undefined, clickIndex: number): { hidden: boolean; className: string; phase?: BuildPhase } {
  if (!motion) return { hidden: false, className: "" };
  const phases = compileBuildPhases(motion.builds).filter((phase) => phase.elementIds.includes(elementId));
  const pendingEntrance = phases.some((phase) => phase.kind === "entrance" && phase.clickIndex > clickIndex);
  const completedExit = phases.some((phase) => phase.kind === "exit" && phase.clickIndex < clickIndex);
  const active = [...phases].reverse().find((phase) => phase.clickIndex === clickIndex);
  if (!active) return { hidden: pendingEntrance || completedExit, className: "" };
  let className = "";
  if (active.kind === "emphasis") className = "build-pulse";
  else if (active.effect === "fade" || active.effect === "appear") className = active.kind === "exit" ? "build-fade-out" : "build-fade-in";
  else if (active.effect === "scale") className = active.kind === "exit" ? "build-scale-out" : "build-scale-in";
  else if (active.effect === "slide") className = active.kind === "exit" ? "build-slide-out" : "build-slide-in";
  else if (active.effect === "wipe") className = active.kind === "exit" ? "build-wipe-out" : "build-wipe-in";
  else if (active.effect === "pulse") className = "build-pulse";
  return { hidden: active.kind === "entrance" ? false : pendingEntrance || completedExit, className, phase: active };
}

function elementHtml(element: AnyRecord, motion: SlideMotion | undefined, clickIndex: number): string {
  const g = element.geometry;
  const build = buildStateFor(element.id, motion, clickIndex);
  const vector = buildVector(build.phase);
  const common = `data-presenter-element="${esc(element.id)}" data-build-hidden="${build.hidden ? "true" : "false"}" class="pitch-presenter-el ${build.className}" style="left:${g.x}px;top:${g.y}px;width:${g.width}px;height:${g.height}px;z-index:${element.zIndex};--base-opacity:${element.opacity ?? 1};opacity:${element.opacity ?? 1};--rotation:${g.rotation || 0}deg;--scale-x:1;--scale-y:1;--track-x:0px;--track-y:0px;--build-x:${vector.x};--build-y:${vector.y};--motion-duration:${(build.phase?.durationMs ?? 400) / 1000}s;--motion-delay:${(build.phase?.relativeStartMs ?? 0) / 1000}s;transform:translate(var(--track-x),var(--track-y)) rotate(var(--rotation)) scale(var(--scale-x),var(--scale-y));`;
  if (element.type === "text") return `<div ${common} style="${common.match(/style=\"([^\"]*)/)?.[1] ?? ""};display:flex;flex-direction:column;justify-content:${element.verticalAlign === "middle" ? "center" : element.verticalAlign === "bottom" ? "flex-end" : "flex-start"};overflow:hidden">${textHtml(element)}</div>`;
  if (element.type === "shape" || element.type === "frame") {
    const fill = element.fill || "transparent"; const stroke = element.stroke ? `${element.stroke.widthDU}px solid ${esc(element.stroke.color)}` : "none"; const radius = element.type === "shape" && element.shape === "ellipse" ? "50%" : `${element.radiusDU || 0}px`;
    return `<div ${common} style="${common.match(/style=\"([^\"]*)/)?.[1] ?? ""};background:${esc(fill)};border:${stroke};border-radius:${radius};${element.clipContent ? "overflow:hidden" : ""}"></div>`;
  }
  if (element.type === "line") return `<svg ${common} style="${common.match(/style=\"([^\"]*)/)?.[1] ?? ""};overflow:visible"><line x1="${element.start[0]}" y1="${element.start[1]}" x2="${element.end[0]}" y2="${element.end[1]}" stroke="${esc(element.stroke.color)}" stroke-width="${element.stroke.widthDU}"/></svg>`;
  if (element.type === "image") return `<div ${common} style="${common.match(/style=\"([^\"]*)/)?.[1] ?? ""};border-radius:${element.cornerRadiusDU || 0}px;background:#1d232b;display:grid;place-items:center;color:#75808f;font:22px system-ui">IMAGE · ${esc(element.assetId)}</div>`;
  if (element.type === "table") return `<div ${common} style="${common.match(/style=\"([^\"]*)/)?.[1] ?? ""};background:#fff;border:1px solid #d7dce3;padding:10px;font:18px system-ui;overflow:hidden">${element.rows.map((row: AnyRecord[]) => `<div>${row.map((cell: AnyRecord) => esc(cell.text)).join(" · ")}</div>`).join("")}</div>`;
  if (element.type === "chart") return `<div ${common} style="${common.match(/style=\"([^\"]*)/)?.[1] ?? ""};border:1px solid #d7dce3;padding:18px;font:20px system-ui">Chart · ${esc(element.chart?.chartType || "data")}</div>`;
  return `<div ${common} style="${common.match(/style=\"([^\"]*)/)?.[1] ?? ""};border:1px dashed #9aa3af"></div>`;
}

function fitStage(): void {
  const wrap = document.querySelector<HTMLElement>(".pitch-presenter-wrap"); const stage = document.getElementById("pitchPresenterStage"); if (!wrap || !stage) return;
  const maxWidth = Math.min(window.innerWidth * .92, (window.innerHeight - 94) * (16 / 9)); const scale = maxWidth / 1920;
  wrap.style.width = `${1920 * scale}px`; wrap.style.height = `${1080 * scale}px`; stage.style.transform = `scale(${scale})`;
}

function applyTrackFrame(project: AnyRecord): void {
  if (!open || !presenterState) return;
  const view = presenterView(project.deck, project.motion, presenterState, Date.now());
  const motion = slideMotion(project, view.currentSlide.id); if (!motion) return;
  const timeMs = Math.max(0, Date.now() - presenterState.slideEnteredAtMs);
  for (const [elementId, sampled] of sampleSlideMotion(motion, timeMs)) {
    const node = document.querySelector<HTMLElement>(`#pitchPresenterStage [data-presenter-element="${CSS.escape(elementId)}"]`); if (!node) continue;
    const model = view.currentSlide.scene.find((element: AnyRecord) => element.id === elementId); if (!model) continue;
    if (sampled.geometry?.x !== undefined) node.style.left = `${sampled.geometry.x}px`;
    if (sampled.geometry?.y !== undefined) node.style.top = `${sampled.geometry.y}px`;
    if (sampled.geometry?.width !== undefined) node.style.width = `${Math.max(1, sampled.geometry.width)}px`;
    if (sampled.geometry?.height !== undefined) node.style.height = `${Math.max(1, sampled.geometry.height)}px`;
    if (sampled.geometry?.rotation !== undefined) node.style.setProperty("--rotation", `${sampled.geometry.rotation}deg`);
    if (sampled.opacity !== undefined) { node.style.setProperty("--base-opacity", String(sampled.opacity)); node.style.opacity = String(sampled.opacity); }
    if (sampled.scaleX !== undefined) node.style.setProperty("--scale-x", String(sampled.scaleX));
    if (sampled.scaleY !== undefined) node.style.setProperty("--scale-y", String(sampled.scaleY));
  }
}

function loop(): void {
  cancelAnimationFrame(raf); const editor = runtime(); const project = editor?.getProject();
  if (!open || !project || !presenterState) return;
  applyTrackFrame(project);
  if (shouldAutoAdvance(project.deck, project.motion, presenterState, Date.now())) { presenterState = advancePresenter(project.deck, project.motion, presenterState, Date.now()); render(); }
  raf = requestAnimationFrame(loop);
}

function render(): void {
  const root = document.getElementById("pitchPresenter"); const editor = runtime(); const project = editor?.getProject(); if (!root || !editor || !project) return;
  root.classList.toggle("open", open); if (!open) { cancelAnimationFrame(raf); return; }
  if (!presenterState) presenterState = createPresenterState(project.deck, Date.now());
  const view = presenterView(project.deck, project.motion, presenterState, Date.now()); const motion = slideMotion(project, view.currentSlide.id);
  const slideChanged = lastRenderedSlideId !== view.currentSlide.id; lastRenderedSlideId = view.currentSlide.id;
  const transition = slideChanged ? motion?.transition : undefined; const transitionClass = transition && transition.type !== "none" ? ` transition-${transition.type}` : "";
  root.innerHTML = `<div class="pitch-presenter-main" data-presenter-advance>
      <div class="pitch-presenter-wrap"><div id="pitchPresenterStage" class="pitch-presenter-stage${transitionClass}" style="--transition-duration:${(transition?.durationMs ?? 0) / 1000}s">${[...view.currentSlide.scene].sort((a: AnyRecord,b: AnyRecord) => a.zIndex-b.zIndex).map((element: AnyRecord) => elementHtml(element,motion,view.build.activeClickIndex)).join("")}</div></div>
      <div class="pitch-presenter-hint">Click / → next · ← back · N notes · Esc close</div>
      <div class="pitch-presenter-notes ${notesOpen ? "open" : ""}">${view.speakerNotes ? esc(view.speakerNotes) : "No speaker notes on this slide."}</div>
    </div>
    <div class="pitch-presenter-bar"><button data-presenter=back>←</button><button data-presenter=next>→</button><b>${view.slideNumber} / ${view.slideCount}</b><div class="pitch-presenter-progress"><span style="width:${view.progress * 100}%"></span></div><span>${esc(view.currentSlide.title)}</span><span>Build ${Math.max(0,view.build.activeClickIndex + 1)} / ${view.build.clickCount}</span><div class="pitch-presenter-spacer"></div><button data-presenter=notes>Notes</button><button data-presenter=fullscreen>Fullscreen</button><button data-presenter=close>Close</button></div>`;
  root.querySelector("[data-presenter-advance]")?.addEventListener("click", () => next());
  root.querySelector("[data-presenter=back]")?.addEventListener("click", (event) => { event.stopPropagation(); back(); });
  root.querySelector("[data-presenter=next]")?.addEventListener("click", (event) => { event.stopPropagation(); next(); });
  root.querySelector("[data-presenter=notes]")?.addEventListener("click", (event) => { event.stopPropagation(); notesOpen = !notesOpen; render(); });
  root.querySelector("[data-presenter=fullscreen]")?.addEventListener("click", (event) => { event.stopPropagation(); void root.requestFullscreen?.(); });
  root.querySelector("[data-presenter=close]")?.addEventListener("click", (event) => { event.stopPropagation(); close(); });
  requestAnimationFrame(fitStage); loop();
}

function next(): void { const project = runtime()?.getProject(); if (!project || !presenterState) return; presenterState = advancePresenter(project.deck, project.motion, presenterState, Date.now()); if (presenterState.finished) { close(); return; } render(); }
function back(): void { const project = runtime()?.getProject(); if (!project || !presenterState) return; presenterState = retreatPresenter(project.deck, project.motion, presenterState, Date.now()); render(); }
function close(): void { open = false; presenterState = null; lastRenderedSlideId = null; cancelAnimationFrame(raf); if (document.fullscreenElement) void document.exitFullscreen?.(); render(); }
function openPresenter(): void {
  const editor = runtime(); const project = editor?.getProject(); const currentSlide = editor?.getSlide(); if (!editor || !project) return;
  presenterState = createPresenterState(project.deck, Date.now()); const index = currentSlide ? project.deck.slides.findIndex((slide: AnyRecord) => slide.id === currentSlide.id) : 0;
  if (index > 0) presenterState = jumpToSlide(project.deck, presenterState, index, Date.now()); open = true; notesOpen = false; lastRenderedSlideId = null; render();
}

export function installPitchPresenterUI(): void {
  const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);
  const top = document.querySelector<HTMLElement>(".spike-top"); const spacer = top?.querySelector<HTMLElement>(".spacer");
  if (top && spacer) { const button = document.createElement("button"); button.className = "spike-btn pitch-present-toggle"; button.textContent = "Present"; button.addEventListener("click", openPresenter); top.insertBefore(button, spacer); }
  const root = document.createElement("div"); root.id = "pitchPresenter"; root.className = "pitch-presenter"; document.body.appendChild(root);
  window.addEventListener("resize", fitStage);
  window.addEventListener("keydown", (event) => {
    if (!open) return;
    if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "ArrowRight" || event.key === " " || event.key === "Enter") { event.preventDefault(); next(); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); back(); }
    else if (event.key.toLowerCase() === "n") { event.preventDefault(); notesOpen = !notesOpen; render(); }
  }, true);
}
