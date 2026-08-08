import type { VectorPathCommand, VectorPathData } from "../../deck-model/src/index.js";

export interface VectorBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface VectorAnchor {
  commandIndex: number;
  command: "M" | "L" | "C" | "Q";
  x: number;
  y: number;
  inHandle?: { x: number; y: number };
  outHandle?: { x: number; y: number };
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function fmt(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export function validateVectorPathData(path: VectorPathData): void {
  if (!path || !Array.isArray(path.commands) || path.commands.length === 0) throw new Error("Vector path requires at least one command");
  let active = false;
  for (let index = 0; index < path.commands.length; index += 1) {
    const command = path.commands[index];
    const check = (value: number, label: string) => finite(value, `command ${index} ${label}`);
    if (command.command === "M") {
      check(command.x, "x"); check(command.y, "y"); active = true; continue;
    }
    if (command.command === "Z") {
      if (!active) throw new Error(`Close command ${index} has no active subpath`);
      active = false; continue;
    }
    if (!active) throw new Error(`Command ${index} (${command.command}) must follow M`);
    if (command.command === "L") {
      check(command.x, "x"); check(command.y, "y"); continue;
    }
    if (command.command === "Q") {
      check(command.x1, "x1"); check(command.y1, "y1"); check(command.x, "x"); check(command.y, "y"); continue;
    }
    check(command.x1, "x1"); check(command.y1, "y1"); check(command.x2, "x2"); check(command.y2, "y2"); check(command.x, "x"); check(command.y, "y");
  }
}

export function vectorPathToSvg(path: VectorPathData): string {
  validateVectorPathData(path);
  return path.commands.map((command) => {
    if (command.command === "Z") return "Z";
    if (command.command === "M" || command.command === "L") return `${command.command} ${fmt(command.x)} ${fmt(command.y)}`;
    if (command.command === "Q") return `Q ${fmt(command.x1)} ${fmt(command.y1)} ${fmt(command.x)} ${fmt(command.y)}`;
    return `C ${fmt(command.x1)} ${fmt(command.y1)} ${fmt(command.x2)} ${fmt(command.y2)} ${fmt(command.x)} ${fmt(command.y)}`;
  }).join(" ");
}

function quadAt(p0: number, p1: number, p2: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function quadraticExtrema(p0: number, p1: number, p2: number): number[] {
  const denominator = p0 - 2 * p1 + p2;
  if (Math.abs(denominator) < 1e-12) return [];
  const t = (p0 - p1) / denominator;
  return t > 0 && t < 1 ? [t] : [];
}

function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  // Derivative / 3: a*t^2 + b*t + c
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) < 1e-12) return [];
    const t = -c / b;
    return t > 0 && t < 1 ? [t] : [];
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)].filter((t) => t > 0 && t < 1);
}

export function vectorPathBounds(path: VectorPathData): VectorBounds {
  validateVectorPathData(path);
  let current = { x: 0, y: 0 };
  let subpathStart = { x: 0, y: 0 };
  const xs: number[] = [];
  const ys: number[] = [];
  const add = (x: number, y: number) => { xs.push(x); ys.push(y); };

  for (const command of path.commands) {
    if (command.command === "M") {
      current = { x: command.x, y: command.y };
      subpathStart = { ...current };
      add(current.x, current.y);
      continue;
    }
    if (command.command === "Z") {
      add(subpathStart.x, subpathStart.y);
      current = { ...subpathStart };
      continue;
    }
    if (command.command === "L") {
      add(command.x, command.y);
      current = { x: command.x, y: command.y };
      continue;
    }
    if (command.command === "Q") {
      add(current.x, current.y); add(command.x, command.y);
      for (const t of quadraticExtrema(current.x, command.x1, command.x)) add(quadAt(current.x, command.x1, command.x, t), quadAt(current.y, command.y1, command.y, t));
      for (const t of quadraticExtrema(current.y, command.y1, command.y)) add(quadAt(current.x, command.x1, command.x, t), quadAt(current.y, command.y1, command.y, t));
      current = { x: command.x, y: command.y };
      continue;
    }
    add(current.x, current.y); add(command.x, command.y);
    for (const t of cubicExtrema(current.x, command.x1, command.x2, command.x)) add(cubicAt(current.x, command.x1, command.x2, command.x, t), cubicAt(current.y, command.y1, command.y2, command.y, t));
    for (const t of cubicExtrema(current.y, command.y1, command.y2, command.y)) add(cubicAt(current.x, command.x1, command.x2, command.x, t), cubicAt(current.y, command.y1, command.y2, command.y, t));
    current = { x: command.x, y: command.y };
  }

  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export function vectorAnchors(path: VectorPathData): VectorAnchor[] {
  validateVectorPathData(path);
  const result: VectorAnchor[] = [];
  for (let index = 0; index < path.commands.length; index += 1) {
    const command = path.commands[index];
    if (command.command === "Z") continue;
    const next = path.commands[index + 1];
    const outHandle = next?.command === "C" || next?.command === "Q" ? { x: next.x1, y: next.y1 } : undefined;
    if (command.command === "C") result.push({ commandIndex: index, command: "C", x: command.x, y: command.y, inHandle: { x: command.x2, y: command.y2 }, outHandle });
    else if (command.command === "Q") result.push({ commandIndex: index, command: "Q", x: command.x, y: command.y, inHandle: { x: command.x1, y: command.y1 }, outHandle });
    else result.push({ commandIndex: index, command: command.command, x: command.x, y: command.y, outHandle });
  }
  return result;
}

export function moveVectorAnchor(path: VectorPathData, commandIndex: number, x: number, y: number, moveHandles = true): VectorPathData {
  validateVectorPathData(path);
  finite(x, "anchor x"); finite(y, "anchor y");
  const commands = structuredClone(path.commands);
  const command = commands[commandIndex];
  if (!command || command.command === "Z") throw new Error(`Command ${commandIndex} is not a movable vector anchor`);
  const dx = x - command.x;
  const dy = y - command.y;
  if (moveHandles) {
    if (command.command === "C") { command.x2 += dx; command.y2 += dy; }
    if (command.command === "Q") { command.x1 += dx; command.y1 += dy; }
    const next = commands[commandIndex + 1];
    if (next?.command === "C" || next?.command === "Q") { next.x1 += dx; next.y1 += dy; }
  }
  command.x = x;
  command.y = y;
  return { ...path, commands };
}

export function moveVectorHandle(path: VectorPathData, commandIndex: number, handle: "in" | "out", x: number, y: number): VectorPathData {
  validateVectorPathData(path);
  finite(x, "handle x"); finite(y, "handle y");
  const commands = structuredClone(path.commands);
  const command = commands[commandIndex];
  if (!command || command.command === "Z") throw new Error(`Command ${commandIndex} is not an editable anchor`);
  if (handle === "in") {
    if (command.command === "C") { command.x2 = x; command.y2 = y; }
    else if (command.command === "Q") { command.x1 = x; command.y1 = y; }
    else throw new Error(`Anchor ${commandIndex} has no incoming handle`);
  } else {
    const next = commands[commandIndex + 1];
    if (next?.command === "C" || next?.command === "Q") { next.x1 = x; next.y1 = y; }
    else throw new Error(`Anchor ${commandIndex} has no outgoing handle`);
  }
  return { ...path, commands };
}

export function translateVectorPath(path: VectorPathData, dx: number, dy: number): VectorPathData {
  validateVectorPathData(path);
  finite(dx, "dx"); finite(dy, "dy");
  return {
    ...path,
    commands: path.commands.map((command): VectorPathCommand => {
      if (command.command === "Z") return { command: "Z" };
      if (command.command === "M" || command.command === "L") return { ...command, x: command.x + dx, y: command.y + dy };
      if (command.command === "Q") return { ...command, x1: command.x1 + dx, y1: command.y1 + dy, x: command.x + dx, y: command.y + dy };
      return { ...command, x1: command.x1 + dx, y1: command.y1 + dy, x2: command.x2 + dx, y2: command.y2 + dy, x: command.x + dx, y: command.y + dy };
    }),
  };
}

export function normalizeVectorPath(path: VectorPathData): { path: VectorPathData; bounds: VectorBounds } {
  const bounds = vectorPathBounds(path);
  const normalized = translateVectorPath(path, -bounds.left, -bounds.top);
  return { path: normalized, bounds };
}

interface Token { kind: "command" | "number"; value: string }

function svgTokens(source: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /([a-zA-Z])|([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) tokens.push(match[1] ? { kind: "command", value: match[1] } : { kind: "number", value: match[2] });
  return tokens;
}

export function parseSvgPathData(source: string): VectorPathData {
  const tokens = svgTokens(source.trim());
  if (!tokens.length) throw new Error("SVG path is empty");
  let index = 0;
  let command = "";
  let current = { x: 0, y: 0 };
  let subpath = { x: 0, y: 0 };
  let previousCubicControl: { x: number; y: number } | undefined;
  let previousQuadControl: { x: number; y: number } | undefined;
  const commands: VectorPathCommand[] = [];
  const number = () => {
    const token = tokens[index++];
    if (!token || token.kind !== "number") throw new Error(`Expected SVG path number at token ${index - 1}`);
    return Number(token.value);
  };
  const hasNumber = () => tokens[index]?.kind === "number";
  const point = (relative: boolean) => {
    const x = number(); const y = number();
    return relative ? { x: current.x + x, y: current.y + y } : { x, y };
  };
  const reflect = (control: { x: number; y: number } | undefined) => control ? { x: current.x * 2 - control.x, y: current.y * 2 - control.y } : { ...current };

  while (index < tokens.length) {
    if (tokens[index].kind === "command") command = tokens[index++].value;
    if (!command) throw new Error("SVG path must start with a command");
    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();
    if (upper === "A") throw new Error("SVG arc commands (A/a) are not editable in Vector Engine v1; import as legacy SVG vector instead");
    if (upper === "Z") {
      commands.push({ command: "Z" }); current = { ...subpath }; previousCubicControl = undefined; previousQuadControl = undefined; command = ""; continue;
    }
    if (upper === "M") {
      const p = point(relative); commands.push({ command: "M", ...p }); current = p; subpath = { ...p }; previousCubicControl = undefined; previousQuadControl = undefined;
      command = relative ? "l" : "L";
      continue;
    }
    if (upper === "L") {
      if (!hasNumber()) { command = ""; continue; }
      const p = point(relative); commands.push({ command: "L", ...p }); current = p; previousCubicControl = undefined; previousQuadControl = undefined; continue;
    }
    if (upper === "H") {
      if (!hasNumber()) { command = ""; continue; }
      const value = number(); const p = { x: relative ? current.x + value : value, y: current.y }; commands.push({ command: "L", ...p }); current = p; previousCubicControl = undefined; previousQuadControl = undefined; continue;
    }
    if (upper === "V") {
      if (!hasNumber()) { command = ""; continue; }
      const value = number(); const p = { x: current.x, y: relative ? current.y + value : value }; commands.push({ command: "L", ...p }); current = p; previousCubicControl = undefined; previousQuadControl = undefined; continue;
    }
    if (upper === "C") {
      if (!hasNumber()) { command = ""; continue; }
      const c1 = point(relative); const c2Base = point(relative); const p = point(relative);
      commands.push({ command: "C", x1: c1.x, y1: c1.y, x2: c2Base.x, y2: c2Base.y, x: p.x, y: p.y }); current = p; previousCubicControl = c2Base; previousQuadControl = undefined; continue;
    }
    if (upper === "S") {
      if (!hasNumber()) { command = ""; continue; }
      const c1 = reflect(previousCubicControl); const c2 = point(relative); const p = point(relative);
      commands.push({ command: "C", x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: p.x, y: p.y }); current = p; previousCubicControl = c2; previousQuadControl = undefined; continue;
    }
    if (upper === "Q") {
      if (!hasNumber()) { command = ""; continue; }
      const c = point(relative); const p = point(relative); commands.push({ command: "Q", x1: c.x, y1: c.y, x: p.x, y: p.y }); current = p; previousQuadControl = c; previousCubicControl = undefined; continue;
    }
    if (upper === "T") {
      if (!hasNumber()) { command = ""; continue; }
      const c = reflect(previousQuadControl); const p = point(relative); commands.push({ command: "Q", x1: c.x, y1: c.y, x: p.x, y: p.y }); current = p; previousQuadControl = c; previousCubicControl = undefined; continue;
    }
    throw new Error(`Unsupported SVG path command: ${command}`);
  }
  const path: VectorPathData = { fillRule: "nonzero", commands };
  validateVectorPathData(path);
  return path;
}
