import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { ingestFile } from "../packages/source-ingest/src/index.js";
import { extractEvidenceCandidates } from "../packages/evidence/src/index.js";
import { compileDeckToPptx } from "../packages/pptx/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";

const root="/tmp/pitchos-ingest-test";

test("markdown ingestion preserves line anchors and finds numeric evidence candidates",async()=>{
  await rm(root,{recursive:true,force:true});await mkdir(root,{recursive:true});
  const path=`${root}/brief.md`;await writeFile(path,"# Growth\n\nCAC decreased by 24% in Q2.\nRevenue reached €10m.\n","utf8");
  const ingested=await ingestFile(path,root);
  assert.equal(ingested.source.kind,"markdown");
  assert.equal(ingested.blocks.length,2);
  assert.deepEqual([ingested.blocks[1].anchor.locator.lineStart,ingested.blocks[1].anchor.locator.lineEnd],[3,4]);
  const evidence=extractEvidenceCandidates(ingested);
  assert.ok(evidence.some(x=>x.rawMatch.includes("24%")));
  assert.ok(evidence.some(x=>x.rawMatch.includes("10m")));
  assert.equal(evidence.some(x=>x.rawMatch==="2"),false);
});

test("generated native PPTX can be ingested back into slide-anchored source blocks",async()=>{
  await rm(root,{recursive:true,force:true});await mkdir(root,{recursive:true});const now=new Date().toISOString();
  const deck:DeckDocument={schemaVersion:"0.1",id:"d",title:"Roundtrip source",canvas:{widthDU:1920,heightDU:1080,duPerInch:144,aspectRatio:"16:9"},briefId:"b",narrativeId:"n",designSystemId:"ds",sourceIds:[],claimIds:[],activeBranchId:"main",createdAt:now,updatedAt:now,slides:[{id:"s1",order:0,title:"Metrics",archetype:"heroMetric",semantic:{purpose:"p",takeaway:"CAC fell 24%",questionAnswered:"q",narrativeRole:"evidence",claimIds:[],evidenceRefs:[],audienceRelevance:"a",density:"sparse"},scene:[{id:"t",type:"text",semanticRole:"title",geometry:{x:150,y:200,width:1400,height:300},zIndex:1,origin:"agent",exportStrategy:"native",dependencies:[],paragraphs:[{runs:[{text:"CAC fell 24%",fontSizePt:54,bold:true,color:"#FFFFFF"}]}]}],status:"draft",qaIssueIds:[],dependencyIds:[]} ]};
  const path=`${root}/deck.pptx`;await compileDeckToPptx(deck,path);const ingested=await ingestFile(path);
  assert.equal(ingested.source.kind,"pptx");assert.equal(ingested.blocks.length,1);assert.equal(ingested.blocks[0].anchor.locator.slide,1);assert.match(ingested.blocks[0].text,/CAC fell 24%/);
});
