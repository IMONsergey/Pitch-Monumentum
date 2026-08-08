(() => {
  const css = `
  .pitch-full-command-backdrop{position:fixed;z-index:2500;inset:0;display:none;align-items:flex-start;justify-content:center;padding-top:min(16vh,150px);background:#05060888;backdrop-filter:blur(8px)}.pitch-full-command-backdrop.open{display:flex}
  .pitch-full-command{width:min(660px,calc(100vw - 32px));max-height:min(640px,72vh);display:grid;grid-template-rows:auto 1fr;border:1px solid #323743;border-radius:15px;background:#0d1015f8;color:#edf0f4;box-shadow:0 34px 120px #000e;overflow:hidden;font:11px/1.4 Inter,system-ui,sans-serif}.pitch-full-command-search{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px;padding:10px 12px;border-bottom:1px solid #272c35;background:#11151b}.pitch-full-command-search strong{font-size:13px}.pitch-full-command-search input{min-width:0;height:34px;border:0;outline:0;background:transparent;color:#f1f3f6;font:13px Inter,system-ui,sans-serif}.pitch-full-command-search kbd{height:22px;display:flex;align-items:center;border:1px solid #39404b;border-radius:5px;padding:0 6px;color:#7e8997;background:#171c23;font:9px ui-monospace,SFMono-Regular,Menlo,monospace}
  .pitch-full-command-list{overflow:auto;padding:7px}.pitch-full-command-item{width:100%;display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;border:0;border-radius:8px;background:transparent;color:#c8d0d9;text-align:left;padding:8px 9px;cursor:pointer}.pitch-full-command-item:hover,.pitch-full-command-item.active{background:#1a212a;color:#fff}.pitch-full-command-item b{display:block;font-size:10px}.pitch-full-command-item small{display:block;margin-top:2px;color:#717e8c;font-size:8px}.pitch-full-command-item em{font-style:normal;color:#63717f;font-size:8px}.pitch-full-command-empty{padding:24px;text-align:center;color:#667381;font-size:9px}.pitch-full-command-group{padding:5px 9px 4px;color:#596572;font-size:7px;text-transform:uppercase;letter-spacing:.09em}
  `;

  const commands = new Map();
  let open = false;
  let query = '';
  let cursor = 0;
  let bypassLegacy = false;
  let sequence = 0;

  const normalize = (value) => String(value || '').trim().toLowerCase();
  const safeId = (value) => String(value || '').trim().replace(/[^a-zA-Z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '');
  const status = (message) => { const node = document.getElementById('spikeStatus'); if (node) node.textContent = message; };

  function register(input) {
    if (!input || typeof input.run !== 'function') throw new Error('Command registry requires a run() function');
    const id = safeId(input.id || `external-${++sequence}`);
    if (!id) throw new Error('Command registry id is required');
    const command = {
      id,
      title: String(input.title || id),
      description: String(input.description || ''),
      group: String(input.group || 'Extensions'),
      keywords: Array.isArray(input.keywords) ? input.keywords.map(String) : [],
      shortcut: input.shortcut ? String(input.shortcut) : '',
      order: Number.isFinite(input.order) ? input.order : 100,
      run: input.run,
    };
    commands.set(id, command);
    window.dispatchEvent(new CustomEvent('pitch:command-registry-change', { detail: { id, action: 'register' } }));
    if (open) render();
    return () => unregister(id);
  }
  function unregister(id) {
    const removed = commands.delete(String(id));
    if (removed) window.dispatchEvent(new CustomEvent('pitch:command-registry-change', { detail: { id, action: 'unregister' } }));
    if (open) render();
    return removed;
  }
  function list() { return [...commands.values()].map(({ run, ...meta }) => ({ ...meta })); }
  async function execute(id) {
    const command = commands.get(String(id));
    if (!command) throw new Error(`Unknown Pitch command ${id}`);
    close();
    try { await command.run(); status(`Command · ${command.title}`); }
    catch (error) { status(`Command failed: ${error instanceof Error ? error.message : String(error)}`); throw error; }
  }

  window.__pitchCommandRegistry = { register, unregister, list, execute, open: () => show(), close: () => close() };
  window.dispatchEvent(new CustomEvent('pitch:command-registry-ready', { detail: window.__pitchCommandRegistry }));

  function buttonByLabel(label) {
    return [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === label && !button.closest('#pitchFullCommandBackdrop'));
  }
  function clickSurface(label) {
    const button = buttonByLabel(label);
    if (!button) throw new Error(`${label} surface is not available in the current editor shell`);
    button.click();
  }
  function openLegacyPalette() {
    const button = buttonByLabel('Commands');
    if (!button) throw new Error('Core editor command palette is not available');
    bypassLegacy = true;
    try { button.click(); }
    finally { queueMicrotask(() => { bypassLegacy = false; }); }
  }

  const builtins = [
    ['core-palette','Editor commands','Object, slide, arrange, alignment, undo/redo and insert commands from the Pro Editor core.','Editor',['insert','duplicate','delete','group','ungroup','align','undo','redo','slide','rectangle','frame','text'],'⌘K',0,openLegacyPalette],
    ['assets','Assets','Open project-native Assets Library.','Create',['image','media','upload','asset'],null,20,()=>clickSurface('Assets')],
    ['motion','Motion','Open Motion Studio for transitions, builds and keyframe tracks.','Create',['animation','transition','build','keyframe'],null,21,()=>clickSurface('Motion')],
    ['components','Components','Open reusable Component System 2.0 library and linked instances.','Create',['component','instance','master','reuse'],null,22,()=>clickSurface('Components')],
    ['present','Present','Open Presenter from the current slide.','Present',['presenter','slideshow','fullscreen'],null,30,()=>clickSurface('Present')],
    ['design','Design System','Open live tokens, Brand QA and design-system migration controls.','System',['design','token','brand','theme','color','font'],null,40,()=>clickSurface('Design')],
    ['layouts','Slide Layouts','Open Slide Masters and Smart Layout recommendations.','System',['layout','master','placeholder','template'],null,41,()=>clickSurface('Layouts')],
    ['director','Creative Director','Open production review, guarded agent plans and Safe Fixes.','AI',['ai','codex','creative','review','quality','agent'],null,50,()=>clickSurface('Director')],
    ['versions','Versions','Open branches, checkpoints, restore and semantic/object compare.','Project',['version','branch','checkpoint','history','compare','restore'],null,60,()=>clickSurface('Versions')],
    ['comments','Comments & Review','Open anchored review threads, approvals and delivery governance.','Project',['comment','review','approval','thread','blocking'],null,61,()=>clickSurface('Comments')],
    ['deliver','Delivery Center','Open PPTX, Figma, Web, Keynote and Desktop static delivery.','Project',['export','pptx','figma','web','keynote','pdf','png'],null,70,()=>clickSurface('Deliver')],
    ['health','System Health','Open full-stack diagnostics for project, runtime and delivery readiness.','Project',['health','diagnostic','status','runtime','release','intel'],null,71,()=>clickSurface('Health')],
  ];
  for (const [id,title,description,group,keywords,shortcut,order,run] of builtins) register({ id, title, description, group, keywords, shortcut, order, run });

  function matching() {
    const needle = normalize(query);
    return [...commands.values()].filter((command) => {
      if (!needle) return true;
      const haystack = normalize([command.title, command.description, command.group, command.id, ...command.keywords].join(' '));
      return haystack.includes(needle);
    }).sort((a,b) => a.order-b.order || a.group.localeCompare(b.group) || a.title.localeCompare(b.title));
  }
  function render() {
    const root = document.getElementById('pitchFullCommandBackdrop');
    if (!root) return;
    root.classList.toggle('open', open);
    if (!open) return;
    const items = matching();
    if (cursor >= items.length) cursor = Math.max(0, items.length - 1);
    let lastGroup = '';
    const html = items.map((command, index) => {
      const group = command.group !== lastGroup ? `<div class="pitch-full-command-group">${escapeHtml(command.group)}</div>` : '';
      lastGroup = command.group;
      return `${group}<button class="pitch-full-command-item ${index===cursor?'active':''}" data-full-command="${escapeHtml(command.id)}"><span><b>${escapeHtml(command.title)}</b><small>${escapeHtml(command.description)}</small></span><em>${escapeHtml(command.shortcut)}</em></button>`;
    }).join('') || '<div class="pitch-full-command-empty">No matching commands.</div>';
    root.innerHTML = `<div class="pitch-full-command" role="dialog" aria-modal="true" aria-label="Pitch commands"><div class="pitch-full-command-search"><strong>⌘K</strong><input data-full-command-search autocomplete="off" placeholder="Search editor, AI, project and delivery commands…" value="${escapeHtml(query)}"><kbd>ESC</kbd></div><div class="pitch-full-command-list">${html}</div></div>`;
    wire(root, items);
    queueMicrotask(() => root.querySelector('[data-full-command-search]')?.focus());
  }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>\"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[char] || char)); }
  function wire(root, items) {
    const input = root.querySelector('[data-full-command-search]');
    input?.addEventListener('input', () => { query = input.value; cursor = 0; render(); });
    root.querySelectorAll('[data-full-command]').forEach((button) => button.addEventListener('click', () => void execute(button.dataset.fullCommand)));
    root.querySelector('.pitch-full-command')?.addEventListener('click', (event) => event.stopPropagation());
    root.addEventListener('click', (event) => { if (event.target === root) close(); }, { once: true });
  }
  function show() { open = true; query = ''; cursor = 0; render(); }
  function close() { open = false; render(); }
  function move(delta) {
    const items = matching(); if (!items.length) return;
    cursor = (cursor + delta + items.length) % items.length; render();
  }
  function runCurrent() {
    const items = matching(); const command = items[cursor]; if (command) void execute(command.id);
  }

  const styleNode = document.createElement('style'); styleNode.textContent = css; document.head.appendChild(styleNode);
  const backdrop = document.createElement('div'); backdrop.id='pitchFullCommandBackdrop'; backdrop.className='pitch-full-command-backdrop'; document.body.appendChild(backdrop);

  window.addEventListener('keydown', (event) => {
    const cmdK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
    if (cmdK) { event.preventDefault(); event.stopImmediatePropagation(); show(); return; }
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    else if (event.key === 'Enter') { event.preventDefault(); runCurrent(); }
  }, true);
  document.addEventListener('click', (event) => {
    if (bypassLegacy) return;
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (button && button.textContent?.trim() === 'Commands' && !button.closest('#pitchFullCommandBackdrop')) {
      event.preventDefault(); event.stopImmediatePropagation(); show();
    }
  }, true);
})();
