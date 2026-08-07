import type { EvidenceItem } from "../../deck-model/src/index.js";
import type { IngestedSource, SourceBlock } from "../../source-ingest/src/index.js";
import { createHash } from "node:crypto";

export interface EvidenceCandidate extends EvidenceItem { blockId:string; rawMatch:string; }
const NUMBER_PATTERN=/(?:[$€£₽]\s*)?[-+]?\d[\d\s,.]*(?:\s?%|\s?(?:k|m|bn|b|тыс\.?|млн|млрд))?/gi;
function id(seed:string):string{return `evidence_${createHash("sha256").update(seed).digest("hex").slice(0,16)}`;}
function candidatesFromBlock(block:SourceBlock):EvidenceCandidate[]{const out:EvidenceCandidate[]=[];for(const m of block.text.matchAll(NUMBER_PATTERN)){const raw=m[0].trim();const start=m.index??0;const before=start>0?block.text[start-1]:"";if(!raw||!/\d/.test(raw)||/[A-Za-zА-Яа-я]/.test(before))continue;out.push({id:id(`${block.anchor.id}:${m.index}:${raw}`),kind:"number",anchorIds:[block.anchor.id],value:raw,normalizedText:block.text,blockId:block.id,rawMatch:raw});}return out;}
export function extractEvidenceCandidates(source:IngestedSource):EvidenceCandidate[]{return source.blocks.flatMap(candidatesFromBlock);}
