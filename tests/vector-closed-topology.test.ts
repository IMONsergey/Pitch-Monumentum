import test from "node:test";
import assert from "node:assert/strict";
import type { VectorPathData } from "../packages/deck-model/src/index.js";
import {
  deleteEditableVectorAnchor,
  editableVectorAnchors,
  explicitClosingSegment,
  moveEditableVectorAnchor,
  moveEditableVectorHandle,
} from "../packages/vector-path/src/topology.js";

function curvedClosedPath(): VectorPathData {
  return {
    fillRule: "nonzero",
    commands: [
      { command: "M", x: 0, y: 0 },
      { command: "C", x1: 30, y1: -20, x2: 80, y2: -20, x: 100, y: 20 },
      { command: "C", x1: 120, y1: 70, x2: 80, y2: 110, x: 30, y: 90 },
      // Explicit curved closing edge back to the first M anchor.
      { command: "C", x1: 0, y1: 80, x2: -20, y2: 30, x: 0, y: 0 },
      { command: "Z" },
    ],
  };
}

test("explicit curved closing segment is merged into the first editable anchor", () => {
  const path = curvedClosedPath();
  assert.deepEqual(explicitClosingSegment(path, 0), { startIndex: 0, terminalIndex: 3, closeIndex: 4 });
  const anchors = editableVectorAnchors(path);
  assert.equal(anchors.length, 3, "terminal duplicate endpoint must not appear as a fourth point");
  assert.deepEqual(anchors[0], {
    commandIndex: 0,
    command: "M",
    x: 0,
    y: 0,
    inHandle: { x: -20, y: 30 },
    outHandle: { x: 30, y: -20 },
  });
});

test("moving closed start anchor keeps explicit terminal endpoint closed and moves both handles", () => {
  const path = curvedClosedPath();
  const moved = moveEditableVectorAnchor(path, 0, 15, 25, true);
  const start = moved.commands[0];
  const outgoing = moved.commands[1];
  const terminal = moved.commands[3];
  assert(start.command === "M" && outgoing.command === "C" && terminal.command === "C");
  if (start.command !== "M" || outgoing.command !== "C" || terminal.command !== "C") throw new Error("Unexpected commands");
  assert.deepEqual({ x: start.x, y: start.y }, { x: 15, y: 25 });
  assert.deepEqual({ x: terminal.x, y: terminal.y }, { x: 15, y: 25 });
  assert.deepEqual({ x: outgoing.x1, y: outgoing.y1 }, { x: 45, y: 5 });
  assert.deepEqual({ x: terminal.x2, y: terminal.y2 }, { x: -5, y: 55 });
});

test("editing incoming handle of first closed anchor modifies terminal Bezier control", () => {
  const path = curvedClosedPath();
  const moved = moveEditableVectorHandle(path, 0, "in", -35, 45);
  const terminal = moved.commands[3];
  assert(terminal.command === "C");
  if (terminal.command !== "C") throw new Error("Expected cubic closing segment");
  assert.deepEqual({ x: terminal.x2, y: terminal.y2 }, { x: -35, y: 45 });
  const first = editableVectorAnchors(moved)[0];
  assert.deepEqual(first.inHandle, { x: -35, y: 45 });
});

test("deleting merged closed start anchor fails explicitly instead of corrupting topology", () => {
  assert.throws(() => deleteEditableVectorAnchor(curvedClosedPath(), 0), /first anchor.*closed path/i);
  assert.throws(() => deleteEditableVectorAnchor(curvedClosedPath(), 3), /merged into closed start anchor/i);
});
