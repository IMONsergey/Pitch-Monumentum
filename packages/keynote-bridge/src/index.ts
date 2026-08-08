import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { DeckDocument } from "../../deck-model/src/index.js";
import { exportProductionPptx, type ProductionExportManifest } from "../../export-pipeline/src/index.js";
import type { RichAsset } from "../../pptx-rich/src/index.js";

const execFileAsync = promisify(execFile);

export class KeynoteBridgeUnavailableError extends Error {
  constructor(message = "Native Keynote export requires macOS with Apple Keynote installed") {
    super(message);
    this.name = "KeynoteBridgeUnavailableError";
  }
}

export interface KeynoteAutomationRunner {
  run(inputPptxPath: string, outputKeyPath: string): Promise<void>;
}

export interface KeynoteExportOptions {
  assets?: Record<string, RichAsset>;
  platform?: NodeJS.Platform;
  runner?: KeynoteAutomationRunner;
}

export interface KeynoteExportResult {
  outputPath: string;
  sourcePptxManifest: ProductionExportManifest;
  bridge: "apple-keynote";
}

const KEYNOTE_SCRIPT = String.raw`
on run argv
  if (count of argv) is not 2 then error "Pitch Keynote bridge requires input and output paths"
  set inputPath to item 1 of argv
  set outputPath to item 2 of argv
  tell application "Keynote"
    activate
    with timeout of 180 seconds
      set importedDocument to open inputPath
      save importedDocument in outputPath as Keynote
      close importedDocument saving no
    end timeout
  end tell
  return outputPath
end run
`;

export class AppleScriptKeynoteRunner implements KeynoteAutomationRunner {
  async run(inputPptxPath: string, outputKeyPath: string): Promise<void> {
    try {
      await execFileAsync("osascript", ["-e", KEYNOTE_SCRIPT, inputPptxPath, outputKeyPath], {
        timeout: 200_000,
        maxBuffer: 2 * 1024 * 1024,
      });
    } catch (error: any) {
      const detail = [error?.stderr, error?.stdout, error?.message].filter(Boolean).join("\n");
      throw new KeynoteBridgeUnavailableError(`Keynote automation failed. Ensure Keynote is installed and automation permission is granted.\n${detail}`);
    }
  }
}

function keyPath(outputPath: string): string {
  const absolute = resolve(outputPath);
  return extname(absolute).toLowerCase() === ".key" ? absolute : `${absolute}.key`;
}

export async function exportDeckToKeynote(
  deck: DeckDocument,
  outputPath: string,
  options: KeynoteExportOptions = {},
): Promise<KeynoteExportResult> {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") throw new KeynoteBridgeUnavailableError();

  const outputKeyPath = keyPath(outputPath);
  const working = await mkdtemp(join(tmpdir(), "pitch-keynote-"));
  const inputPptxPath = join(working, `${basename(outputKeyPath, ".key")}.pptx`);
  try {
    const sourcePptxManifest = await exportProductionPptx(deck, inputPptxPath, { assets: options.assets ?? {} });
    if (!sourcePptxManifest.ready) {
      throw new Error("Keynote bridge refuses to convert a PPTX that did not pass the production export gate");
    }
    const runner = options.runner ?? new AppleScriptKeynoteRunner();
    await runner.run(inputPptxPath, outputKeyPath);
    const info = await stat(outputKeyPath).catch(() => null);
    if (!info || info.size <= 0) throw new Error(`Keynote did not create a valid output at ${outputKeyPath}`);
    return { outputPath: outputKeyPath, sourcePptxManifest, bridge: "apple-keynote" };
  } finally {
    await rm(working, { recursive: true, force: true });
  }
}
