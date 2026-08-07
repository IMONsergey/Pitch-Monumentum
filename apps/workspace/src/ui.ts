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
