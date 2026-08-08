type AnyRecord = Record<string, any>;
type Runtime = {
  getProject(): AnyRecord | null;
  getSlide(): AnyRecord | undefined;
  command(input: AnyRecord): Promise<AnyRecord>;
  select(ids: string[]): void;
};

const css = `
  .pitch-data-tools{display:flex;gap:3px;align-items:center;padding-right:6px;margin-right:3px;border-right:1px solid var(--line)}
  .pitch-data-tool{height:30px;border:1px solid var(--line);background:#151a20;color:var(--text);border-radius:7px;padding:0 8px;cursor:pointer;font-size:11px}.pitch-data-tool:hover{border-color:#4b5666;background:#1b2129}
  .pitch-render-table{width:100%;height:100%;border-collapse:collapse;font:18px/1.2 Inter,system-ui;background:#fff;color:#111;pointer-events:none}.pitch-render-table td{border:1px solid #ccd2da;padding:8px 10px;overflow:hidden}.pitch-render-table tr:first-child td{font-weight:700;background:#eef1f4}
  .pitch-render-svg{display:block;width:100%;height:100%;overflow:visible;pointer-events:none}
`;

function runtime(): Runtime | undefined { return (window as any).__pitchEditorRuntime as Runtime | undefined; }
function status(message: string): void { const node = document.getElementById("spikeStatus"); if (node) node.textContent = message; }

async function insert(command: AnyRecord): Promise<void> {
  const editor = runtime(); const slide = editor?.getSlide();
  if (!editor || !slide) return;
  try {
    const result = await editor.command({ ...command, slideId: slide.id });
    if (result.nextSelectionIds?.length) editor.select(result.nextSelectionIds);
  } catch (error) { status(`Insert failed: ${error instanceof Error ? error.message : String(error)}`); }
}

function installToolbar(): void {
  const top = document.querySelector<HTMLElement>(".spike-top");
  const spacer = top?.querySelector<HTMLElement>(".spacer");
  if (!top || !spacer) return;
  const group = document.createElement("div"); group.className = "pitch-data-tools";
  group.innerHTML = `<button class="pitch-data-tool" data-data-tool=line>Line</button><button class="pitch-data-tool" data-data-tool=arrow>Arrow</button><button class="pitch-data-tool" data-data-tool=table>Table</button><button class="pitch-data-tool" data-data-tool=chart>Chart</button>`;
  top.insertBefore(group, spacer);
  group.querySelectorAll<HTMLButtonElement>("[data-data-tool]").forEach(button => button.addEventListener("click", () => {
    const tool = button.dataset.dataTool;
    if (tool === "line") void insert({ command: "insertLine", geometry: { x: 520, y: 530, width: 760, height: 1 }, stroke: { color: "#111111", widthDU: 3 } });
    if (tool === "arrow") void insert({ command: "insertLine", geometry: { x: 520, y: 530, width: 760, height: 1 }, stroke: { color: "#111111", widthDU: 3 }, endMarker: "arrow" });
    if (tool === "table") void insert({ command: "insertTable", geometry: { x: 380, y: 290, width: 1160, height: 500 } });
    if (tool === "chart") void insert({ command: "insertChart", geometry: { x: 360, y: 260, width: 1200, height: 600 }, chartType: "column" });
  }));
}

function lineSvg(element: AnyRecord): string {
  const width = Math.max(1, element.geometry.width), height = Math.max(12, element.geometry.height);
  const stroke = element.stroke?.color || "#111111", sw = Math.max(1, element.stroke?.widthDU || 2);
  const x1 = 2, y1 = height / 2, x2 = width - 8, y2 = height / 2;
  const arrow = element.endMarker === "arrow" ? `<defs><marker id="arrow-${element.id}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="${stroke}"/></marker></defs>` : "";
  const end = element.endMarker === "arrow" ? ` marker-end="url(#arrow-${element.id})"` : "";
  return `<svg class="pitch-render-svg" viewBox="0 0 ${width} ${height}">${arrow}<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}"${end}/></svg>`;
}

function tableHtml(element: AnyRecord): string {
  return `<table class="pitch-render-table"><tbody>${(element.rows ?? []).map((row: AnyRecord[]) => `<tr>${row.map(cell => `<td>${String(cell.text ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function chartSvg(element: AnyRecord): string {
  const chart = element.chart ?? {}; const categories: string[] = chart.categories ?? [];
  const series = chart.series?.[0]?.values ?? [];
  const width = 1000, height = 500, left = 70, bottom = 55, top = 35, plotW = width - left - 30, plotH = height - top - bottom;
  const max = Math.max(1, ...series.map((value: number) => Math.abs(value)));
  const labels = categories.map((category, index) => `<text x="${left + (index + .5) * plotW / Math.max(1,categories.length)}" y="${height-18}" text-anchor="middle" font-size="18" fill="#67717f">${category}</text>`).join("");
  if (chart.chartType === "line" || chart.chartType === "area") {
    const points = series.map((value: number, index: number) => `${left + (index + .5) * plotW / Math.max(1,series.length)},${top + plotH - Math.max(0,value) / max * plotH}`).join(" ");
    return `<svg class="pitch-render-svg" viewBox="0 0 ${width} ${height}"><line x1="${left}" y1="${top+plotH}" x2="${width-20}" y2="${top+plotH}" stroke="#ccd2da"/><polyline points="${points}" fill="${chart.chartType === "area" ? "rgba(51,92,255,.12)" : "none"}" stroke="#335cff" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>${labels}</svg>`;
  }
  const barW = plotW / Math.max(1,series.length) * .58;
  const bars = series.map((value: number, index: number) => { const h = Math.max(2, Math.abs(value) / max * plotH); const x = left + (index + .5)*plotW/Math.max(1,series.length)-barW/2; return `<rect x="${x}" y="${top+plotH-h}" width="${barW}" height="${h}" rx="8" fill="#335cff"/><text x="${x+barW/2}" y="${top+plotH-h-10}" text-anchor="middle" font-size="18" fill="#111">${value}</text>`; }).join("");
  return `<svg class="pitch-render-svg" viewBox="0 0 ${width} ${height}"><line x1="${left}" y1="${top+plotH}" x2="${width-20}" y2="${top+plotH}" stroke="#ccd2da"/>${bars}${labels}</svg>`;
}

function hydrate(): void {
  const project = runtime()?.getProject(); if (!project) return;
  const index = new Map<string,AnyRecord>((project.deck.slides ?? []).flatMap((slide:AnyRecord)=>slide.scene??[]).map((element:AnyRecord)=>[element.id,element]));
  document.querySelectorAll<HTMLElement>("#spikeScene .spike-el[data-id]").forEach(host => {
    const element = host.dataset.id ? index.get(host.dataset.id) : undefined; if (!element) return;
    if (element.type === "line") { host.innerHTML = lineSvg(element); host.style.border="0"; host.style.background="transparent"; }
    if (element.type === "table") { host.innerHTML = tableHtml(element); host.style.border="0"; host.style.background="transparent"; host.style.overflow="hidden"; }
    if (element.type === "chart") { host.innerHTML = chartSvg(element); host.style.border="0"; host.style.background="#fff"; }
  });
}

export function installPitchDataPrimitivesUI(): void {
  const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);
  installToolbar();
  window.addEventListener("pitch:editor-state", () => requestAnimationFrame(() => requestAnimationFrame(hydrate)));
  requestAnimationFrame(() => requestAnimationFrame(hydrate));
}
