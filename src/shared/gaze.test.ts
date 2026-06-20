import { describe, it, expect } from 'vitest';
import { cursorToGazeTarget } from './gaze';

describe('cursorToGazeTarget', () => {
  // window centred at (200, 200)
  const bounds = { x: 100, y: 100, width: 200, height: 200 };

  it('is centred (0,0) when the cursor is at the window centre', () => {
    expect(cursorToGazeTarget({ x: 200, y: 200 }, bounds, 100)).toEqual({ x: 0, y: 0 });
  });

  it('maps a cursor one reach right/below to (1,1)', () => {
    expect(cursorToGazeTarget({ x: 300, y: 300 }, bounds, 100)).toEqual({ x: 1, y: 1 });
  });

  it('maps a cursor up-left to negative axes', () => {
    expect(cursorToGazeTarget({ x: 150, y: 150 }, bounds, 100)).toEqual({ x: -0.5, y: -0.5 });
  });

  it('clamps beyond the reach radius to [-1, 1]', () => {
    expect(cursorToGazeTarget({ x: 9999, y: 9999 }, bounds, 100)).toEqual({ x: 1, y: 1 });
  });
});
