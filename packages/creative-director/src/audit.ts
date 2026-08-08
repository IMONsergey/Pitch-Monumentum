import type { CreativeDirectorPlan, CreativeExecutionReview } from "./index.js";
import type { CreativeExecutionValidation, CreativeToolAction } from "./execution.js";

export interface CreativeAuditTrace {
  actionId: string;
  stepId: string;
  tool: CreativeToolAction["tool"];
  beforeDeckHash: string;
  afterDeckHash: string;
  branchId: string;
  ok: boolean;
  reason?: string;
  error?: string;
}

export interface CreativeRunAuditRecord {
  schemaVersion: "0.1";
  id: string;
  requestId: string;
  deckId: string;
  createdAt: string;
  originalBranchId: string;
  executionBranchId: string;
  previewBranchId?: string;
  effectiveMode: "currentBranch" | "previewBranch";
  plan: CreativeDirectorPlan;
  validation: CreativeExecutionValidation;
  actions: CreativeToolAction[];
  traces: CreativeAuditTrace[];
  review?: CreativeExecutionReview;
  accepted?: boolean;
  rejectedPreviewReturnedToOriginal: boolean;
  error?: string;
}
