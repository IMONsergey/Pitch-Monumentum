import type { TableCell, TableElement } from "../../deck-model/src/index.js";

export type TableCommand =
  | { command: "setCellText"; row: number; column: number; text: string }
  | { command: "insertRow"; index: number }
  | { command: "deleteRow"; index: number }
  | { command: "insertColumn"; index: number }
  | { command: "deleteColumn"; index: number }
  | { command: "setColumnWidths"; widths: number[] }
  | { command: "mergeCells"; fromRow: number; fromColumn: number; toRow: number; toColumn: number }
  | { command: "unmergeCell"; row: number; column: number }
  | { command: "replaceData"; rows: string[][] };

export interface TableEditResult {
  table: TableElement;
  changed: boolean;
}

interface Anchor {
  row: number;
  column: number;
  sourceRow: number;
  sourceIndex: number;
  rowspan: number;
  colspan: number;
  cell: TableCell;
}

interface TableGrid {
  width: number;
  height: number;
  anchors: Anchor[];
  slots: Array<Array<Anchor | undefined>>;
}

function span(value: number | undefined): number {
  return Math.max(1, Math.floor(value ?? 1));
}

function buildGrid(rows: TableCell[][]): TableGrid {
  if (!rows.length) throw new Error("Table must contain at least one row");
  const slots: Array<Array<Anchor | undefined>> = Array.from({ length: rows.length }, () => []);
  const anchors: Anchor[] = [];
  let width = 0;

  rows.forEach((row, rowIndex) => {
    let column = 0;
    row.forEach((cell, sourceIndex) => {
      while (slots[rowIndex][column]) column += 1;
      const rowspan = span(cell.rowspan);
      const colspan = span(cell.colspan);
      if (rowIndex + rowspan > rows.length) throw new Error(`Cell at ${rowIndex},${column} rowspan exceeds table height`);
      const anchor: Anchor = { row: rowIndex, column, sourceRow: rowIndex, sourceIndex, rowspan, colspan, cell };
      anchors.push(anchor);
      for (let r = rowIndex; r < rowIndex + rowspan; r += 1) {
        for (let c = column; c < column + colspan; c += 1) {
          if (slots[r][c]) throw new Error(`Table spans overlap at ${r},${c}`);
          slots[r][c] = anchor;
          width = Math.max(width, c + 1);
        }
      }
      column += colspan;
    });
  });

  for (let r = 0; r < rows.length; r += 1) {
    for (let c = 0; c < width; c += 1) {
      if (!slots[r][c]) throw new Error(`Table has a structural hole at ${r},${c}`);
    }
  }
  return { width, height: rows.length, anchors, slots };
}

function cloneTable(table: TableElement): TableElement {
  return structuredClone(table);
}

function normalizedCell(cell: TableCell, rowspan = 1, colspan = 1): TableCell {
  const next: TableCell = { ...structuredClone(cell) };
  if (rowspan > 1) next.rowspan = rowspan; else delete next.rowspan;
  if (colspan > 1) next.colspan = colspan; else delete next.colspan;
  return next;
}

function blankCell(): TableCell {
  return { text: "" };
}

function anchorAt(grid: TableGrid, row: number, column: number): Anchor {
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 || row >= grid.height || column >= grid.width) throw new Error(`Cell ${row},${column} is out of range`);
  return grid.slots[row][column]!;
}

function ensureUnmerged(grid: TableGrid, command: string): void {
  if (grid.anchors.some((anchor) => anchor.rowspan > 1 || anchor.colspan > 1)) {
    throw new Error(`${command} is not supported while the table contains merged cells; unmerge first`);
  }
}

function equal(a: TableElement, b: TableElement): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizeWidths(widths: number[], expected: number): number[] {
  if (widths.length !== expected) throw new Error(`Expected ${expected} column widths, got ${widths.length}`);
  if (widths.some((value) => !Number.isFinite(value) || value <= 0)) throw new Error("Column widths must be positive finite numbers");
  const sum = widths.reduce((total, value) => total + value, 0);
  return widths.map((value) => value / sum);
}

function rebuildFromAnchors(height: number, anchors: Array<{ row: number; column: number; cell: TableCell; rowspan: number; colspan: number }>): TableCell[][] {
  const rows: TableCell[][] = Array.from({ length: height }, () => []);
  const sorted = [...anchors].sort((a, b) => a.row - b.row || a.column - b.column);
  for (const anchor of sorted) rows[anchor.row].push(normalizedCell(anchor.cell, anchor.rowspan, anchor.colspan));
  return rows;
}

export function executeTableCommand(element: TableElement, input: TableCommand): TableEditResult {
  const table = cloneTable(element);
  const before = cloneTable(element);
  let grid = buildGrid(table.rows);

  if (input.command === "setCellText") {
    const anchor = anchorAt(grid, input.row, input.column);
    table.rows[anchor.sourceRow][anchor.sourceIndex].text = input.text;
  } else if (input.command === "insertRow") {
    ensureUnmerged(grid, "Insert row");
    if (!Number.isInteger(input.index) || input.index < 0 || input.index > grid.height) throw new Error(`Row insertion index ${input.index} is out of range`);
    table.rows.splice(input.index, 0, Array.from({ length: grid.width }, blankCell));
  } else if (input.command === "deleteRow") {
    ensureUnmerged(grid, "Delete row");
    if (grid.height <= 1) throw new Error("Table must keep at least one row");
    if (!Number.isInteger(input.index) || input.index < 0 || input.index >= grid.height) throw new Error(`Row ${input.index} is out of range`);
    table.rows.splice(input.index, 1);
  } else if (input.command === "insertColumn") {
    ensureUnmerged(grid, "Insert column");
    if (!Number.isInteger(input.index) || input.index < 0 || input.index > grid.width) throw new Error(`Column insertion index ${input.index} is out of range`);
    table.rows.forEach((row) => row.splice(input.index, 0, blankCell()));
    const widths = table.columnWidths ?? Array.from({ length: grid.width }, () => 1 / grid.width);
    widths.splice(input.index, 0, 1 / (grid.width + 1));
    table.columnWidths = normalizeWidths(widths, grid.width + 1);
  } else if (input.command === "deleteColumn") {
    ensureUnmerged(grid, "Delete column");
    if (grid.width <= 1) throw new Error("Table must keep at least one column");
    if (!Number.isInteger(input.index) || input.index < 0 || input.index >= grid.width) throw new Error(`Column ${input.index} is out of range`);
    table.rows.forEach((row) => row.splice(input.index, 1));
    if (table.columnWidths) table.columnWidths = normalizeWidths(table.columnWidths.filter((_, index) => index !== input.index), grid.width - 1);
  } else if (input.command === "setColumnWidths") {
    table.columnWidths = normalizeWidths(input.widths, grid.width);
  } else if (input.command === "mergeCells") {
    const fromRow = Math.min(input.fromRow, input.toRow);
    const toRow = Math.max(input.fromRow, input.toRow);
    const fromColumn = Math.min(input.fromColumn, input.toColumn);
    const toColumn = Math.max(input.fromColumn, input.toColumn);
    anchorAt(grid, fromRow, fromColumn);
    anchorAt(grid, toRow, toColumn);
    const selected = new Map<string, Anchor>();
    for (let r = fromRow; r <= toRow; r += 1) for (let c = fromColumn; c <= toColumn; c += 1) {
      const anchor = grid.slots[r][c]!;
      selected.set(`${anchor.row}:${anchor.column}`, anchor);
      if (anchor.row < fromRow || anchor.column < fromColumn || anchor.row + anchor.rowspan - 1 > toRow || anchor.column + anchor.colspan - 1 > toColumn) throw new Error("Merge selection cuts through an existing merged cell");
    }
    if (selected.size < 2) throw new Error("Merge requires at least two cells");
    const topLeft = grid.slots[fromRow][fromColumn]!;
    const selectedAnchors = new Set(selected.values());
    const remaining = grid.anchors.filter((anchor) => !selectedAnchors.has(anchor));
    remaining.push({ ...topLeft, row: fromRow, column: fromColumn, rowspan: toRow - fromRow + 1, colspan: toColumn - fromColumn + 1, cell: normalizedCell(topLeft.cell, toRow - fromRow + 1, toColumn - fromColumn + 1) });
    table.rows = rebuildFromAnchors(grid.height, remaining);
  } else if (input.command === "unmergeCell") {
    const target = anchorAt(grid, input.row, input.column);
    if (target.rowspan === 1 && target.colspan === 1) throw new Error("Cell is not merged");
    const anchors = grid.anchors.filter((anchor) => anchor !== target).map((anchor) => ({ row: anchor.row, column: anchor.column, rowspan: anchor.rowspan, colspan: anchor.colspan, cell: anchor.cell }));
    for (let r = target.row; r < target.row + target.rowspan; r += 1) {
      for (let c = target.column; c < target.column + target.colspan; c += 1) {
        anchors.push({ row: r, column: c, rowspan: 1, colspan: 1, cell: r === target.row && c === target.column ? normalizedCell(target.cell) : blankCell() });
      }
    }
    table.rows = rebuildFromAnchors(grid.height, anchors);
  } else {
    if (!input.rows.length || !input.rows[0]?.length) throw new Error("Replacement table data cannot be empty");
    const width = input.rows[0].length;
    if (input.rows.some((row) => row.length !== width)) throw new Error("Replacement table rows must have equal column counts");
    table.rows = input.rows.map((row) => row.map((text) => ({ text: String(text ?? "") })));
    table.columnWidths = Array.from({ length: width }, () => 1 / width);
  }

  grid = buildGrid(table.rows);
  if (table.columnWidths) table.columnWidths = normalizeWidths(table.columnWidths, grid.width);
  return { table, changed: !equal(before, table) };
}

export function tableDimensions(element: TableElement): { rows: number; columns: number; mergedCells: number } {
  const grid = buildGrid(element.rows);
  return { rows: grid.height, columns: grid.width, mergedCells: grid.anchors.filter((anchor) => anchor.rowspan > 1 || anchor.colspan > 1).length };
}
