import { describe, it, expect } from 'vitest';
import { Gaze } from './gaze';

describe('Gaze', () => {
  it('rests at centre with no target', () => {
    expect(new Gaze().step()).toEqual({ lookX: 0, lookY: 0 });
  });

  it('eases toward a target and converges to the max offset', () => {
    const g = new Gaze(0.5, 1);
    g.setTarget({ x: 1, y: -1 });
    let last = g.step();
    for (let i = 0; i < 50; i++) last = g.step();
    expect(last).toEqual({ lookX: 1, lookY: -1 });
  });

  it('approaches gradually (not instantly) on the first step', () => {
    const g = new Gaze(0.2, 10); // maxLook 10 so rounding reveals partial progress
    g.setTarget({ x: 1, y: 0 });
    const first = g.step();
    expect(first.lookX).toBeGreaterThan(0);
    expect(first.lookX).toBeLessThan(10);
  });

  it('returns to centre when the target is cleared', () => {
    const g = new Gaze(0.5, 1);
    g.setTarget({ x: 1, y: 1 });
    for (let i = 0; i < 50; i++) g.step();
    g.setTarget(null);
    let last = g.step();
    for (let i = 0; i < 50; i++) last = g.step();
    expect(last).toEqual({ lookX: 0, lookY: 0 });
  });

  it('clamps an out-of-range target', () => {
    const g = new Gaze(1, 1); // ease 1 => instant
    g.setTarget({ x: 5, y: -5 });
    expect(g.step()).toEqual({ lookX: 1, lookY: -1 });
  });
});
