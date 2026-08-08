type AnyRecord = Record<string, any>;

const style = `
  .pitch-export-btn{height:30px;border:1px solid #4e5a68;background:#1a2129;color:#e9edf2;border-radius:7px;padding:0 10px;cursor:pointer;font-size:11px;font-weight:600}.pitch-export-btn:hover{border-color:#c7ff5e}
  .pitch-export-overlay{position:fixed;inset:0;background:rgba(4,7,10,.68);backdrop-filter:blur(5px);z-index:10010;display:grid;place-items:center;padding:24px}.pitch-export-modal{width:min(820px,94vw);max-height:84vh;overflow:auto;border:1px solid #303845;background:#11161c;border-radius:14px;box-shadow:0 28px 80px rgba(0,0,0,.45);padding:18px}.pitch-export-head{display:flex;gap:12px;align-items:flex-start;margin-bottom:14px}.pitch-export-head h3{margin:0;font-size:15px}.pitch-export-head p{margin:3px 0 0;color:#818b99;font-size:10px}.pitch-export-close{margin-left:auto;width:28px;height:28px;border:1px solid var(--line);border-radius:7px;background:#171c23;color:#aab3c0;cursor:pointer}
  .pitch-export-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.pitch-export-card{border:1px solid #2b333e;background:#0d1217;border-radius:10px;padding:13px;display:flex;flex-direction:column;min-height:210px}.pitch-export-card h4{margin:0;font-size:13px}.pitch-export-card p{margin:5px 0 12px;color:#7c8795;font-size:9px;line-height:1.45}.pitch-export-run{height:31px;border:1px solid #384351;background:#171d24;color:#e4e8ee;border-radius:7px;cursor:pointer;font-size:10px;margin-top:auto}.pitch-export-run:hover{border-color:#c7ff5e}.pitch-export-status{min-height:56px;margin:9px 0;color:#8d98a6;font:9px/1.5 ui-monospace,SFMono-Regular,monospace;white-space:pre-wrap;word-break:break-word}.pitch-export-download{display:none;height:29px;align-items:center;justify-content:center;border-radius:7px;background:#c7ff5e;color:#080b0e;text-decoration:none;font-size:10px;font-weight:700;margin-top:6px}.pitch-export-download.visible{display:flex}.pitch-export-note{margin-top:12px;padding:9px;border:1px solid #27303a;border-radius:8px;color:#778291;font-size:9px;line-height:1.5}
  @media(max-width:760px){.pitch-export-grid{grid-template-columns:1fr}}
`;

function status(message: string): void {
  const node = document.getElementById("spikeStatus");
  if (node) node.textContent = message;
}

async function api(path: string, options: RequestInit = {}): Promise<any> {
  const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function close(): void { document.getElementById("pitchExportOverlay")?.remove(); }

function formatPptx(result: AnyRecord): string {
  const manifest = result.manifest || {};
  const edit = manifest.editability || {};
  const roundTripCritical = (manifest.roundTripIssues || []).filter((issue: AnyRecord) => issue.severity === "critical").length;
  return [
    `ready: ${manifest.ready === true}`,
    `slides: ${manifest.slideCount ?? "?"}`,
    `native: ${edit.native ?? 0}`,
    `vector fallback: ${edit.vector ?? 0}`,
    `raster fallback: ${edit.rasterFallback ?? 0}`,
    `unsupported: ${edit.unsupported ?? 0}`,
    `round-trip critical: ${roundTripCritical}`,
  ].join("\n");
}

function formatFigma(result: AnyRecord): string {
  const warnings = result.warnings || [];
  return [`slides: ${result.slideCount ?? "?"}`, `embedded assets: ${result.assetCount ?? 0}`, `warnings: ${warnings.length}`, ...warnings.slice(0, 4).map((warning: AnyRecord) => `• ${warning.message || warning}`)].join("\n");
}

function wireExport(card: HTMLElement, endpoint: string, formatter: (result: AnyRecord) => string, label: string): void {
  const button = card.querySelector<HTMLButtonElement>("[data-export-run]")!;
  const output = card.querySelector<HTMLElement>("[data-export-status]")!;
  const download = card.querySelector<HTMLAnchorElement>("[data-export-download]")!;
  button.addEventListener("click", async () => {
    button.disabled = true;
    output.textContent = `Building ${label}…`;
    download.classList.remove("visible");
    try {
      const result = await api(endpoint, { method: "POST", body: "{}" });
      output.textContent = formatter(result);
      if (result.downloadUrl) {
        download.href = result.downloadUrl;
        download.download = "";
        download.classList.add("visible");
      }
      status(`${label} export ready`);
    } catch (error) {
      output.textContent = error instanceof Error ? error.message : String(error);
      status(`${label} export blocked`);
    } finally { button.disabled = false; }
  });
}

function show(): void {
  close();
  const overlay = document.createElement("div");
  overlay.id = "pitchExportOverlay";
  overlay.className = "pitch-export-overlay";
  overlay.innerHTML = `<div class="pitch-export-modal">
    <div class="pitch-export-head"><div><h3>Export Center</h3><p>All targets compile from the same canonical DeckDocument and original Asset Registry bytes.</p></div><button class="pitch-export-close" data-export-close>×</button></div>
    <div class="pitch-export-grid">
      <section class="pitch-export-card" data-export-card=pptx><h4>PowerPoint · PPTX</h4><p>Production gate, editable native objects, charts with embedded XLSX and round-trip validation.</p><div class="pitch-export-status" data-export-status>Not built yet.</div><button class="pitch-export-run" data-export-run>Build production PPTX</button><a class="pitch-export-download" data-export-download>Download PPTX</a></section>
      <section class="pitch-export-card" data-export-card=figma><h4>Figma / Figma Slides</h4><p>Self-contained Pitch bridge bundle. Import with our plugin to create native frames/slides, text, images, Auto Layout and editable chart/table primitives.</p><div class="pitch-export-status" data-export-status>Not built yet.</div><button class="pitch-export-run" data-export-run>Build Figma bundle</button><a class="pitch-export-download" data-export-download>Download bundle</a></section>
      <section class="pitch-export-card" data-export-card=keynote><h4>Apple Keynote · KEY</h4><p>macOS-only bridge: hard-gated native PPTX → Keynote import → real Keynote document. No reverse-engineered fake .key.</p><div class="pitch-export-status" data-export-status>Requires macOS + Keynote.</div><button class="pitch-export-run" data-export-run>Build Keynote</button><a class="pitch-export-download" data-export-download>Download KEY</a></section>
    </div>
    <div class="pitch-export-note"><b>Figma workflow:</b> install the Pitch Figma importer from <code>integrations/figma-plugin</code>, then select the downloaded <code>.pitch-figma.json</code>. In Figma Slides it creates real SlideNodes; in Figma Design it creates 1920×1080 frames.</div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("mousedown", event => { if (event.target === overlay) close(); });
  overlay.querySelector("[data-export-close]")?.addEventListener("click", close);
  wireExport(overlay.querySelector<HTMLElement>("[data-export-card=pptx]")!, "/api/export", formatPptx, "PowerPoint");
  wireExport(overlay.querySelector<HTMLElement>("[data-export-card=figma]")!, "/api/export/figma", formatFigma, "Figma");
  wireExport(overlay.querySelector<HTMLElement>("[data-export-card=keynote]")!, "/api/export/keynote", (result) => `output: ${result.outputPath || "ready"}\nPPTX gate: ready\nKeynote conversion: completed`, "Keynote");
}

export function installPitchExportCenterUI(): void {
  const styleNode = document.createElement("style");
  styleNode.textContent = style;
  document.head.appendChild(styleNode);
  const top = document.querySelector<HTMLElement>(".spike-top");
  const spacer = top?.querySelector<HTMLElement>(".spacer");
  if (!top || !spacer) return;
  const button = document.createElement("button");
  button.className = "pitch-export-btn";
  button.textContent = "Export";
  button.addEventListener("click", show);
  top.insertBefore(button, spacer);
}
