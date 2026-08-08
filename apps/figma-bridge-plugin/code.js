figma.showUI(__html__, { width: 480, height: 620, themeColors: true });

function post(type, payload = {}) { figma.ui.postMessage({ type, ...payload }); }
function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min)); }
function hex(value, fallback = { r: .7, g: .7, b: .7 }) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return fallback;
  const raw = value.slice(1); return { r: parseInt(raw.slice(0,2),16)/255, g: parseInt(raw.slice(2,4),16)/255, b: parseInt(raw.slice(4,6),16)/255 };
}
function solid(value, opacity = 1) { return { type: 'SOLID', color: hex(value), opacity: clamp(opacity) }; }
function firstRange(payload) { return Array.isArray(payload?.ranges) && payload.ranges.length ? payload.ranges[0] : {}; }
function textColor(payload) { return firstRange(payload)?.color || '#111111'; }
function textSize(payload) { return Number(firstRange(payload)?.fontSizePt || 18); }
function textFont(payload) { return String(firstRange(payload)?.fontFamily || 'Inter'); }
async function loadFont(family, style = 'Regular') {
  try { await figma.loadFontAsync({ family, style }); return { family, style }; }
  catch { await figma.loadFontAsync({ family: 'Inter', style: 'Regular' }); return { family: 'Inter', style: 'Regular' }; }
}
function base64Bytes(value) {
  const binary = atob(value || ''); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function applyCommon(node, spec, parentOrigin) {
  node.name = spec.name || spec.pitchId;
  node.x = spec.x - parentOrigin.x;
  node.y = spec.y - parentOrigin.y;
  node.rotation = Number(spec.rotation || 0);
  node.opacity = clamp(Number(spec.opacity ?? 1));
  if ('locked' in node) node.locked = Boolean(spec.locked);
  try { node.setPluginData('pitchId', String(spec.pitchId)); node.setPluginData('pitchType', String(spec.type)); node.setPluginData('pitchSemanticRole', String(spec.semanticRole || 'other')); node.setPluginData('pitchPayload', JSON.stringify(spec.payload || {}));
    if (spec.tokenBindings) node.setPluginData('pitchTokenBindings', JSON.stringify(spec.tokenBindings));
    if (spec.componentInstanceId) node.setPluginData('pitchComponentInstanceId', spec.componentInstanceId);
    if (spec.componentId) node.setPluginData('pitchComponentId', spec.componentId);
    if (spec.masterId) node.setPluginData('pitchMasterId', spec.masterId);
    if (spec.masterSourceId) node.setPluginData('pitchMasterSourceId', spec.masterSourceId);
    if (spec.placeholderId) node.setPluginData('pitchPlaceholderId', spec.placeholderId);
  } catch {}
}
function strokePaint(stroke) {
  return stroke?.color ? [solid(stroke.color)] : [];
}
function applyStroke(node, stroke) {
  if (!stroke || !('strokes' in node)) return;
  node.strokes = strokePaint(stroke);
  if ('strokeWeight' in node && Number.isFinite(stroke.widthDU)) node.strokeWeight = Math.max(0, stroke.widthDU);
  if ('dashPattern' in node && stroke.dash === 'dash') node.dashPattern = [8, 6];
  if ('dashPattern' in node && stroke.dash === 'dot') node.dashPattern = [2, 5];
}
function applyEffects(node, effects) {
  if (!Array.isArray(effects) || !('effects' in node)) return;
  const result = [];
  for (const effect of effects) if (effect?.kind === 'dropShadow') result.push({ type: 'DROP_SHADOW', color: { ...hex(effect.color, {r:0,g:0,b:0}), a: clamp(effect.opacity ?? 1) }, offset: { x: effect.offsetXDU || 0, y: effect.offsetYDU || 0 }, radius: Math.max(0, effect.blurDU || 0), visible: true, blendMode: 'NORMAL' });
  node.effects = result;
}
function fillPaint(payload, fallback) {
  const paint = payload?.fillPaint;
  if (paint?.kind === 'solid') return [solid(paint.color, paint.opacity ?? 1)];
  if (paint?.kind === 'linearGradient' && Array.isArray(paint.stops)) return [{ type: 'GRADIENT_LINEAR', gradientStops: paint.stops.map(stop => ({ position: clamp(stop.position), color: { ...hex(stop.color), a: clamp(stop.opacity ?? 1) } })), gradientTransform: [[1,0,0],[0,1,0]] }];
  if (paint?.kind === 'none') return [];
  return fallback ? [solid(fallback)] : [];
}
async function createText(spec, parent, origin) {
  const node = figma.createText(); parent.appendChild(node); applyCommon(node, spec, origin);
  const payload = spec.payload || {}; const font = await loadFont(textFont(payload)); node.fontName = font; node.characters = String(payload.characters || ''); node.fontSize = textSize(payload); node.fills = [solid(textColor(payload))];
  try { node.resize(Math.max(1, spec.width), Math.max(1, spec.height)); } catch {}
  node.textAutoResize = 'NONE';
  if (payload.verticalAlign === 'middle') node.textAlignVertical = 'CENTER'; else if (payload.verticalAlign === 'bottom') node.textAlignVertical = 'BOTTOM'; else node.textAlignVertical = 'TOP';
  const firstParagraph = payload.paragraphs?.[0]; if (firstParagraph?.align) node.textAlignHorizontal = firstParagraph.align === 'justify' ? 'JUSTIFIED' : String(firstParagraph.align).toUpperCase();
  return node;
}
function createShape(spec, parent, origin) {
  const payload = spec.payload || {}; let node;
  if (payload.shape === 'ellipse') node = figma.createEllipse();
  else if (payload.shape === 'triangle') { node = figma.createPolygon(); node.pointCount = 3; }
  else if (payload.shape === 'custom' && (payload.svgPath || payload.pathData)) {
    node = figma.createVector();
    if (payload.svgPath) { try { node.vectorPaths = [{ windingRule: 'NONZERO', data: payload.svgPath }]; } catch {} }
  } else node = figma.createRectangle();
  parent.appendChild(node); applyCommon(node, spec, origin); node.resize(Math.max(1, spec.width), Math.max(1, spec.height));
  if ('fills' in node) node.fills = fillPaint(payload, payload.fill);
  if ('cornerRadius' in node && (payload.shape === 'roundRect' || payload.radiusDU)) node.cornerRadius = Math.max(0, Number(payload.radiusDU || 12));
  applyStroke(node, payload.stroke); applyEffects(node, payload.effects); return node;
}
function createLine(spec, parent, origin) {
  const payload = spec.payload || {}; const node = figma.createLine(); parent.appendChild(node); applyCommon(node, spec, origin);
  const start = payload.start || [0,0], end = payload.end || [spec.width,0]; const dx=end[0]-start[0], dy=end[1]-start[1]; const length=Math.max(1,Math.hypot(dx,dy)); node.resize(length,0); node.rotation = Math.atan2(dy,dx)*180/Math.PI + Number(spec.rotation||0); applyStroke(node,payload.stroke); return node;
}
async function createImage(spec, parent, origin, assets) {
  const payload = spec.payload || {}; const node = figma.createRectangle(); parent.appendChild(node); applyCommon(node, spec, origin); node.resize(Math.max(1,spec.width),Math.max(1,spec.height));
  const asset = assets[payload.assetId]; if (asset?.base64) { const image = figma.createImage(base64Bytes(asset.base64)); const scaleMode = payload.fit === 'contain' ? 'FIT' : 'FILL'; node.fills = [{ type:'IMAGE', imageHash:image.hash, scaleMode }]; } else node.fills=[solid('#D9DDE3')];
  if (payload.clipShape === 'ellipse') { node.setPluginData('pitchClipShape','ellipse'); node.cornerRadius = Math.min(spec.width,spec.height)/2; }
  else if (payload.clipShape === 'roundRect' || payload.cornerRadiusDU) node.cornerRadius = Math.max(0,Number(payload.cornerRadiusDU||12));
  return node;
}
function createContainer(spec, parent, origin, transparent = false) {
  const node=figma.createFrame(); parent.appendChild(node); applyCommon(node,spec,origin); node.resize(Math.max(1,spec.width),Math.max(1,spec.height)); node.layoutMode='NONE'; const payload=spec.payload||{}; node.fills=transparent?[]:fillPaint(payload,payload.fill); node.clipsContent=Boolean(payload.clipContent); if (payload.radiusDU) node.cornerRadius=Math.max(0,payload.radiusDU); applyStroke(node,payload.stroke); applyEffects(node,payload.effects); return node;
}
async function createFallback(spec,parent,origin) {
  const frame=createContainer(spec,parent,origin,true); frame.name=`${spec.name} · ${spec.type}`; const label=figma.createText(); frame.appendChild(label); const font=await loadFont('Inter'); label.fontName=font; label.characters=`${String(spec.type).toUpperCase()} · editable structured payload stored in plugin data`; label.fontSize=12; label.fills=[solid('#69727D')]; label.x=8; label.y=8; try{label.resize(Math.max(40,spec.width-16),28);}catch{} return frame;
}
async function createNode(spec,parent,origin,assets) {
  if (spec.type==='text') return createText(spec,parent,origin);
  if (spec.type==='shape') return createShape(spec,parent,origin);
  if (spec.type==='line') return createLine(spec,parent,origin);
  if (spec.type==='image'||spec.type==='icon') return createImage(spec,parent,origin,assets);
  if (spec.type==='frame') return createContainer(spec,parent,origin,false);
  if (spec.type==='group') return createContainer(spec,parent,origin,true);
  return createFallback(spec,parent,origin);
}
async function renderSlide(slide,index,assets) {
  const page=figma.currentPage; const slideFrame=figma.createFrame(); page.appendChild(slideFrame); slideFrame.name=`${String(index+1).padStart(2,'0')} · ${slide.title}`; slideFrame.resize(slide.width,slide.height); slideFrame.x=index*(slide.width+160); slideFrame.y=0; slideFrame.fills=[solid('#FFFFFF')]; slideFrame.clipsContent=true; slideFrame.setPluginData('pitchSlideId',slide.slideId);
  const byId=new Map(slide.nodes.map(n=>[n.pitchId,n])); const parentOf=new Map(); for(const spec of slide.nodes) if(Array.isArray(spec.childIds)) for(const child of spec.childIds) parentOf.set(child,spec.pitchId); for(const spec of slide.nodes) if(spec.groupId&&!parentOf.has(spec.pitchId))parentOf.set(spec.pitchId,spec.groupId);
  async function render(spec,parent,origin){const node=await createNode(spec,parent,origin,assets);const children=Array.isArray(spec.childIds)?spec.childIds:[];for(const childId of children){const child=byId.get(childId);if(child)await render(child,node,{x:spec.x,y:spec.y});}return node;}
  const roots=[...slide.nodes].filter(spec=>!parentOf.has(spec.pitchId)).sort((a,b)=>a.zIndex-b.zIndex); for(const spec of roots) await render(spec,slideFrame,{x:0,y:0}); return slideFrame;
}
async function importBridge(document) {
  if (!document || document.kind!=='pitch-figma-bridge' || document.schemaVersion!=='0.1') throw new Error('Not a Pitch Monumentum Figma bridge document');
  const created=[]; for (let i=0;i<document.slides.length;i+=1){post('progress',{message:`Importing slide ${i+1}/${document.slides.length}`});created.push(await renderSlide(document.slides[i],i,document.assets||{}));}
  figma.currentPage.setPluginData('pitchDeckId',String(document.deckId)); figma.currentPage.setPluginData('pitchBridgeTheme',JSON.stringify(document.theme||null)); figma.currentPage.setPluginData('pitchSlideMasters',JSON.stringify(document.slideMasters||null)); figma.currentPage.selection=created; if(created.length)figma.viewport.scrollAndZoomIntoView(created); return created.length;
}
figma.ui.onmessage = async (message) => {
  if (message?.type==='close') { figma.closePlugin(); return; }
  if (message?.type!=='import') return;
  try { post('progress',{message:'Validating Pitch bridge…'}); const count=await importBridge(message.document); post('done',{message:`Imported ${count} slide${count===1?'':'s'} as editable Figma frames.`}); }
  catch(error){ post('error',{message:error instanceof Error?error.message:String(error)}); }
};
