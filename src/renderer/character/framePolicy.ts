// src/renderer/character/framePolicy.ts — pure map of (visible, energy, busy) -> a
// frame plan the avatar applies to the Pixi ticker. This is the frame governor's brain.

import type { Energy } from './activity';

export type PowerState = 'occluded' | 'asleep' | 'idle' | 'active';

export interface FramePlan {
  state: PowerState;
  /** false => app.stop() (cancel rAF, true zero idle); true => app.start(). */
  running: boolean;
  /** ticker.maxFPS when running (0 = unused while stopped). */
  targetFps: number;
}

export function framePolicy(visible: boolean, energy: Energy, busy: boolean): FramePlan {
  if (!visible) return { state: 'occluded', running: false, targetFps: 0 };
  if (busy) return { state: 'active', running: true, targetFps: 60 };
  if (energy === 'asleep') return { state: 'asleep', running: true, targetFps: 6 };
  if (energy === 'drowsy') return { state: 'idle', running: true, targetFps: 12 };
  return { state: 'active', running: true, targetFps: 60 };
}
