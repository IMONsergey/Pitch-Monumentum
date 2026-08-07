export interface RectDU {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutZone {
  id: string;
  role: "title" | "takeaway" | "visual" | "body" | "metric" | "source" | "footer" | "free";
  bounds: RectDU;
  required: boolean;
  maxItems?: number;
}

export interface LayoutRecipe {
  id: string;
  name: string;
  jobs: string[];
  densities: Array<"sparse" | "balanced" | "dense">;
  zones: LayoutZone[];
  rules: string[];
  antiPatterns: string[];
}

export const DEFAULT_RECIPES: LayoutRecipe[] = [
  {
    id: "hero-metric-v1",
    name: "Hero metric",
    jobs: ["emphasize one decisive number", "open a quantitative section"],
    densities: ["sparse", "balanced"],
    zones: [
      { id: "title", role: "title", bounds: { x: 144, y: 110, width: 1632, height: 120 }, required: true },
      { id: "metric", role: "metric", bounds: { x: 144, y: 300, width: 900, height: 390 }, required: true },
      { id: "support", role: "visual", bounds: { x: 1080, y: 280, width: 696, height: 520 }, required: false },
      { id: "source", role: "source", bounds: { x: 144, y: 980, width: 1632, height: 40 }, required: false }
    ],
    rules: ["one dominant metric", "supporting copy must explain why it matters"],
    antiPatterns: ["four equally weighted KPIs", "decorative chart without source"]
  },
  {
    id: "chart-insight-v1",
    name: "Chart + insight",
    jobs: ["prove a claim with quantitative evidence"],
    densities: ["balanced", "dense"],
    zones: [
      { id: "title", role: "title", bounds: { x: 144, y: 96, width: 1632, height: 120 }, required: true },
      { id: "takeaway", role: "takeaway", bounds: { x: 144, y: 220, width: 1632, height: 90 }, required: true },
      { id: "chart", role: "visual", bounds: { x: 144, y: 340, width: 1632, height: 570 }, required: true },
      { id: "source", role: "source", bounds: { x: 144, y: 980, width: 1632, height: 40 }, required: true }
    ],
    rules: ["chart title is a conclusion, not a topic", "highlight only the series/data point that proves the takeaway"],
    antiPatterns: ["legend with no need", "tiny labels", "3D chart"]
  }
];
