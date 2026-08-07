export interface CodexThreadBinding { projectId:string; branchId:string; threadId:string; sessionId?:string; purpose:"orchestrator"|"worker"|"reviewer"; parentThreadId?:string; lastTurnId?:string; status:"idle"|"active"|"archived"|"error"; }
export interface SelectionContext { deckId:string; slideIds?:string[]; elementIds?:string[]; narrativeNodeIds?:string[]; claimIds?:string[]; sourceAnchorIds?:string[]; region?:{slideId:string;x:number;y:number;width:number;height:number}; }
export interface CodexMutationRequest { threadId:string; userInstruction:string; selection:SelectionContext; canonicalArtifactRefs:string[]; expectedOutput:"artifactPatch"|"newArtifact"|"qaReport"|"branchProposal"|"userFacingAnswer"; }
export interface ArtifactPatchOperation { op:"add"|"remove"|"replace"|"move"; path:string; value?:unknown; from?:string; }
export interface ArtifactPatch { targetArtifactId:string; baseVersion:number; reason:string; operations:ArtifactPatchOperation[]; invalidates:string[]; }
