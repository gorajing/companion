// src/renderer/character/lipsync.ts — amplitude-driven mouth movement.
//
// Feed setAmplitude() from Vapi's volume-level (0..1) while the assistant TTS
// speaks. A ticker registered at UPDATE_PRIORITY.LOW runs AFTER the model's own
// per-frame update (Live2D auto-updates at HIGH), so our ParamMouthOpenY write
// isn't overwritten by the idle/talking motion. For the placeholder we drive its
// mouth graphic instead.
//
// Do NOT run this together with model.speak() on the same utterance — both write
// the mouth param and fight. The driver enforces that (amplitude is paused while
// a speak() clip plays).

import * as PIXI from 'pixi.js';
import type { Avatar } from './avatar';

const MOUTH_PARAM_C4 = 'ParamMouthOpenY';
const MOUTH_PARAM_C2 = 'PARAM_MOUTH_OPEN_Y';
const SMOOTHING = 0.35; // exponential smoothing factor; higher = snappier

interface CubismCoreModel {
  setParameterValueById?: (id: string, value: number) => void;
  setParamFloat?: (id: string | number, value: number, weight?: number) => unknown;
}

export class AmplitudeLipSync {
  private target = 0;
  private value = 0;
  private bound = false;

  constructor(private avatar: Avatar) {}

  /** Latest amplitude from Vapi volume-level (clamped 0..1). */
  setAmplitude(a: number): void {
    this.target = Math.max(0, Math.min(1, a));
  }

  start(): void {
    if (this.bound) return;
    this.bound = true;
    this.avatar.app.ticker.add(this.tick, this, PIXI.UPDATE_PRIORITY.LOW);
  }

  stop(): void {
    if (!this.bound) return;
    this.avatar.app.ticker.remove(this.tick, this);
    this.bound = false;
    this.value = this.target = 0;
    this.apply(0);
  }

  private tick = (): void => {
    this.value += (this.target - this.value) * SMOOTHING;
    this.apply(this.value);
  };

  private apply(v: number): void {
    if (this.avatar.placeholder) {
      this.avatar.placeholder.setMouthOpen(v);
      return;
    }
    const model = this.avatar.model;
    if (!model) return;
    const core = model.internalModel?.coreModel as unknown as CubismCoreModel | undefined;
    if (!core) return;
    if (typeof core.setParameterValueById === 'function') {
      core.setParameterValueById(MOUTH_PARAM_C4, v); // Cubism 4 (model3)
    } else if (typeof core.setParamFloat === 'function') {
      core.setParamFloat(MOUTH_PARAM_C2, v); // Cubism 2 fallback
    }
  }
}
