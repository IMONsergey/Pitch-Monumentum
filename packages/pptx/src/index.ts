export const STANDARD_WIDE = {
  widthDU: 1920,
  heightDU: 1080,
  duPerInch: 144,
} as const;

export function duToInches(valueDU: number): number {
  return valueDU / STANDARD_WIDE.duPerInch;
}

export type PptxElementResult = {
  elementId: string;
  strategy: "native" | "vector" | "rasterFallback" | "unsupported";
  warnings: string[];
};

export interface PptxCompileResult {
  outputPath: string;
  slideCount: number;
  elementResults: PptxElementResult[];
  warnings: string[];
  contentHash: string;
}

export interface RoundTripDiff {
  slideId: string;
  elementId?: string;
  kind: "missing" | "textChanged" | "geometryDrift" | "styleDrift" | "downgraded" | "extra";
  severity: "minor" | "major" | "critical";
  message: string;
}

export interface PptxCompiler {
  compile(deckArtifactPath: string, outputPath: string): Promise<PptxCompileResult>;
}

export interface PptxRoundTripValidator {
  compare(canonicalDeckPath: string, exportedPptxPath: string): Promise<RoundTripDiff[]>;
}
