import type { Geometry, VectorPathData } from "../../deck-model/src/index.js";
import { translateVectorPath, validateVectorPathData, vectorPathBounds } from "./index.js";

export interface FittedVectorPath {
  pathData: VectorPathData;
  geometry: Geometry;
}

/**
 * Rebase an edited path to local origin while preserving the element's existing
 * world-space affine mapping. This keeps unchanged path coordinates visually fixed
 * even when the edited path extends outside the previous intrinsic bounds.
 */
export function fitEditedVectorPath(previousPath: VectorPathData, editedPath: VectorPathData, geometry: Geometry): FittedVectorPath {
  validateVectorPathData(previousPath);
  validateVectorPathData(editedPath);
  const before = vectorPathBounds(previousPath);
  const after = vectorPathBounds(editedPath);
  const epsilon = 1e-6;

  const sxKnown = before.width > epsilon ? geometry.width / before.width : undefined;
  const syKnown = before.height > epsilon ? geometry.height / before.height : undefined;
  const sx = sxKnown ?? syKnown ?? 1;
  const sy = syKnown ?? sxKnown ?? 1;

  const oldCenterLocal = { x: before.left + before.width / 2, y: before.top + before.height / 2 };
  const newCenterLocal = { x: after.left + after.width / 2, y: after.top + after.height / 2 };
  const localDelta = {
    x: (newCenterLocal.x - oldCenterLocal.x) * sx,
    y: (newCenterLocal.y - oldCenterLocal.y) * sy,
  };

  const radians = (geometry.rotation ?? 0) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rotatedDelta = {
    x: localDelta.x * cos - localDelta.y * sin,
    y: localDelta.x * sin + localDelta.y * cos,
  };

  const oldCenterWorld = { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 };
  const newWidth = Math.max(.01, after.width * sx);
  const newHeight = Math.max(.01, after.height * sy);
  const newCenterWorld = { x: oldCenterWorld.x + rotatedDelta.x, y: oldCenterWorld.y + rotatedDelta.y };

  return {
    pathData: translateVectorPath(editedPath, -after.left, -after.top),
    geometry: {
      x: newCenterWorld.x - newWidth / 2,
      y: newCenterWorld.y - newHeight / 2,
      width: newWidth,
      height: newHeight,
      ...(geometry.rotation !== undefined ? { rotation: geometry.rotation } : {}),
    },
  };
}
