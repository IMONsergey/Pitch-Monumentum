import type { DeckDocument, Paint, SceneElement, TextRun, VectorPathCommand } from "../../deck-model/src/index.js";
import type { MotionDocument, SlideMotion } from "../../motion-engine/src/index.js";

export interface WebExportAsset {
  assetId: string;
  mimeType: string;
  base64: string;
}
export interface WebExportResult { html: string; warnings: string[]; }

function esc(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function cssFont(value: string): string { return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`; }
function cssColor(value: string | undefined, fallback = "transparent"): string { return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback; }
function rgba(color: string, opacity = 1): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
  const raw = color.slice(1);
  const r = parseInt(raw.slice(0, 2), 16), g = parseInt(raw.slice(2, 4), 16), b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, opacity))})`;
}
function style(parts: Array<string | undefined | false>): string { return parts.filter(Boolean).join(";"); }
function ptToDU(value: number | undefined, duPerInch: number): number | undefined { return value === undefined ? undefined : value * duPerInch / 72; }
function effectsStyle(element: SceneElement): string | undefined {
  const shadows = (element.effects ?? []).filter((effect) => effect.kind === "dropShadow");
  if (!shadows.length) return undefined;
  return `filter:${shadows.map((shadow) => `drop-shadow(${shadow.offsetXDU}px ${shadow.offsetYDU}px ${shadow.blurDU}px ${rgba(shadow.color, shadow.opacity)})`).join(" ")}`;
}
function base(element: SceneElement): string {
  const g = element.geometry;
  return style([
    "position:absolute",
    `left:${g.x}px`, `top:${g.y}px`, `width:${g.width}px`, `height:${g.height}px`,
    `z-index:${element.zIndex}`, `opacity:${element.opacity ?? 1}`,
    `transform:rotate(${g.rotation ?? 0}deg)`, "transform-origin:center center", "box-sizing:border-box",
    effectsStyle(element), element.locked ? "pointer-events:none" : undefined,
  ]);
}
function backgroundPaint(paint: Paint | undefined, fallback?: string): string {
  if (!paint) return cssColor(fallback);
  if (paint.kind === "none") return "transparent";
  if (paint.kind === "solid") return rgba(paint.color, paint.opacity ?? 1);
  const stops = paint.stops.map((stop) => `${rgba(stop.color, stop.opacity ?? 1)} ${Math.round(stop.position * 10000) / 100}%`).join(",");
  return `linear-gradient(${paint.angleDeg}deg,${stops})`;
}
function run(run: TextRun, duPerInch: number): string {
  const fontSize = ptToDU(run.fontSizePt, duPerInch);
  const letterSpacing = ptToDU(run.letterSpacingPt, duPerInch);
  return `<span style="${style([
    run.bold ? "font-weight:700" : undefined,
    run.italic ? "font-style:italic" : undefined,
    run.underline ? "text-decoration:underline" : undefined,
    run.color ? `color:${cssColor(run.color, "#111111")}` : undefined,
    run.fontFamily ? `font-family:${cssFont(run.fontFamily)},sans-serif` : undefined,
    fontSize !== undefined ? `font-size:${fontSize}px` : undefined,
    letterSpacing !== undefined ? `letter-spacing:${letterSpacing}px` : undefined,
  ])}">${esc(run.text)}</span>`;
}
function textElement(element: Extract<SceneElement, { type: "text" }>, duPerInch: number): string {
  const paragraphs = element.paragraphs.map((paragraph) => {
    const before = ptToDU(paragraph.spaceBeforePt, duPerInch);
    const after = ptToDU(paragraph.spaceAfterPt, duPerInch);
    const bullet = paragraph.bullet ? `<span aria-hidden="true" style="display:inline-block;min-width:${18 + paragraph.bullet.level * 18}px">${esc(paragraph.bullet.marker ?? "•")}</span>` : "";
    return `<div style="${style([
      `text-align:${paragraph.align ?? "left"}`,
      paragraph.lineSpacing ? `line-height:${paragraph.lineSpacing}` : undefined,
      before ? `margin-top:${before}px` : undefined,
      after ? `margin-bottom:${after}px` : undefined,
      paragraph.bullet ? "display:flex" : undefined,
    ])}">${bullet}<span>${paragraph.runs.map((item) => run(item, duPerInch)).join("")}</span></div>`;
  }).join("");
  const justify = element.verticalAlign === "middle" ? "center" : element.verticalAlign === "bottom" ? "flex-end" : "flex-start";
  const insets = element.insetsDU ?? [0, 0, 0, 0];
  return `<div class="pitch-el" data-pitch-id="${esc(element.id)}" style="${base(element)};display:flex;flex-direction:column;justify-content:${justify};overflow:hidden;white-space:pre-wrap;padding:${insets[0]}px ${insets[1]}px ${insets[2]}px ${insets[3]}px">${paragraphs}</div>`;
}
function pathData(commands: VectorPathCommand[]): string {
  return commands.map((command) => {
    if (command.command === "M" || command.command === "L") return `${command.command}${command.x} ${command.y}`;
    if (command.command === "C") return `C${command.x1} ${command.y1} ${command.x2} ${command.y2} ${command.x} ${command.y}`;
    if (command.command === "Q") return `Q${command.x1} ${command.y1} ${command.x} ${command.y}`;
    return "Z";
  }).join(" ");
}
function shapeElement(element: Extract<SceneElement, { type: "shape" }>): string {
  const stroke = element.stroke ? `border:${element.stroke.widthDU}px ${element.stroke.dash === "dash" ? "dashed" : element.stroke.dash === "dot" ? "dotted" : "solid"} ${cssColor(element.stroke.color)}` : undefined;
  const background = backgroundPaint(element.fillPaint, element.fill);
  if (element.shape === "triangle") return `<div class="pitch-el" data-pitch-id="${esc(element.id)}" style="${base(element)}"><svg width="100%" height="100%" viewBox="0 0 ${element.geometry.width} ${element.geometry.height}"><polygon points="${element.geometry.width / 2},0 ${element.geometry.width},${element.geometry.height} 0,${element.geometry.height}" fill="${cssColor(element.fill)}" ${element.stroke ? `stroke="${cssColor(element.stroke.color)}" stroke-width="${element.stroke.widthDU}"` : ""}/></svg></div>`;
  if (element.shape === "custom" && (element.svgPath || element.pathData)) {
    const path = element.svgPath || pathData(element.pathData?.commands ?? []);
    return `<div class="pitch-el" data-pitch-id="${esc(element.id)}" style="${base(element)}"><svg width="100%" height="100%" viewBox="0 0 ${element.geometry.width} ${element.geometry.height}"><path d="${esc(path)}" fill="${cssColor(element.fill)}" fill-rule="${element.pathData?.fillRule ?? "nonzero"}" ${element.stroke ? `stroke="${cssColor(element.stroke.color)}" stroke-width="${element.stroke.widthDU}"` : ""}/></svg></div>`;
  }
  return `<div class="pitch-el" data-pitch-id="${esc(element.id)}" style="${base(element)};background:${background};${stroke ?? ""};border-radius:${element.shape === "ellipse" ? "50%" : element.shape === "roundRect" ? `${element.radiusDU ?? 18}px` : `${element.radiusDU ?? 0}px`}"></div>`;
}
function frameElement(element: Extract<SceneElement, { type: "frame" }>): string {
  return `<div class="pitch-el" data-pitch-id="${esc(element.id)}" style="${base(element)};background:${backgroundPaint(element.fillPaint, element.fill)};border-radius:${element.radiusDU ?? 0}px;${element.stroke ? `border:${element.stroke.widthDU}px ${element.stroke.dash === "dash" ? "dashed" : element.stroke.dash === "dot" ? "dotted" : "solid"} ${cssColor(element.stroke.color)}` : ""};${element.clipContent ? "overflow:hidden" : "overflow:visible"}"></div>`;
}
function lineElement(element: Extract<SceneElement, { type: "line" }>): string {
  const s = element.start, e = element.end;
  return `<div class="pitch-el" data-pitch-id="${esc(element.id)}" style="${base(element)};overflow:visible"><svg width="100%" height="100%" viewBox="0 0 ${Math.max(1, element.geometry.width)} ${Math.max(1, element.geometry.height)}" overflow="visible"><line x1="${s[0]}" y1="${s[1]}" x2="${e[0]}" y2="${e[1]}" stroke="${cssColor(element.stroke.color, "#111111")}" stroke-width="${element.stroke.widthDU}" ${element.stroke.dash === "dash" ? 'stroke-dasharray="8 6"' : element.stroke.dash === "dot" ? 'stroke-dasharray="2 5"' : ""}/></svg></div>`;
}
function imageStyle(element: Extract<SceneElement, { type: "image" }>): string {
  const crop = element.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const vw = Math.max(.001, 1 - crop.left - crop.right), vh = Math.max(.001, 1 - crop.top - crop.bottom);
  const focal = element.focalPoint ?? { x: .5, y: .5 };
  const px = Math.max(0, Math.min(1, (focal.x - crop.left) / vw)) * 100, py = Math.max(0, Math.min(1, (focal.y - crop.top) / vh)) * 100;
  return `position:absolute;left:${-(crop.left / vw) * 100}%;top:${-(crop.top / vh) * 100}%;width:${100 / vw}%;height:${100 / vh}%;object-fit:${element.fit === "stretch" ? "fill" : element.fit};object-position:${px}% ${py}%`;
}
function mediaElement(element: Extract<SceneElement, { type: "image" | "icon" }>, assets: Record<string, WebExportAsset>): string {
  const asset = assets[element.assetId], uri = asset ? `data:${asset.mimeType};base64,${asset.base64}` : "";
  if (element.type === "icon") return `<div class="pitch-el" data-pitch-id="${esc(element.id)}" style="${base(element)};overflow:hidden"><img src="${uri}" alt="" style="width:100%;height:100%;object-fit:contain"/></div>`;
  const clipPath = element.clipShape === "ellipse" ? "clip-path:ellipse(50% 50% at 50% 50%)" : undefined;
  return `<div class="pitch-el" data-pitch-id="${esc(element.id)}" style="${base(element)};overflow:hidden;border-radius:${element.cornerRadiusDU ?? 0}px;${clipPath ?? ""}"><img src="${uri}" alt="${esc(element.alt ?? "")}" style="${imageStyle(element)}"/></div>`;
}
function tableElement(element: Extract<SceneElement, { type: "table" }>, duPerInch: number): string {
  return `<div class="pitch-el" data-pitch-id="${esc(element.id)}" style="${base(element)};overflow:hidden"><table style="width:100%;height:100%;border-collapse:collapse;font:${ptToDU(12, duPerInch)}px/1.2 Inter,sans-serif">${element.rows.map((row) => `<tr>${row.map((cell) => `<td colspan="${cell.colspan ?? 1}" rowspan="${cell.rowspan ?? 1}" style="border:1px solid #D8DDE3;padding:${duPerInch / 20}px">${esc(cell.text)}</td>`).join("")}</tr>`).join("")}</table></div>`;
}
function chartElement(element: Extract<SceneElement, { type: "chart" }>): string {
  const chart = element.chart, values = chart.series.flatMap((series) => series.values), max = Math.max(1, ...values.map((value) => Math.abs(value)));
  if (["column", "bar"].includes(chart.chartType)) {
    const series = chart.series[0]?.values ?? [];
    return `<div class="pitch-el" data-pitch-id="${esc(element.id)}" style="${base(element)};display:flex;align-items:flex-end;gap:8px;padding:12px;border:1px solid #E0E4E8">${series.map((value) => `<div style="flex:1;height:${Math.abs(value) / max * 90}%;background:#4B75FF;min-width:3px"></div>`).join("")}</div>`;
  }
  return `<div class="pitch-el" data-pitch-id="${esc(element.id)}" style="${base(element)};display:grid;place-items:center;border:1px solid #D8DDE3;color:#6B7280;font:18px Inter,sans-serif">${esc(chart.chartType.toUpperCase())} · ${esc(chart.insightStatement)}</div>`;
}
function renderElement(element: SceneElement, assets: Record<string, WebExportAsset>, warnings: string[], slideId: string, duPerInch: number): string {
  if (element.type === "text") return textElement(element, duPerInch);
  if (element.type === "shape") return shapeElement(element);
  if (element.type === "frame") return frameElement(element);
  if (element.type === "line") return lineElement(element);
  if (element.type === "image" || element.type === "icon") return mediaElement(element, assets);
  if (element.type === "table") return tableElement(element, duPerInch);
  if (element.type === "chart") return chartElement(element);
  if (element.type === "group") return "";
  warnings.push(`${slideId}:${element.id} ${element.type} uses web fallback metadata and is not fully rendered`);
  return `<div class="pitch-el" data-pitch-id="${esc(element.id)}" style="${base(element)};display:grid;place-items:center;border:1px dashed #AEB6C0;color:#7A8490">${esc(element.type)}</div>`;
}
function motionFor(motion: MotionDocument | undefined, slideId: string): SlideMotion | undefined { return motion?.slides.find((slide) => slide.slideId === slideId); }
function motionJson(motion: MotionDocument | undefined) { return JSON.stringify(motion ?? { schemaVersion: "0.1", deckId: "", slides: [] }).replace(/</g, "\\u003c"); }

export function exportStandaloneWeb(deck: DeckDocument, assets: Record<string, WebExportAsset>, motion?: MotionDocument): WebExportResult {
  const warnings: string[] = [];
  for (const slide of deck.slides) for (const element of slide.scene) if ((element.type === "image" || element.type === "icon") && !assets[element.assetId]) warnings.push(`${slide.id}:${element.id} missing embedded asset ${element.assetId}`);
  const slides = [...deck.slides].sort((a, b) => a.order - b.order).map((slide, index) => `<section class="pitch-slide ${index === 0 ? "active" : ""}" data-slide-id="${esc(slide.id)}" data-index="${index}" style="width:${deck.canvas.widthDU}px;height:${deck.canvas.heightDU}px">${[...slide.scene].sort((a, b) => a.zIndex - b.zIndex).map((element) => renderElement(element, assets, warnings, slide.id, deck.canvas.duPerInch)).join("")}<aside class="pitch-notes">${esc(slide.speakerNotes ?? "")}</aside></section>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(deck.title)}</title><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#090b0e;overflow:hidden;font-family:Inter,system-ui,sans-serif}.pitch-viewport{position:absolute;inset:0;display:grid;place-items:center}.pitch-stage{width:${deck.canvas.widthDU}px;height:${deck.canvas.heightDU}px;position:relative;transform-origin:center}.pitch-slide{position:absolute;inset:0;display:none;background:white;overflow:hidden;box-shadow:0 25px 90px #0008}.pitch-slide.active{display:block}.pitch-el{box-sizing:border-box}.pitch-ui{position:fixed;left:14px;right:14px;bottom:12px;z-index:9999;display:flex;align-items:center;gap:8px;color:#c8cdd4;font:11px system-ui;pointer-events:none}.pitch-ui .bar{height:2px;background:#ffffff25;flex:1}.pitch-ui .bar i{display:block;height:100%;background:#fff;width:0}.pitch-notes{display:none}.pitch-build-hidden{opacity:0!important}.pitch-pulse{animation:pitchPulse .45s ease}@keyframes pitchPulse{50%{transform:scale(1.04)}}@media print{html,body{overflow:visible;background:white}.pitch-viewport{position:static;display:block}.pitch-stage{transform:none!important;width:auto;height:auto}.pitch-slide{position:relative;display:block!important;page-break-after:always;box-shadow:none}}</style></head><body><div class="pitch-viewport"><main class="pitch-stage">${slides}</main></div><div class="pitch-ui"><span id="pitchCounter">1 / ${deck.slides.length}</span><div class="bar"><i id="pitchProgress"></i></div></div><script id="pitchMotion" type="application/json">${motionJson(motion)}</script><script>(()=>{const slides=[...document.querySelectorAll('.pitch-slide')],motion=JSON.parse(document.getElementById('pitchMotion').textContent||'{}');let index=0,buildIndex=0,phases=[];const stage=document.querySelector('.pitch-stage'),counter=document.getElementById('pitchCounter'),progress=document.getElementById('pitchProgress');function fit(){const s=Math.min(innerWidth/${deck.canvas.widthDU},innerHeight/${deck.canvas.heightDU});stage.style.transform='scale('+s+')'}function slideMotion(id){return(motion.slides||[]).find(s=>s.slideId===id)}function compile(builds){const result=[];for(const b of builds||[]){if(!result.length||b.trigger==='onClick')result.push([b]);else result[result.length-1].push(b)}return result}function reset(){const s=slides[index],m=slideMotion(s.dataset.slideId);phases=compile(m?.builds);buildIndex=0;s.querySelectorAll('.pitch-el').forEach(n=>{n.classList.remove('pitch-build-hidden','pitch-pulse');n.style.opacity=''});for(const b of m?.builds||[])if(b.kind==='entrance')for(const id of b.elementIds||[])s.querySelector('[data-pitch-id="'+CSS.escape(id)+'"]')?.classList.add('pitch-build-hidden')}function show(next){if(next<0||next>=slides.length)return;slides[index]?.classList.remove('active');index=next;slides[index].classList.add('active');reset();counter.textContent=(index+1)+' / '+slides.length;progress.style.width=((index+1)/slides.length*100)+'%'}function applyPhase(){if(buildIndex>=phases.length)return false;for(const b of phases[buildIndex++])for(const id of b.elementIds||[]){const n=slides[index].querySelector('[data-pitch-id="'+CSS.escape(id)+'"]');if(!n)continue;if(b.kind==='entrance')n.classList.remove('pitch-build-hidden');else if(b.kind==='exit')n.classList.add('pitch-build-hidden');else{n.classList.remove('pitch-pulse');void n.offsetWidth;n.classList.add('pitch-pulse')}}return true}function next(){if(!applyPhase())show(index+1)}function prev(){show(index-1)}addEventListener('resize',fit);addEventListener('keydown',e=>{if(['ArrowRight',' ','PageDown','Enter'].includes(e.key)){e.preventDefault();next()}if(['ArrowLeft','PageUp'].includes(e.key)){e.preventDefault();prev()}if(e.key==='Home')show(0);if(e.key==='End')show(slides.length-1)});addEventListener('click',e=>{if(e.clientX<innerWidth*.25)prev();else next()});fit();show(0)})();</script></body></html>`;
  if (motion?.slides.some((slide) => slide.tracks.length)) warnings.push("Standalone Web export currently preserves builds but does not play exact keyframe tracks; use Pitch Presenter for full keyframe playback.");
  for (const slide of deck.slides) if (motionFor(motion, slide.id)?.tracks.length) warnings.push(`${slide.id}: exact motion keyframe tracks are not rendered in standalone Web`);
  return { html, warnings: [...new Set(warnings)] };
}
