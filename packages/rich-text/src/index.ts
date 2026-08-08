import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  createEditor,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  type ElementFormatType,
  type LexicalEditor,
  type TextFormatType,
} from "lexical";
import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
  registerList,
} from "@lexical/list";
import { HeadingNode, QuoteNode, registerRichText } from "@lexical/rich-text";
import { $patchStyleText } from "@lexical/selection";
import type { TextParagraph, TextRun } from "../../deck-model/src/index.js";

export interface RichTextTheme {
  paragraph?: string;
  text?: Partial<Record<TextFormatType, string>>;
}

export interface PitchRichTextSession {
  editor: LexicalEditor;
  readParagraphs(): TextParagraph[];
  focus(): void;
  toggleFormat(format: "bold" | "italic" | "underline"): void;
  setAlignment(alignment: NonNullable<TextParagraph["align"]>): void;
  setFontFamily(fontFamily: string): void;
  setFontSizePt(fontSizePt: number): void;
  setColor(color: string): void;
  setLetterSpacingPt(letterSpacingPt: number): void;
  toggleBulletList(): void;
  toggleNumberedList(): void;
  destroy(): void;
}

const PT_PER_PX = 72 / 96;

function escapeStyleValue(value: string): string {
  return value.replace(/[;\n\r]/g, "").trim();
}

function styleFromRun(run: TextRun): string {
  const declarations: string[] = [];
  if (run.fontFamily) declarations.push(`font-family:${escapeStyleValue(run.fontFamily)}`);
  if (run.fontSizePt !== undefined) declarations.push(`font-size:${run.fontSizePt}pt`);
  if (run.color) declarations.push(`color:${escapeStyleValue(run.color)}`);
  if (run.letterSpacingPt !== undefined) declarations.push(`letter-spacing:${run.letterSpacingPt}pt`);
  return declarations.join(";");
}

function parseCss(style: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const declaration of style.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (property && value) result[property] = value;
  }
  return result;
}

function cssLengthToPt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)(pt|px)?$/i);
  if (!match) return undefined;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return undefined;
  return (match[2]?.toLowerCase() ?? "pt") === "px" ? number * PT_PER_PX : number;
}

function runFromTextNode(node: any): TextRun {
  const css = parseCss(node.getStyle?.() ?? "");
  const run: TextRun = {
    text: node.getTextContent(),
    bold: node.hasFormat?.("bold") || undefined,
    italic: node.hasFormat?.("italic") || undefined,
    underline: node.hasFormat?.("underline") || undefined,
  };
  if (css["font-family"]) run.fontFamily = css["font-family"].replace(/^['"]|['"]$/g, "");
  const size = cssLengthToPt(css["font-size"]);
  if (size !== undefined) run.fontSizePt = Math.round(size * 1000) / 1000;
  if (css.color) run.color = css.color;
  const spacing = cssLengthToPt(css["letter-spacing"]);
  if (spacing !== undefined) run.letterSpacingPt = Math.round(spacing * 1000) / 1000;
  return run;
}

function appendRuns(parent: any, runs: TextRun[]): void {
  for (const run of runs) {
    const text = $createTextNode(run.text);
    if (run.bold) text.toggleFormat("bold");
    if (run.italic) text.toggleFormat("italic");
    if (run.underline) text.toggleFormat("underline");
    const style = styleFromRun(run);
    if (style) text.setStyle(style);
    parent.append(text);
  }
}

function paragraphAlignment(paragraph: TextParagraph): ElementFormatType {
  return (paragraph.align ?? "left") as ElementFormatType;
}

function populateEditor(paragraphs: TextParagraph[]): void {
  const root = $getRoot();
  root.clear();

  let index = 0;
  while (index < paragraphs.length) {
    const paragraph = paragraphs[index];
    if (!paragraph.bullet) {
      const node = $createParagraphNode();
      node.setFormat(paragraphAlignment(paragraph));
      appendRuns(node, paragraph.runs);
      root.append(node);
      index += 1;
      continue;
    }

    const ordered = /^(\d+[.)]|ordered|number)/i.test(paragraph.bullet.marker ?? "");
    const list = $createListNode(ordered ? "number" : "bullet");
    while (index < paragraphs.length && paragraphs[index].bullet) {
      const itemParagraph = paragraphs[index];
      const item = $createListItemNode();
      appendRuns(item, itemParagraph.runs);
      item.setFormat(paragraphAlignment(itemParagraph));
      list.append(item);
      index += 1;
    }
    root.append(list);
  }

  if (root.getChildrenSize() === 0) root.append($createParagraphNode());
}

function alignmentOf(node: any): TextParagraph["align"] {
  const value = node.getFormatType?.();
  if (value === "center" || value === "right" || value === "justify") return value;
  return "left";
}

function collectRuns(node: any): TextRun[] {
  const runs: TextRun[] = [];
  const visit = (current: any) => {
    if ($isTextNode(current)) {
      runs.push(runFromTextNode(current));
      return;
    }
    if ($isElementNode(current)) {
      for (const child of current.getChildren()) visit(child);
    }
  };
  visit(node);
  return runs.length ? runs : [{ text: "" }];
}

function serializeEditor(original: TextParagraph[]): TextParagraph[] {
  const root = $getRoot();
  const result: TextParagraph[] = [];
  let originalIndex = 0;

  for (const node of root.getChildren()) {
    if ($isListNode(node)) {
      const listType = node.getListType();
      for (const child of node.getChildren()) {
        if (!$isListItemNode(child)) continue;
        const previous = original[originalIndex] ?? { runs: [] };
        result.push({
          ...previous,
          runs: collectRuns(child),
          align: alignmentOf(child),
          bullet: {
            level: previous.bullet?.level ?? 0,
            marker: listType === "number" ? `${result.length + 1}.` : "•",
          },
        });
        originalIndex += 1;
      }
      continue;
    }

    if ($isElementNode(node)) {
      const previous = original[originalIndex] ?? { runs: [] };
      result.push({
        ...previous,
        runs: collectRuns(node),
        align: alignmentOf(node),
        bullet: undefined,
      });
      originalIndex += 1;
    }
  }

  return result.length ? result : [{ runs: [{ text: "" }], align: "left" }];
}

function patchSelection(editor: LexicalEditor, styles: Record<string, string | null>): void {
  editor.update(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) $patchStyleText(selection, styles);
  });
}

export function createPitchRichTextSession(
  rootElement: HTMLElement,
  paragraphs: TextParagraph[],
  options: { namespace?: string; theme?: RichTextTheme; historyDelayMs?: number } = {},
): PitchRichTextSession {
  const editor = createEditor({
    namespace: options.namespace ?? `PitchText:${crypto.randomUUID()}`,
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode],
    onError(error) { throw error; },
    theme: options.theme,
  });
  editor.setRootElement(rootElement);
  const unregisterRichText = registerRichText(editor);
  const unregisterList = registerList(editor);
  const unregisterHistory = registerHistory(editor, createEmptyHistoryState(), options.historyDelayMs ?? 250);

  editor.update(() => populateEditor(paragraphs), { discrete: true });

  return {
    editor,
    readParagraphs() {
      let result: TextParagraph[] = [];
      editor.getEditorState().read(() => { result = serializeEditor(paragraphs); });
      return result;
    },
    focus() { editor.focus(); },
    toggleFormat(format) { editor.dispatchCommand(FORMAT_TEXT_COMMAND, format); },
    setAlignment(alignment) { editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, alignment); },
    setFontFamily(fontFamily) { patchSelection(editor, { "font-family": escapeStyleValue(fontFamily) }); },
    setFontSizePt(fontSizePt) {
      if (!Number.isFinite(fontSizePt) || fontSizePt <= 0) throw new Error("fontSizePt must be a positive finite number");
      patchSelection(editor, { "font-size": `${fontSizePt}pt` });
    },
    setColor(color) { patchSelection(editor, { color: escapeStyleValue(color) }); },
    setLetterSpacingPt(letterSpacingPt) {
      if (!Number.isFinite(letterSpacingPt)) throw new Error("letterSpacingPt must be finite");
      patchSelection(editor, { "letter-spacing": `${letterSpacingPt}pt` });
    },
    toggleBulletList() { editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined); },
    toggleNumberedList() { editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined); },
    destroy() {
      unregisterHistory();
      unregisterList();
      unregisterRichText();
      editor.setRootElement(null);
    },
  };
}

export const pitchTextStyle = {
  styleFromRun,
  parseCss,
  cssLengthToPt,
};
