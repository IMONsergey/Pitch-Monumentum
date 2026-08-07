export const STAGES = ["INTAKE","EVIDENCE","BRIEF","NARRATIVE","DESIGN","STORYBOARD","COMPOSE","QA_NARRATIVE","QA_EVIDENCE","QA_VISUAL","REPAIR","EXPORT","ROUNDTRIP_QA","READY"] as const;
export type Stage = (typeof STAGES)[number];
export type StageState = "pending" | "running" | "ready" | "stale" | "failed" | "skipped";
export interface StageRecord { stage: Stage; state: StageState; runId?: string; startedAt?: string; completedAt?: string; inputArtifactIds: string[]; outputArtifactIds: string[]; error?: string; }
export interface PipelineState { projectId: string; branchId: string; stages: Record<Stage, StageRecord>; }
export const STAGE_DEPENDENCIES: Record<Stage, Stage[]> = {
  INTAKE:[], EVIDENCE:["INTAKE"], BRIEF:["INTAKE","EVIDENCE"], NARRATIVE:["BRIEF","EVIDENCE"], DESIGN:["BRIEF"], STORYBOARD:["NARRATIVE","DESIGN"],
  COMPOSE:["STORYBOARD","DESIGN","EVIDENCE"], QA_NARRATIVE:["NARRATIVE","STORYBOARD","COMPOSE"], QA_EVIDENCE:["EVIDENCE","COMPOSE"], QA_VISUAL:["DESIGN","COMPOSE"],
  REPAIR:["QA_NARRATIVE","QA_EVIDENCE","QA_VISUAL"], EXPORT:["REPAIR"], ROUNDTRIP_QA:["EXPORT"], READY:["ROUNDTRIP_QA"]
};
export function createPipelineState(projectId:string,branchId:string):PipelineState { const stages={} as Record<Stage,StageRecord>; for(const stage of STAGES) stages[stage]={stage,state:"pending",inputArtifactIds:[],outputArtifactIds:[]}; return {projectId,branchId,stages}; }
export function canRun(state:PipelineState,stage:Stage):boolean { return STAGE_DEPENDENCIES[stage].every((d)=>["ready","skipped"].includes(state.stages[d].state)); }
export function downstreamStages(changedStage:Stage):Set<Stage> { const result=new Set<Stage>(); const visit=(s:Stage)=>{ for(const stage of STAGES){ if(STAGE_DEPENDENCIES[stage].includes(s)&&!result.has(stage)){ result.add(stage);visit(stage); } } }; visit(changedStage); return result; }
export function markDownstreamStale(state:PipelineState,changedStage:Stage):PipelineState { const copy:PipelineState=structuredClone(state); for(const stage of downstreamStages(changedStage)){ if(copy.stages[stage].state==="ready") copy.stages[stage].state="stale"; } return copy; }
export function earliestRunnableStage(state:PipelineState):Stage|undefined { return STAGES.find((stage)=>state.stages[stage].state!=="ready"&&state.stages[stage].state!=="skipped"&&canRun(state,stage)); }
