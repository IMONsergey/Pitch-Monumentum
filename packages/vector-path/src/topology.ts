import type { VectorPathCommand, VectorPathData } from "../../deck-model/src/index.js";
import {
  moveVectorAnchor,
  moveVectorHandle,
  validateVectorPathData,
  vectorAnchors,
  type VectorAnchor,
} from "./index.js";
import { deleteVectorAnchor } from "./edit.js";

function samePoint(a: { x: number; y: number }, b: { x: number; y: number }, epsilon = 1e-6): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}

function endpoint(command: VectorPathCommand): { x: number; y: number } | undefined {
  return command.command === "Z" ? undefined : { x: command.x, y: command.y };
}

interface ExplicitClosingSegment {
  startIndex: number;
  terminalIndex: number;
  closeIndex: number;
}

/**
 * Detect a subpath represented as M ... [L/Q/C endpoint == M] Z.
 * The explicit terminal segment is necessary when the closing edge itself carries
 * Bezier controls, but it should behave as the incoming side of the first anchor.
 */
export function explicitClosingSegment(path: VectorPathData, startIndex: number): ExplicitClosingSegment | undefined {
  const start = path.commands[startIndex];
  if (!start || start.command !== "M") return undefined;
  let terminalIndex = -1;
  for (let index = startIndex + 1; index < path.commands.length; index += 1) {
    const command = path.commands[index];
    if (command.command === "M") return undefined;
    if (command.command === "Z") {
      if (terminalIndex < 0) return undefined;
      const terminal = path.commands[terminalIndex];
      const end = endpoint(terminal);
      return end && samePoint(end, start)
        ? { startIndex, terminalIndex, closeIndex: index }
        : undefined;
    }
    terminalIndex = index;
  }
  return undefined;
}

function incomingHandle(command: VectorPathCommand): { x: number; y: number } | undefined {
  if (command.command === "C") return { x: command.x2, y: command.y2 };
  if (command.command === "Q") return { x: command.x1, y: command.y1 };
  return undefined;
}

export function editableVectorAnchors(path: VectorPathData): VectorAnchor[] {
  validateVectorPathData(path);
  const anchors = vectorAnchors(path);
  const mergedTerminalIndices = new Set<number>();
  const startIncoming = new Map<number, { x: number; y: number }>();

  for (let index = 0; index < path.commands.length; index += 1) {
    if (path.commands[index].command !== "M") continue;
    const closing = explicitClosingSegment(path, index);
    if (!closing) continue;
    mergedTerminalIndices.add(closing.terminalIndex);
    const handle = incomingHandle(path.commands[closing.terminalIndex]);
    if (handle) startIncoming.set(index, handle);
  }

  return anchors
    .filter((anchor) => !mergedTerminalIndices.has(anchor.commandIndex))
    .map((anchor) => {
      const inHandle = startIncoming.get(anchor.commandIndex);
      return inHandle ? { ...anchor, inHandle } : anchor;
    });
}

export function moveEditableVectorAnchor(
  path: VectorPathData,
  commandIndex: number,
  x: number,
  y: number,
  moveHandles = true,
): VectorPathData {
  validateVectorPathData(path);
  const original = path.commands[commandIndex];
  if (!original || original.command === "Z") throw new Error(`Command ${commandIndex} is not a movable anchor`);

  // M anchor of an explicitly curved/segmented closed path owns both the M point
  // and the terminal endpoint that returns to it.
  if (original.command === "M") {
    const closing = explicitClosingSegment(path, commandIndex);
    if (closing) {
      const dx = x - original.x;
      const dy = y - original.y;
      const result = moveVectorAnchor(path, commandIndex, x, y, moveHandles);
      const commands = structuredClone(result.commands);
      const terminal = commands[closing.terminalIndex];
      if (terminal.command === "Z" || terminal.command === "M") throw new Error("Closing segment topology changed unexpectedly");
      terminal.x += dx;
      terminal.y += dy;
      if (moveHandles) {
        if (terminal.command === "C") { terminal.x2 += dx; terminal.y2 += dy; }
        if (terminal.command === "Q") { terminal.x1 += dx; terminal.y1 += dy; }
      }
      return { ...result, commands };
    }
  }

  // The duplicate terminal endpoint is intentionally hidden from editable anchors.
  for (let startIndex = 0; startIndex < path.commands.length; startIndex += 1) {
    const closing = explicitClosingSegment(path, startIndex);
    if (closing?.terminalIndex === commandIndex) throw new Error(`Anchor ${commandIndex} is the merged closing endpoint; edit start anchor ${startIndex} instead`);
  }
  return moveVectorAnchor(path, commandIndex, x, y, moveHandles);
}

export function moveEditableVectorHandle(
  path: VectorPathData,
  commandIndex: number,
  handle: "in" | "out",
  x: number,
  y: number,
): VectorPathData {
  validateVectorPathData(path);
  const command = path.commands[commandIndex];
  if (!command || command.command === "Z") throw new Error(`Command ${commandIndex} is not an editable anchor`);

  if (command.command === "M" && handle === "in") {
    const closing = explicitClosingSegment(path, commandIndex);
    if (!closing) throw new Error(`Anchor ${commandIndex} has no incoming handle`);
    const commands = structuredClone(path.commands);
    const terminal = commands[closing.terminalIndex];
    if (terminal.command === "C") { terminal.x2 = x; terminal.y2 = y; }
    else if (terminal.command === "Q") { terminal.x1 = x; terminal.y1 = y; }
    else throw new Error(`Closed start anchor ${commandIndex} has no incoming Bezier handle`);
    return { ...path, commands };
  }

  return moveVectorHandle(path, commandIndex, handle, x, y);
}

export function deleteEditableVectorAnchor(path: VectorPathData, commandIndex: number): VectorPathData {
  validateVectorPathData(path);
  const command = path.commands[commandIndex];
  if (!command || command.command === "Z") throw new Error(`Command ${commandIndex} is not a deletable anchor`);

  if (command.command === "M" && explicitClosingSegment(path, commandIndex)) {
    throw new Error("Deleting the first anchor of an explicitly curved closed path is deferred; delete another anchor or open the path first");
  }
  for (let startIndex = 0; startIndex < path.commands.length; startIndex += 1) {
    const closing = explicitClosingSegment(path, startIndex);
    if (closing?.terminalIndex === commandIndex) throw new Error(`Anchor ${commandIndex} is merged into closed start anchor ${startIndex}`);
  }
  return deleteVectorAnchor(path, commandIndex);
}
