import type { VectorPathCommand, VectorPathData } from "../../deck-model/src/index.js";

function number(value: number, label: string): string {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return String(Object.is(value, -0) ? 0 : value);
}

export function vectorPathCommandsToSvgPath(commands: VectorPathCommand[]): string {
  return commands.map((command, index) => {
    const label = `Vector path command ${index}`;
    if (command.command === "M" || command.command === "L") return `${command.command}${number(command.x, `${label}.x`)} ${number(command.y, `${label}.y`)}`;
    if (command.command === "C") return `C${number(command.x1, `${label}.x1`)} ${number(command.y1, `${label}.y1`)} ${number(command.x2, `${label}.x2`)} ${number(command.y2, `${label}.y2`)} ${number(command.x, `${label}.x`)} ${number(command.y, `${label}.y`)}`;
    if (command.command === "Q") return `Q${number(command.x1, `${label}.x1`)} ${number(command.y1, `${label}.y1`)} ${number(command.x, `${label}.x`)} ${number(command.y, `${label}.y`)}`;
    return "Z";
  }).join(" ");
}

export function vectorPathDataToSvgPath(path: VectorPathData): string {
  if (!path.commands.length) throw new Error("Vector path must contain at least one command");
  return vectorPathCommandsToSvgPath(path.commands);
}
