import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIImageGenerator, openAIImageGeneratorFromEnv, type OpenAIImagesClientLike } from "../packages/image-generation/src/openai.js";

const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

class FakeOpenAIClient implements OpenAIImagesClientLike {
  readonly inputs: Record<string, unknown>[] = [];
  images = {
    generate: async (input: Record<string, unknown>) => {
      this.inputs.push(input);
      return {
        data: [{ b64_json: ONE_PX_PNG.toString("base64"), revised_prompt: "refined prompt" }],
        _request_id: "req_openai_test",
      };
    },
  };
}

test("OpenAI adapter maps Pitch image controls to the official Images API", async () => {
  const client = new FakeOpenAIClient();
  const generator = new OpenAIImageGenerator({ model: "image-model-from-config", client });
  const result = await generator.generate({
    prompt: "architectural photo",
    aspectRatio: "landscape",
    quality: "high",
    background: "transparent",
  });

  assert.deepEqual(client.inputs[0], {
    model: "image-model-from-config",
    prompt: "architectural photo",
    size: "1536x1024",
    quality: "high",
    background: "transparent",
    output_format: "png",
    n: 1,
  });
  assert(result.bytes.equals(ONE_PX_PNG));
  assert.equal(result.mimeType, "image/png");
  assert.equal(result.model, "image-model-from-config");
  assert.equal(result.requestId, "req_openai_test");
  assert.equal(result.revisedPrompt, "refined prompt");
});

test("OpenAI adapter maps square/draft defaults deterministically", async () => {
  const client = new FakeOpenAIClient();
  const generator = new OpenAIImageGenerator({ model: "configured", client });
  await generator.generate({ prompt: "simple icon", quality: "draft" });
  assert.equal(client.inputs[0].size, "1024x1024");
  assert.equal(client.inputs[0].quality, "low");
  assert.equal(client.inputs[0].background, "auto");
});

test("environment helper requires an explicit model instead of hard-coding one", () => {
  assert.throws(() => openAIImageGeneratorFromEnv({ OPENAI_API_KEY: "test" } as NodeJS.ProcessEnv), /PITCH_OPENAI_IMAGE_MODEL/);
});
