import type { DeckDocument, SceneElement, TextRun } from "../../deck-model/src/index.js";

export type ThemeTokenCategory = "colors" | "fonts" | "typeScalePt" | "spacingDU";
export type ThemeBindingTarget = "fill" | "strokeColor" | "textColor" | "fontFamily" | "fontSizePt";

export interface DeckTheme {
  schemaVersion: "0.1";
  id: string;
  name: string;
  colors: Record<string, string>;
  fonts: Record<string, string>;
  typeScalePt: Record<string, number>;
  spacingDU: Record<string, number>;
}

export type ElementTokenBindings = Partial<Record<ThemeBindingTarget, string>>;
export type TokenizedSceneElement = SceneElement & { tokenBindings?: ElementTokenBindings };
export type ThemedDeckDocument = DeckDocument & { theme?: DeckTheme };

export type DesignCommand =
  | { command: "initializeTheme"; theme: DeckTheme }
  | { command: "renameTheme"; name: string }
  | { command: "setToken"; category: ThemeTokenCategory; token: string; value: string | number }
  | { command: "bindToken"; slideId: string; elementIds: string[]; target: ThemeBindingTarget; token: string }
  | { command: "unbindToken"; slideId: string; elementIds: string[]; target: ThemeBindingTarget }
  | { command: "deleteToken"; category: ThemeTokenCategory; token: string };

export interface DesignCommandResult {
  deck: DeckDocument;
  changed: boolean;
  reason: string;
  affectedSlideIds: string[];
  affectedElementIds: string[];
  audit: ThemeAuditIssue[];
}

export interface ThemeAuditIssue {
  code: "missing-theme" | "missing-token" | "binding-target-invalid" | "materialized-value-mismatch";
  severity: "major" | "minor";
  slideId?: string;
  elementId?: string;
  target?: ThemeBindingTarget;
  token?: string;
  message: string;
}

const TOKEN_RE = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/;

function tokenName(value: string): string {
  const token = value.trim();
  if (!TOKEN_RE.test(token)) throw new Error(`Invalid design token name: ${value}`);
  return token;
}

function color(value: unknown): string {
  if (typeof value !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(value)) throw new Error("Color token must be #RRGGBB");
  return value.toUpperCase();
}

function font(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Font token must be a non-empty font family");
  return value.trim();
}

function numberToken(value: unknown, label: string, allowZero = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) throw new Error(`${label} must be ${allowZero ? "non-negative" : "positive"}`);
  return value;
}

export function validateTheme(theme: DeckTheme): void {
  if (theme.schemaVersion !== "0.1") throw new Error(`Unsupported theme schema: ${theme.schemaVersion}`);
  if (!theme.id.trim()) throw new Error("Theme id is required");
  if (!theme.name.trim()) throw new Error("Theme name is required");
  for (const [key, value] of Object.entries(theme.colors)) { tokenName(key); color(value); }
  for (const [key, value] of Object.entries(theme.fonts)) { tokenName(key); font(value); }
  for (const [key, value] of Object.entries(theme.typeScalePt)) { tokenName(key); numberToken(value, `Type token ${key}`); }
  for (const [key, value] of Object.entries(theme.spacingDU)) { tokenName(key); numberToken(value, `Spacing token ${key}`, true); }
}

export function themeFromDesignSystem(input: {
  id: string;
  name: string;
  tokens: { colors: Record<string, string>; fonts: Record<string, string>; typeScalePt: Record<string, number>; spacingDU: Record<string, number> };
}): DeckTheme {
  const theme: DeckTheme = {
    schemaVersion: "0.1",
    id: input.id,
    name: input.name,
    colors: structuredClone(input.tokens.colors),
    fonts: structuredClone(input.tokens.fonts),
    typeScalePt: structuredClone(input.tokens.typeScalePt),
    spacingDU: structuredClone(input.tokens.spacingDU),
  };
  validateTheme(theme);
  return theme;
}

function categoryForTarget(target: ThemeBindingTarget): ThemeTokenCategory {
  if (target === "fill" || target === "strokeColor" || target === "textColor") return "colors";
  if (target === "fontFamily") return "fonts";
  return "typeScalePt";
}

function tokenValue(theme: DeckTheme, target: ThemeBindingTarget, token: string): string | number {
  const category = categoryForTarget(target);
  const map = theme[category] as Record<string, string | number>;
  if (!(token in map)) throw new Error(`Unknown ${category} token: ${token}`);
  return map[token];
}

function textRuns(element: Extract<SceneElement, { type: "text" }>, patch: Partial<TextRun>) {
  return element.paragraphs.map((paragraph) => ({ ...paragraph, runs: paragraph.runs.map((run) => ({ ...run, ...patch })) }));
}

function materialize(element: TokenizedSceneElement, target: ThemeBindingTarget, value: string | number): TokenizedSceneElement {
  const next: any = structuredClone(element);
  if (target === "fill") {
    if (next.type !== "shape" && next.type !== "frame") throw new Error(`Element ${element.id} cannot bind a fill token`);
    next.fill = color(value);
    if (next.fillPaint && next.fillPaint.kind !== "none") next.fillPaint = { kind: "solid", color: next.fill };
  } else if (target === "strokeColor") {
    if (next.type !== "shape" && next.type !== "line" && next.type !== "frame") throw new Error(`Element ${element.id} cannot bind a stroke token`);
    if (!next.stroke) throw new Error(`Element ${element.id} has no stroke to bind`);
    next.stroke = { ...next.stroke, color: color(value) };
  } else if (target === "textColor") {
    if (next.type !== "text") throw new Error(`Element ${element.id} cannot bind a text color token`);
    next.paragraphs = textRuns(next, { color: color(value) });
  } else if (target === "fontFamily") {
    if (next.type !== "text") throw new Error(`Element ${element.id} cannot bind a font token`);
    next.paragraphs = textRuns(next, { fontFamily: font(value) });
  } else {
    if (next.type !== "text") throw new Error(`Element ${element.id} cannot bind a type-scale token`);
    next.paragraphs = textRuns(next, { fontSizePt: numberToken(value, "Font size") });
  }
  return next;
}

function bind(element: TokenizedSceneElement, target: ThemeBindingTarget, token: string, theme: DeckTheme): TokenizedSceneElement {
  const key = tokenName(token);
  const value = tokenValue(theme, target, key);
  const next = materialize(element, target, value);
  next.tokenBindings = { ...(next.tokenBindings ?? {}), [target]: key };
  return next;
}

function unbind(element: TokenizedSceneElement, target: ThemeBindingTarget): TokenizedSceneElement {
  const next: TokenizedSceneElement = structuredClone(element);
  if (!next.tokenBindings?.[target]) return next;
  const bindings = { ...next.tokenBindings };
  delete bindings[target];
  next.tokenBindings = Object.keys(bindings).length ? bindings : undefined;
  return next;
}

function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

function materializedValue(element: TokenizedSceneElement, target: ThemeBindingTarget): unknown {
  if (target === "fill") return element.type === "shape" || element.type === "frame" ? element.fill : undefined;
  if (target === "strokeColor") return element.type === "shape" || element.type === "line" || element.type === "frame" ? element.stroke?.color : undefined;
  if (element.type !== "text") return undefined;
  const values = element.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => target === "textColor" ? run.color : target === "fontFamily" ? run.fontFamily : run.fontSizePt));
  return values.length && values.every((value) => same(value, values[0])) ? values[0] : values;
}

export function auditTheme(deck: DeckDocument): ThemeAuditIssue[] {
  const themed = deck as ThemedDeckDocument;
  const issues: ThemeAuditIssue[] = [];
  if (!themed.theme) {
    const hasBindings = deck.slides.some((slide) => slide.scene.some((element) => Boolean((element as TokenizedSceneElement).tokenBindings && Object.keys((element as TokenizedSceneElement).tokenBindings!).length)));
    if (hasBindings) issues.push({ code: "missing-theme", severity: "major", message: "Deck contains token bindings but has no theme snapshot" });
    return issues;
  }
  const theme = themed.theme;
  for (const slide of deck.slides) for (const element of slide.scene as TokenizedSceneElement[]) {
    for (const [target, token] of Object.entries(element.tokenBindings ?? {}) as Array<[ThemeBindingTarget, string]>) {
      let expected: string | number;
      try { expected = tokenValue(theme, target, token); }
      catch {
        issues.push({ code: "missing-token", severity: "major", slideId: slide.id, elementId: element.id, target, token, message: `Binding ${target} references missing token ${token}` });
        continue;
      }
      try { materialize(element, target, expected); }
      catch (error) {
        issues.push({ code: "binding-target-invalid", severity: "major", slideId: slide.id, elementId: element.id, target, token, message: error instanceof Error ? error.message : String(error) });
        continue;
      }
      const actual = materializedValue(element, target);
      const normalizedExpected = target === "fill" || target === "strokeColor" || target === "textColor" ? color(expected) : target === "fontFamily" ? font(expected) : numberToken(expected, "Font size");
      if (!same(actual, normalizedExpected)) issues.push({ code: "materialized-value-mismatch", severity: "minor", slideId: slide.id, elementId: element.id, target, token, message: `Materialized ${target} does not match token ${token}` });
    }
  }
  return issues;
}

function updateBoundElements(deck: ThemedDeckDocument, category: ThemeTokenCategory, token: string): { slides: DeckDocument["slides"]; affectedSlideIds: string[]; affectedElementIds: string[] } {
  const theme = deck.theme!;
  const affectedSlideIds: string[] = [];
  const affectedElementIds: string[] = [];
  const slides = deck.slides.map((slide) => {
    let changed = false;
    const scene = (slide.scene as TokenizedSceneElement[]).map((element) => {
      let next = element;
      for (const [target, binding] of Object.entries(element.tokenBindings ?? {}) as Array<[ThemeBindingTarget, string]>) {
        if (binding !== token || categoryForTarget(target) !== category) continue;
        next = materialize(next, target, tokenValue(theme, target, token));
        affectedElementIds.push(element.id);
        changed = true;
      }
      return next;
    });
    if (!changed) return slide;
    affectedSlideIds.push(slide.id);
    return { ...slide, status: "draft" as const, scene };
  });
  return { slides, affectedSlideIds: [...new Set(affectedSlideIds)], affectedElementIds: [...new Set(affectedElementIds)] };
}

export function executeDesignCommand(deck: DeckDocument, command: DesignCommand): DesignCommandResult {
  const current = deck as ThemedDeckDocument;
  let next: ThemedDeckDocument = structuredClone(current);
  const affectedSlideIds: string[] = [];
  const affectedElementIds: string[] = [];
  let reason = "Design system edit";

  if (command.command === "initializeTheme") {
    validateTheme(command.theme);
    next.theme = structuredClone(command.theme);
    reason = `Initialize theme ${command.theme.name}`;
  } else {
    if (!next.theme) throw new Error("Deck theme is not initialized");
    if (command.command === "renameTheme") {
      if (!command.name.trim()) throw new Error("Theme name is required");
      next.theme.name = command.name.trim();
      reason = `Rename theme to ${next.theme.name}`;
    } else if (command.command === "setToken") {
      const token = tokenName(command.token);
      const category = command.category;
      const map = next.theme[category] as Record<string, string | number>;
      map[token] = category === "colors" ? color(command.value) : category === "fonts" ? font(command.value) : category === "spacingDU" ? numberToken(command.value, `Spacing token ${token}`, true) : numberToken(command.value, `Type token ${token}`);
      const propagated = updateBoundElements(next, category, token);
      next.slides = propagated.slides;
      affectedSlideIds.push(...propagated.affectedSlideIds);
      affectedElementIds.push(...propagated.affectedElementIds);
      reason = `Set ${category} token ${token}`;
    } else if (command.command === "bindToken" || command.command === "unbindToken") {
      const slide = next.slides.find((item) => item.id === command.slideId);
      if (!slide) throw new Error(`Unknown slide: ${command.slideId}`);
      const ids = [...new Set(command.elementIds)];
      if (!ids.length) throw new Error("Select at least one element");
      for (const id of ids) if (!slide.scene.some((element) => element.id === id)) throw new Error(`Unknown element ${id} on slide ${slide.id}`);
      const token = command.command === "bindToken" ? tokenName(command.token) : undefined;
      const scene = (slide.scene as TokenizedSceneElement[]).map((element) => {
        if (!ids.includes(element.id)) return element;
        affectedElementIds.push(element.id);
        return command.command === "bindToken" ? bind(element, command.target, token!, next.theme!) : unbind(element, command.target);
      });
      next.slides = next.slides.map((item) => item.id === slide.id ? { ...item, status: "draft", scene } : item);
      affectedSlideIds.push(slide.id);
      reason = command.command === "bindToken" ? `Bind ${command.target} to ${token}` : `Unbind ${command.target}`;
    } else if (command.command === "deleteToken") {
      const token = tokenName(command.token);
      for (const slide of next.slides) for (const element of slide.scene as TokenizedSceneElement[]) for (const [target, binding] of Object.entries(element.tokenBindings ?? {}) as Array<[ThemeBindingTarget, string]>) {
        if (binding === token && categoryForTarget(target) === command.category) throw new Error(`Cannot delete token ${token}: it is bound to ${slide.id}:${element.id}:${target}`);
      }
      delete (next.theme[command.category] as Record<string, string | number>)[token];
      reason = `Delete ${command.category} token ${token}`;
    }
  }

  validateTheme(next.theme!);
  const changed = !same(deck, next);
  if (changed) next.updatedAt = new Date().toISOString();
  return {
    deck: changed ? next : deck,
    changed,
    reason,
    affectedSlideIds: [...new Set(affectedSlideIds)],
    affectedElementIds: [...new Set(affectedElementIds)],
    audit: auditTheme(changed ? next : deck),
  };
}
