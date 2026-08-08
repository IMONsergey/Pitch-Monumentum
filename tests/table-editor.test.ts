import test from "node:test";
import assert from "node:assert/strict";
import type { TableElement } from "../packages/deck-model/src/index.js";
import { executeTableCommand, tableDimensions } from "../packages/table-editor/src/index.js";

function table(): TableElement {
  return {
    id: "table",
    type: "table",
    semanticRole: "table",
    geometry: { x: 100, y: 100, width: 900, height: 420 },
    zIndex: 1,
    origin: "user",
    exportStrategy: "native",
    dependencies: [],
    rows: [
      [{ text: "Metric" }, { text: "Q1" }, { text: "Q2" }],
      [{ text: "Revenue" }, { text: "10" }, { text: "12" }],
      [{ text: "Margin" }, { text: "4" }, { text: "5" }],
    ],
    columnWidths: [0.5, 0.25, 0.25],
  };
}

test("table cell edit is immutable and addresses visual cells", () => {
  const original = table();
  const result = executeTableCommand(original, { command: "setCellText", row: 1, column: 2, text: "13" });
  assert.equal(result.changed, true);
  assert.equal(result.table.rows[1][2].text, "13");
  assert.equal(original.rows[1][2].text, "12");
});

test("row and column insertion/deletion keep a rectangular editable table", () => {
  let current = executeTableCommand(table(), { command: "insertRow", index: 2 }).table;
  assert.deepEqual(tableDimensions(current), { rows: 4, columns: 3, mergedCells: 0 });
  assert.deepEqual(current.rows[2].map(cell => cell.text), ["", "", ""]);
  current = executeTableCommand(current, { command: "insertColumn", index: 1 }).table;
  assert.deepEqual(tableDimensions(current), { rows: 4, columns: 4, mergedCells: 0 });
  assert.equal(current.rows.every(row => row.length === 4), true);
  assert(Math.abs((current.columnWidths ?? []).reduce((sum, value) => sum + value, 0) - 1) < 1e-9);
  current = executeTableCommand(current, { command: "deleteRow", index: 2 }).table;
  current = executeTableCommand(current, { command: "deleteColumn", index: 1 }).table;
  assert.deepEqual(tableDimensions(current), { rows: 3, columns: 3, mergedCells: 0 });
});

test("column widths normalize to proportions and reject invalid input", () => {
  const result = executeTableCommand(table(), { command: "setColumnWidths", widths: [4, 2, 2] });
  assert.deepEqual(result.table.columnWidths, [0.5, 0.25, 0.25]);
  assert.throws(() => executeTableCommand(table(), { command: "setColumnWidths", widths: [1, 2] }), /Expected 3/);
  assert.throws(() => executeTableCommand(table(), { command: "setColumnWidths", widths: [1, 0, 1] }), /positive/);
});

test("merge and unmerge preserve top-left content and produce canonical spans", () => {
  let current = executeTableCommand(table(), { command: "mergeCells", fromRow: 0, fromColumn: 1, toRow: 0, toColumn: 2 }).table;
  assert.deepEqual(tableDimensions(current), { rows: 3, columns: 3, mergedCells: 1 });
  assert.equal(current.rows[0][1].text, "Q1");
  assert.equal(current.rows[0][1].colspan, 2);
  assert.equal(current.rows[0].length, 2);

  current = executeTableCommand(current, { command: "unmergeCell", row: 0, column: 2 }).table;
  assert.deepEqual(tableDimensions(current), { rows: 3, columns: 3, mergedCells: 0 });
  assert.deepEqual(current.rows[0].map(cell => cell.text), ["Metric", "Q1", ""]);
});

test("structural row/column edits fail closed while merged spans exist", () => {
  const merged = executeTableCommand(table(), { command: "mergeCells", fromRow: 0, fromColumn: 0, toRow: 1, toColumn: 0 }).table;
  assert.throws(() => executeTableCommand(merged, { command: "insertRow", index: 1 }), /unmerge first/);
  assert.throws(() => executeTableCommand(merged, { command: "deleteColumn", index: 1 }), /unmerge first/);
});

test("replaceData validates rectangular input and resets equal column widths", () => {
  const result = executeTableCommand(table(), { command: "replaceData", rows: [["A", "B"], ["1", "2"], ["3", "4"]] });
  assert.deepEqual(tableDimensions(result.table), { rows: 3, columns: 2, mergedCells: 0 });
  assert.deepEqual(result.table.columnWidths, [0.5, 0.5]);
  assert.throws(() => executeTableCommand(table(), { command: "replaceData", rows: [["A", "B"], ["1"]] }), /equal column counts/);
  assert.throws(() => executeTableCommand(table(), { command: "replaceData", rows: [] }), /cannot be empty/);
});

test("table cannot delete its final row or final column", () => {
  const single: TableElement = { ...table(), rows: [[{ text: "Only" }]], columnWidths: [1] };
  assert.throws(() => executeTableCommand(single, { command: "deleteRow", index: 0 }), /at least one row/);
  assert.throws(() => executeTableCommand(single, { command: "deleteColumn", index: 0 }), /at least one column/);
});
