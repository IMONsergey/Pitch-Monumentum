figma.showUI(__html__, { width: 360, height: 430, themeColors: true });

const PT_TO_PX = 96 / 72;

function isContainer(element) {
  return element && (element.type === 'frame' || element.type === 'group');
}

function rgb(hex, fallback = '#000000') {
  const value = String(hex || fallback).replace('#', '').trim();
  const normalized = value.length === 3 ? value.split('').map(c => c + c).join('') : value.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return rgb(fallback, '#000000');
  return {
    r: parseInt(normalized.slice(0, 2), 16) / 255,
    g: parseInt(normalized.slice(2, 4), 16) / 255,
    b: parseInt(normalized.slice(4, 6), 16) / 255,
  };
}

function solidPaint(color) {
  return { type: 'SOLID', color: rgb(color) };
}

function safeSet(target, key, value, warnings, label) {
  try {
    target[key] = value;
    return true;
  } catch (error) {
    warnings.push(`${label || key}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

function safePluginData(node, key, value, warnings, label) {
  try {
    node.setPluginData(key, value);
    return true;
  } catch (error) {
    warnings.push(`${label || key}: pluginData was not preserved (${error instanceof Error ? error.message : String(error)})`);
    return false;
  }
}

function base64Bytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function setPluginIdentity(node, element) {
  node.setPluginData('pitchElementId', element.id);
  node.setPluginData('pitchElementType', element.type);
  if (element.semanticRole) node.setPluginData('pitchSemanticRole', element.semanticRole);
}

function positionNode(node, element, parentElement) {
  const originX = parentElement ? parentElement.geometry.x : 0;
  const originY = parentElement ? parentElement.geometry.y : 0;
  if ('x' in node) node.x = element.geometry.x - originX;
  if ('y' in node) node.y = element.geometry.y - originY;
  if ('rotation' in node) node.rotation = element.geometry.rotation || 0;
  if ('opacity' in node) node.opacity = element.opacity == null ? 1 : element.opacity;
  if ('locked' in node) node.locked = Boolean(element.locked);
}

function resizeNode(node, geometry, warnings, label) {
  if (typeof node.resize !== 'function') return;
  try {
    node.resize(Math.max(0.01, geometry.width), Math.max(0.01, geometry.height));
  } catch (error) {
    warnings.push(`${label}: could not preserve ${geometry.width}×${geometry.height} geometry (${error instanceof Error ? error.message : String(error)})`);
  }
}

function applyStroke(node, stroke, warnings, label) {
  if (!stroke || !('strokes' in node)) return;
  safeSet(node, 'strokes', [solidPaint(stroke.color)], warnings, `${label} stroke`);
  if ('strokeWeight' in node) safeSet(node, 'strokeWeight', Math.max(0.01, stroke.widthDU || 1), warnings, `${label} strokeWeight`);
  if (stroke.dash && stroke.dash !== 'solid' && 'dashPattern' in node) {
    const width = Math.max(1, stroke.widthDU || 1);
    safeSet(node, 'dashPattern', stroke.dash === 'dot' ? [width, width * 1.5] : [width * 4, width * 2], warnings, `${label} dash`);
  }
}

function configureFrameAppearance(node, element, warnings) {
  const label = `${element.type}:${element.id}`;
  const structural = element.type === 'group';
  if ('fills' in node) safeSet(node, 'fills', structural || !element.fill ? [] : [solidPaint(element.fill)], warnings, `${label} fill`);
  applyStroke(node, element.stroke, warnings, label);
  if (element.radiusDU != null && 'cornerRadius' in node) safeSet(node, 'cornerRadius', element.radiusDU, warnings, `${label} radius`);
  if ('clipsContent' in node) safeSet(node, 'clipsContent', Boolean(element.clipContent), warnings, `${label} clip`);
}

function primaryAlign(value, warnings, elementId) {
  if (value === 'center') return 'CENTER';
  if (value === 'end') return 'MAX';
  if (value === 'spaceBetween') return 'SPACE_BETWEEN';
  if (value === 'spaceAround' || value === 'spaceEvenly') {
    warnings.push(`frame:${elementId}: Figma Auto Layout has no exact ${value} equivalent; imported as SPACE_BETWEEN`);
    return 'SPACE_BETWEEN';
  }
  return 'MIN';
}

function counterAlign(value) {
  if (value === 'center') return 'CENTER';
  if (value === 'end') return 'MAX';
  return 'MIN';
}

function itemAlign(value) {
  if (value === 'center') return 'CENTER';
  if (value === 'end') return 'MAX';
  if (value === 'stretch') return 'STRETCH';
  if (value === 'start') return 'MIN';
  return 'INHERIT';
}

function setChildLayoutItem(node, element, parentLayout, warnings) {
  const item = element.layoutItem || {};
  if ('layoutSizingHorizontal' in node) {
    const sizing = item.width === 'fill' ? 'FILL' : item.width === 'hug' ? 'HUG' : 'FIXED';
    safeSet(node, 'layoutSizingHorizontal', sizing, warnings, `${element.id} width sizing`);
  }
  if ('layoutSizingVertical' in node) {
    const sizing = item.height === 'fill' ? 'FILL' : item.height === 'hug' ? 'HUG' : 'FIXED';
    safeSet(node, 'layoutSizingVertical', sizing, warnings, `${element.id} height sizing`);
  }
  if ('layoutGrow' in node && item.grow != null) safeSet(node, 'layoutGrow', Math.max(0, item.grow), warnings, `${element.id} layoutGrow`);
  if ('layoutAlign' in node) {
    const align = item.alignSelf ? itemAlign(item.alignSelf) : parentLayout.align === 'stretch' ? 'STRETCH' : 'INHERIT';
    safeSet(node, 'layoutAlign', align, warnings, `${element.id} layoutAlign`);
  }
  for (const [key, prop] of [['minWidthDU', 'minWidth'], ['maxWidthDU', 'maxWidth'], ['minHeightDU', 'minHeight'], ['maxHeightDU', 'maxHeight']]) {
    if (item[key] != null && prop in node) safeSet(node, prop, item[key], warnings, `${element.id} ${prop}`);
  }
}

function configureAutoLayout(node, element, childNodes, warnings) {
  const layout = element.layout;
  if (!layout || !('layoutMode' in node)) return;
  const horizontal = layout.direction === 'horizontal';
  safeSet(node, 'layoutMode', horizontal ? 'HORIZONTAL' : 'VERTICAL', warnings, `${element.id} layoutMode`);
  safeSet(node, 'itemSpacing', layout.gapDU || 0, warnings, `${element.id} itemSpacing`);
  safeSet(node, 'paddingTop', layout.padding?.top || 0, warnings, `${element.id} paddingTop`);
  safeSet(node, 'paddingRight', layout.padding?.right || 0, warnings, `${element.id} paddingRight`);
  safeSet(node, 'paddingBottom', layout.padding?.bottom || 0, warnings, `${element.id} paddingBottom`);
  safeSet(node, 'paddingLeft', layout.padding?.left || 0, warnings, `${element.id} paddingLeft`);
  safeSet(node, 'primaryAxisAlignItems', primaryAlign(layout.justify, warnings, element.id), warnings, `${element.id} justify`);
  safeSet(node, 'counterAxisAlignItems', counterAlign(layout.align), warnings, `${element.id} align`);
  if ('layoutWrap' in node) safeSet(node, 'layoutWrap', layout.wrap ? 'WRAP' : 'NO_WRAP', warnings, `${element.id} wrap`);

  const widthHug = (layout.widthSizing || 'fixed') === 'hug';
  const heightHug = (layout.heightSizing || 'fixed') === 'hug';
  if ('primaryAxisSizingMode' in node) safeSet(node, 'primaryAxisSizingMode', (horizontal ? widthHug : heightHug) ? 'AUTO' : 'FIXED', warnings, `${element.id} primary sizing`);
  if ('counterAxisSizingMode' in node) safeSet(node, 'counterAxisSizingMode', (horizontal ? heightHug : widthHug) ? 'AUTO' : 'FIXED', warnings, `${element.id} counter sizing`);

  for (const childId of element.childIds || []) {
    const entry = childNodes.get(childId);
    if (entry) setChildLayoutItem(entry.node, entry.element, layout, warnings);
  }
}

function createShape(element, warnings) {
  let node;
  if (element.shape === 'ellipse') node = figma.createEllipse();
  else if (element.shape === 'triangle') {
    node = figma.createPolygon();
    if ('pointCount' in node) safeSet(node, 'pointCount', 3, warnings, `${element.id} triangle`);
  } else if (element.shape === 'custom' && element.svgPath) {
    node = figma.createVector();
    safeSet(node, 'vectorPaths', [{ windingRule: 'NONZERO', data: element.svgPath }], warnings, `${element.id} vector path`);
  } else node = figma.createRectangle();
  node.name = element.name || element.id;
  resizeNode(node, element.geometry, warnings, `shape:${element.id}`);
  if ('fills' in node) safeSet(node, 'fills', element.fill ? [solidPaint(element.fill)] : [], warnings, `${element.id} fill`);
  applyStroke(node, element.stroke, warnings, `shape:${element.id}`);
  if (element.shape === 'roundRect' && 'cornerRadius' in node) safeSet(node, 'cornerRadius', element.radiusDU || 12, warnings, `${element.id} radius`);
  return node;
}

function createLine(element, warnings) {
  const node = figma.createLine();
  node.name = element.name || element.id;
  resizeNode(node, { width: Math.max(0.01, element.geometry.width), height: 0.01 }, warnings, `line:${element.id}`);
  applyStroke(node, element.stroke, warnings, `line:${element.id}`);
  if (element.startMarker === 'arrow' && 'strokeCap' in node) safeSet(node, 'strokeCap', 'ARROW_LINES', warnings, `${element.id} start arrow`);
  if (element.endMarker === 'arrow' && 'strokeCap' in node) warnings.push(`line:${element.id}: independent end-marker mapping is not yet exact in the Figma importer`);
  return node;
}

function desiredFontStyle(run) {
  if (run.bold && run.italic) return ['Bold Italic', 'BoldItalic', 'Semi Bold Italic', 'Semibold Italic'];
  if (run.bold) return ['Bold', 'Semi Bold', 'Semibold', 'Medium'];
  if (run.italic) return ['Italic', 'Regular Italic'];
  return ['Regular', 'Normal', 'Book'];
}

function chooseFont(run, available, warnings) {
  const desiredFamily = String(run.fontFamily || 'Inter').toLowerCase();
  const sameFamily = available.filter(item => item.fontName.family.toLowerCase() === desiredFamily);
  const styles = desiredFontStyle(run).map(value => value.toLowerCase());
  let chosen = sameFamily.find(item => styles.includes(item.fontName.style.toLowerCase()));
  if (!chosen && sameFamily.length) chosen = sameFamily[0];
  if (!chosen) {
    const inter = available.filter(item => item.fontName.family.toLowerCase() === 'inter');
    chosen = inter.find(item => styles.includes(item.fontName.style.toLowerCase())) || inter[0] || available[0];
    warnings.push(`text font fallback: ${run.fontFamily || 'Inter'} is unavailable; using ${chosen?.fontName.family || 'Figma default'}`);
  }
  return chosen ? chosen.fontName : { family: 'Inter', style: 'Regular' };
}

function textSegments(element) {
  const segments = [];
  let text = '';
  const paragraphRanges = [];
  (element.paragraphs || []).forEach((paragraph, paragraphIndex) => {
    const paragraphStart = text.length;
    for (const run of paragraph.runs || []) {
      const start = text.length;
      text += run.text || '';
      segments.push({ start, end: text.length, run });
    }
    const paragraphEnd = text.length;
    paragraphRanges.push({ start: paragraphStart, end: paragraphEnd, paragraph });
    if (paragraphIndex < element.paragraphs.length - 1) text += '\n';
  });
  return { text, segments, paragraphRanges };
}

async function createText(element, context, warnings) {
  const node = figma.createText();
  node.name = element.name || element.id;
  const data = textSegments(element);
  const firstRun = data.segments[0]?.run || {};
  const baseFont = chooseFont(firstRun, context.availableFonts, warnings);
  await context.loadFont(baseFont);
  node.fontName = baseFont;
  node.characters = data.text;
  node.textAutoResize = 'NONE';
  resizeNode(node, element.geometry, warnings, `text:${element.id}`);

  for (const segment of data.segments) {
    if (segment.end <= segment.start) continue;
    const run = segment.run;
    const fontName = chooseFont(run, context.availableFonts, warnings);
    await context.loadFont(fontName);
    try { node.setRangeFontName(segment.start, segment.end, fontName); } catch (error) { warnings.push(`${element.id} font range: ${error}`); }
    if (run.fontSizePt != null) try { node.setRangeFontSize(segment.start, segment.end, run.fontSizePt * PT_TO_PX); } catch (error) { warnings.push(`${element.id} font size: ${error}`); }
    if (run.color) try { node.setRangeFills(segment.start, segment.end, [solidPaint(run.color)]); } catch (error) { warnings.push(`${element.id} color: ${error}`); }
    if (run.underline) try { node.setRangeTextDecoration(segment.start, segment.end, 'UNDERLINE'); } catch (error) { warnings.push(`${element.id} underline: ${error}`); }
    if (run.letterSpacingPt != null) try { node.setRangeLetterSpacing(segment.start, segment.end, { unit: 'PIXELS', value: run.letterSpacingPt * PT_TO_PX }); } catch (error) { warnings.push(`${element.id} letter spacing: ${error}`); }
  }

  const aligns = [...new Set((element.paragraphs || []).map(p => p.align || 'left'))];
  if (aligns.length === 1) {
    const map = { left: 'LEFT', center: 'CENTER', right: 'RIGHT', justify: 'JUSTIFIED' };
    safeSet(node, 'textAlignHorizontal', map[aligns[0]] || 'LEFT', warnings, `${element.id} paragraph alignment`);
  } else if (aligns.length > 1) warnings.push(`text:${element.id}: mixed paragraph alignment is not yet imported exactly`);
  const vertical = element.verticalAlign === 'middle' ? 'CENTER' : element.verticalAlign === 'bottom' ? 'BOTTOM' : 'TOP';
  safeSet(node, 'textAlignVertical', vertical, warnings, `${element.id} vertical alignment`);
  if ((element.paragraphs || []).some(p => p.bullet)) warnings.push(`text:${element.id}: bullet/list semantics are not yet imported exactly`);
  if (element.insetsDU) warnings.push(`text:${element.id}: text insets require a wrapper frame and are not yet imported exactly`);
  return node;
}

async function createPrimitiveLabel(text, width, height, context, warnings, options = {}) {
  const node = figma.createText();
  const fontName = chooseFont({ bold: Boolean(options.bold), fontFamily: options.fontFamily || 'Inter' }, context.availableFonts, warnings);
  await context.loadFont(fontName);
  node.fontName = fontName;
  node.characters = String(text ?? '');
  node.fontSize = options.fontSize || 12;
  node.fills = [solidPaint(options.color || '#111111')];
  node.textAutoResize = 'NONE';
  node.textAlignHorizontal = options.align || 'LEFT';
  node.textAlignVertical = 'CENTER';
  node.resize(Math.max(1, width), Math.max(1, height));
  return node;
}

function imageScaleMode(element) {
  if (element.fit === 'contain') return 'FIT';
  return 'FILL';
}

function createImageNode(element, bundle, warnings) {
  const node = figma.createRectangle();
  node.name = element.name || element.alt || element.id;
  resizeNode(node, element.geometry, warnings, `image:${element.id}`);
  if (element.cornerRadiusDU != null) safeSet(node, 'cornerRadius', element.cornerRadiusDU, warnings, `${element.id} radius`);
  const asset = bundle.assets?.[element.assetId];
  if (!asset) {
    warnings.push(`image:${element.id}: missing embedded asset ${element.assetId}`);
    node.fills = [{ type: 'SOLID', color: rgb('#E5E7EB') }];
    return node;
  }
  if (asset.width > 4096 || asset.height > 4096) {
    warnings.push(`image:${element.id}: ${asset.width}×${asset.height}px exceeds Figma's image limit; original was not downscaled silently`);
    node.fills = [{ type: 'SOLID', color: rgb('#E5E7EB') }];
    return node;
  }
  try {
    const image = figma.createImage(base64Bytes(asset.bytesBase64));
    node.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: imageScaleMode(element) }];
  } catch (error) {
    warnings.push(`image:${element.id}: ${error instanceof Error ? error.message : String(error)}`);
    node.fills = [{ type: 'SOLID', color: rgb('#E5E7EB') }];
  }
  if (element.crop) warnings.push(`image:${element.id}: Pitch crop rectangle is not yet mapped to Figma imageTransform exactly`);
  if (element.fit === 'stretch') warnings.push(`image:${element.id}: stretch imported using Figma FILL; image geometry is preserved but pixel stretching is not exact`);
  return node;
}

async function createTableNode(element, context, warnings) {
  const root = figma.createFrame();
  root.name = element.name || `Table · ${element.id}`;
  root.resize(Math.max(1, element.geometry.width), Math.max(1, element.geometry.height));
  root.fills = [];
  root.clipsContent = true;
  safePluginData(root, 'pitchTableData', JSON.stringify({ rows: element.rows, columnWidths: element.columnWidths || null }), warnings, `table:${element.id}`);

  const rows = element.rows || [];
  const rowCount = Math.max(1, rows.length);
  const colCount = Math.max(1, ...rows.map(row => row.reduce((sum, cell) => sum + Math.max(1, cell.colspan || 1), 0)));
  let weights = Array.isArray(element.columnWidths) && element.columnWidths.length === colCount ? element.columnWidths.map(Number) : Array(colCount).fill(1);
  const totalWeight = weights.reduce((sum, value) => sum + Math.max(0, value || 0), 0) || colCount;
  weights = weights.map(value => Math.max(0, value || 0) / totalWeight);
  const xPositions = [0];
  for (let i = 0; i < weights.length; i += 1) xPositions.push(xPositions[i] + element.geometry.width * weights[i]);
  const rowHeight = element.geometry.height / rowCount;

  rows.forEach((row, rowIndex) => {
    let columnIndex = 0;
    row.forEach((cell, cellIndex) => {
      const colspan = Math.max(1, cell.colspan || 1);
      const rowspan = Math.max(1, cell.rowspan || 1);
      const x = xPositions[columnIndex] || 0;
      const rightIndex = Math.min(colCount, columnIndex + colspan);
      const width = Math.max(1, (xPositions[rightIndex] ?? element.geometry.width) - x);
      const height = Math.max(1, rowHeight * rowspan);
      const cellNode = figma.createFrame();
      cellNode.name = `Cell ${rowIndex + 1}:${cellIndex + 1}`;
      cellNode.resize(width, height);
      cellNode.x = x;
      cellNode.y = rowIndex * rowHeight;
      cellNode.fills = [solidPaint(rowIndex === 0 ? '#F2F4F7' : '#FFFFFF')];
      cellNode.strokes = [solidPaint('#D0D5DD')];
      cellNode.strokeWeight = 1;
      root.appendChild(cellNode);
      safePluginData(cellNode, 'pitchTableCell', JSON.stringify(cell), warnings, `table:${element.id}:cell`);
      void createPrimitiveLabel(cell.text || '', Math.max(1, width - 16), Math.max(1, height - 12), context, warnings, { bold: rowIndex === 0, fontSize: 12 }).then(textNode => {
        textNode.x = 8;
        textNode.y = 6;
        cellNode.appendChild(textNode);
      });
      columnIndex += colspan;
    });
  });
  return root;
}

function chartValues(chart) {
  return (chart.series || []).flatMap(series => (series.values || []).filter(value => Number.isFinite(value)));
}

function chartScale(values) {
  if (!values.length) return { min: 0, max: 1 };
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  if (minValue === maxValue) return { min: minValue, max: minValue + 1 };
  return { min: minValue, max: maxValue };
}

function chartColor(index) {
  const palette = ['#335CFF', '#14B8A6', '#F59E0B', '#EF4444', '#8B5CF6', '#0EA5E9', '#84CC16'];
  return palette[index % palette.length];
}

async function createChartNode(element, context, warnings) {
  const root = figma.createFrame();
  root.name = element.name || `Chart · ${element.id}`;
  root.resize(Math.max(1, element.geometry.width), Math.max(1, element.geometry.height));
  root.fills = [];
  root.clipsContent = true;
  safePluginData(root, 'pitchChartData', JSON.stringify(element.chart), warnings, `chart:${element.id}`);
  safePluginData(root, 'pitchChartInsight', String(element.chart?.insightStatement || ''), warnings, `chart:${element.id}:insight`);

  const chart = element.chart || {};
  const categories = chart.categories || [];
  const series = chart.series || [];
  const values = chartValues(chart);
  const { min, max } = chartScale(values);
  const plot = { left: 44, top: 20, right: Math.max(60, element.geometry.width - 16), bottom: Math.max(50, element.geometry.height - 38) };
  const plotWidth = Math.max(1, plot.right - plot.left);
  const plotHeight = Math.max(1, plot.bottom - plot.top);
  const range = max - min || 1;
  const zeroY = plot.top + (max / range) * plotHeight;
  const zeroX = plot.left + ((0 - min) / range) * plotWidth;

  const axisX = figma.createLine(); axisX.resize(plotWidth, 0.01); axisX.x = plot.left; axisX.y = Math.max(plot.top, Math.min(plot.bottom, zeroY)); axisX.strokes = [solidPaint('#98A2B3')]; axisX.strokeWeight = 1; root.appendChild(axisX);
  const axisY = figma.createLine(); axisY.resize(plotHeight, 0.01); axisY.rotation = -90; axisY.x = plot.left; axisY.y = plot.bottom; axisY.strokes = [solidPaint('#98A2B3')]; axisY.strokeWeight = 1; root.appendChild(axisY);

  if (chart.chartType === 'column') {
    const categoryCount = Math.max(1, categories.length || Math.max(0, ...series.map(item => item.values?.length || 0)));
    const groupWidth = plotWidth / categoryCount;
    const barGap = 3;
    const barWidth = Math.max(2, (groupWidth * 0.72 - Math.max(0, series.length - 1) * barGap) / Math.max(1, series.length));
    for (let categoryIndex = 0; categoryIndex < categoryCount; categoryIndex += 1) {
      for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex += 1) {
        const value = Number(series[seriesIndex].values?.[categoryIndex] ?? 0);
        const valueY = plot.top + ((max - value) / range) * plotHeight;
        const top = Math.min(zeroY, valueY);
        const height = Math.max(1, Math.abs(zeroY - valueY));
        const bar = figma.createRectangle();
        bar.name = `${series[seriesIndex].name || 'Series'} · ${categories[categoryIndex] || categoryIndex + 1}`;
        bar.resize(barWidth, height);
        bar.x = plot.left + categoryIndex * groupWidth + groupWidth * 0.14 + seriesIndex * (barWidth + barGap);
        bar.y = top;
        bar.fills = [solidPaint(chartColor(seriesIndex))];
        root.appendChild(bar);
      }
      const label = await createPrimitiveLabel(categories[categoryIndex] || String(categoryIndex + 1), groupWidth, 22, context, warnings, { fontSize: 10, color: '#667085', align: 'CENTER' });
      label.x = plot.left + categoryIndex * groupWidth;
      label.y = plot.bottom + 7;
      root.appendChild(label);
    }
  } else if (chart.chartType === 'bar') {
    const categoryCount = Math.max(1, categories.length || Math.max(0, ...series.map(item => item.values?.length || 0)));
    const groupHeight = plotHeight / categoryCount;
    const barGap = 3;
    const barHeight = Math.max(2, (groupHeight * 0.72 - Math.max(0, series.length - 1) * barGap) / Math.max(1, series.length));
    for (let categoryIndex = 0; categoryIndex < categoryCount; categoryIndex += 1) {
      const label = await createPrimitiveLabel(categories[categoryIndex] || String(categoryIndex + 1), Math.max(1, plot.left - 8), groupHeight, context, warnings, { fontSize: 10, color: '#667085', align: 'RIGHT' });
      label.x = 0; label.y = plot.top + categoryIndex * groupHeight; root.appendChild(label);
      for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex += 1) {
        const value = Number(series[seriesIndex].values?.[categoryIndex] ?? 0);
        const valueX = plot.left + ((value - min) / range) * plotWidth;
        const left = Math.min(zeroX, valueX);
        const width = Math.max(1, Math.abs(zeroX - valueX));
        const bar = figma.createRectangle();
        bar.name = `${series[seriesIndex].name || 'Series'} · ${categories[categoryIndex] || categoryIndex + 1}`;
        bar.resize(width, barHeight);
        bar.x = left;
        bar.y = plot.top + categoryIndex * groupHeight + groupHeight * 0.14 + seriesIndex * (barHeight + barGap);
        bar.fills = [solidPaint(chartColor(seriesIndex))];
        root.appendChild(bar);
      }
    }
  } else if (chart.chartType === 'line') {
    const pointCount = Math.max(1, categories.length || Math.max(0, ...series.map(item => item.values?.length || 0)));
    const xFor = index => pointCount <= 1 ? plot.left + plotWidth / 2 : plot.left + index / (pointCount - 1) * plotWidth;
    const yFor = value => plot.top + ((max - value) / range) * plotHeight;
    for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex += 1) {
      const current = series[seriesIndex];
      const points = (current.values || []).map((value, index) => ({ x: xFor(index), y: yFor(Number(value || 0)) }));
      for (let index = 0; index < points.length - 1; index += 1) {
        const a = points[index]; const b = points[index + 1];
        const dx = b.x - a.x; const dy = b.y - a.y;
        const segment = figma.createLine();
        segment.name = `${current.name || 'Series'} segment ${index + 1}`;
        segment.resize(Math.max(0.01, Math.hypot(dx, dy)), 0.01);
        segment.x = a.x; segment.y = a.y;
        segment.rotation = -Math.atan2(dy, dx) * 180 / Math.PI;
        segment.strokes = [solidPaint(chartColor(seriesIndex))]; segment.strokeWeight = 2;
        root.appendChild(segment);
      }
      points.forEach((point, index) => {
        const dot = figma.createEllipse();
        dot.name = `${current.name || 'Series'} point ${index + 1}`;
        dot.resize(7, 7); dot.x = point.x - 3.5; dot.y = point.y - 3.5; dot.fills = [solidPaint(chartColor(seriesIndex))];
        root.appendChild(dot);
      });
    }
    for (let categoryIndex = 0; categoryIndex < pointCount; categoryIndex += 1) {
      const label = await createPrimitiveLabel(categories[categoryIndex] || String(categoryIndex + 1), Math.min(100, plotWidth / pointCount + 20), 22, context, warnings, { fontSize: 10, color: '#667085', align: 'CENTER' });
      label.x = xFor(categoryIndex) - label.width / 2; label.y = plot.bottom + 7; root.appendChild(label);
    }
  } else if (chart.chartType === 'pie' || chart.chartType === 'doughnut') {
    const sliceValues = series[0]?.values || [];
    const total = sliceValues.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
    const size = Math.max(1, Math.min(plotWidth, plotHeight));
    let angle = -Math.PI / 2;
    sliceValues.forEach((value, index) => {
      const positive = Math.max(0, Number(value) || 0);
      const sweep = total > 0 ? positive / total * Math.PI * 2 : 0;
      const slice = figma.createEllipse();
      slice.name = categories[index] || `Slice ${index + 1}`;
      slice.resize(size, size);
      slice.x = plot.left + (plotWidth - size) / 2;
      slice.y = plot.top + (plotHeight - size) / 2;
      slice.fills = [solidPaint(chartColor(index))];
      safeSet(slice, 'arcData', { startingAngle: angle, endingAngle: angle + sweep, innerRadius: chart.chartType === 'doughnut' ? 0.58 : 0 }, warnings, `chart:${element.id}:slice`);
      root.appendChild(slice);
      angle += sweep;
    });
  } else {
    warnings.push(`chart:${element.id}: ${chart.chartType} has no editable primitive renderer yet; a placeholder was used`);
    const placeholder = figma.createFrame();
    placeholder.name = `Unsupported ${chart.chartType} chart`;
    placeholder.resize(plotWidth, plotHeight);
    placeholder.x = plot.left; placeholder.y = plot.top; placeholder.fills = []; placeholder.strokes = [solidPaint('#F59E0B')]; placeholder.dashPattern = [8, 6];
    root.appendChild(placeholder);
  }

  if (chart.insightStatement) {
    const insight = await createPrimitiveLabel(chart.insightStatement, Math.max(1, element.geometry.width - 20), 18, context, warnings, { fontSize: 10, color: '#475467' });
    insight.x = 10; insight.y = 0; root.appendChild(insight);
  }
  return root;
}

function createUnsupported(element, warnings) {
  const node = figma.createFrame();
  node.name = `[Pitch unsupported ${element.type}] ${element.name || element.id}`;
  resizeNode(node, element.geometry, warnings, `unsupported:${element.id}`);
  node.fills = [];
  node.strokes = [solidPaint('#F59E0B')];
  node.strokeWeight = 2;
  node.dashPattern = [8, 6];
  warnings.push(`${element.type}:${element.id}: created a visible placeholder instead of silently dropping the canonical object`);
  return node;
}

async function createLeaf(element, bundle, context, warnings) {
  if (element.type === 'text') return createText(element, context, warnings);
  if (element.type === 'image') return createImageNode(element, bundle, warnings);
  if (element.type === 'shape') return createShape(element, warnings);
  if (element.type === 'line') return createLine(element, warnings);
  if (element.type === 'table') return createTableNode(element, context, warnings);
  if (element.type === 'chart') return createChartNode(element, context, warnings);
  return createUnsupported(element, warnings);
}

async function createElementRecursive(element, parentNode, parentElement, sceneIndex, bundle, context, warnings, created) {
  let node;
  if (isContainer(element)) {
    node = figma.createFrame();
    node.name = element.name || (element.type === 'group' ? 'Group' : 'Frame');
    resizeNode(node, element.geometry, warnings, `${element.type}:${element.id}`);
    configureFrameAppearance(node, element, warnings);
  } else node = await createLeaf(element, bundle, context, warnings);

  setPluginIdentity(node, element);
  parentNode.appendChild(node);
  positionNode(node, element, parentElement);
  created.set(element.id, { node, element });

  if (isContainer(element)) {
    for (const childId of element.childIds || []) {
      const child = sceneIndex.get(childId);
      if (!child) { warnings.push(`${element.type}:${element.id}: missing canonical child ${childId}`); continue; }
      await createElementRecursive(child, node, element, sceneIndex, bundle, context, warnings, created);
    }
    configureAutoLayout(node, element, created, warnings);
  }
  return node;
}

function parentMap(scene) {
  const map = new Map();
  for (const element of scene) {
    if (!isContainer(element)) continue;
    for (const childId of element.childIds || []) map.set(childId, element.id);
  }
  return map;
}

async function makeSlideContainer(slide, deck, index, warnings) {
  if (figma.editorType === 'slides') {
    const node = figma.createSlide(0, index);
    node.name = slide.title || `Slide ${index + 1}`;
    node.setPluginData('pitchSlideId', slide.id);
    return node;
  }
  const node = figma.createFrame();
  node.name = `${String(index + 1).padStart(2, '0')} · ${slide.title || 'Slide'}`;
  node.resize(deck.canvas.widthDU, deck.canvas.heightDU);
  node.x = index * (deck.canvas.widthDU + 160);
  node.y = 0;
  node.clipsContent = true;
  node.fills = [solidPaint('#FFFFFF')];
  node.setPluginData('pitchSlideId', slide.id);
  return node;
}

async function importBundle(bundle) {
  if (!bundle || bundle.kind !== 'pitch-figma-bridge' || bundle.schemaVersion !== '0.1') throw new Error('Unsupported Pitch Figma bridge bundle');
  const deck = bundle.deck;
  const warnings = (bundle.warnings || []).map(w => `${w.elementId}: ${w.message}`);
  const availableFonts = await figma.listAvailableFontsAsync();
  const loaded = new Set();
  const context = {
    availableFonts,
    async loadFont(fontName) {
      const key = `${fontName.family}::${fontName.style}`;
      if (loaded.has(key)) return;
      await figma.loadFontAsync(fontName);
      loaded.add(key);
    },
  };

  let elementCount = 0;
  const roots = [];
  for (let slideIndex = 0; slideIndex < deck.slides.length; slideIndex += 1) {
    const slide = deck.slides[slideIndex];
    const slideNode = await makeSlideContainer(slide, deck, slideIndex, warnings);
    roots.push(slideNode);
    const scene = [...slide.scene].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
    const sceneIndex = new Map(scene.map(element => [element.id, element]));
    const parents = parentMap(scene);
    const created = new Map();
    for (const element of scene) {
      if (parents.has(element.id)) continue;
      await createElementRecursive(element, slideNode, null, sceneIndex, bundle, context, warnings, created);
    }
    elementCount += created.size;
  }

  figma.currentPage.selection = roots.filter(node => 'visible' in node);
  if (roots.length) figma.viewport.scrollAndZoomIntoView(roots);
  return { slides: deck.slides.length, elements: elementCount, warnings };
}

figma.ui.onmessage = async message => {
  if (!message || message.type !== 'IMPORT_PITCH_BUNDLE') return;
  try {
    const result = await importBundle(message.bundle);
    figma.ui.postMessage({ type: 'IMPORT_DONE', ...result });
    figma.notify(`Pitch Monumentum: imported ${result.slides} slide(s), ${result.elements} object(s)`, { timeout: 4000 });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    console.error(error);
    figma.ui.postMessage({ type: 'IMPORT_ERROR', message: messageText });
    figma.notify(`Pitch import failed: ${messageText}`, { error: true, timeout: 6000 });
  }
};
