import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { ArtifactStore } from "../../../packages/artifact-store/src/index.js";
import { propagateStale, extractEvidenceCandidates, type DependencyGraph } from "../../../packages/evidence/src/index.js";
import { ingestFile } from "../../../packages/source-ingest/src/index.js";
import { runDeterministicQA } from "../../../packages/qa/src/index.js";
import { renderDeckHtml } from "../../../packages/renderer/src/index.js";
import { compileDeckToPptx } from "../../../packages/pptx/src/index.js";
import type { DeckDocument, PresentationBrief, NarrativeGraph, DesignSystem } from "../../../packages/deck-model/src/index.js";

const args=process.argv.slice(2); const command=args[0]??"help";
async function loadDeck(path:string):Promise<DeckDocument>{return JSON.parse(await readFile(path,"utf8")) as DeckDocument;}
function demoDeck(now:string):DeckDocument{return {schemaVersion:"0.1",id:"deck_demo",title:"Pitch Monumentum — Phase 0",canvas:{widthDU:1920,heightDU:1080,duPerInch:144,aspectRatio:"16:9"},briefId:"brief_demo",narrativeId:"narrative_demo",designSystemId:"design_demo",sourceIds:["source_demo"],claimIds:["claim_demo"],activeBranchId:"branch_main",createdAt:now,updatedAt:now,slides:[{id:"slide_01",order:0,title:"The product thesis",archetype:"thesis",semantic:{purpose:"Define the product category",takeaway:"Pitch Monumentum turns evidence into decision-grade editable presentations.",questionAnswered:"What are we building?",narrativeRole:"thesis",claimIds:[],evidenceRefs:[],audienceRelevance:"Product direction",density:"sparse"},scene:[{id:"bg",type:"shape",semanticRole:"decoration",geometry:{x:0,y:0,width:1920,height:1080},zIndex:0,origin:"deterministic",exportStrategy:"native",dependencies:[],shape:"rect",fill:"#0D0E11"},{id:"kicker",type:"text",semanticRole:"label",geometry:{x:150,y:150,width:700,height:70},zIndex:1,origin:"agent",exportStrategy:"native",dependencies:[],paragraphs:[{runs:[{text:"PITCH MONUMENTUM / PITCHOS",fontSizePt:18,bold:true,color:"#C7FF5E"}]}],fitPolicy:"fixed"},{id:"title",type:"text",semanticRole:"title",geometry:{x:150,y:290,width:1480,height:330},zIndex:2,origin:"agent",exportStrategy:"native",dependencies:[],paragraphs:[{runs:[{text:"Evidence → argument → presentation",fontSizePt:58,bold:true,color:"#F4F5F7"}]}],fitPolicy:"shrinkText"},{id:"body",type:"text",semanticRole:"body",geometry:{x:150,y:690,width:1250,height:140},zIndex:3,origin:"agent",exportStrategy:"native",dependencies:[],paragraphs:[{runs:[{text:"The deck remains source-grounded, branchable and deeply editable instead of collapsing into a generated bitmap.",fontSizePt:25,color:"#B2B8C2"}]}],fitPolicy:"shrinkText"}],status:"draft",qaIssueIds:[],dependencyIds:[]} ]};}
async function demo(dirArg?:string){const dir=resolve(dirArg??".pitch-demo");const store=new ArtifactStore(dir);const manifest=await store.init("PitchOS demo","project_demo");const now=new Date().toISOString();
  const brief:PresentationBrief={id:"brief_demo",language:"en",audience:"Pitch Monumentum builders",communicationIntent:"Define the Phase 0 architecture",audienceOutcome:"Understand the canonical domain spine",coreMessage:"Own evidence, narrative and scene state",deliveryContext:"working artifact",sourceDivergence:"free within blueprint",readingMode:"balanced",pageBudget:{min:1,target:1,max:3},mustInclude:[],mustNotChange:[],brandConstraints:[],assumptions:[]};
  const narrative:NarrativeGraph={id:"narrative_demo",nodes:[{id:"n1",kind:"claim",label:"Evidence becomes a professional editable deck"}],edges:[],sectionOrder:[],rationale:"Minimal demo"};
  const design:DesignSystem={id:"design_demo",name:"PitchOS Dark",tokens:{colors:{canvas:"#0D0E11",accent:"#C7FF5E"},fonts:{display:"Inter",body:"Inter"},typeScalePt:{display:58,body:25},spacingDU:{m:24,l:48}},grid:{marginXDU:144,marginYDU:96,columns:12,gutterDU:24},chartRules:[],imageRules:[],iconRules:[],forbiddenTreatments:[],recipeIds:[]};
  const b=await store.write({id:"brief_demo",kind:"brief",payload:brief,producer:{type:"deterministic"}}); const n=await store.write({id:"narrative_demo",kind:"narrative",payload:narrative,producer:{type:"deterministic"},inputs:[b]}); const d=await store.write({id:"design_demo",kind:"design",payload:design,producer:{type:"deterministic"},inputs:[b]}); const deck=demoDeck(now); const de=await store.write({id:"deck_demo",kind:"deck",payload:deck,producer:{type:"deterministic"},inputs:[n,d]});
  const issues=runDeterministicQA(deck); await store.write({id:"qa_demo",kind:"qa",payload:{deckId:deck.id,issues},producer:{type:"deterministic"},inputs:[de],status:issues.some(i=>i.severity==="critical")?"needsReview":"ready"});
  await mkdir(join(dir,"preview"),{recursive:true}); await writeFile(join(dir,"preview","deck.html"),renderDeckHtml(deck),"utf8");
  await mkdir(join(dir,"exports"),{recursive:true}); const pptx=await compileDeckToPptx(deck,join(dir,"exports","deck.pptx"));
  const graph:DependencyGraph={nodes:[{id:"source_demo",kind:"source",status:"valid"},{id:"ev_demo",kind:"evidence",status:"valid"},{id:"claim_demo",kind:"claim",status:"valid"},{id:"slide_01",kind:"slide",status:"valid"}],edges:[{from:"source_demo",to:"ev_demo"},{from:"ev_demo",to:"claim_demo"},{from:"claim_demo",to:"slide_01"}]}; await writeFile(join(dir,".project","dependency-graph.json"),JSON.stringify(graph,null,2)+"\n","utf8");
  console.log(JSON.stringify({project:manifest.projectId,directory:dir,preview:join(dir,"preview","deck.html"),qaIssues:issues.length,pptx:join(dir,"exports","deck.pptx"),nativePptxObjects:pptx.elementResults.filter(x=>x.strategy==="native").length,artifactCount:Object.keys((await store.readManifest()).artifacts).length},null,2));}
async function status(dirArg?:string){const dir=resolve(dirArg??".pitch-demo");const store=new ArtifactStore(dir);const manifest=await store.readManifest();console.log(JSON.stringify({projectId:manifest.projectId,name:manifest.name,activeBranchId:manifest.activeBranchId,branches:Object.values(manifest.branches),artifacts:manifest.artifacts},null,2));}
async function qa(path?:string){if(!path)throw new Error("qa requires deck JSON path");const deck=await loadDeck(resolve(path));const issues=runDeterministicQA(deck);console.log(JSON.stringify(issues,null,2));if(issues.some(i=>i.severity==="critical"))process.exitCode=2;}
async function render(input?:string,output?:string){if(!input||!output)throw new Error("render requires input deck JSON and output HTML");const deck=await loadDeck(resolve(input));await writeFile(resolve(output),renderDeckHtml(deck),"utf8");console.log(resolve(output));}

async function pptx(input?:string,output?:string){if(!input||!output)throw new Error("pptx requires input deck JSON and output PPTX");const deck=await loadDeck(resolve(input));const result=await compileDeckToPptx(deck,resolve(output));console.log(JSON.stringify(result,null,2));if(result.elementResults.some(x=>x.strategy==="unsupported"))process.exitCode=3;}

async function ingest(projectDir?:string,files:string[]=[]){
  if(!projectDir||files.length===0)throw new Error("ingest requires project directory and at least one source file");
  const dir=resolve(projectDir);const store=new ArtifactStore(dir);await store.init("Pitch Monumentum project");
  const graphPath=join(dir,".project","dependency-graph.json");let graph:DependencyGraph={nodes:[],edges:[]};
  try{graph=JSON.parse(await readFile(graphPath,"utf8")) as DependencyGraph;}catch{}
  const result=[];
  for(const file of files){
    const src=await ingestFile(file,dir);
    const srcArtifact=await store.write({id:src.source.id,kind:"source",payload:src.source,producer:{type:"deterministic"}});
    const blocksArtifact=await store.write({id:`${src.source.id}_blocks`,kind:"source-blocks",payload:src.blocks,producer:{type:"deterministic"},inputs:[srcArtifact]});
    const evidence=extractEvidenceCandidates(src);
    const evidenceArtifact=await store.write({id:`${src.source.id}_evidence`,kind:"evidence-candidates",payload:evidence,producer:{type:"deterministic"},inputs:[blocksArtifact]});
    const addNode=(id:string,kind:any)=>{if(!graph.nodes.some(n=>n.id===id))graph.nodes.push({id,kind,status:"valid"});}; const addEdge=(from:string,to:string)=>{if(!graph.edges.some(e=>e.from===from&&e.to===to))graph.edges.push({from,to});};
    addNode(src.source.id,"source");
    for(const b of src.blocks){addNode(b.anchor.id,"anchor");addEdge(src.source.id,b.anchor.id);}
    for(const ev of evidence){addNode(ev.id,"evidence");for(const anchor of ev.anchorIds)addEdge(anchor,ev.id);}
    result.push({file:resolve(file),sourceId:src.source.id,kind:src.source.kind,blocks:src.blocks.length,evidenceCandidates:evidence.length,warnings:src.warnings,artifactIds:[srcArtifact.id,blocksArtifact.id,evidenceArtifact.id]});
  }
  await writeFile(graphPath,JSON.stringify(graph,null,2)+"\n","utf8");console.log(JSON.stringify({projectDir:dir,sources:result},null,2));
}

async function stale(dirArg?:string,changed="source_demo"){const dir=resolve(dirArg??".pitch-demo");const graph=JSON.parse(await readFile(join(dir,".project","dependency-graph.json"),"utf8")) as DependencyGraph;const next=propagateStale(graph,[changed]);await writeFile(join(dir,".project","dependency-graph.json"),JSON.stringify(next,null,2)+"\n","utf8");console.log(JSON.stringify(next,null,2));}
async function main(){
  if(command==="demo")return demo(args[1]);
  if(command==="status")return status(args[1]);
  if(command==="qa")return qa(args[1]);
  if(command==="render")return render(args[1],args[2]);
  if(command==="pptx")return pptx(args[1],args[2]);
  if(command==="ingest")return ingest(args[1],args.slice(2));
  if(command==="stale")return stale(args[1],args[2]);
  console.log(`PitchOS CLI\n  demo [dir]\n  status [dir]\n  qa <deck.json>\n  render <deck.json> <out.html>\n  pptx <deck.json> <out.pptx>\n  ingest <project-dir> <source...>\n  stale [dir] [nodeId]`);
}
main().catch((e)=>{console.error(e);process.exitCode=1;});
