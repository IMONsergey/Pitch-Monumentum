import type { Geometry } from "../../deck-model/src/index.js";
import {
  createMutation,
  type DeckMutation,
  type DeckMutationOperation,
  type MutationOrigin,
} from "../../mutations/src/index.js";

export type EditorMode = "slides" | "design";
export type EditorTool =
  | "select"
  | "text"
  | "shape"
  | "line"
  | "pen"
  | "frame"
  | "image"
  | "chart"
  | "table"
  | "comment"
  | "hand";

export type SelectionMode = "element" | "text" | "vector" | "table" | "chart";

export interface TextRangeSelection {
  elementId: string;
  anchor: number;
  focus: number;
}

export interface EditorSelection {
  slideId: string;
  elementIds: string[];
  primaryElementId?: string;
  mode: SelectionMode;
  textRange?: TextRangeSelection;
  vectorPointIds?: string[];
}

export interface EditorViewport {
  zoom: number;
  panX: number;
  panY: number;
  widthPx: number;
  heightPx: number;
}

export type SnapGuideKind =
  | "slide-edge"
  | "slide-center"
  | "element-edge"
  | "element-center"
  | "explicit-guide"
  | "grid"
  | "equal-spacing"
  | "layout";

export interface SnapGuide {
  id: string;
  kind: SnapGuideKind;
  axis: "x" | "y";
  positionDU: number;
  fromDU?: number;
  toDU?: number;
  label?: string;
}

export interface SnapResult {
  geometry: Partial<Geometry>;
  guides: SnapGuide[];
}

export interface EditorInteractionPreview {
  sessionId: string;
  slideId: string;
  elementIds: string[];
  geometryByElementId: Record<string, Partial<Geometry>>;
  guides: SnapGuide[];
}

export interface EditorInteractionCommit {
  reason: string;
  operations: DeckMutationOperation[];
  origin?: MutationOrigin;
  expectedDeckHash?: string;
}

export interface InteractionAdapter {
  readonly name: string;
  attach(root: HTMLElement): void;
  detach(): void;
  setSelection(selection: EditorSelection | null): void;
  setViewport(viewport: EditorViewport): void;
}

export interface SelectionAdapter {
  readonly name: string;
  attach(root: HTMLElement): void;
  detach(): void;
  setSelectableElementIds(elementIds: string[]): void;
  setSelection(selection: EditorSelection | null): void;
}

export interface GuideAdapter {
  readonly name: string;
  attach(root: HTMLElement): void;
  detach(): void;
  setViewport(viewport: EditorViewport): void;
  setGuides(guides: SnapGuide[]): void;
}

export interface ViewportAdapter {
  readonly name: string;
  attach(root: HTMLElement): void;
  detach(): void;
  getViewport(): EditorViewport;
  setViewport(viewport: Partial<EditorViewport>): void;
  focusRect(rect: Geometry, paddingPx?: number): void;
}

export interface RichTextEditorAdapter {
  readonly name: string;
  begin(elementId: string, host: HTMLElement): Promise<void> | void;
  commit(): Promise<void> | void;
  cancel(): Promise<void> | void;
  isEditing(elementId?: string): boolean;
}

export interface AutoLayoutAdapter<LayoutInput = unknown, LayoutOutput = unknown> {
  readonly name: string;
  layout(input: LayoutInput): LayoutOutput;
}

export interface VectorAdapter<VectorInput = unknown, VectorOutput = unknown> {
  readonly name: string;
  boolean(
    operation: "union" | "subtract" | "intersect" | "exclude",
    inputs: VectorInput[],
  ): VectorOutput;
}

export interface MotionAdapter<AnimationModel = unknown> {
  readonly name: string;
  play(animation: AnimationModel, root: HTMLElement): Promise<void> | void;
  pause(): void;
  seek(timeMs: number): void;
}

export interface CollaborationAdapter<Presence = unknown> {
  readonly name: string;
  connect(projectId: string, branchId: string): Promise<void>;
  disconnect(): Promise<void>;
  setPresence(presence: Presence): void;
}

export interface EditorEngineAdapters {
  interaction?: InteractionAdapter;
  selection?: SelectionAdapter;
  guides?: GuideAdapter;
  viewport?: ViewportAdapter;
  text?: RichTextEditorAdapter;
  layout?: AutoLayoutAdapter;
  vector?: VectorAdapter;
  motion?: MotionAdapter;
  collaboration?: CollaborationAdapter;
}

export interface EditorEngineState {
  mode: EditorMode;
  tool: EditorTool;
  selection: EditorSelection | null;
  viewport: EditorViewport;
  interactionPreview: EditorInteractionPreview | null;
}

export function normalizeSelection(selection: EditorSelection): EditorSelection {
  const uniqueIds = [...new Set(selection.elementIds)];
  const primary = selection.primaryElementId && uniqueIds.includes(selection.primaryElementId)
    ? selection.primaryElementId
    : uniqueIds[0];
  return {
    ...selection,
    elementIds: uniqueIds,
    primaryElementId: primary,
  };
}

export function geometryCommit(
  slideId: string,
  geometryByElementId: Record<string, Partial<Geometry>>,
  reason: string,
  origin: MutationOrigin = "user",
  expectedDeckHash?: string,
): DeckMutation {
  const operations: DeckMutationOperation[] = Object.entries(geometryByElementId).map(
    ([elementId, geometry]) => ({
      op: "updateGeometry",
      slideId,
      elementId,
      geometry,
    }),
  );
  return createMutation(reason, operations, origin, expectedDeckHash);
}

export class EditorEngineController {
  readonly adapters: EditorEngineAdapters;
  private state: EditorEngineState;

  constructor(adapters: EditorEngineAdapters = {}) {
    this.adapters = adapters;
    this.state = {
      mode: "slides",
      tool: "select",
      selection: null,
      viewport: { zoom: 1, panX: 0, panY: 0, widthPx: 0, heightPx: 0 },
      interactionPreview: null,
    };
  }

  getState(): Readonly<EditorEngineState> {
    return this.state;
  }

  setMode(mode: EditorMode): void {
    this.state = { ...this.state, mode };
  }

  setTool(tool: EditorTool): void {
    this.state = { ...this.state, tool };
  }

  setSelection(selection: EditorSelection | null): void {
    const normalized = selection ? normalizeSelection(selection) : null;
    this.state = { ...this.state, selection: normalized };
    this.adapters.interaction?.setSelection(normalized);
    this.adapters.selection?.setSelection(normalized);
  }

  setViewport(viewport: Partial<EditorViewport>): void {
    const next = { ...this.state.viewport, ...viewport };
    if (!Number.isFinite(next.zoom) || next.zoom <= 0) throw new Error("Viewport zoom must be positive");
    this.state = { ...this.state, viewport: next };
    this.adapters.interaction?.setViewport(next);
    this.adapters.guides?.setViewport(next);
    this.adapters.viewport?.setViewport(next);
  }

  previewInteraction(preview: EditorInteractionPreview): void {
    if (this.state.selection && preview.slideId !== this.state.selection.slideId) {
      throw new Error("Interaction preview cannot cross the current slide selection boundary");
    }
    this.state = { ...this.state, interactionPreview: preview };
    this.adapters.guides?.setGuides(preview.guides);
  }

  cancelInteraction(): void {
    this.state = { ...this.state, interactionPreview: null };
    this.adapters.guides?.setGuides([]);
  }

  commitInteraction(
    reason: string,
    origin: MutationOrigin = "user",
    expectedDeckHash?: string,
  ): DeckMutation {
    const preview = this.state.interactionPreview;
    if (!preview) throw new Error("No interaction preview to commit");
    const mutation = geometryCommit(
      preview.slideId,
      preview.geometryByElementId,
      reason,
      origin,
      expectedDeckHash,
    );
    this.cancelInteraction();
    return mutation;
  }
}
