// src/renderer/character/stateMachine.ts — maps the 6 canonical AvatarStates to
// model expression/motion (real model) or tint/label (placeholder). Idempotent:
// re-setting the same state is a no-op so the animation doesn't re-fire each frame.

import type { AvatarState } from '../../shared/avatar';
import type { Avatar } from './avatar';

const MotionPriority = {
  IDLE: 1,
  NORMAL: 2,
  FORCE: 3,
} as const;

type MotionPriorityValue = typeof MotionPriority[keyof typeof MotionPriority];

interface StateSpec {
  /** Expression name or index (model-specific). Guarded if the model has none. */
  expression?: string | number;
  /** Motion group name (model-specific, case-sensitive). */
  motion?: string;
  priority: MotionPriorityValue;
  /** Placeholder tint (used when no real model). */
  color: number;
}

// Tuned for Haru's groups ('Idle','TapBody') + expressions f01..f08. If the
// loaded model differs, expression()/motion() simply resolve nothing and the
// state still advances (guarded below). Discover real names at runtime via
// Object.keys(model.internalModel.motionManager.definitions).
const MAP: Record<AvatarState, StateSpec> = {
  idle: { expression: 'f01', motion: 'Idle', priority: MotionPriority.IDLE, color: 0x8a8aff },
  listening: { expression: 'f03', motion: 'Idle', priority: MotionPriority.NORMAL, color: 0x4caf50 },
  thinking: { expression: 'f02', motion: 'Idle', priority: MotionPriority.NORMAL, color: 0xffb300 },
  working: { expression: 'f04', motion: 'TapBody', priority: MotionPriority.NORMAL, color: 0x29b6f6 },
  done: { expression: 'f05', motion: 'TapBody', priority: MotionPriority.FORCE, color: 0x66bb6a },
  error: { expression: 'f07', motion: 'TapBody', priority: MotionPriority.FORCE, color: 0xef5350 },
};

export class AvatarStateMachine {
  private current: AvatarState | null = null;

  constructor(private avatar: Avatar) {}

  get state(): AvatarState | null {
    return this.current;
  }

  setState(state: AvatarState): void {
    if (state === this.current) return; // idempotent
    this.current = state;
    const spec = MAP[state];

    // Placeholder path: tint + label.
    if (this.avatar.placeholder) {
      this.avatar.placeholder.setState(state, spec.color);
      this.avatar.placeholder.setLabel(state);
      return;
    }

    const model = this.avatar.model;
    if (!model) return;

    try {
      // expressionManager is undefined when the model has no expressions — guard.
      const hasExpr = !!model.internalModel?.motionManager?.expressionManager;
      if (spec.expression !== undefined && hasExpr) {
        // Returns a Promise<boolean>; we don't await (fire-and-forget animation).
        void model.expression(spec.expression);
      }
      if (spec.motion) {
        void model.motion(spec.motion, undefined, spec.priority);
      }
    } catch (err) {
      // Fail loud (visible in console) but never throw out of an animation tick.
      console.error('[avatar] setState failed for', state, err);
    }
  }
}
