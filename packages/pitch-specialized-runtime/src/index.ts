import { ArtifactStore, type BranchArtifactHead, type ProjectManifest } from "../../artifact-store/src/index.js";
import type { DeckDocument } from "../../deck-model/src/index.js";
import { applyDeckMutation, createMutation, deckHash } from "../../mutations/src/index.js";
import { VersionJournal } from "../../version-history/src/index.js";
import { runDeterministicQA } from "../../qa/src/index.js";
import { buildScopedObjectContext, type ScopedObjectReadRequest } from "../../pitch-tools/src/scoped-read.js";
import { buildInsertVectorCommand, type InsertVectorInput } from "../../vector-commands/src/index.js";
import { executeDataObjectCommand, type DataObjectCommand } from "../../data-object-commands/src/index.js";

export interface SpecializedState {
  manifest: ProjectManifest;
  deck: DeckDocument;
  deckHash: string;
  head: BranchArtifactHead;
}

function activeHeadByKind(manifest: ProjectManifest, kind: string): BranchArtifactHead | undefined {
  return Object.values(manifest.branches[manifest.activeBranchId]?.heads ?? {}).find((head) => head.kind === kind);
}

function assertHash(expected: string | undefined, actual: string): void {
  if (expected && expected !== actual) throw new Error(`Deck changed since specialized command was authored: expected ${expected}, got ${actual}`);
}

export class PitchSpecializedRuntime {
  readonly store: ArtifactStore;
  readonly journal: VersionJournal;

  constructor(readonly projectRoot: string) {
    this.store = new ArtifactStore(projectRoot);
    this.journal = new VersionJournal(projectRoot);
  }

  async state(): Promise<SpecializedState> {
    const manifest = await this.store.readManifest();
    const head = activeHeadByKind(manifest, "deck");
    if (!head) throw new Error("No deck artifact on active branch");
    const stored = (await this.store.read<DeckDocument>(head.id, head.version)).payload;
    const deck = stored.activeBranchId === manifest.activeBranchId ? stored : { ...stored, activeBranchId: manifest.activeBranchId };
    return { manifest, deck, deckHash: deckHash(deck), head };
  }

  async readObjects(request: ScopedObjectReadRequest): Promise<ReturnType<typeof buildScopedObjectContext>> {
    const current = await this.state();
    return buildScopedObjectContext(current.deck, request);
  }

  private async writeDeck(current: SpecializedState, deck: DeckDocument, reason: string, impact: unknown): Promise<SpecializedState> {
    if (deckHash(deck) === current.deckHash) return current;
    await this.journal.record(current.manifest.activeBranchId, current.head);
    const artifact = await this.store.write({ id: current.head.id, kind: "deck", payload: deck, producer: { type: "codex" }, inputs: [current.head] });
    await this.journal.record(current.manifest.activeBranchId, { id: artifact.id, kind: artifact.kind, version: artifact.version, contentHash: artifact.contentHash, status: artifact.status });
    const qa = runDeterministicQA(deck);
    await this.store.write({
      id: "qa_current",
      kind: "qa",
      payload: { deckId: deck.id, reason, impact, issues: qa },
      producer: { type: "deterministic" },
      inputs: [artifact],
      status: qa.some((item) => item.severity === "critical") ? "needsReview" : "ready",
    });
    return this.state();
  }

  async insertVector(input: { slideId: string; vector: InsertVectorInput; expectedDeckHash?: string }) {
    const current = await this.state();
    assertHash(input.expectedDeckHash, current.deckHash);
    const slide = current.deck.slides.find((item) => item.id === input.slideId);
    if (!slide) throw new Error(`Unknown slide: ${input.slideId}`);
    const built = buildInsertVectorCommand(slide, { ...input.vector, origin: "agent" });
    const mutation = createMutation(`Codex insert vector ${built.element.id}`, built.operations, "codex", current.deckHash);
    const applied = applyDeckMutation(current.deck, mutation);
    const state = await this.writeDeck(current, applied.deck, mutation.reason, applied.impact);
    return { ...state, insertedElementId: built.element.id, nextSelectionIds: built.nextSelectionIds, impact: applied.impact };
  }

  async editDataObject(input: { edit: DataObjectCommand; expectedDeckHash?: string }) {
    const current = await this.state();
    assertHash(input.expectedDeckHash, current.deckHash);
    const edited = executeDataObjectCommand(current.deck, input.edit);
    if (!edited.changed) return { ...current, changed: false, warnings: edited.warnings, impact: edited.impact };
    const state = await this.writeDeck(current, edited.deck, edited.reason, edited.impact);
    return { ...state, changed: true, warnings: edited.warnings, impact: edited.impact };
  }

  async undo() {
    const current = await this.state();
    await this.journal.undo(current.manifest.activeBranchId, current.head.id);
    return this.state();
  }

  async redo() {
    const current = await this.state();
    await this.journal.redo(current.manifest.activeBranchId, current.head.id);
    return this.state();
  }
}
