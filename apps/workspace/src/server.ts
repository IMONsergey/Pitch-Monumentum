import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ArtifactStore, type ProjectManifest, type BranchArtifactHead } from "../../../packages/artifact-store/src/index.js";
import type { DeckDocument } from "../../../packages/deck-model/src/index.js";
import { applyDeckMutation, createMutation, deckHash, type DeckMutationOperation } from "../../../packages/mutations/src/index.js";
import { runDeterministicQA } from "../../../packages/qa/src/index.js";
import { compileDeckToPptx } from "../../../packages/pptx/src/index.js";
import { workspaceHtml } from "./ui.js";

function json(res:any,status:number,value:unknown){res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});res.end(JSON.stringify(value));}
async function body(req:any):Promise<any>{const parts:Buffer[]=[];for await(const chunk of req)parts.push(Buffer.from(chunk));if(!parts.length)return {};return JSON.parse(Buffer.concat(parts).toString("utf8"));}
function activeHeadByKind(manifest:ProjectManifest,kind:string):BranchArtifactHead|undefined{return Object.values(manifest.branches[manifest.activeBranchId]?.heads??{}).find(head=>head.kind===kind);}

export class PitchWorkspaceService {
  readonly root:string; readonly store:ArtifactStore;
  constructor(root:string){this.root=resolve(root);this.store=new ArtifactStore(this.root);}
  async state(){const manifest=await this.store.readManifest();const head=activeHeadByKind(manifest,"deck");if(!head)throw new Error("No deck artifact on active branch");const deck=(await this.store.read<DeckDocument>(head.id,head.version)).payload;const qa=runDeterministicQA(deck);return {manifest,deck,deckHash:deckHash(deck),qa};}
  async mutate(input:{reason?:string;operations:DeckMutationOperation[];expectedDeckHash?:string}){const current=await this.state();const head=activeHeadByKind(current.manifest,"deck")!;const mutation=createMutation(input.reason??"Workspace edit",input.operations,"user",input.expectedDeckHash);const applied=applyDeckMutation(current.deck,mutation);const deckArtifact=await this.store.write({id:head.id,kind:"deck",payload:applied.deck,producer:{type:"user"},inputs:[head]});const qa=runDeterministicQA(applied.deck);await this.store.write({id:"qa_current",kind:"qa",payload:{deckId:applied.deck.id,issues:qa,mutationId:mutation.id,impact:applied.impact},producer:{type:"deterministic"},inputs:[deckArtifact],status:qa.some(i=>i.severity==="critical")?"needsReview":"ready"});return this.state();}
  async fork(name:string){const id=await this.store.forkBranch(name);const current=await this.state();const head=activeHeadByKind(current.manifest,"deck")!;await this.store.write({id:head.id,kind:"deck",payload:{...current.deck,activeBranchId:id,updatedAt:new Date().toISOString()},producer:{type:"deterministic"},inputs:[head]});return this.state();}
  async checkout(branchId:string){await this.store.checkoutBranch(branchId);return this.state();}
  async exportPptx(){const current=await this.state();const head=activeHeadByKind(current.manifest,"deck")!;const dir=join(this.root,".project","exports");await mkdir(dir,{recursive:true});const path=join(dir,`${current.deck.id}-v${head.version}.pptx`);const result=await compileDeckToPptx(current.deck,path);return {path,result};}
}

export function createWorkspaceServer(projectRoot:string){const service=new PitchWorkspaceService(projectRoot);const server=createServer(async(req:any,res:any)=>{try{const url=new URL(req.url??"/","http://local");if(req.method==="GET"&&url.pathname==="/"){res.writeHead(200,{"content-type":"text/html; charset=utf-8"});res.end(workspaceHtml());return}if(req.method==="GET"&&url.pathname==="/api/project"){json(res,200,await service.state());return}if(req.method==="POST"&&url.pathname==="/api/mutate"){json(res,200,await service.mutate(await body(req)));return}if(req.method==="POST"&&url.pathname==="/api/branch"){const data=await body(req);if(!data.name)throw new Error("Branch name required");json(res,200,await service.fork(data.name));return}if(req.method==="POST"&&url.pathname==="/api/checkout"){const data=await body(req);if(!data.branchId)throw new Error("branchId required");json(res,200,await service.checkout(data.branchId));return}if(req.method==="POST"&&url.pathname==="/api/export"){json(res,200,await service.exportPptx());return}json(res,404,{error:"Not found"});}catch(error){json(res,400,{error:error instanceof Error?error.message:String(error)});}});return {server,service};}

if(process.argv[1]?.endsWith("server.js")){const projectRoot=process.argv[2]??".pitch-demo";const port=Number(process.argv[3]??"4173");const {server}=createWorkspaceServer(projectRoot);server.listen(port,"127.0.0.1",()=>console.log(`Pitch Monumentum workspace: http://127.0.0.1:${port}`));}
