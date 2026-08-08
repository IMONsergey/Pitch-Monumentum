import OpenAI from "openai";
import type { GeneratedImage, ImageGenerationRequest, ImageGenerator } from "./index.js";

export interface OpenAIImageGeneratorOptions {
  model: string;
  apiKey?: string;
  organization?: string;
  project?: string;
  client?: OpenAIImagesClientLike;
}

export interface OpenAIImagesClientLike {
  images: {
    generate(input: Record<string, unknown>): Promise<any>;
  };
}

function sizeFor(aspectRatio: ImageGenerationRequest["aspectRatio"]): "1024x1024" | "1536x1024" | "1024x1536" {
  if (aspectRatio === "portrait") return "1024x1536";
  if (aspectRatio === "landscape") return "1536x1024";
  return "1024x1024";
}

function qualityFor(quality: ImageGenerationRequest["quality"]): "low" | "medium" | "high" {
  if (quality === "draft") return "low";
  if (quality === "high") return "high";
  return "medium";
}

function backgroundFor(background: ImageGenerationRequest["background"]): "auto" | "transparent" | "opaque" {
  return background ?? "auto";
}

export class OpenAIImageGenerator implements ImageGenerator {
  readonly provider = "openai";
  readonly model: string;
  readonly client: OpenAIImagesClientLike;

  constructor(options: OpenAIImageGeneratorOptions) {
    this.model = options.model.trim();
    if (!this.model) throw new Error("OpenAI image model is required");
    this.client = options.client ?? new OpenAI({
      apiKey: options.apiKey,
      organization: options.organization,
      project: options.project,
    });
  }

  async generate(request: ImageGenerationRequest): Promise<GeneratedImage> {
    const response = await this.client.images.generate({
      model: this.model,
      prompt: request.prompt,
      size: sizeFor(request.aspectRatio),
      quality: qualityFor(request.quality),
      background: backgroundFor(request.background),
      output_format: "png",
      n: 1,
    });
    const image = response.data?.[0];
    if (!image?.b64_json) throw new Error("OpenAI image generation returned no base64 image data");
    return {
      bytes: Buffer.from(image.b64_json, "base64"),
      mimeType: "image/png",
      model: this.model,
      requestId: response._request_id,
      revisedPrompt: image.revised_prompt,
    };
  }
}

export function openAIImageGeneratorFromEnv(env: NodeJS.ProcessEnv = process.env): OpenAIImageGenerator {
  const model = env.PITCH_OPENAI_IMAGE_MODEL ?? env.OPENAI_IMAGE_MODEL;
  if (!model?.trim()) {
    throw new Error("Set PITCH_OPENAI_IMAGE_MODEL or OPENAI_IMAGE_MODEL before enabling OpenAI image generation");
  }
  return new OpenAIImageGenerator({
    model,
    apiKey: env.OPENAI_API_KEY,
    organization: env.OPENAI_ORG_ID,
    project: env.OPENAI_PROJECT_ID,
  });
}
