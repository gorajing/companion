import { describe, it, expect } from 'vitest';
import { Activity } from './activity';

describe('Activity', () => {
  const T = { drowsyMs: 1000, asleepMs: 3000 };

  it('starts awake at construction time', () => {
    expect(new Activity(0, T).energy(0)).toBe('awake');
  });

  it('goes drowsy then asleep as idle time crosses the thresholds', () => {
    const a = new Activity(0, T);
    expect(a.energy(999)).toBe('awake');
    expect(a.energy(1000)).toBe('drowsy');
    expect(a.energy(2999)).toBe('drowsy');
    expect(a.energy(3000)).toBe('asleep');
  });

  it('poke() resets idle so the cat wakes', () => {
    const a = new Activity(0, T);
    expect(a.energy(3000)).toBe('asleep');
    a.poke(3000);
    expect(a.energy(3000)).toBe('awake');
    expect(a.idleMs(3500)).toBe(500);
  });
});
