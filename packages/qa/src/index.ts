import type { DeckDocument, SceneElement } from "../../deck-model/src/index.js";
export type QACategory="schema"|"geometry"|"readability"|"evidence"|"narrative"|"visual"|"brand"|"export";
export type QASeverity="info"|"minor"|"major"|"critical";
export interface QAIssue { id:string; category:QACategory; severity:QASeverity; scope:{deckId:string;slideId?:string;elementIds?:string[];claimIds?:string[]}; message:string; suggestedAction?:string; autoFixSafe:boolean; status:"open"|"fixed"|"ignored"; }
export interface QualityScores { narrative:number;evidence:number;visual:number;readability:number;brand:number;exportEditability:number; }
export interface QAReport { id:string;deckId:string;createdAt:string;scores:QualityScores;weightedScore:number;ready:boolean;issues:QAIssue[]; }
export function weightedQualityScore(s:QualityScores):number{return s.narrative*.25+s.evidence*.25+s.visual*.2+s.readability*.1+s.brand*.1+s.exportEditability*.1;}
export function isReady(r:QAReport):boolean{if(r.issues.some(x=>x.status==="open"&&x.severity==="critical"))return false;return r.scores.narrative>=80&&r.scores.evidence>=90&&r.scores.visual>=80&&r.scores.readability>=90&&r.scores.exportEditability>=90;}

function issue(deckId:string,slideId:string|undefined,elementIds:string[]|undefined,category:QACategory,severity:QASeverity,message:string,autoFixSafe=false):QAIssue { return {id:`issue_${category}_${slideId??"deck"}_${elementIds?.join("_")??"x"}_${message.length}`,category,severity,scope:{deckId,slideId,elementIds},message,autoFixSafe,status:"open"}; }
function elementIds(slide:{scene:SceneElement[]}):string[]{return slide.scene.map(e=>e.id);}
export function runDeterministicQA(deck:DeckDocument):QAIssue[]{
  const out:QAIssue[]=[]; const seen=new Set<string>();
  for(const slide of deck.slides){
    if(seen.has(slide.id)) out.push(issue(deck.id,slide.id,undefined,"schema","critical","Duplicate slide id.")); seen.add(slide.id);
    const local=new Set<string>();
    for(const el of slide.scene){
      if(local.has(el.id)||seen.has(el.id)) out.push(issue(deck.id,slide.id,[el.id],"schema","critical","Duplicate scene element id.")); local.add(el.id); seen.add(el.id);
      const g=el.geometry;
      if(g.width<=0||g.height<=0) out.push(issue(deck.id,slide.id,[el.id],"geometry","critical","Element has zero or negative dimensions."));
      if(g.x<0||g.y<0||g.x+g.width>deck.canvas.widthDU||g.y+g.height>deck.canvas.heightDU) out.push(issue(deck.id,slide.id,[el.id],"geometry","major","Element extends outside the slide canvas."));
      if(el.type==="text"&&(g.x<72||g.y<60||g.x+g.width>deck.canvas.widthDU-72||g.y+g.height>deck.canvas.heightDU-50)) out.push(issue(deck.id,slide.id,[el.id],"readability","minor","Text is outside the default safe area."));
      if(el.exportStrategy==="unsupported") out.push(issue(deck.id,slide.id,[el.id],"export","critical","Element has unsupported export strategy."));
      if(el.exportStrategy==="rasterFallback"&&["text","chart","table"].includes(el.type)) out.push(issue(deck.id,slide.id,[el.id],"export","major","Semantic/editable content would be rasterized."));
      for(const dep of el.dependencies){ if(!dep.id) out.push(issue(deck.id,slide.id,[el.id],"schema","major","Element has a dangling dependency reference.")); }
    }
    if(elementIds(slide).length===0) out.push(issue(deck.id,slide.id,undefined,"schema","major","Slide contains no scene elements."));
    if(!slide.semantic.takeaway.trim()) out.push(issue(deck.id,slide.id,undefined,"narrative","major","Slide has no dominant takeaway."));
  }
  return out;
}
