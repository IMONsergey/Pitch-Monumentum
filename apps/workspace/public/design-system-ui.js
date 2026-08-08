(() => {
  const css = `
  .pitch-design-toggle{border-color:#52643c!important;color:#d9f7a2!important}
  .pitch-design-drawer{position:fixed;z-index:1450;right:16px;top:62px;bottom:16px;width:min(390px,calc(100vw - 32px));display:none;grid-template-rows:auto auto 1fr;border:1px solid #303a45;border-radius:14px;background:#0c1015f7;color:#e8edf2;box-shadow:0 30px 100px #000c;backdrop-filter:blur(15px);overflow:hidden;font:11px/1.4 Inter,system-ui,sans-serif}.pitch-design-drawer.open{display:grid}
  .pitch-design-head{display:flex;align-items:center;gap:8px;padding:12px 13px;border-bottom:1px solid #252d36}.pitch-design-head b{font-size:12px}.pitch-design-head small{color:#73808f}.pitch-design-head .spacer{flex:1}.pitch-design-head button{height:27px;border:1px solid #34404b;border-radius:6px;background:#151b22;color:#aeb8c4;padding:0 8px;cursor:pointer}
  .pitch-design-score{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:10px 13px;border-bottom:1px solid #252d36;background:#0f141a}.pitch-design-score strong{font-size:20px;font-weight:650}.pitch-design-score span{color:#7f8b99}.pitch-design-meter{grid-column:1/-1;height:4px;border-radius:10px;background:#202833;overflow:hidden}.pitch-design-meter i{display:block;height:100%;background:#b9ff66;border-radius:inherit}
  .pitch-design-body{overflow:auto;padding:10px 10px 18px}.pitch-design-section{margin-bottom:10px;border:1px solid #252e37;border-radius:10px;background:#10151b;overflow:hidden}.pitch-design-section h5{display:flex;align-items:center;gap:6px;margin:0;padding:9px 10px;border-bottom:1px solid #252e37;color:#aeb8c4;font-size:9px;text-transform:uppercase;letter-spacing:.08em}.pitch-design-section h5 span{margin-left:auto;color:#667384;font-weight:400;text-transform:none;letter-spacing:0}
  .pitch-design-token{display:grid;grid-template-columns:22px 105px 1fr 28px;gap:6px;align-items:center;padding:6px 8px;border-bottom:1px solid #1d242c}.pitch-design-token:last-child{border-bottom:0}.pitch-design-token .swatch{width:20px;height:20px;border:1px solid #ffffff22;border-radius:5px;padding:0;background:transparent}.pitch-design-token code{color:#aab6c2;font-size:9px;overflow:hidden;text-overflow:ellipsis}.pitch-design-token input[type=text],.pitch-design-token input[type=number]{min-width:0;height:25px;border:1px solid #303a45;border-radius:5px;background:#0b0f14;color:#e5ebf1;padding:0 6px;font:10px ui-monospace,SFMono-Regular,Menlo,monospace}.pitch-design-token button{height:25px;border:0;background:transparent;color:#687687;cursor:pointer}.pitch-design-token button:hover{color:#f08f8f}
  .pitch-design-row{display:grid;grid-template-columns:1fr 1fr;gap:7px;padding:8px}.pitch-design-field label{display:block;margin:0 0 4px;color:#778493;font-size:9px}.pitch-design-field select,.pitch-design-field input{width:100%;box-sizing:border-box;height:28px;border:1px solid #303a45;border-radius:6px;background:#0b0f14;color:#e5ebf1;padding:0 6px;font-size:10px}.pitch-design-actions{display:flex;gap:6px;padding:0 8px 8px}.pitch-design-actions button{flex:1;height:29px;border:1px solid #3c4933;border-radius:6px;background:#172011;color:#d9f7a2;font-size:9px;cursor:pointer}.pitch-design-actions button.secondary{border-color:#303a45;background:#151b22;color:#aeb8c4}.pitch-design-actions button:disabled{opacity:.35;cursor:default}
  .pitch-design-issue{padding:7px 8px;border-bottom:1px solid #1e252d;color:#aab4bf;font-size:9px}.pitch-design-issue:last-child{border-bottom:0}.pitch-design-issue.major{color:#f1aaa3}.pitch-design-issue b{color:inherit}.pitch-design-empty{padding:12px 9px;color:#6f7b89;text-align:center;font-size:9px}.pitch-design-init{padding:14px}.pitch-design-init p{margin:0 0 10px;color:#8e9aa8}.pitch-design-init button{width:100%;height:32px;border:1px solid #557038;border-radius:7px;background:#192512;color:#dcffa4;cursor:pointer}.pitch-design-plan{margin:0 8px 8px;padding:8px;border:1px dashed #35414c;border-radius:7px;color:#8996a4;font-size:9px}.pitch-design-status{padding:5px 8px;color:#708090;font-size:9px}
  `;
  let designState = null;
  let open = false;
  const runtime = () => window.__pitchEditorRuntime;
  const status = (message) => { const node = document.getElementById('spikeStatus'); if (node) node.textContent = message; };
  const esc = (value) => String(value ?? '').replace(/[&<>\"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[ch] || ch));
  const request = async (url, options) => { const response = await fetch(url, options); const data = await response.json(); if (!response.ok) throw new Error(data.error || response.statusText); return data; };
  const post = (url, value) => request(url, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(value) });
  const categoryForTarget = (target) => target === 'fill' || target === 'strokeColor' || target === 'textColor' ? 'colors' : target === 'fontFamily' ? 'fonts' : 'typeScalePt';
  const selectedIds = () => runtime()?.getSelectedIds?.() || [];
  const slideId = () => runtime()?.getSlide?.()?.id;

  async function reloadAll(message) {
    await runtime()?.reload?.();
    designState = await request('/api/design-state');
    render();
    if (message) status(message);
  }
  async function command(input) {
    if (!designState) designState = await request('/api/design-state');
    const result = await post('/api/design-command', { ...input, expectedDeckHash: designState.deckHash });
    await reloadAll(`Design · ${result.commandReason || input.command}`);
  }
  async function bootstrap() {
    const result = await post('/api/design-bootstrap', { expectedDeckHash: designState?.deckHash });
    await reloadAll(`Design · ${result.commandReason || 'theme initialized'}`);
  }
  async function migrationPlan() {
    const plan = await post('/api/design-migration-plan', { minimumConfidence: .99 });
    const node = document.querySelector('.pitch-design-plan');
    if (node) node.innerHTML = `<b>Dry-run</b><br>${plan.acceptedSuggestions.length} exact bindings · ${plan.affectedElementIds.length} objects · coverage ${Math.round(plan.before.coverage.coverage*100)}% → ${Math.round(plan.after.coverage.coverage*100)}% · ${plan.after.issues.filter(i=>i.severity==='major').length} major issues remain`;
  }

  function tokenRows(category, tokens) {
    return Object.entries(tokens || {}).map(([key,value]) => {
      const isColor = category === 'colors';
      const type = category === 'typeScalePt' || category === 'spacingDU' ? 'number' : 'text';
      return `<div class="pitch-design-token" data-token-row="${esc(category)}:${esc(key)}">${isColor ? `<input class="swatch" data-token-color type="color" value="${esc(value)}">` : '<span></span>'}<code title="${esc(key)}">${esc(key)}</code><input data-token-value type="${type}" ${type==='number'?'step="1"':''} value="${esc(value)}"><button data-token-delete title="Delete token">×</button></div>`;
    }).join('') || '<div class="pitch-design-empty">No tokens</div>';
  }
  function section(title, category, tokens) {
    return `<section class="pitch-design-section"><h5>${title}<span>${Object.keys(tokens||{}).length}</span></h5>${tokenRows(category,tokens)}<div class="pitch-design-actions"><button class="secondary" data-token-add="${category}">+ Add token</button></div></section>`;
  }
  function bindingSection(theme) {
    const ids = selectedIds();
    return `<section class="pitch-design-section"><h5>Selection bindings<span>${ids.length} selected</span></h5><div class="pitch-design-row"><div class="pitch-design-field"><label>Target</label><select data-bind-target><option value="fill">Fill</option><option value="strokeColor">Stroke</option><option value="textColor">Text color</option><option value="fontFamily">Font</option><option value="fontSizePt">Type scale</option></select></div><div class="pitch-design-field"><label>Token</label><select data-bind-token></select></div></div><div class="pitch-design-actions"><button data-bind>Bind selection</button><button class="secondary" data-unbind>Unbind target</button></div></section>`;
  }
  function issuesSection() {
    const issues = designState?.issues || [];
    return `<section class="pitch-design-section"><h5>Brand QA<span>${issues.length}</span></h5>${issues.length ? issues.slice(0,30).map(issue => `<div class="pitch-design-issue ${issue.severity}"><b>${esc(issue.code)}</b>${issue.elementId?' · '+esc(issue.elementId):''}<br>${esc(issue.message)}</div>`).join('') : '<div class="pitch-design-empty">No design-system issues</div>'}</section>`;
  }
  function render() {
    const drawer = document.getElementById('pitchDesignDrawer');
    if (!drawer) return;
    drawer.classList.toggle('open', open);
    if (!open) return;
    if (!designState) { drawer.innerHTML = '<div class="pitch-design-empty">Loading Design System…</div>'; return; }
    const coverage = Math.round((designState.coverage?.coverage ?? 0) * 100);
    const major = (designState.issues || []).filter(issue => issue.severity === 'major').length;
    const theme = designState.theme;
    drawer.innerHTML = `<div class="pitch-design-head"><div><b>Design System 2.0</b><br><small>${esc(theme?.name || designState.suggestedTheme?.name || 'No live theme')}</small></div><span class="spacer"></span><button data-design-refresh>↻</button><button data-design-close>Close</button></div><div class="pitch-design-score"><div><strong>${coverage}%</strong><br><span>token coverage · ${major} major issue${major===1?'':'s'}</span></div><div>${(designState.suggestions||[]).length} suggestions</div><div class="pitch-design-meter"><i style="width:${coverage}%"></i></div></div><div class="pitch-design-body">${!theme ? `<div class="pitch-design-init"><p>The deck has a canonical DesignSystem artifact but no live deck theme yet. Initialize it without changing narrative/content.</p><button data-design-bootstrap ${designState.suggestedTheme?'':'disabled'}>Initialize from ${esc(designState.suggestedTheme?.name || 'Design System')}</button></div>` : `${section('Colors','colors',theme.colors)}${section('Fonts','fonts',theme.fonts)}${section('Type scale','typeScalePt',theme.typeScalePt)}${section('Spacing','spacingDU',theme.spacingDU)}${bindingSection(theme)}<section class="pitch-design-section"><h5>Migration / coverage</h5><div class="pitch-design-plan">${(designState.suggestions||[]).length} binding suggestions available. Run dry-run before bulk migration.</div><div class="pitch-design-actions"><button class="secondary" data-design-plan>Plan exact migration</button></div></section>${issuesSection()}`}</div>`;
    wire(drawer);
  }
  function updateTokenOptions(root) {
    if (!designState?.theme) return;
    const target = root.querySelector('[data-bind-target]')?.value || 'fill';
    const category = categoryForTarget(target);
    const select = root.querySelector('[data-bind-token]'); if (!select) return;
    select.innerHTML = Object.keys(designState.theme[category] || {}).map(token => `<option value="${esc(token)}">${esc(token)}</option>`).join('');
  }
  function wire(root) {
    root.querySelector('[data-design-close]')?.addEventListener('click', () => { open=false; render(); });
    root.querySelector('[data-design-refresh]')?.addEventListener('click', () => void load());
    root.querySelector('[data-design-bootstrap]')?.addEventListener('click', () => void bootstrap().catch(error=>status(`Design failed: ${error.message}`)));
    root.querySelector('[data-design-plan]')?.addEventListener('click', () => void migrationPlan().catch(error=>status(`Design plan failed: ${error.message}`)));
    root.querySelectorAll('[data-token-row]').forEach(row => {
      const [category,token] = row.dataset.tokenRow.split(':'); const value = row.querySelector('[data-token-value]'); const swatch = row.querySelector('[data-token-color]');
      const save = () => { let next = value.value; if (category==='typeScalePt'||category==='spacingDU') next = Number(next); void command({command:'setToken',category,token,value:next}).catch(error=>status(`Design failed: ${error.message}`)); };
      value?.addEventListener('change', save);
      swatch?.addEventListener('input', () => { value.value = swatch.value.toUpperCase(); });
      swatch?.addEventListener('change', save);
      row.querySelector('[data-token-delete]')?.addEventListener('click', () => void command({command:'deleteToken',category,token}).catch(error=>status(`Design failed: ${error.message}`)));
    });
    root.querySelectorAll('[data-token-add]').forEach(button => button.addEventListener('click', () => {
      const category = button.dataset.tokenAdd; const token = window.prompt('Token name'); if (!token) return;
      const raw = window.prompt(category==='colors'?'Value (#RRGGBB)':category==='fonts'?'Font family':'Numeric value'); if (!raw) return;
      const value = category==='typeScalePt'||category==='spacingDU' ? Number(raw) : raw;
      void command({command:'setToken',category,token,value}).catch(error=>status(`Design failed: ${error.message}`));
    }));
    const target = root.querySelector('[data-bind-target]'); target?.addEventListener('change', () => updateTokenOptions(root)); updateTokenOptions(root);
    root.querySelector('[data-bind]')?.addEventListener('click', () => {
      const ids=selectedIds(), slide=slideId(), targetValue=target?.value, token=root.querySelector('[data-bind-token]')?.value;
      if (!ids.length || !slide || !token) return status('Design · select one or more compatible objects');
      void command({command:'bindToken',slideId:slide,elementIds:ids,target:targetValue,token}).catch(error=>status(`Design failed: ${error.message}`));
    });
    root.querySelector('[data-unbind]')?.addEventListener('click', () => {
      const ids=selectedIds(), slide=slideId(), targetValue=target?.value; if (!ids.length || !slide) return;
      void command({command:'unbindToken',slideId:slide,elementIds:ids,target:targetValue}).catch(error=>status(`Design failed: ${error.message}`));
    });
  }
  async function load() { try { designState = await request('/api/design-state'); render(); } catch(error) { status(`Design state failed: ${error.message}`); } }
  function toggle() { open=!open; render(); if(open) void load(); }
  const style = document.createElement('style'); style.textContent=css; document.head.appendChild(style);
  const drawer = document.createElement('aside'); drawer.id='pitchDesignDrawer'; drawer.className='pitch-design-drawer'; document.body.appendChild(drawer);
  const installButton = () => { const top=document.querySelector('.spike-top'); const spacer=top?.querySelector('.spacer'); if(!top||!spacer||top.querySelector('.pitch-design-toggle')) return; const button=document.createElement('button'); button.className='spike-btn pitch-design-toggle'; button.textContent='Design'; button.title='Design System 2.0 · ⇧⌘D'; button.addEventListener('click',toggle); top.insertBefore(button,spacer); };
  installButton(); window.addEventListener('pitch:editor-state', () => { installButton(); if(open) void load(); });
  window.addEventListener('keydown', event => { if((event.metaKey||event.ctrlKey)&&event.shiftKey&&event.key.toLowerCase()==='d'){ event.preventDefault(); toggle(); } }, true);
})();
