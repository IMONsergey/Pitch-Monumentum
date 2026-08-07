export type DataClass = "source" | "external" | "scenario" | "derived";
export type VerificationStatus =
  | "verified"
  | "unverified"
  | "stale"
  | "conflicting"
  | "notRequired";

export interface SourceLocator {
  page?: number;
  slide?: number;
  paragraph?: number;
  sheet?: string;
  range?: string;
  url?: string;
  fragment?: string;
  bbox?: [number, number, number, number];
  quoteHash?: string;
}

export interface SourceDocument {
  id: string;
  kind: "pdf" | "docx" | "pptx" | "xlsx" | "csv" | "text" | "markdown" | "image" | "web";
  title: string;
  uri: string;
  checksum: string;
  importedAt: string;
  metadata?: Record<string, unknown>;
}

export interface SourceAnchor {
  id: string;
  sourceId: string;
  locator: SourceLocator;
  excerpt?: string;
  checksum: string;
}

export interface EvidenceItem {
  id: string;
  kind: "quote" | "number" | "fact" | "table" | "figure" | "definition";
  anchorIds: string[];
  value: unknown;
  normalizedText: string;
}

export interface Claim {
  id: string;
  statement: string;
  dataClass: DataClass;
  evidenceRefs: string[];
  confidence: number;
  verificationStatus: VerificationStatus;
  staleReason?: string;
  lastVerifiedAt?: string;
}

export interface PresentationBrief {
  id: string;
  language: string;
  audience: string;
  audienceKnowledge?: string;
  communicationIntent: string;
  audienceOutcome: string;
  coreMessage: string;
  decisionOrAsk?: string;
  deliveryContext: string;
  artifactAfterlife?: string;
  sourceDivergence: string;
  readingMode: "presentation" | "balanced" | "reader";
  pageBudget: {
    min: number;
    target: number;
    max: number;
  };
  mustInclude: string[];
  mustNotChange: string[];
  brandConstraints: string[];
  dataSensitivity?: "normal" | "confidential" | "restricted";
  assumptions: string[];
}

export type NarrativeNodeKind =
  | "question"
  | "context"
  | "claim"
  | "evidence"
  | "objection"
  | "decision"
  | "recommendation"
  | "action"
  | "section";

export type NarrativeEdgeKind =
  | "supports"
  | "proves"
  | "causes"
  | "contrasts"
  | "dependsOn"
  | "answers"
  | "objectsTo"
  | "resolves"
  | "follows";

export interface NarrativeNode {
  id: string;
  kind: NarrativeNodeKind;
  label: string;
  claimId?: string;
  sectionId?: string;
}

export interface NarrativeEdge {
  id: string;
  from: string;
  to: string;
  kind: NarrativeEdgeKind;
}

export interface NarrativeGraph {
  id: string;
  nodes: NarrativeNode[];
  edges: NarrativeEdge[];
  sectionOrder: string[];
  rationale: string;
}

export interface DesignCanvas {
  widthDU: number;
  heightDU: number;
  duPerInch: number;
  aspectRatio: "16:9" | "4:3" | "custom";
}

export interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

export interface ElementDependency {
  kind: "claim" | "evidence" | "asset" | "designToken" | "dataset";
  id: string;
}

export type ExportStrategy = "native" | "vector" | "rasterFallback" | "unsupported";
export type ElementOrigin = "agent" | "user" | "import" | "deterministic";

export interface SceneElementBase {
  id: string;
  name?: string;
  semanticRole:
    | "title"
    | "subtitle"
    | "body"
    | "caption"
    | "metric"
    | "label"
    | "visual"
    | "chart"
    | "table"
    | "decoration"
    | "source"
    | "footer"
    | "other";
  geometry: Geometry;
  zIndex: number;
  locked?: boolean;
  groupId?: string;
  opacity?: number;
  origin: ElementOrigin;
  exportStrategy: ExportStrategy;
  dependencies: ElementDependency[];
  tags?: string[];
}

export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  fontFamily?: string;
  fontSizePt?: number;
  letterSpacingPt?: number;
}

export interface TextParagraph {
  runs: TextRun[];
  align?: "left" | "center" | "right" | "justify";
  bullet?: { level: number; marker?: string };
  lineSpacing?: number;
  spaceBeforePt?: number;
  spaceAfterPt?: number;
}

export interface TextElement extends SceneElementBase {
  type: "text";
  paragraphs: TextParagraph[];
  verticalAlign?: "top" | "middle" | "bottom";
  insetsDU?: [number, number, number, number];
  fitPolicy?: "growBox" | "shrinkText" | "fixed";
}

export interface ImageElement extends SceneElementBase {
  type: "image";
  assetId: string;
  crop?: { left: number; top: number; right: number; bottom: number };
  cornerRadiusDU?: number;
  fit: "cover" | "contain" | "stretch";
  alt?: string;
}

export interface ShapeElement extends SceneElementBase {
  type: "shape";
  shape: "rect" | "roundRect" | "ellipse" | "triangle" | "custom";
  fill?: string;
  stroke?: { color: string; widthDU: number; dash?: "solid" | "dash" | "dot" };
  radiusDU?: number;
  svgPath?: string;
}

export interface LineElement extends SceneElementBase {
  type: "line";
  start: [number, number];
  end: [number, number];
  stroke: { color: string; widthDU: number; dash?: "solid" | "dash" | "dot" };
  startMarker?: "none" | "arrow" | "dot";
  endMarker?: "none" | "arrow" | "dot";
}

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartSpec {
  chartType: "bar" | "column" | "line" | "area" | "pie" | "doughnut" | "scatter";
  categories?: string[];
  series: ChartSeries[];
  numberFormat?: string;
  showLegend?: boolean;
  insightStatement: string;
  dataSourceRefs: string[];
}

export interface ChartElement extends SceneElementBase {
  type: "chart";
  chart: ChartSpec;
  themeTokenRefs?: string[];
}

export interface TableCell {
  text: string;
  claimId?: string;
  styleTokenRefs?: string[];
  colspan?: number;
  rowspan?: number;
}

export interface TableElement extends SceneElementBase {
  type: "table";
  rows: TableCell[][];
  columnWidths?: number[];
}

export interface IconElement extends SceneElementBase {
  type: "icon";
  assetId: string;
  tint?: string;
}

export interface DiagramNode {
  id: string;
  label: string;
  claimId?: string;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DiagramElement extends SceneElementBase {
  type: "diagram";
  diagramType: "flow" | "cycle" | "hierarchy" | "network" | "funnel" | "custom";
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface GroupElement extends SceneElementBase {
  type: "group";
  childIds: string[];
}

export interface VideoElement extends SceneElementBase {
  type: "video";
  assetId: string;
  posterAssetId?: string;
}

export type SceneElement =
  | TextElement
  | ImageElement
  | ShapeElement
  | LineElement
  | ChartElement
  | TableElement
  | IconElement
  | DiagramElement
  | GroupElement
  | VideoElement;

export type SlideArchetype =
  | "cover"
  | "thesis"
  | "heroMetric"
  | "context"
  | "problem"
  | "solution"
  | "comparison"
  | "timeline"
  | "process"
  | "matrix"
  | "chartInsight"
  | "evidence"
  | "caseStudy"
  | "quote"
  | "roadmap"
  | "decision"
  | "recommendation"
  | "ask"
  | "closing"
  | "freeform";

export interface SlideSemanticContract {
  purpose: string;
  takeaway: string;
  questionAnswered: string;
  narrativeRole: string;
  claimIds: string[];
  evidenceRefs: string[];
  audienceRelevance: string;
  decisionContribution?: string;
  density: "sparse" | "balanced" | "dense";
}

export interface SlideDocument {
  id: string;
  order: number;
  sectionId?: string;
  title: string;
  archetype: SlideArchetype;
  recipeId?: string;
  semantic: SlideSemanticContract;
  scene: SceneElement[];
  speakerNotes?: string;
  status: "draft" | "reviewable" | "ready" | "stale";
  qaIssueIds: string[];
  dependencyIds: string[];
}

export interface DesignSystem {
  id: string;
  name: string;
  tokens: {
    colors: Record<string, string>;
    fonts: Record<string, string>;
    typeScalePt: Record<string, number>;
    spacingDU: Record<string, number>;
  };
  grid: {
    marginXDU: number;
    marginYDU: number;
    columns: number;
    gutterDU: number;
  };
  chartRules: string[];
  imageRules: string[];
  iconRules: string[];
  forbiddenTreatments: string[];
  recipeIds: string[];
}

export interface DeckDocument {
  schemaVersion: "0.1";
  id: string;
  title: string;
  canvas: DesignCanvas;
  briefId: string;
  narrativeId: string;
  designSystemId: string;
  slides: SlideDocument[];
  sourceIds: string[];
  claimIds: string[];
  activeBranchId: string;
  createdAt: string;
  updatedAt: string;
}
