import type {
  CreativeDirectorPlan,
  CreativePlanStep,
  CreativeRisk,
  CreativeScope,
  CreativeToolFamily,
} from "./index.js";

export type CreativeCanonicalTool =
  | "pitch_editor_command"
  | "pitch_media_command"
  | "pitch_design_command"
  | "pitch_component_command"
  | "pitch_master_command"
  | "pitch_motion_command";

export interface CreativeToolAction {
  id: string;
  stepId: string;
  tool: CreativeCanonicalTool;
  args: Record<string, unknown>;
}

export interface CreativeExecutionBundle {
  schemaVersion: "0.1";
  requestId: string;
  deckId: string;
  mode?: "currentBranch" | "previewBranch";
  previewBranchName?: string;
  approvedStepIds?: string[];
  directHighRiskWriteApproved?: boolean;
  actions: CreativeToolAction[];
}

export interface CreativeExecutionValidationIssue {
  severity: "warning" | "error";
  code:
    | "bundle-mismatch"
    | "plan-blocked"
    | "duplicate-action"
    | "unknown-step"
    | "non-edit-step"
    | "tool-family-mismatch"
    | "scope-violation"
    | "global-propagation-outside-deck-scope"
    | "approval-required"
    | "preview-branch-required"
    | "too-many-actions";
  actionId?: string;
  stepId?: string;
  message: string;
}

export interface CreativeExecutionValidation {
  valid: boolean;
  effectiveMode: "currentBranch" | "previewBranch";
  issues: CreativeExecutionValidationIssue[];
  orderedActions: CreativeToolAction[];
  highRiskActionIds: string[];
}

const TOOL_FAMILY: Record<CreativeCanonicalTool, CreativeToolFamily> = {
  pitch_editor_command: "editor",
  pitch_media_command: "media",
  pitch_design_command: "design",
  pitch_component_command: "component",
  pitch_master_command: "master",
  pitch_motion_command: "motion",
};

const GLOBAL_COMMANDS: Partial<Record<CreativeCanonicalTool, Set<string>>> = {
  pitch_design_command: new Set(["initializeTheme", "renameTheme", "setToken", "deleteToken"]),
  pitch_component_command: new Set(["updateFromSelection", "refreshInstances"]),
  pitch_master_command: new Set(["updateMasterFromSlide", "deleteMaster"]),
};

function riskRank(value: CreativeRisk): number {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item)) : [];
}

function actionSlideIds(action: CreativeToolAction): string[] {
  const ids = new Set<string>();
  if (typeof action.args.slideId === "string" && action.args.slideId) ids.add(action.args.slideId);
  for (const id of stringArray(action.args.slideIds)) ids.add(id);
  return [...ids];
}

function actionElementIds(action: CreativeToolAction): string[] {
  const ids = new Set<string>();
  if (typeof action.args.elementId === "string" && action.args.elementId) ids.add(action.args.elementId);
  for (const key of ["elementIds", "selectedIds"] as const) for (const id of stringArray(action.args[key])) ids.add(id);
  return [...ids];
}

function isSubset(values: string[], allowed: string[] | undefined): boolean {
  if (!values.length) return true;
  if (!allowed?.length) return false;
  const set = new Set(allowed);
  return values.every((value) => set.has(value));
}

function scopeAllows(scope: CreativeScope, action: CreativeToolAction): boolean {
  if (scope.kind === "deck") return true;
  if (!isSubset(actionSlideIds(action), scope.slideIds)) return false;
  if (scope.kind === "selection" && !isSubset(actionElementIds(action), scope.elementIds)) return false;
  return true;
}

function isGlobalAction(action: CreativeToolAction): boolean {
  const command = typeof action.args.command === "string" ? action.args.command : "";
  return Boolean(GLOBAL_COMMANDS[action.tool]?.has(command));
}

function allowedFamilies(step: CreativePlanStep): CreativeToolFamily[] {
  if (step.id === "edit_layout" && step.operation === "applyRecommendedMasterOrEditGeometry") return ["master", "editor"];
  if (step.id === "edit_system") return ["component", "design", "master"];
  if (step.id === "edit_brand" && step.operation === "bindOrStyleSelection") return ["design", "editor"];
  return [step.toolFamily];
}

function unresolvedPlanBlockers(plan: CreativeDirectorPlan, approvedStepIds: Set<string>): string[] {
  const approvalMessages = new Set(
    plan.steps
      .filter((step) => step.requiresExplicitApproval && approvedStepIds.has(step.id))
      .map((step) => `${step.id} requires explicit approval for global propagation`),
  );
  return plan.blockers.filter((message) => !approvalMessages.has(message));
}

export function validateCreativeExecutionBundle(plan: CreativeDirectorPlan, bundle: CreativeExecutionBundle): CreativeExecutionValidation {
  const issues: CreativeExecutionValidationIssue[] = [];
  const approved = new Set(bundle.approvedStepIds ?? []);
  const steps = new Map(plan.steps.map((step) => [step.id, step]));
  const seenActionIds = new Set<string>();
  const highRiskActionIds: string[] = [];

  if (bundle.schemaVersion !== "0.1" || bundle.requestId !== plan.requestId || bundle.deckId !== plan.deckId) {
    issues.push({ severity: "error", code: "bundle-mismatch", message: "Execution bundle does not match the Creative Director plan/deck." });
  }
  const unresolved = unresolvedPlanBlockers(plan, approved);
  if (unresolved.length) issues.push({ severity: "error", code: "plan-blocked", message: unresolved.join("; ") });
  if (bundle.actions.length > 80) issues.push({ severity: "error", code: "too-many-actions", message: "Creative execution is limited to 80 bounded tool actions per bundle." });

  for (const action of bundle.actions) {
    if (!action.id.trim() || seenActionIds.has(action.id)) {
      issues.push({ severity: "error", code: "duplicate-action", actionId: action.id, stepId: action.stepId, message: `Duplicate or empty action id ${action.id || "<empty>"}.` });
      continue;
    }
    seenActionIds.add(action.id);
    const step = steps.get(action.stepId);
    if (!step) {
      issues.push({ severity: "error", code: "unknown-step", actionId: action.id, stepId: action.stepId, message: `Action ${action.id} references unknown plan step ${action.stepId}.` });
      continue;
    }
    if (step.phase !== "edit") {
      issues.push({ severity: "error", code: "non-edit-step", actionId: action.id, stepId: step.id, message: `Action ${action.id} cannot execute against ${step.phase} step ${step.id}.` });
      continue;
    }
    const family = TOOL_FAMILY[action.tool];
    if (!allowedFamilies(step).includes(family)) {
      issues.push({ severity: "error", code: "tool-family-mismatch", actionId: action.id, stepId: step.id, message: `${action.tool} (${family}) is outside the allowed tool family for ${step.id}.` });
    }
    if (!scopeAllows(step.scope, action)) {
      issues.push({ severity: "error", code: "scope-violation", actionId: action.id, stepId: step.id, message: `Action ${action.id} targets slide/object handles outside the planned ${step.scope.kind} scope.` });
    }
    const global = isGlobalAction(action);
    const highRisk = step.risk === "high" || global;
    if (highRisk) highRiskActionIds.push(action.id);
    if (global && step.scope.kind !== "deck") {
      issues.push({ severity: "error", code: "global-propagation-outside-deck-scope", actionId: action.id, stepId: step.id, message: `Global command ${(action.args.command as string) || "<unknown>"} is not allowed from ${step.scope.kind} scope.` });
    }
    if (step.requiresExplicitApproval && !approved.has(step.id)) {
      issues.push({ severity: "error", code: "approval-required", actionId: action.id, stepId: step.id, message: `Step ${step.id} requires explicit approval before execution.` });
    }
  }

  const bundleMode = bundle.mode ?? (riskRank(plan.risk) >= riskRank("high") || highRiskActionIds.length ? "previewBranch" : "currentBranch");
  if (bundleMode === "currentBranch" && highRiskActionIds.length && !bundle.directHighRiskWriteApproved) {
    issues.push({ severity: "error", code: "preview-branch-required", message: "High-risk/global Creative Director edits must run in a preview branch unless directHighRiskWriteApproved is explicitly true." });
  }

  const order = new Map(plan.steps.map((step) => [step.id, step.order]));
  const orderedActions = [...bundle.actions].sort((a, b) => (order.get(a.stepId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.stepId) ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));
  return { valid: !issues.some((issue) => issue.severity === "error"), effectiveMode: bundleMode, issues, orderedActions, highRiskActionIds };
}
