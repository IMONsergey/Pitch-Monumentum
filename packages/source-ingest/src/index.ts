import { createHash } from "node:crypto";
import { readFile, copyFile, mkdir } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import type { SourceAnchor, SourceDocument, SourceLocator } from "../../deck-model/src/index.js";
import { readZipMap } from "./zip.js";

export type SourceBlockKind = "paragraph" | "slide" | "row" | "section" | "raw";
export interface SourceBlock {
  id: string;
  sourceId: string;
  kind: SourceBlockKind;
  anchor: SourceAnchor;
  text: string;
  metadata?: Record<string, unknown>;
}
export interface IngestedSource {
  source: SourceDocument;
  blocks: SourceBlock[];
  warnings: string[];
  importedCopyPath?: string;
}

function sha256(data: Buffer | string): string { return createHash("sha256").update(data).digest("hex"); }
function xmlUnescape(s:string):string { return s.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&"); }
function stripXmlTags(s:string):string { return xmlUnescape(s.replace(/<[^>]+>/g,"")); }
function normalizedText(s:string):string { return s.replace(/\u00a0/g," ").replace(/[ \t]+/g," ").replace(/\s*\n\s*/g,"\n").trim(); }
function stableId(prefix:string, seed:string):string { return `${prefix}_${sha256(seed).slice(0,16)}`; }

function block(sourceId:string, kind:SourceBlockKind, text:string, locator:SourceLocator, ordinal:number, metadata?:Record<string,unknown>):SourceBlock {
  const clean=normalizedText(text);
  const anchorId=stableId("anchor",`${sourceId}:${JSON.stringify(locator)}:${clean}`);
  const anchor:SourceAnchor={id:anchorId,sourceId,locator,excerpt:clean.slice(0,1200),checksum:sha256(clean)};
  return {id:stableId("block",`${anchorId}:${ordinal}`),sourceId,kind,anchor,text:clean,metadata};
}

function lineBlocks(sourceId:string,text:string,kind:SourceBlockKind="paragraph"):SourceBlock[]{
  const lines=text.replace(/\r\n/g,"\n").split("\n"); const out:SourceBlock[]=[]; let start=0; let buf:string[]=[];
  const flush=(end:number)=>{const value=buf.join("\n").trim(); if(value) out.push(block(sourceId,kind,value,{lineStart:start+1,lineEnd:end},out.length));buf=[];};
  lines.forEach((line,i)=>{if(!buf.length)start=i;if(line.trim()===""){flush(i);}else buf.push(line);}); flush(lines.length); return out;
}

function pptxBlocks(sourceId:string,buf:Buffer):SourceBlock[]{
  const zip=readZipMap(buf); const files=[...zip.keys()].filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b)=>Number(a.match(/slide(\d+)/)?.[1])-Number(b.match(/slide(\d+)/)?.[1]));
  return files.map((name,i)=>{const xml=zip.get(name)!.toString("utf8");const runs=[...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map(m=>xmlUnescape(m[1]));return block(sourceId,"slide",runs.join("\n"),{slide:i+1,part:name},i,{part:name});}).filter(b=>b.text.length>0);
}

function docxBlocks(sourceId:string,buf:Buffer):SourceBlock[]{
  const zip=readZipMap(buf); const doc=zip.get("word/document.xml"); if(!doc) throw new Error("DOCX missing word/document.xml"); const xml=doc.toString("utf8");
  const paragraphs=[...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)]; const out:SourceBlock[]=[];
  paragraphs.forEach((m,i)=>{const text=[...m[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(x=>xmlUnescape(x[1])).join("");if(text.trim())out.push(block(sourceId,"paragraph",text,{paragraph:i+1,part:"word/document.xml"},out.length));});return out;
}

function parseRelationships(xml:string):Map<string,string>{const out=new Map<string,string>();for(const m of xml.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/?\s*>/g))out.set(m[1],m[2]);return out;}
function xlsxBlocks(sourceId:string,buf:Buffer):SourceBlock[]{
  const zip=readZipMap(buf); const sharedXml=zip.get("xl/sharedStrings.xml")?.toString("utf8")??"";
  const shared=[...sharedXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(m=>[...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(t=>xmlUnescape(t[1])).join(""));
  const workbook=zip.get("xl/workbook.xml")?.toString("utf8")??""; const relXml=zip.get("xl/_rels/workbook.xml.rels")?.toString("utf8")??""; const rels=parseRelationships(relXml);
  const sheetNames=new Map<string,string>(); for(const m of workbook.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"[^>]*\/?\s*>/g)){const target=rels.get(m[2]);if(target)sheetNames.set(`xl/${target.replace(/^\.\.\//,"")}`,xmlUnescape(m[1]));}
  const sheets=[...zip.keys()].filter(n=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort(); const out:SourceBlock[]=[];
  for(const file of sheets){const xml=zip.get(file)!.toString("utf8");const sheet=sheetNames.get(file)??basename(file,".xml");for(const row of xml.matchAll(/<row\b[^>]*\br="([0-9]+)"[^>]*>([\s\S]*?)<\/row>/g)){const cells:string[]=[];let first="",last="";for(const c of row[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)){const attrs=c[1];const ref=attrs.match(/\br="([^"]+)"/)?.[1]??"";const type=attrs.match(/\bt="([^"]+)"/)?.[1];const raw=c[2].match(/<v>([\s\S]*?)<\/v>/)?.[1]??c[2].match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/)?.[1]??"";const value=type==="s"?shared[Number(raw)]??raw:xmlUnescape(raw);if(ref){first ||= ref;last=ref;}cells.push(value);}const text=cells.join("\t").trim();if(text)out.push(block(sourceId,"row",text,{sheet,range:first&&last?`${first}:${last}`:undefined,part:file},out.length,{sheet,row:Number(row[1])}));}}
  return out;
}

function jsonBlocks(sourceId:string,text:string):SourceBlock[]{
  const value=JSON.parse(text) as unknown; if(!value||typeof value!=="object"||Array.isArray(value))return [block(sourceId,"raw",JSON.stringify(value,null,2),{fragment:"$"},0)];
  return Object.entries(value as Record<string,unknown>).map(([key,v],i)=>block(sourceId,"section",`${key}:\n${typeof v==="string"?v:JSON.stringify(v,null,2)}`,{fragment:`$.${key}`},i));
}
function htmlBlocks(sourceId:string,text:string):SourceBlock[]{const body=text.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi,"\n");return lineBlocks(sourceId,stripXmlTags(body));}

export async function ingestFile(filePath:string,projectRoot?:string):Promise<IngestedSource>{
  const absolute=resolve(filePath); const data=await readFile(absolute); const checksum=sha256(data); const ext=extname(absolute).toLowerCase(); const sourceId=stableId("source",`${absolute}:${checksum}`);
  const kind:SourceDocument["kind"]=ext===".pdf"?"pdf":ext===".docx"?"docx":ext===".pptx"?"pptx":ext===".xlsx"?"xlsx":ext===".csv"||ext===".tsv"?"csv":ext===".md"||ext===".mdx"?"markdown":ext===".html"||ext===".htm"?"web":ext===".json"?"text":"text";
  const source:SourceDocument={id:sourceId,kind,title:basename(absolute),uri:absolute,checksum,importedAt:new Date().toISOString(),metadata:{extension:ext,bytes:data.length}};
  let blocks:SourceBlock[]=[]; const warnings:string[]=[];
  if(kind==="pptx")blocks=pptxBlocks(sourceId,data); else if(kind==="docx")blocks=docxBlocks(sourceId,data); else if(kind==="xlsx")blocks=xlsxBlocks(sourceId,data); else if(ext===".json")blocks=jsonBlocks(sourceId,data.toString("utf8")); else if(ext===".html"||ext===".htm")blocks=htmlBlocks(sourceId,data.toString("utf8")); else if(kind==="pdf")warnings.push("PDF source registered, but text/layout extraction requires the PDF parser adapter planned for the next ingestion layer."); else blocks=lineBlocks(sourceId,data.toString("utf8"),kind==="csv"?"row":"paragraph");
  let importedCopyPath:string|undefined; if(projectRoot){const dir=join(resolve(projectRoot),".project","sources");await mkdir(dir,{recursive:true});const copyPath:string=join(dir,`${sourceId}-${basename(absolute)}`);await copyFile(absolute,copyPath);importedCopyPath=copyPath;source.uri=copyPath;}
  if(!blocks.length&&kind!=="pdf")warnings.push("No readable content blocks were extracted."); return {source,blocks,warnings,importedCopyPath};
}
