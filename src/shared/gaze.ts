// src/shared/gaze.ts — pure, dependency-free gaze math shared by MAIN and the renderer.
// Imports NOTHING (no electron, no pixi) so it is importable everywhere and unit-testable.

export interface GazeTarget {
  /** -1 (left) .. 1 (right): cursor x relative to the cat. */
  x: number;
  /** -1 (up) .. 1 (down): cursor y relative to the cat. */
  y: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Convert a global cursor point + the window's screen bounds into a normalized
 * gaze target in [-1, 1] per axis. `reach` is the pixel distance from the window
 * centre at which the gaze is fully deflected.
 */
export function cursorToGazeTarget(
  cursor: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number },
  reach: number,
): GazeTarget {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const r = Math.max(1, reach);
  return {
    x: clamp((cursor.x - cx) / r, -1, 1),
    y: clamp((cursor.y - cy) / r, -1, 1),
  };
}
