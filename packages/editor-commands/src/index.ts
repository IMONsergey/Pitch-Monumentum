import { randomUUID } from "node:crypto";
import type {
  FrameElement,
  Geometry,
  GroupElement,
  SceneElement,
  ShapeElement,
  SlideDocument,
  TextElement,
} from "../../deck-model/src/index.js";
import type { DeckMutationOperation } from "../../mutations/src/index.js";

export type AlignCommand = "left" | "horizontalCenter" | "right" | "top" | "verticalCenter" | "bottom";
export type DistributeCommand = "horizontal" | "vertical";
export type ArrangeCommand = "bringToFront" | "bringForward" | "sendBackward" | "sendToBack";

export interface EditorSelection {
  slideId: string;
  elementIds: string[];
}

export interface EditorCommandResult {
  operations: DeckMutationOperation[];
  nextSelectionIds: string[];
  affectedAutoLayoutContainerIds: string[];
}

export interface PitchClipboardPayload {
  schemaVersion: "0.1";
  sourceSlideId: string;
  rootIds: string[];
  elements: SceneElement[];
}

export interface LayerTreeNode {
  id: string;
  element: SceneElement;
  children: LayerTreeNode[];
  depth: number;
}

function isContainer(element: SceneElement): element is FrameElement | GroupElement {
  return element.type === "frame" || element.type === "group";
}

function byId(slide: SlideDocument): Map<string, SceneElement> {
  return new Map(slide.scene.map((element) => [element.id, element]));
}

export function parentMap(slide: SlideDocument): Map<string, string> {
  const map = new Map<string, string>();
  for (const element of slide.scene) {
    if (!isContainer(element)) continue;
    for (const childId of element.childIds) map.set(childId, element.id);
  }
  return map;
}

export function descendantIds(slide: SlideDocument, rootId: string): string[] {
  const index = byId(slide);
  const result: string[] = [];
  const visit = (id: string) => {
    const element = index.get(id);
    if (!element || !isContainer(element)) return;
    for (const childId of element.childIds) {
      result.push(childId);
      visit(childId);
    }
  };
  visit(rootId);
  return result;
}

export function selectionRoots(slide: SlideDocument, selectedIds: string[]): string[] {
  const selected = new Set(selectedIds.filter((id) => slide.scene.some((element) => element.id === id)));
  const parents = parentMap(slide);
  return [...selected].filter((id) => {
    let parent = parents.get(id);
    while (parent) {
      if (selected.has(parent)) return false;
      parent = parents.get(parent);
    }
    return true;
  });
}

export function selectionClosure(slide: SlideDocument, selectedIds: string[]): string[] {
  const result = new Set<string>();
  for (const rootId of selectionRoots(slide, selectedIds)) {
    result.add(rootId);
    for (const descendantId of descendantIds(slide, rootId)) result.add(descendantId);
  }
  return [...result];
}

function geometryBounds(elements: SceneElement[]): Geometry {
  if (!elements.length) throw new Error("Cannot calculate bounds of an empty selection");
  const left = Math.min(...elements.map((element) => element.geometry.x));
  const top = Math.min(...elements.map((element) => element.geometry.y));
  const right = Math.max(...elements.map((element) => element.geometry.x + element.geometry.width));
  const bottom = Math.max(...elements.map((element) => element.geometry.y + element.geometry.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function selectionBounds(slide: SlideDocument, selectedIds: string[]): Geometry {
  const index = byId(slide);
  const roots = selectionRoots(slide, selectedIds).map((id) => index.get(id)).filter((element): element is SceneElement => Boolean(element));
  return geometryBounds(roots);
}

function autoLayoutParents(slide: SlideDocument, elementIds: Iterable<string>): string[] {
  const index = byId(slide);
  const parents = parentMap(slide);
  const result = new Set<string>();
  for (const id of elementIds) {
    const parentId = parents.get(id);
    if (!parentId) continue;
    const parent = index.get(parentId);
    if (parent && isContainer(parent) && parent.layout) result.add(parentId);
  }
  return [...result];
}

function translateOperations(slide: SlideDocument, rootIds: string[], offsets: Map<string, { dx: number; dy: number }>): DeckMutationOperation[] {
  const index = byId(slide);
  const operations: DeckMutationOperation[] = [];
  const visited = new Set<string>();

  for (const rootId of rootIds) {
    const offset = offsets.get(rootId);
    if (!offset || (!offset.dx && !offset.dy)) continue;
    const closure = [rootId, ...descendantIds(slide, rootId)];
    for (const id of closure) {
      if (visited.has(id)) continue;
      visited.add(id);
      const element = index.get(id);
      if (!element) continue;
      operations.push({
        op: "updateGeometry",
        slideId: slide.id,
        elementId: id,
        geometry: { x: element.geometry.x + offset.dx, y: element.geometry.y + offset.dy },
      });
    }
  }
  return operations;
}

export function nudgeSelection(slide: SlideDocument, selectedIds: string[], dx: number, dy: number): EditorCommandResult {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error("Nudge delta must be finite");
  const roots = selectionRoots(slide, selectedIds);
  const offsets = new Map(roots.map((id) => [id, { dx, dy }]));
  const closure = selectionClosure(slide, roots);
  return {
    operations: translateOperations(slide, roots, offsets),
    nextSelectionIds: roots,
    affectedAutoLayoutContainerIds: autoLayoutParents(slide, closure),
  };
}

export function alignSelection(slide: SlideDocument, selectedIds: string[], command: AlignCommand): EditorCommandResult {
  const index = byId(slide);
  const roots = selectionRoots(slide, selectedIds);
  if (roots.length < 2) return { operations: [], nextSelectionIds: roots, affectedAutoLayoutContainerIds: [] };
  const elements = roots.map((id) => index.get(id)!).filter(Boolean);
  const bounds = geometryBounds(elements);
  const offsets = new Map<string, { dx: number; dy: number }>();

  for (const element of elements) {
    let dx = 0;
    let dy = 0;
    if (command === "left") dx = bounds.x - element.geometry.x;
    else if (command === "horizontalCenter") dx = bounds.x + bounds.width / 2 - (element.geometry.x + element.geometry.width / 2);
    else if (command === "right") dx = bounds.x + bounds.width - (element.geometry.x + element.geometry.width);
    else if (command === "top") dy = bounds.y - element.geometry.y;
    else if (command === "verticalCenter") dy = bounds.y + bounds.height / 2 - (element.geometry.y + element.geometry.height / 2);
    else if (command === "bottom") dy = bounds.y + bounds.height - (element.geometry.y + element.geometry.height);
    offsets.set(element.id, { dx, dy });
  }

  return {
    operations: translateOperations(slide, roots, offsets),
    nextSelectionIds: roots,
    affectedAutoLayoutContainerIds: autoLayoutParents(slide, selectionClosure(slide, roots)),
  };
}

export function distributeSelection(slide: SlideDocument, selectedIds: string[], command: DistributeCommand): EditorCommandResult {
  const index = byId(slide);
  const roots = selectionRoots(slide, selectedIds);
  if (roots.length < 3) return { operations: [], nextSelectionIds: roots, affectedAutoLayoutContainerIds: [] };
  const elements = roots.map((id) => index.get(id)!).filter(Boolean);
  const horizontal = command === "horizontal";
  const sorted = [...elements].sort((a, b) => horizontal
    ? a.geometry.x - b.geometry.x || a.id.localeCompare(b.id)
    : a.geometry.y - b.geometry.y || a.id.localeCompare(b.id));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const available = horizontal
    ? (last.geometry.x + last.geometry.width) - first.geometry.x
    : (last.geometry.y + last.geometry.height) - first.geometry.y;
  const totalSize = sorted.reduce((sum, element) => sum + (horizontal ? element.geometry.width : element.geometry.height), 0);
  const gap = (available - totalSize) / (sorted.length - 1);
  const offsets = new Map<string, { dx: number; dy: number }>();
  let cursor = horizontal ? first.geometry.x : first.geometry.y;

  for (const element of sorted) {
    const current = horizontal ? element.geometry.x : element.geometry.y;
    offsets.set(element.id, horizontal ? { dx: cursor - current, dy: 0 } : { dx: 0, dy: cursor - current });
    cursor += (horizontal ? element.geometry.width : element.geometry.height) + gap;
  }

  return {
    operations: translateOperations(slide, roots, offsets),
    nextSelectionIds: roots,
    affectedAutoLayoutContainerIds: autoLayoutParents(slide, selectionClosure(slide, roots)),
  };
}

function postOrder(slide: SlideDocument, rootIds: string[]): string[] {
  const index = byId(slide);
  const seen = new Set<string>();
  const ordered: string[] = [];
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const element = index.get(id);
    if (element && isContainer(element)) for (const childId of element.childIds) visit(childId);
    ordered.push(id);
  };
  for (const rootId of rootIds) visit(rootId);
  return ordered;
}

function remapElement(element: SceneElement, idMap: Map<string, string>, dx: number, dy: number, zShift: number): SceneElement {
  const cloned: any = structuredClone(element);
  cloned.id = idMap.get(element.id)!;
  cloned.name = element.name ? `${element.name} copy` : element.name;
  cloned.origin = "user";
  cloned.geometry = { ...element.geometry, x: element.geometry.x + dx, y: element.geometry.y + dy };
  cloned.zIndex = element.zIndex + zShift;
  if (isContainer(element)) cloned.childIds = element.childIds.map((id) => idMap.get(id) ?? id);
  if (element.groupId) cloned.groupId = idMap.get(element.groupId) ?? element.groupId;
  return cloned as SceneElement;
}

export function duplicateSelection(slide: SlideDocument, selectedIds: string[], offsetDU = 32): EditorCommandResult {
  const roots = selectionRoots(slide, selectedIds);
  if (!roots.length) return { operations: [], nextSelectionIds: [], affectedAutoLayoutContainerIds: [] };
  const closure = selectionClosure(slide, roots);
  const index = byId(slide);
  const idMap = new Map(closure.map((id) => [id, `${id}_copy_${randomUUID().slice(0, 8)}`]));
  const selectedElements = closure.map((id) => index.get(id)!).filter(Boolean);
  const maxSceneZ = Math.max(0, ...slide.scene.map((element) => element.zIndex));
  const minSelectedZ = Math.min(...selectedElements.map((element) => element.zIndex));
  const zShift = maxSceneZ + 1 - minSelectedZ;
  const operations: DeckMutationOperation[] = [];

  // Children must exist before a duplicated container is added, otherwise hierarchy validation
  // would correctly reject the container's temporary dangling childIds.
  for (const id of postOrder(slide, roots)) {
    const element = index.get(id);
    if (!element || !idMap.has(id)) continue;
    operations.push({ op: "addElement", slideId: slide.id, element: remapElement(element, idMap, offsetDU, offsetDU, zShift) });
  }

  // If a root was duplicated inside an unselected container, keep the copy in that same container,
  // immediately after its source sibling.
  const parents = parentMap(slide);
  const duplicatedRootSet = new Set(roots);
  const parentUpdates = new Map<string, string[]>();
  for (const rootId of roots) {
    const parentId = parents.get(rootId);
    if (!parentId || duplicatedRootSet.has(parentId)) continue;
    const parent = index.get(parentId);
    if (!parent || !isContainer(parent)) continue;
    const current = parentUpdates.get(parentId) ?? [...parent.childIds];
    const sourceIndex = current.indexOf(rootId);
    current.splice(sourceIndex + 1, 0, idMap.get(rootId)!);
    parentUpdates.set(parentId, current);
  }
  for (const [parentId, childIds] of parentUpdates) {
    operations.push({ op: "updateContainerChildren", slideId: slide.id, elementId: parentId, childIds });
  }

  return {
    operations,
    nextSelectionIds: roots.map((id) => idMap.get(id)!),
    affectedAutoLayoutContainerIds: [...parentUpdates.keys()].filter((parentId) => {
      const parent = index.get(parentId);
      return Boolean(parent && isContainer(parent) && parent.layout);
    }),
  };
}

export function deleteSelection(slide: SlideDocument, selectedIds: string[]): EditorCommandResult {
  const roots = selectionRoots(slide, selectedIds);
  const closure = selectionClosure(slide, roots);
  const parents = autoLayoutParents(slide, closure);
  return {
    operations: [...closure].reverse().map((elementId) => ({ op: "removeElement", slideId: slide.id, elementId })),
    nextSelectionIds: [],
    affectedAutoLayoutContainerIds: parents.filter((id) => !closure.includes(id)),
  };
}

export function groupSelection(slide: SlideDocument, selectedIds: string[], groupId = `group_${randomUUID()}`): EditorCommandResult {
  const roots = selectionRoots(slide, selectedIds);
  if (roots.length < 2) throw new Error("Grouping requires at least two top-level selected elements");
  if (slide.scene.some((element) => element.id === groupId)) throw new Error(`Group id already exists: ${groupId}`);
  const index = byId(slide);
  const elements = roots.map((id) => index.get(id)!).filter(Boolean);
  const bounds = geometryBounds(elements);
  const group: GroupElement = {
    id: groupId,
    type: "group",
    name: "Group",
    semanticRole: "visual",
    geometry: bounds,
    zIndex: Math.min(...elements.map((element) => element.zIndex)) - 1,
    origin: "user",
    exportStrategy: "native",
    dependencies: [],
    childIds: roots,
  };
  return {
    operations: [{ op: "addElement", slideId: slide.id, element: group }],
    nextSelectionIds: [groupId],
    affectedAutoLayoutContainerIds: [],
  };
}

export function ungroupSelection(slide: SlideDocument, selectedIds: string[]): EditorCommandResult {
  const index = byId(slide);
  const groups = selectionRoots(slide, selectedIds)
    .map((id) => index.get(id))
    .filter((element): element is GroupElement => Boolean(element && element.type === "group"));
  const nextSelectionIds = groups.flatMap((group) => group.childIds);
  return {
    operations: groups.map((group) => ({ op: "removeElement", slideId: slide.id, elementId: group.id })),
    nextSelectionIds,
    affectedAutoLayoutContainerIds: [],
  };
}

export function arrangeSelection(slide: SlideDocument, selectedIds: string[], command: ArrangeCommand): EditorCommandResult {
  const roots = selectionRoots(slide, selectedIds);
  if (!roots.length) return { operations: [], nextSelectionIds: [], affectedAutoLayoutContainerIds: [] };
  const selectedClosure = new Set(selectionClosure(slide, roots));
  const ordered = [...slide.scene].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
  const selected = ordered.filter((element) => selectedClosure.has(element.id));
  const unselected = ordered.filter((element) => !selectedClosure.has(element.id));
  let nextOrder: SceneElement[];

  if (command === "bringToFront") nextOrder = [...unselected, ...selected];
  else if (command === "sendToBack") nextOrder = [...selected, ...unselected];
  else {
    nextOrder = [...ordered];
    if (command === "bringForward") {
      for (let index = nextOrder.length - 2; index >= 0; index -= 1) {
        if (selectedClosure.has(nextOrder[index].id) && !selectedClosure.has(nextOrder[index + 1].id)) {
          [nextOrder[index], nextOrder[index + 1]] = [nextOrder[index + 1], nextOrder[index]];
        }
      }
    } else {
      for (let index = 1; index < nextOrder.length; index += 1) {
        if (selectedClosure.has(nextOrder[index].id) && !selectedClosure.has(nextOrder[index - 1].id)) {
          [nextOrder[index], nextOrder[index - 1]] = [nextOrder[index - 1], nextOrder[index]];
        }
      }
    }
  }

  const operations = nextOrder.flatMap((element, zIndex) => element.zIndex === zIndex
    ? []
    : [{ op: "updateElementPresentation" as const, slideId: slide.id, elementId: element.id, changes: { zIndex } }]);
  return { operations, nextSelectionIds: roots, affectedAutoLayoutContainerIds: [] };
}

export function copySelection(slide: SlideDocument, selectedIds: string[]): PitchClipboardPayload {
  const roots = selectionRoots(slide, selectedIds);
  const closure = new Set(selectionClosure(slide, roots));
  return {
    schemaVersion: "0.1",
    sourceSlideId: slide.id,
    rootIds: roots,
    elements: slide.scene.filter((element) => closure.has(element.id)).map((element) => structuredClone(element)),
  };
}

export function pasteClipboard(slide: SlideDocument, payload: PitchClipboardPayload, offsetDU = 32): EditorCommandResult {
  if (payload.schemaVersion !== "0.1") throw new Error(`Unsupported clipboard schema: ${payload.schemaVersion}`);
  const sourceById = new Map(payload.elements.map((element) => [element.id, element]));
  const idMap = new Map(payload.elements.map((element) => [element.id, `${element.id}_paste_${randomUUID().slice(0, 8)}`]));
  const maxSceneZ = Math.max(0, ...slide.scene.map((element) => element.zIndex));
  const minSourceZ = Math.min(...payload.elements.map((element) => element.zIndex));
  const zShift = maxSceneZ + 1 - minSourceZ;
  const operations: DeckMutationOperation[] = [];
  const seen = new Set<string>();
  const order: string[] = [];
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const element = sourceById.get(id);
    if (element && isContainer(element)) for (const childId of element.childIds) if (sourceById.has(childId)) visit(childId);
    if (element) order.push(id);
  };
  for (const rootId of payload.rootIds) visit(rootId);
  for (const id of payload.elements.map((element) => element.id)) visit(id);
  for (const id of order) {
    const element = sourceById.get(id)!;
    operations.push({ op: "addElement", slideId: slide.id, element: remapElement(element, idMap, offsetDU, offsetDU, zShift) });
  }
  return {
    operations,
    nextSelectionIds: payload.rootIds.map((id) => idMap.get(id)!).filter(Boolean),
    affectedAutoLayoutContainerIds: [],
  };
}

export function buildLayerTree(slide: SlideDocument): LayerTreeNode[] {
  const index = byId(slide);
  const parents = parentMap(slide);
  const makeNode = (element: SceneElement, depth: number): LayerTreeNode => ({
    id: element.id,
    element,
    depth,
    children: isContainer(element)
      ? element.childIds.map((id) => index.get(id)).filter((child): child is SceneElement => Boolean(child)).map((child) => makeNode(child, depth + 1))
      : [],
  });
  return slide.scene
    .filter((element) => !parents.has(element.id))
    .sort((a, b) => b.zIndex - a.zIndex || a.id.localeCompare(b.id))
    .map((element) => makeNode(element, 0));
}

export function createTextElement(partial: Partial<TextElement> & Pick<TextElement, "geometry">): TextElement {
  return {
    id: partial.id ?? `text_${randomUUID()}`,
    type: "text",
    name: partial.name ?? "Text",
    semanticRole: partial.semanticRole ?? "body",
    geometry: partial.geometry,
    zIndex: partial.zIndex ?? 1,
    origin: partial.origin ?? "user",
    exportStrategy: partial.exportStrategy ?? "native",
    dependencies: partial.dependencies ?? [],
    paragraphs: partial.paragraphs ?? [{ runs: [{ text: "Text", fontSizePt: 24, color: "#111111" }] }],
    verticalAlign: partial.verticalAlign ?? "top",
    fitPolicy: partial.fitPolicy ?? "fixed",
    ...partial,
  };
}

export function createShapeElement(partial: Partial<ShapeElement> & Pick<ShapeElement, "geometry">): ShapeElement {
  return {
    id: partial.id ?? `shape_${randomUUID()}`,
    type: "shape",
    name: partial.name ?? "Shape",
    semanticRole: partial.semanticRole ?? "visual",
    geometry: partial.geometry,
    zIndex: partial.zIndex ?? 1,
    origin: partial.origin ?? "user",
    exportStrategy: partial.exportStrategy ?? "native",
    dependencies: partial.dependencies ?? [],
    shape: partial.shape ?? "rect",
    fill: partial.fill ?? "#E9EDF2",
    ...partial,
  };
}

export function createFrameElement(partial: Partial<FrameElement> & Pick<FrameElement, "geometry">): FrameElement {
  return {
    id: partial.id ?? `frame_${randomUUID()}`,
    type: "frame",
    name: partial.name ?? "Frame",
    semanticRole: partial.semanticRole ?? "visual",
    geometry: partial.geometry,
    zIndex: partial.zIndex ?? 0,
    origin: partial.origin ?? "user",
    exportStrategy: partial.exportStrategy ?? "native",
    dependencies: partial.dependencies ?? [],
    childIds: partial.childIds ?? [],
    clipContent: partial.clipContent ?? false,
    ...partial,
  };
}
