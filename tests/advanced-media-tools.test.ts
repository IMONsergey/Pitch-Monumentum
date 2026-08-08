import test from "node:test";
import assert from "node:assert/strict";
import { PITCH_TOOL_DEFINITIONS } from "../packages/pitch-tools/src/index.js";

test("Pitch media tool exposes focal point, clip shape and atomic advanced-media patching", () => {
  const tool = PITCH_TOOL_DEFINITIONS.find((item) => item.name === "pitch_media_command");
  assert(tool);
  const schema = tool.inputSchema as any;
  assert(schema.properties.command.enum.includes("setImageFocalPoint"));
  assert(schema.properties.command.enum.includes("setImageClipShape"));
  assert(schema.properties.command.enum.includes("setImageProperties"));
  assert(schema.properties.focalPoint);
  assert(schema.properties.clipShape);
  assert(schema.properties.changes.properties.focalPoint);
  assert(schema.properties.changes.properties.clipShape);
});
