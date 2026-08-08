import { randomUUID } from "node:crypto";
import Yoga, {
  Align,
  Direction,
  Edge,
  FlexDirection,
  Gutter,
  Justify,
  Wrap,
} from "yoga-layout";
import type {
  AutoLayoutSpec,
  DeckDocument,
  FrameElement,
  Geometry,
  GroupElement,
  LayoutItemSpec,
  SceneElement,
  SlideDocument,
} from "../../deck-model/src/index.js";
import type { DeckMutationOperation } from "../../mutations/src/index.js";

export type AutoLayoutContainer = FrameElement | GroupElement;

export interface AutoLayoutChildResult {
  elementId: string;
  geometry: Geometry;
}

export interface AutoLayoutResult {
  containerId: string;
  containerGeometry: Geometry;
  children: AutoLayoutChildResult[];
  warnings: string[];
}

export interface WrapSelectionInAutoLayoutOptions {
  frameId?: string;
  direction?: AutoLayoutSpec["direction"];
  gapDU?: number;
  paddingDU?: number;
  fill?: string;
  radiusDU?: number;
}

function justify(value: AutoLayoutSpec["justify"]): Justify {
  switch (value) {
    case "center": return Justify.Center;
    case "end": return Justify.FlexEnd;
    case "spaceBetween": return Justify.SpaceBetween;
    case "spaceAround": return Justify.SpaceAround;
    case "spaceEvenly": return Justify.SpaceEvenly;
    default: return Justify.FlexStart;
  }
}

function align(value: AutoLayoutSpec["align"] | LayoutItemSpec["alignSelf"]): Align {
  switch (value) {
    case "center": return Align.Center;
    case "end": return Align.FlexEnd;
    case "stretch": return Align.Stretch;
    case "auto": return Align.Auto;
    default: return Align.FlexStart;
  }
}

export function validateAutoLayoutSpec(layout: AutoLayoutSpec): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(layout.gapDU) || layout.gapDU < 0) errors.push("gapDU must be a finite non-negative number");
  for (const [edge, value] of Object.entries(layout.padding)) {
    if (!Number.isFinite(value) || value < 0) errors.push(`padding.${edge} must be a finite non-negative number`);
  }
  return errors;
}

function applyItemSizing(node: any, element: SceneElement, layout: AutoLayoutSpec): void {
  const item = element.layoutItem ?? {};
  const mainHorizontal = layout.direction === "horizontal";
  const widthMode = item.width ?? "fixed";
  const heightMode = item.height ?? "fixed";

  if (widthMode === "fixed" || widthMode === "hug") node.setWidth(element.geometry.width);
  if (heightMode === "fixed" || heightMode === "hug") node.setHeight(element.geometry.height);

  if (mainHorizontal && widthMode === "fill") {
    node.setFlexGrow(item.grow ?? 1);
    node.setFlexBasis(0);
  } else if (!mainHorizontal && heightMode === "fill") {
    node.setFlexGrow(item.grow ?? 1);
    node.setFlexBasis(0);
  }

  if (mainHorizontal && heightMode === "fill") node.setAlignSelf(Align.Stretch);
  if (!mainHorizontal && widthMode === "fill") node.setAlignSelf(Align.Stretch);
  if (item.alignSelf) node.setAlignSelf(align(item.alignSelf));

  if (item.minWidthDU !== undefined) node.setMinWidth(item.minWidthDU);
  if (item.maxWidthDU !== undefined) node.setMaxWidth(item.maxWidthDU);
  if (item.minHeightDU !== undefined) node.setMinHeight(item.minHeightDU);
  if (item.maxHeightDU !== undefined) node.setMaxHeight(item.maxHeightDU);
  if (item.grow !== undefined && item.grow >= 0) node.setFlexGrow(item.grow);
}

function resolveContainer(slide: SlideDocument, containerId: string): AutoLayoutContainer {
  const element = slide.scene.find((item) => item.id === containerId);
  if (!element) throw new Error(`Unknown auto-layout container: ${containerId}`);
  if (element.type !== "frame" && element.type !== "group") throw new Error(`Element ${containerId} is not a frame/group`);
  if (!element.layout) throw new Error(`Element ${containerId} has no auto-layout spec`);
  return element;
}

export function solveAutoLayout(slide: SlideDocument, containerId: string): AutoLayoutResult {
  const container = resolveContainer(slide, containerId);
  const layout = container.layout!;
  const validation = validateAutoLayoutSpec(layout);
  if (validation.length) throw new Error(validation.join("; "));

  const childMap = new Map(slide.scene.map((element) => [element.id, element]));
  const children = container.childIds.map((id) => childMap.get(id)).filter((item): item is SceneElement => Boolean(item));
  const warnings: string[] = [];
  const missing = container.childIds.filter((id) => !childMap.has(id));
  if (missing.length) warnings.push(`Missing child ids: ${missing.join(", ")}`);

  const root = Yoga.Node.create();
  try {
    root.setFlexDirection(layout.direction === "horizontal" ? FlexDirection.Row : FlexDirection.Column);
    root.setJustifyContent(justify(layout.justify));
    root.setAlignItems(align(layout.align));
    root.setFlexWrap(layout.wrap ? Wrap.Wrap : Wrap.NoWrap);
    root.setGap(Gutter.All, layout.gapDU);
    root.setPadding(Edge.Top, layout.padding.top);
    root.setPadding(Edge.Right, layout.padding.right);
    root.setPadding(Edge.Bottom, layout.padding.bottom);
    root.setPadding(Edge.Left, layout.padding.left);

    if ((layout.widthSizing ?? "fixed") === "fixed") root.setWidth(container.geometry.width);
    if ((layout.heightSizing ?? "fixed") === "fixed") root.setHeight(container.geometry.height);

    const yogaChildren: Array<{ element: SceneElement; node: any }> = [];
    for (const [index, element] of children.entries()) {
      const node = Yoga.Node.create();
      applyItemSizing(node, element, layout);
      root.insertChild(node, index);
      yogaChildren.push({ element, node });
    }

    root.calculateLayout(undefined, undefined, Direction.LTR);

    const containerGeometry: Geometry = {
      ...container.geometry,
      width: Math.round(root.getComputedWidth()),
      height: Math.round(root.getComputedHeight()),
    };

    const childResults = yogaChildren.map(({ element, node }) => ({
      elementId: element.id,
      geometry: {
        ...element.geometry,
        x: Math.round(container.geometry.x + node.getComputedLeft()),
        y: Math.round(container.geometry.y + node.getComputedTop()),
        width: Math.round(node.getComputedWidth()),
        height: Math.round(node.getComputedHeight()),
      },
    }));

    return { containerId, containerGeometry, children: childResults, warnings };
  } finally {
    root.freeRecursive();
  }
}

export function autoLayoutMutationOperations(slide: SlideDocument, containerId: string): DeckMutationOperation[] {
  const result = solveAutoLayout(slide, containerId);
  const operations: DeckMutationOperation[] = [
    { op: "updateGeometry", slideId: slide.id, elementId: containerId, geometry: result.containerGeometry },
  ];
  for (const child of result.children) {
    operations.push({ op: "updateGeometry", slideId: slide.id, elementId: child.elementId, geometry: child.geometry });
  }
  return operations;
}

export function setAutoLayoutMutationOperations(
  slide: SlideDocument,
  containerId: string,
  layout: AutoLayoutSpec,
): DeckMutationOperation[] {
  const validation = validateAutoLayoutSpec(layout);
  if (validation.length) throw new Error(validation.join("; "));
  const container = slide.scene.find((element) => element.id === containerId);
  if (!container || (container.type !== "frame" && container.type !== "group")) throw new Error(`Element ${containerId} is not a frame/group`);
  const previewSlide: SlideDocument = {
    ...slide,
    scene: slide.scene.map((element) => element.id === containerId ? { ...container, layout } : element),
  };
  return [
    { op: "updateAutoLayout", slideId: slide.id, elementId: containerId, layout },
    ...autoLayoutMutationOperations(previewSlide, containerId),
  ];
}

export function removeAutoLayoutMutationOperations(slide: SlideDocument, containerId: string): DeckMutationOperation[] {
  const container = slide.scene.find((element) => element.id === containerId);
  if (!container || (container.type !== "frame" && container.type !== "group")) throw new Error(`Element ${containerId} is not a frame/group`);
  return [{ op: "updateAutoLayout", slideId: slide.id, elementId: containerId, layout: null }];
}

function selectedBounds(elements: SceneElement[]): Geometry {
  const left = Math.min(...elements.map((element) => element.geometry.x));
  const top = Math.min(...elements.map((element) => element.geometry.y));
  const right = Math.max(...elements.map((element) => element.geometry.x + element.geometry.width));
  const bottom = Math.max(...elements.map((element) => element.geometry.y + element.geometry.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function spatialOrder(elements: SceneElement[], direction: AutoLayoutSpec["direction"]): SceneElement[] {
  return [...elements].sort((a, b) => {
    if (direction === "horizontal") {
      return a.geometry.x - b.geometry.x || a.geometry.y - b.geometry.y || a.zIndex - b.zIndex || a.id.localeCompare(b.id);
    }
    return a.geometry.y - b.geometry.y || a.geometry.x - b.geometry.x || a.zIndex - b.zIndex || a.id.localeCompare(b.id);
  });
}

export function wrapSelectionInAutoLayoutOperations(
  slide: SlideDocument,
  selectedIds: string[],
  options: WrapSelectionInAutoLayoutOptions = {},
): { frameId: string; operations: DeckMutationOperation[] } {
  const uniqueIds = [...new Set(selectedIds)];
  if (uniqueIds.length < 2) throw new Error("Auto layout requires at least two selected elements");
  const selected = uniqueIds.map((id) => slide.scene.find((element) => element.id === id));
  if (selected.some((element) => !element)) throw new Error("Selection contains an unknown scene element");
  const elements = selected as SceneElement[];
  if (elements.some((element) => element.type === "frame" && element.childIds.some((id) => uniqueIds.includes(id)))) {
    throw new Error("Cannot wrap a frame together with its own child");
  }

  const direction = options.direction ?? "horizontal";
  const orderedElements = spatialOrder(elements, direction);
  const orderedIds = orderedElements.map((element) => element.id);
  const bounds = selectedBounds(orderedElements);
  const padding = options.paddingDU ?? 24;
  const frameId = options.frameId ?? `frame_${randomUUID()}`;
  if (slide.scene.some((element) => element.id === frameId)) throw new Error(`Frame id already exists: ${frameId}`);

  const layout: AutoLayoutSpec = {
    direction,
    gapDU: options.gapDU ?? 24,
    padding: { top: padding, right: padding, bottom: padding, left: padding },
    justify: "start",
    align: "start",
    widthSizing: "hug",
    heightSizing: "hug",
  };
  const frame: FrameElement = {
    id: frameId,
    type: "frame",
    name: "Auto Layout",
    semanticRole: "visual",
    geometry: { x: bounds.x - padding, y: bounds.y - padding, width: bounds.width + padding * 2, height: bounds.height + padding * 2 },
    zIndex: Math.min(...orderedElements.map((element) => element.zIndex)) - 1,
    origin: "user",
    exportStrategy: "native",
    dependencies: [],
    childIds: orderedIds,
    layout,
    fill: options.fill,
    radiusDU: options.radiusDU,
    clipContent: false,
  };

  const selectedSet = new Set(orderedIds);
  const previewChildren = slide.scene.map((element) => selectedSet.has(element.id)
    ? { ...element, layoutItem: element.layoutItem ?? { width: "fixed", height: "fixed" } as LayoutItemSpec }
    : element);
  const previewSlide: SlideDocument = { ...slide, scene: [...previewChildren, frame] };
  const solved = solveAutoLayout(previewSlide, frameId);

  const operations: DeckMutationOperation[] = [
    { op: "addElement", slideId: slide.id, element: frame },
    ...orderedElements.filter((element) => !element.layoutItem).map((element) => ({
      op: "updateLayoutItem" as const,
      slideId: slide.id,
      elementId: element.id,
      layoutItem: { width: "fixed", height: "fixed" } as LayoutItemSpec,
    })),
    { op: "updateGeometry", slideId: slide.id, elementId: frameId, geometry: solved.containerGeometry },
    ...solved.children.map((child) => ({
      op: "updateGeometry" as const,
      slideId: slide.id,
      elementId: child.elementId,
      geometry: child.geometry,
    })),
  ];
  return { frameId, operations };
}

export function findAutoLayoutContainers(deck: DeckDocument): Array<{ slideId: string; elementId: string }> {
  return deck.slides.flatMap((slide) => slide.scene
    .filter((element): element is AutoLayoutContainer => (element.type === "frame" || element.type === "group") && Boolean(element.layout))
    .map((element) => ({ slideId: slide.id, elementId: element.id })));
}
