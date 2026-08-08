export function workspaceHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Pitch Monumentum</title>
  <link rel="stylesheet" href="/workspace.css">
</head>
<body>
  <div class="app">
    <header class="top">
      <div class="brand">Pitch Monumentum</div>
      <div id="projectName" class="project">—</div>
      <select id="branchSelect" class="branch-select" title="Active branch"></select>
      <div class="spacer"></div>
      <a class="action" href="/editor-spike" style="text-decoration:none">Editor Engine</a>
      <div id="quality" class="pill">QA —</div>
      <button id="undoBtn" class="action" title="Undo on current branch">Undo</button>
      <button id="redoBtn" class="action" title="Redo on current branch">Redo</button>
      <button id="forkBtn" class="action">Fork</button>
      <button id="exportBtn" class="primary">Export PPTX</button>
    </header>
    <div class="shell">
      <aside class="left">
        <div class="tabs">
          <button class="tab active" data-view="slides">Slides</button>
          <button class="tab" data-view="story">Story</button>
          <button class="tab" data-view="critique">Critique</button>
        </div>
        <div id="leftContent"></div>
      </aside>
      <main class="center">
        <div class="canvas-stack">
          <div class="canvas-meta"><span id="canvasLabel">—</span><span class="spacer"></span><span>1920 × 1080 DU</span></div>
          <div id="stage" class="stage"><div id="scene" class="scene"></div></div>
        </div>
      </main>
      <aside class="right"><div id="inspector"></div></aside>
    </div>
    <footer class="bottom">
      <span class="status-dot"></span><span id="activity">PitchOS ready</span><span class="spacer"></span>
      <span>Object-level edits · branch-safe history · native PPTX</span>
    </footer>
  </div>
  <script src="/workspace.js" defer></script>
</body>
</html>`;
}

export function editorSpikeHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Pitch Editor Engine Spike</title>
  <style>
    :root{--bg:#090b0e;--panel:#111419;--line:#282e37;--text:#f3f5f7;--muted:#8c96a5;--accent:#c7ff5e;--blue:#78a9ff}*{box-sizing:border-box}html,body{height:100%}body{margin:0;background:var(--bg);color:var(--text);font:13px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;overflow:hidden}button,a{font:inherit}.spike-app{height:100vh;display:grid;grid-template-rows:56px 1fr 40px}.spike-top{display:flex;align-items:center;gap:10px;padding:0 14px;border-bottom:1px solid var(--line);background:#0d1014}.spike-top b{font-size:14px}.spike-top .sub{color:var(--muted)}.spacer{flex:1}.spike-btn{border:1px solid var(--line);background:#171b21;color:var(--text);padding:7px 10px;border-radius:8px;cursor:pointer;text-decoration:none}.spike-shell{min-height:0;display:grid;grid-template-columns:240px 1fr}.spike-left{background:var(--panel);border-right:1px solid var(--line);overflow:auto;padding:10px}.spike-thumb{display:block;width:100%;text-align:left;border:1px solid var(--line);background:#0d1014;color:var(--text);border-radius:9px;padding:9px;margin-bottom:8px;cursor:pointer}.spike-thumb.active{border-color:var(--accent)}.spike-thumb small{display:block;color:var(--muted);text-transform:uppercase;font-size:9px}.spike-thumb b{display:block;margin-top:4px}.spike-work{min-width:0;min-height:0;display:grid;grid-template-columns:32px 1fr;grid-template-rows:32px 1fr;background:#151920}.spike-corner{background:#0d1014;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}#spikeGuideX{grid-column:2;grid-row:1;background:#0d1014;border-bottom:1px solid var(--line);overflow:hidden}#spikeGuideY{grid-column:1;grid-row:2;background:#0d1014;border-right:1px solid var(--line);overflow:hidden}#spikeViewer{grid-column:2;grid-row:2;position:relative;overflow:hidden}.spike-stage{width:1920px;height:1080px;position:relative;background:#fff;box-shadow:0 28px 110px #000b}.spike-scene{position:absolute;inset:0}.spike-el{position:absolute;user-select:none;touch-action:none;cursor:default;overflow:hidden}.spike-el.selected{outline:3px solid var(--blue);outline-offset:3px}.spike-meta{position:absolute;top:12px;left:12px;z-index:50;background:#090b0ecc;color:#fff;padding:6px 9px;border-radius:7px;pointer-events:none}.spike-bottom{display:flex;align-items:center;gap:10px;padding:0 12px;border-top:1px solid var(--line);background:#0d1014;color:var(--muted);font-size:11px}#spikeSelection{color:var(--text)}
  </style>
</head>
<body>
<div class="spike-app">
  <header class="spike-top">
    <b>Pitch Editor Engine</b><span class="sub">Daybrush live integration spike</span>
    <div class="spacer"></div>
    <button id="spikeClearSelection" class="spike-btn">Clear selection</button>
    <button id="spikeRefresh" class="spike-btn">Reload scene</button>
    <a href="/" class="spike-btn">Back to Workspace</a>
  </header>
  <div class="spike-shell">
    <aside class="spike-left"><div id="spikeSlides"></div></aside>
    <main class="spike-work">
      <div class="spike-corner"></div>
      <div id="spikeGuideX"></div>
      <div id="spikeGuideY"></div>
      <div id="spikeViewer">
        <div id="spikeStage" class="spike-stage">
          <div class="spike-meta" id="spikeSlideLabel">—</div>
          <div id="spikeScene" class="spike-scene"></div>
        </div>
      </div>
    </main>
  </div>
  <footer class="spike-bottom"><span id="spikeStatus">Loading editor engine…</span><div class="spacer"></div><span id="spikeSelection">Nothing selected</span></footer>
</div>
<script src="/editor-spike.js" defer></script>
</body>
</html>`;
}
