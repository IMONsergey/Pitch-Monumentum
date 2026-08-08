import type { Paint, SceneElement, VisualEffect } from "../../deck-model/src/index.js";

export function effectiveFillPaint(element: SceneElement): Paint | undefined {
  if (element.type !== "shape" && element.type !== "frame") return undefined;
  if (element.fillPaint) return element.fillPaint;
  if (element.fill) return { kind: "solid", color: element.fill };
  return undefined;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function rgba(hex: string, opacity = 1): string {
  const match = hex.replace(/^#/, "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) return hex;
  const [, r, g, b] = match;
  return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${clamp01(opacity)})`;
}

export function paintToCss(paint: Paint | undefined): string {
  if (!paint || paint.kind === "none") return "transparent";
  if (paint.kind === "solid") return rgba(paint.color, paint.opacity ?? 1);
  const stops = paint.stops
    .map((stop) => `${rgba(stop.color, stop.opacity ?? 1)} ${Math.round(clamp01(stop.position) * 10000) / 100}%`)
    .join(", ");
  return `linear-gradient(${paint.angleDeg}deg, ${stops})`;
}

export function dropShadows(effects: VisualEffect[] | undefined): Extract<VisualEffect, { kind: "dropShadow" }>[] {
  return (effects ?? []).filter((effect): effect is Extract<VisualEffect, { kind: "dropShadow" }> => effect.kind === "dropShadow");
}

export function effectsToCssBoxShadow(effects: VisualEffect[] | undefined): string {
  const shadows = dropShadows(effects);
  if (!shadows.length) return "none";
  return shadows
    .map((shadow) => `${shadow.offsetXDU}px ${shadow.offsetYDU}px ${shadow.blurDU}px ${rgba(shadow.color, shadow.opacity)}`)
    .join(", ");
}

export function effectsToCssDropShadow(effects: VisualEffect[] | undefined): string {
  const shadows = dropShadows(effects);
  if (!shadows.length) return "none";
  return shadows
    .map((shadow) => `drop-shadow(${shadow.offsetXDU}px ${shadow.offsetYDU}px ${Math.max(0, shadow.blurDU / 2)}px ${rgba(shadow.color, shadow.opacity)})`)
    .join(" ");
}

export interface AppearanceCapability {
  native: boolean;
  warning?: string;
}

export function pptxAppearanceCapability(element: SceneElement): AppearanceCapability[] {
  const capabilities: AppearanceCapability[] = [];
  const fill = effectiveFillPaint(element);
  if (fill?.kind === "linearGradient") capabilities.push({ native: true });
  if (element.effects?.some((effect) => effect.kind === "dropShadow")) {
    if (["shape", "frame", "text", "line", "image"].includes(element.type)) capabilities.push({ native: true });
    else capabilities.push({ native: false, warning: `Drop shadow is not natively mapped for ${element.type}` });
  }
  return capabilities;
}
