import type { DeckDocument, SceneElement, SlideDocument } from "../../deck-model/src/index.js";
import { applyDeckMutation, createMutation, type AppliedMutation, type DeckMutationOperation } from "../../mutations/src/index.js";

export type EditScopeKind = "element" | "slide" | "section" | "deck";
export interface EditSelection { scope: EditScopeKind; slideIds: string[]; elementIds: string[]; sectionId?: string; }
export interface AgentEditTask {
  kind: "edit-selection";
  instruction: string;
  contract: string;
  selection: EditSelection;
  context: {
    deck: { id: string; title: string; canvas: DeckDocument["canvas"] };
    slides: Array<{ id: string; title: string; sectionId?: string; semantic: SlideDocument["semantic"]; elements: SceneElement[] }>;
  };
}
export interface AgentEditProposal {
  summary: string;
  operations: DeckMutationOperation[];
  requiresScopeExpansion?: { reason: string; requestedScope: EditScopeKind; slideIds?: string[] };
}
export interface CodexEditReasoner { runStructured<TOutput>(task: AgentEditTask): Promise<TOutput>; }
export interface ValidatedEditProposal { proposal: AgentEditProposal; autoApplicable: boolean; scopeExpansionReason?: string; }

function selectedSlides(deck: DeckDocument, selection: EditSelection): SlideDocument[] {
  if (selection.scope === "deck") return deck.slides;
  if (selection.scope === "section") return deck.slides.filter((slide) => slide.sectionId === selection.sectionId || selection.slideIds.includes(slide.id));
  return deck.slides.filter((slide) => selection.slideIds.includes(slide.id));
}
export function createAgentEditTask(deck: DeckDocument, selection: EditSelection, instruction: string): AgentEditTask {
  const slides = selectedSlides(deck, selection);
  if (!slides.length) throw new Error("Selection does not resolve to any slide");
  const selectedElementIds = new Set(selection.elementIds);
  return {
    kind: "edit-selection", instruction,
    contract: [
      "Return typed DeckMutationOperation objects only; never return arbitrary JSON Patch.",
      "Treat the selection as the default mutation boundary.",
      "Do not invent slide ids, element ids, claim ids, evidence ids or data.",
      "If the requested outcome genuinely needs a wider edit, return requiresScopeExpansion instead of mutating outside the selection.",
      "Preserve factual meaning unless the instruction explicitly asks to revise it and supplied semantic/evidence context supports that revision."
    ].join("\n"),
    selection,
    context: {
      deck: { id: deck.id, title: deck.title, canvas: deck.canvas },
      slides: slides.map((slide) => ({ id: slide.id, title: slide.title, sectionId: slide.sectionId, semantic: slide.semantic, elements: selection.scope === "element" ? slide.scene.filter((element) => selectedElementIds.has(element.id)) : slide.scene }))
    }
  };
}
function known(deck: DeckDocument): { slideIds: Set<string>; elementsBySlide: Map<string, Set<string>> } {
  return { slideIds: new Set(deck.slides.map((s) => s.id)), elementsBySlide: new Map(deck.slides.map((s) => [s.id, new Set(s.scene.map((e) => e.id))])) };
}
function target(op: DeckMutationOperation): { slideId?: string; elementId?: string } {
  if (op.op === "moveSlide") return { slideId: op.slideId };
  if ("slideId" in op) return { slideId: op.slideId, elementId: "elementId" in op ? op.elementId : undefined };
  return {};
}
export function validateAgentEditProposal(deck: DeckDocument, selection: EditSelection, proposal: AgentEditProposal): ValidatedEditProposal {
  if (proposal.requiresScopeExpansion) return { proposal, autoApplicable: false, scopeExpansionReason: proposal.requiresScopeExpansion.reason };
  const ids = known(deck), selectedSlideIds = new Set(selectedSlides(deck, selection).map((s) => s.id)), selectedElementIds = new Set(selection.elementIds);
  for (const op of proposal.operations) {
    const t = target(op);
    if (t.slideId && !ids.slideIds.has(t.slideId)) throw new Error(`Agent proposed unknown slide id: ${t.slideId}`);
    if (t.elementId && !ids.elementsBySlide.get(t.slideId!)?.has(t.elementId)) throw new Error(`Agent proposed unknown element id: ${t.elementId}`);
    if (selection.scope !== "deck" && t.slideId && !selectedSlideIds.has(t.slideId)) throw new Error(`Agent edit escaped selected slide scope: ${t.slideId}`);
    if (selection.scope === "element") {
      if (op.op === "moveSlide" || op.op === "setSlideTitle" || op.op === "updateSlideSemantic") throw new Error(`Operation ${op.op} is wider than element selection`);
      if (op.op === "addElement") throw new Error("Adding elements requires slide scope or wider");
      if (t.elementId && !selectedElementIds.has(t.elementId)) throw new Error(`Agent edit escaped selected element scope: ${t.elementId}`);
    }
    if (selection.scope === "slide" && op.op === "moveSlide") throw new Error("Reordering slides requires section or deck scope");
  }
  return { proposal, autoApplicable: true };
}
export async function proposeAndApplyAgentEdit(deck: DeckDocument, selection: EditSelection, instruction: string, reasoner: CodexEditReasoner): Promise<{ validated: ValidatedEditProposal; applied?: AppliedMutation }> {
  const proposal = await reasoner.runStructured<AgentEditProposal>(createAgentEditTask(deck, selection, instruction));
  const validated = validateAgentEditProposal(deck, selection, proposal);
  if (!validated.autoApplicable) return { validated };
  const mutation = createMutation(proposal.summary || instruction, proposal.operations, "codex");
  return { validated, applied: applyDeckMutation(deck, mutation) };
}
