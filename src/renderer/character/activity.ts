// src/renderer/character/activity.ts — time-since-last-interaction -> energy.
// Pure & deterministic: `now` is always passed in (no Date.now()), so it unit-tests.

export type Energy = 'awake' | 'drowsy' | 'asleep';

export interface ActivityThresholds {
  /** idle ms after which the cat is drowsy */
  drowsyMs: number;
  /** idle ms after which the cat is asleep */
  asleepMs: number;
}

const DEFAULTS: ActivityThresholds = { drowsyMs: 45_000, asleepMs: 120_000 };

export class Activity {
  private lastPokeMs: number;

  constructor(now: number, private readonly thresholds: ActivityThresholds = DEFAULTS) {
    this.lastPokeMs = now;
  }

  /** Register a real interaction (cursor move, click, pet, summon). */
  poke(now: number): void {
    this.lastPokeMs = now;
  }

  idleMs(now: number): number {
    return Math.max(0, now - this.lastPokeMs);
  }

  energy(now: number): Energy {
    const idle = this.idleMs(now);
    if (idle >= this.thresholds.asleepMs) return 'asleep';
    if (idle >= this.thresholds.drowsyMs) return 'drowsy';
    return 'awake';
  }
}
