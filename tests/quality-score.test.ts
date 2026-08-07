import test from "node:test";
import assert from "node:assert/strict";
import type { Claim, DeckDocument, EvidenceItem, SourceAnchor, SourceDocument } from "../packages/deck-model/src/index.js";
import { buildContextIndex } from "../packages/context-index/src/index.js";
import { scoreDeckQuality } from "../packages/quality-score/src/index.js";

function fixture(){
  const source:SourceDocument={id:"src",kind:"xlsx",title:"Metrics",uri:"metrics.xlsx",checksum:"x",importedAt:"2026-08-07T00:00:00Z"};
  const anchor:SourceAnchor={id:"a",sourceId:"src",locator:{sheet:"CAC",range:"B4"},excerpt:"76",checksum:"a"};
  const evidence:EvidenceItem={id:"e",kind:"number",anchorIds:["a"],value:76,normalizedText:"CAC=76"};
  const claim:Claim={id:"c",statement:"CAC fell to 76",dataClass:"source",evidenceRefs:["e"],confidence:1,verificationStatus:"verified"};
  const deck:DeckDocument={schemaVersion:"0.1",id:"d",title:"Decision",canvas:{widthDU:1920,heightDU:1080,duPerInch:144,aspectRatio:"16:9"},briefId:"b",narrativeId:"n",designSystemId:"ds",sourceIds:["src"],claimIds:["c"],activeBranchId:"branch_main",createdAt:"2026-08-07T00:00:00Z",updatedAt:"2026-08-07T00:00:00Z",slides:[{id:"s1",order:0,title:"Proof",archetype:"heroMetric",semantic:{purpose:"Prove efficiency",takeaway:"CAC fell to 76",questionAnswered:"Did it improve?",narrativeRole:"evidence",claimIds:["c"],evidenceRefs:["e"],audienceRelevance:"Board",density:"sparse"},status:"ready",qaIssueIds:[],dependencyIds:["c","e"],scene:[{id:"metric",type:"text",semanticRole:"metric",geometry:{x:140,y:180,width:1200,height:220},zIndex:1,origin:"deterministic",exportStrategy:"native",dependencies:[{kind:"claim",id:"c"}],paragraphs:[{runs:[{text:"76",fontSizePt:72,fontFamily:"Aptos",bold:true}]}]}]},{id:"s2",order:1,title:"Decision",archetype:"decision",semantic:{purpose:"Obtain approval",takeaway:"Approve phase two",questionAnswered:"What now?",narrativeRole:"decision",claimIds:[],evidenceRefs:[],audienceRelevance:"Board",density:"sparse"},status:"ready",qaIssueIds:[],dependencyIds:[],scene:[]}]};
  return{source,anchor,evidence,claim,deck};
}

test("verified evidence contributes a high score without a hard evidence gate",()=>{const f=fixture();const index=buildContextIndex({sources:[f.source],anchors:[f.anchor],evidence:[f.evidence],claims:[f.claim],deck:f.deck});const report=scoreDeckQuality({deck:f.deck,contextIndex:index});assert.equal(report.hardGateFailures.some(x=>x.lane==="evidence"),false);assert.ok(report.scores.evidence>=90);});

test("a stale factual claim blocks readiness even when the average score is otherwise high",()=>{const f=fixture();f.claim.verificationStatus="stale";const index=buildContextIndex({sources:[f.source],anchors:[f.anchor],evidence:[f.evidence],claims:[f.claim],deck:f.deck});index.health.claims.c="stale";const report=scoreDeckQuality({deck:f.deck,contextIndex:index});assert.equal(report.ready,false);assert.ok(report.hardGateFailures.some(x=>x.code==="claim-stale"));});
