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

    return {
      containerId,
      containerGeometry,
      children: childResults,
      warnings,
    };
  } finally {
    root.freeRecursive();
  }
}

export function autoLayoutMutationOperations(slide: SlideDocument, containerId: string): DeckMutationOperation[] {
  const result = solveAutoLayout(slide, containerId);
  const operations: DeckMutationOperation[] = [
    {
      op: "updateGeometry",
      slideId: slide.id,
      elementId: containerId,
      geometry: result.containerGeometry,
    },
  ];
  for (const child of result.children) {
    operations.push({
      op: "updateGeometry",
      slideId: slide.id,
      elementId: child.elementId,
      geometry: child.geometry,
    });
  }
  return operations;
}

export function findAutoLayoutContainers(deck: DeckDocument): Array<{ slideId: string; elementId: string }> {
  return deck.slides.flatMap((slide) => slide.scene
    .filter((element): element is AutoLayoutContainer => (element.type === "frame" || element.type === "group") && Boolean(element.layout))
    .map((element) => ({ slideId: slide.id, elementId: element.id })));
}
