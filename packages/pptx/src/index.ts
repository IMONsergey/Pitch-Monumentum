import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type {
  DeckDocument,
  LineElement,
  SceneElement,
  ShapeElement,
  TextElement,
  TextParagraph,
  TextRun,
} from "../../deck-model/src/index.js";

export const STANDARD_WIDE = { widthDU: 1920, heightDU: 1080, duPerInch: 144 } as const;
export const EMU_PER_DU = 914400 / STANDARD_WIDE.duPerInch;

export function duToInches(valueDU: number): number {
  return valueDU / STANDARD_WIDE.duPerInch;
}

export function duToEmu(valueDU: number): number {
  return Math.round(valueDU * EMU_PER_DU);
}

export type PptxElementResult = {
  elementId: string;
  strategy: "native" | "vector" | "rasterFallback" | "unsupported";
  warnings: string[];
};

export interface PptxCompileResult {
  outputPath: string;
  slideCount: number;
  elementResults: PptxElementResult[];
  warnings: string[];
  contentHash: string;
}

export interface RoundTripDiff {
  slideId: string;
  elementId?: string;
  kind: "missing" | "textChanged" | "geometryDrift" | "styleDrift" | "downgraded" | "extra";
  severity: "minor" | "major" | "critical";
  message: string;
}

export interface PptxCompiler {
  compile(deckArtifactPath: string, outputPath: string): Promise<PptxCompileResult>;
}

export interface PptxRoundTripValidator {
  compare(canonicalDeckPath: string, exportedPptxPath: string): Promise<RoundTripDiff[]>;
}

type ZipEntry = { name: string; data: Buffer };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value & 0xffff, 0);
  return buffer;
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

function zipStore(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const crc = crc32(data);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data,
    ]);
    locals.push(local);
    const central = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]);
    centrals.push(central);
    offset += local.length;
  }

  const localData = Buffer.concat(locals);
  const centralData = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralData.length), u32(localData.length), u16(0),
  ]);
  return Buffer.concat([localData, centralData, end]);
}

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function hex(color: string | undefined, fallback = "000000"): string {
  const normalized = (color ?? "").replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(normalized) ? normalized : fallback;
}

function xfrm(element: SceneElement): string {
  const geometry = element.geometry;
  const rotation = geometry.rotation ? ` rot="${Math.round(geometry.rotation * 60000)}"` : "";
  return `<a:xfrm${rotation}><a:off x="${duToEmu(geometry.x)}" y="${duToEmu(geometry.y)}"/><a:ext cx="${duToEmu(geometry.width)}" cy="${duToEmu(geometry.height)}"/></a:xfrm>`;
}

function paragraphAlignment(alignment: TextParagraph["align"]): string | undefined {
  if (alignment === "center") return "ctr";
  if (alignment === "right") return "r";
  if (alignment === "justify") return "just";
  if (alignment === "left") return "l";
  return undefined;
}

function runXml(run: TextRun): string {
  const attributes: string[] = ["lang=\"en-US\"", "dirty=\"0\""];
  if (run.bold) attributes.push('b="1"');
  if (run.italic) attributes.push('i="1"');
  if (run.underline) attributes.push('u="sng"');
  if (run.fontSizePt !== undefined) attributes.push(`sz="${Math.round(run.fontSizePt * 100)}"`);
  if (run.letterSpacingPt !== undefined && run.letterSpacingPt !== 0) {
    attributes.push(`spc="${Math.round(run.letterSpacingPt * 100)}"`, 'kern="0"');
  }

  const color = `<a:solidFill><a:srgbClr val="${hex(run.color, "000000")}"/></a:solidFill>`;
  const font = run.fontFamily
    ? `<a:latin typeface="${xml(run.fontFamily)}"/><a:ea typeface="${xml(run.fontFamily)}"/><a:cs typeface="${xml(run.fontFamily)}"/>`
    : "";
  return `<a:r><a:rPr ${attributes.join(" ")}>${color}${font}</a:rPr><a:t>${xml(run.text)}</a:t></a:r>`;
}

function paragraphPropertiesXml(paragraph: TextParagraph): string {
  const attributes: string[] = [];
  const alignment = paragraphAlignment(paragraph.align);
  if (alignment) attributes.push(`algn="${alignment}"`);
  if (paragraph.bullet) attributes.push(`lvl="${Math.max(0, Math.min(8, Math.round(paragraph.bullet.level)))}"`);

  const children: string[] = [];
  if (paragraph.lineSpacing !== undefined && paragraph.lineSpacing > 0) {
    children.push(`<a:lnSpc><a:spcPct val="${Math.round(paragraph.lineSpacing * 100000)}"/></a:lnSpc>`);
  }
  if (paragraph.spaceBeforePt !== undefined) {
    children.push(`<a:spcBef><a:spcPts val="${Math.round(paragraph.spaceBeforePt * 100)}"/></a:spcBef>`);
  }
  if (paragraph.spaceAfterPt !== undefined) {
    children.push(`<a:spcAft><a:spcPts val="${Math.round(paragraph.spaceAfterPt * 100)}"/></a:spcAft>`);
  }
  if (paragraph.bullet) {
    const marker = paragraph.bullet.marker ?? "•";
    if (/^(\d+[.)]|ordered|number)/i.test(marker)) children.push('<a:buAutoNum type="arabicPeriod"/>');
    else children.push(`<a:buChar char="${xml(marker)}"/>`);
  }

  const attrString = attributes.length ? ` ${attributes.join(" ")}` : "";
  return children.length ? `<a:pPr${attrString}>${children.join("")}</a:pPr>` : `<a:pPr${attrString}/>`;
}

function textBodyPropertiesXml(element: TextElement): string {
  const attributes: string[] = ["wrap=\"square\""];
  attributes.push(`anchor="${element.verticalAlign === "middle" ? "ctr" : element.verticalAlign === "bottom" ? "b" : "t"}"`);
  if (element.insetsDU) {
    const [top, right, bottom, left] = element.insetsDU;
    attributes.push(`lIns="${duToEmu(left)}"`, `tIns="${duToEmu(top)}"`, `rIns="${duToEmu(right)}"`, `bIns="${duToEmu(bottom)}"`);
  }
  const fit = element.fitPolicy === "shrinkText"
    ? "<a:normAutofit/>"
    : element.fitPolicy === "growBox"
      ? "<a:spAutoFit/>"
      : "";
  return fit ? `<a:bodyPr ${attributes.join(" ")}>${fit}</a:bodyPr>` : `<a:bodyPr ${attributes.join(" ")}/>`;
}

function textShape(element: TextElement, id: number): string {
  const paragraphs = element.paragraphs.map((paragraph) => (
    `<a:p>${paragraphPropertiesXml(paragraph)}${paragraph.runs.map(runXml).join("")}<a:endParaRPr lang="en-US" dirty="0"/></a:p>`
  )).join("");
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xml(element.name ?? element.id)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(element)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody>${textBodyPropertiesXml(element)}<a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

function dashXml(dash: "solid" | "dash" | "dot" | undefined): string {
  if (dash === "dash") return '<a:prstDash val="dash"/>';
  if (dash === "dot") return '<a:prstDash val="sysDot"/>';
  return "";
}

function shapeXml(element: ShapeElement, id: number): string {
  const preset = element.shape === "roundRect"
    ? "roundRect"
    : element.shape === "ellipse"
      ? "ellipse"
      : element.shape === "triangle"
        ? "triangle"
        : "rect";
  const fill = element.fill
    ? `<a:solidFill><a:srgbClr val="${hex(element.fill, "FFFFFF")}"/></a:solidFill>`
    : "<a:noFill/>";
  const line = element.stroke
    ? `<a:ln w="${Math.max(1, duToEmu(element.stroke.widthDU))}"><a:solidFill><a:srgbClr val="${hex(element.stroke.color)}"/></a:solidFill>${dashXml(element.stroke.dash)}</a:ln>`
    : "<a:ln><a:noFill/></a:ln>";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xml(element.name ?? element.id)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(element)}<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>${fill}${line}</p:spPr></p:sp>`;
}

function lineXml(element: LineElement, id: number): string {
  const startMarker = element.startMarker === "arrow" ? '<a:headEnd type="triangle"/>' : element.startMarker === "dot" ? '<a:headEnd type="oval"/>' : "";
  const endMarker = element.endMarker === "arrow" ? '<a:tailEnd type="triangle"/>' : element.endMarker === "dot" ? '<a:tailEnd type="oval"/>' : "";
  return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${xml(element.name ?? element.id)}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(element)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="${Math.max(1, duToEmu(element.stroke.widthDU))}"><a:solidFill><a:srgbClr val="${hex(element.stroke.color)}"/></a:solidFill>${dashXml(element.stroke.dash)}${startMarker}${endMarker}</a:ln></p:spPr></p:cxnSp>`;
}

function slideXml(slide: DeckDocument["slides"][number]): { xml: string; results: PptxElementResult[] } {
  let shapeId = 2;
  const results: PptxElementResult[] = [];
  const body: string[] = [];

  for (const element of [...slide.scene].sort((a, b) => a.zIndex - b.zIndex)) {
    if (element.type === "text") {
      body.push(textShape(element, shapeId++));
      results.push({ elementId: element.id, strategy: "native", warnings: [] });
    } else if (element.type === "shape") {
      body.push(shapeXml(element, shapeId++));
      results.push({ elementId: element.id, strategy: "native", warnings: [] });
    } else if (element.type === "line") {
      body.push(lineXml(element, shapeId++));
      results.push({ elementId: element.id, strategy: "native", warnings: [] });
    } else {
      results.push({ elementId: element.id, strategy: "unsupported", warnings: [`Base compiler does not emit ${element.type}; use an appropriate rich compiler`] });
    }
  }

  return {
    xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${body.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    results,
  };
}

function themeXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="PitchOS"><a:themeElements><a:clrScheme name="PitchOS"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F1F1F"/></a:dk2><a:lt2><a:srgbClr val="F2F2F2"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="PitchOS"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="PitchOS"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}

function masterXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`;
}

function layoutXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

export async function compileDeckToPptx(deck: DeckDocument, outputPath: string): Promise<PptxCompileResult> {
  const entries: ZipEntry[] = [];
  const add = (name: string, content: string) => entries.push({ name, data: Buffer.from(content, "utf8") });
  const results: PptxElementResult[] = [];

  const contentOverrides = deck.slides.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("");
  add("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${contentOverrides}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  add("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);

  const slideIds = deck.slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join("");
  add("ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${duToEmu(deck.canvas.widthDU)}" cy="${duToEmu(deck.canvas.heightDU)}" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  const presentationRelationships = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>',
    ...deck.slides.map((_, index) => `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`),
  ].join("");
  add("ppt/_rels/presentation.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${presentationRelationships}</Relationships>`);
  add("ppt/theme/theme1.xml", themeXml());
  add("ppt/slideMasters/slideMaster1.xml", masterXml());
  add("ppt/slideMasters/_rels/slideMaster1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`);
  add("ppt/slideLayouts/slideLayout1.xml", layoutXml());
  add("ppt/slideLayouts/_rels/slideLayout1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);

  for (let index = 0; index < deck.slides.length; index += 1) {
    const rendered = slideXml(deck.slides[index]);
    results.push(...rendered.results);
    add(`ppt/slides/slide${index + 1}.xml`, rendered.xml);
    add(`ppt/slides/_rels/slide${index + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`);
  }

  const now = new Date().toISOString();
  add("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(deck.title)}</dc:title><dc:creator>Pitch Monumentum</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  add("docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Pitch Monumentum</Application><Slides>${deck.slides.length}</Slides><PresentationFormat>Widescreen</PresentationFormat></Properties>`);

  const pptx = zipStore(entries);
  await writeFile(outputPath, pptx);
  return {
    outputPath,
    slideCount: deck.slides.length,
    elementResults: results,
    warnings: results.flatMap((result) => result.warnings),
    contentHash: createHash("sha256").update(pptx).digest("hex"),
  };
}
