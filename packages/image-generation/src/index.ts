import { AssetRegistry, type ImageAssetRecord, type ImageMimeType } from "../../assets/src/index.js";

export interface ImageGenerationRequest {
  prompt: string;
  aspectRatio?: "square" | "landscape" | "portrait";
  quality?: "draft" | "standard" | "high";
  background?: "auto" | "transparent" | "opaque";
}

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: ImageMimeType;
  model: string;
  requestId?: string;
  revisedPrompt?: string;
}

export interface ImageGenerator {
  readonly provider: string;
  generate(request: ImageGenerationRequest): Promise<GeneratedImage>;
}

export interface GenerateAssetResult {
  asset: ImageAssetRecord;
  generated: Omit<GeneratedImage, "bytes">;
}

function generationName(mimeType: ImageMimeType): string {
  return mimeType === "image/png" ? "generated.png" : "generated.jpg";
}

export class GeneratedAssetService {
  constructor(
    readonly registry: AssetRegistry,
    readonly generator: ImageGenerator,
  ) {}

  async generate(request: ImageGenerationRequest): Promise<GenerateAssetResult> {
    const prompt = request.prompt.trim();
    if (!prompt) throw new Error("Image generation prompt cannot be empty");
    const generated = await this.generator.generate({ ...request, prompt });
    if (!generated.bytes.length) throw new Error(`${this.generator.provider} returned an empty image`);

    const asset = await this.registry.registerImage({
      bytes: generated.bytes,
      originalName: generationName(generated.mimeType),
      mimeType: generated.mimeType,
      provenance: {
        source: "generated",
        label: `${this.generator.provider} image generation`,
        prompt,
        model: generated.model,
        requestId: generated.requestId,
      },
    });

    return {
      asset,
      generated: {
        mimeType: generated.mimeType,
        model: generated.model,
        requestId: generated.requestId,
        revisedPrompt: generated.revisedPrompt,
      },
    };
  }
}
