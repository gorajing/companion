// src/renderer/character/avatar.ts — the canvas/mount layer.
//
// createAvatar() tries to load a real Cubism 4 Live2D model from the public dir.
// If the model file is absent (the repo ships NO model yet) OR Cubism Core failed
// to load OR Live2DModel.from() throws, we fall back to a PLACEHOLDER: a plain
// PIXI graphic whose tint is driven by avatar state, plus a text label. Either
// way the returned `Avatar` exposes the SAME shape, so the state machine,
// lip-sync, and the CharacterDriver facade are identical for both — Voice/event
// code never knows whether a model is present.

import '@pixi/unsafe-eval';
import * as PIXI from 'pixi.js';
import type { Live2DModel as Live2DModelType } from 'pixi-live2d-display-lipsyncpatch';
import type { AvatarState } from '../../shared/avatar';

// REQUIRED by the plugin: it reads window.PIXI.Ticker to auto-update models, and
// for some bundlers grabs other PIXI internals. Must be set before from().
(window as unknown as { PIXI: typeof PIXI }).PIXI = PIXI;
type Live2DModule = typeof import('pixi-live2d-display-lipsyncpatch');

export interface Avatar {
  app: PIXI.Application;
  /** The loaded Live2D model, or null when running the placeholder. */
  model: Live2DModelType | null;
  /** The placeholder display object, or null when a real model loaded. */
  placeholder: Placeholder | null;
  /** True when a real Live2D model is mounted. */
  readonly hasModel: boolean;
}

/** A state-aware fallback avatar shown when no model is available. */
export interface Placeholder {
  container: PIXI.Container;
  aura: PIXI.Graphics;
  body: PIXI.Container;
  mouth: PIXI.Graphics;
  label: PIXI.Text;
  /** Re-tint and re-label for a given state. */
  setTint(color: number): void;
  setLabel(text: string): void;
  /** State-aware expression, posture, and effect changes. */
  setState(state: AvatarState, color: number): void;
  /** 0..1 mouth openness for lip-sync feedback. */
  setMouthOpen(v: number): void;
  /** Assistant speech boundary from Vapi. */
  setTalking(talking: boolean): void;
}

async function modelExists(url: string): Promise<boolean> {
  try {
    // HEAD avoids downloading the model just to probe. Some static servers don't
    // support HEAD; fall back to a ranged GET on failure.
    const head = await fetch(url, { method: 'HEAD' });
    if (head.ok) return true;
    if (head.status === 405 || head.status === 501) {
      const get = await fetch(url, { headers: { Range: 'bytes=0-0' } });
      return get.ok;
    }
    return false;
  } catch {
    // Network/path error => treat as absent so we render the placeholder.
    return false;
  }
}

async function loadLive2D(): Promise<Live2DModule | null> {
  try {
    const mod = await import('pixi-live2d-display-lipsyncpatch');
    // Belt-and-suspenders for tree-shaking bundlers.
    mod.Live2DModel.registerTicker(PIXI.Ticker);
    mod.config.logLevel = mod.config.LOG_LEVEL_WARNING;
    // We drive audio ourselves (speak / amplitude); don't let motions trigger sound.
    mod.config.sound = false;
    return mod;
  } catch (err) {
    console.warn('[avatar] Live2D runtime unavailable; using placeholder:', err);
    return null;
  }
}

function buildPlaceholder(app: PIXI.Application): Placeholder {
  const container = new PIXI.Container();
  container.sortableChildren = true;

  let state: AvatarState = 'idle';
  let tint = 0x8a8aff;
  let mouthOpen = 0;
  let talking = false;
  let blinkUntil = 0;
  let nextBlink = performance.now() + 1700;

  const aura = new PIXI.Graphics();
  aura.zIndex = 0;

  const shadow = new PIXI.Graphics();
  shadow.beginFill(0x000000, 0.26);
  shadow.drawEllipse(0, 170, 104, 22);
  shadow.endFill();
  shadow.zIndex = 1;

  const body = new PIXI.Container();
  body.zIndex = 2;

  const torso = new PIXI.Graphics();
  const head = new PIXI.Graphics();
  const visor = new PIXI.Graphics();
  const leftEye = new PIXI.Graphics();
  const rightEye = new PIXI.Graphics();
  const leftPupil = new PIXI.Graphics();
  const rightPupil = new PIXI.Graphics();
  const leftBrow = new PIXI.Graphics();
  const rightBrow = new PIXI.Graphics();
  const mouth = new PIXI.Graphics();
  const chest = new PIXI.Graphics();
  const scanner = new PIXI.Graphics();
  const signal = new PIXI.Graphics();

  const redrawBody = () => {
    torso.clear();
    torso.beginFill(0x151924, 0.96);
    torso.lineStyle(3, tint, 0.42);
    torso.drawRoundedRect(-78, 18, 156, 166, 44);
    torso.endFill();
    torso.beginFill(0xffffff, 0.06);
    torso.drawRoundedRect(-52, 42, 104, 44, 18);
    torso.endFill();

    head.clear();
    head.beginFill(0xf6f7fb);
    head.lineStyle(4, tint, 0.85);
    head.drawRoundedRect(-92, -154, 184, 146, 54);
    head.endFill();
    head.beginFill(0x111521, 0.08);
    head.drawRoundedRect(-76, -140, 152, 26, 14);
    head.endFill();

    visor.clear();
    visor.beginFill(0x151924, 0.96);
    visor.lineStyle(2, tint, 0.65);
    visor.drawRoundedRect(-70, -112, 140, 58, 26);
    visor.endFill();

    chest.clear();
    chest.beginFill(tint, 0.18);
    chest.lineStyle(2, tint, 0.7);
    chest.drawRoundedRect(-42, 104, 84, 42, 18);
    chest.endFill();
    chest.beginFill(tint, 0.9);
    chest.drawCircle(-20, 125, 4);
    chest.drawCircle(0, 125, 4);
    chest.drawCircle(20, 125, 4);
    chest.endFill();
  };

  const redrawFace = () => {
    const blink = performance.now() < blinkUntil;
    const eyeHeight = blink ? 3 : state === 'error' ? 8 : state === 'thinking' ? 12 : 14;
    const pupilOffset = state === 'working' ? 5 : state === 'thinking' ? -4 : 0;
    const eyeColor = state === 'error' ? 0xff6b6b : tint;

    leftEye.clear();
    rightEye.clear();
    for (const [eye, x] of [[leftEye, -34], [rightEye, 34]] as const) {
      eye.beginFill(eyeColor, 0.95);
      eye.drawRoundedRect(x - 19, -98 - eyeHeight / 2, 38, eyeHeight, eyeHeight / 2);
      eye.endFill();
    }

    leftPupil.clear();
    rightPupil.clear();
    if (!blink) {
      for (const [pupil, x] of [[leftPupil, -34], [rightPupil, 34]] as const) {
        pupil.beginFill(0xffffff, 0.9);
        pupil.drawCircle(x + pupilOffset, -100, 4);
        pupil.endFill();
      }
    }

    leftBrow.clear();
    rightBrow.clear();
    const browTilt = state === 'error' ? 7 : state === 'thinking' ? -5 : 0;
    leftBrow.lineStyle(4, 0x151924, 0.78);
    leftBrow.moveTo(-54, -123 + browTilt);
    leftBrow.lineTo(-18, -126 - browTilt);
    rightBrow.lineStyle(4, 0x151924, 0.78);
    rightBrow.moveTo(18, -126 - browTilt);
    rightBrow.lineTo(54, -123 + browTilt);

    mouth.clear();
    mouth.beginFill(state === 'error' ? 0x2f1216 : 0x151924);
    const mouthH = 7 + mouthOpen * 32;
    const mouthW = talking ? 66 : state === 'done' ? 74 : 58;
    const y = state === 'done' ? -62 : -60;
    mouth.drawRoundedRect(-mouthW / 2, y - mouthH / 2, mouthW, mouthH, 8 + mouthOpen * 8);
    mouth.endFill();
    if (state === 'done' && mouthOpen < 0.18) {
      mouth.lineStyle(4, tint, 0.9);
      mouth.moveTo(-34, -64);
      mouth.quadraticCurveTo(0, -45, 34, -64);
    }
  };

  const redrawAura = (tick = 0) => {
    aura.clear();
    const pulse = 0.5 + Math.sin(tick / 34) * 0.5;
    const alpha =
      state === 'thinking' ? 0.22 + pulse * 0.14 :
        state === 'working' ? 0.18 + pulse * 0.08 :
          state === 'error' ? 0.28 :
            0.12 + pulse * 0.04;
    aura.beginFill(tint, alpha);
    aura.drawEllipse(0, 8, 138 + pulse * 10, 178 + pulse * 8);
    aura.endFill();

    if (state === 'thinking') {
      aura.lineStyle(3, 0xffd166, 0.55);
      aura.drawCircle(0, -82, 124 + pulse * 9);
      aura.lineStyle(2, 0x7c8cff, 0.42);
      aura.drawCircle(0, -82, 150 - pulse * 7);
    }

    if (state === 'done') {
      aura.lineStyle(4, 0xffffff, 0.62);
      aura.moveTo(-112, -120);
      aura.lineTo(-92, -140);
      aura.moveTo(108, -34);
      aura.lineTo(132, -48);
      aura.moveTo(82, 78);
      aura.lineTo(110, 92);
    }
  };

  const redrawSignal = (tick = 0) => {
    signal.clear();
    scanner.clear();

    if (state === 'working') {
      const y = -140 + (tick % 92);
      scanner.lineStyle(4, 0x29b6f6, 0.72);
      scanner.moveTo(-68, y);
      scanner.lineTo(68, y);
      scanner.lineStyle(1, 0xffffff, 0.35);
      scanner.moveTo(-56, y + 8);
      scanner.lineTo(56, y + 8);
    }

    if (talking || state === 'listening') {
      const spread = 28 + Math.sin(tick / 16) * 4;
      signal.lineStyle(3, tint, talking ? 0.82 : 0.46);
      signal.arc(-108, -54, spread, -0.8, 0.8);
      signal.arc(108, -54, spread, Math.PI - 0.8, Math.PI + 0.8);
    }
  };

  const label = new PIXI.Text('idle', {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: 24,
    fontWeight: '700',
    fill: 0xffffff,
    align: 'center',
  });
  label.anchor.set(0.5, 0);
  label.position.set(0, 206);

  // A small "no model" hint under the label.
  const hint = new PIXI.Text('drop a Live2D model in /public/live2d for the final skin', {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: 13,
    fill: 0x9aa0b4,
    align: 'center',
  });
  hint.anchor.set(0.5, 0);
  hint.position.set(0, 242);

  body.addChild(torso, head, visor, leftEye, rightEye, leftPupil, rightPupil, leftBrow, rightBrow, mouth, chest, scanner, signal);
  container.addChild(aura, shadow, body, label, hint);
  app.stage.addChild(container);

  const fit = () => {
    container.position.set(app.renderer.width / 2, app.renderer.height / 2 - 40);
  };
  fit();
  window.addEventListener('resize', fit);

  redrawBody();
  redrawFace();
  redrawAura();

  app.ticker.add(() => {
    const now = performance.now();
    if (now > nextBlink) {
      blinkUntil = now + 90;
      nextBlink = now + 1600 + Math.random() * 2200;
    }
    const tick = app.ticker.lastTime / 16.67;
    const breathe = Math.sin(tick / 52) * 4;
    const focusLift = state === 'working' ? -7 : state === 'thinking' ? -4 : 0;
    body.position.y = breathe + focusLift;
    body.rotation = Math.sin(tick / 95) * 0.018;
    shadow.scale.set(1 + Math.sin(tick / 52) * 0.04, 1);
    redrawFace();
    redrawAura(tick);
    redrawSignal(tick);
  }, undefined, PIXI.UPDATE_PRIORITY.LOW);

  const applyState = (nextState: AvatarState, color: number) => {
    state = nextState;
    tint = color;
    redrawBody();
    redrawFace();
    redrawAura();
  };

  return {
    container,
    aura,
    body,
    mouth,
    label,
    setTint: (color: number) => {
      tint = color;
      redrawBody();
    },
    setLabel: (text: string) => {
      label.text = text;
    },
    setState: applyState,
    setMouthOpen: (v: number) => {
      mouthOpen = Math.max(0, Math.min(1, v));
      redrawFace();
    },
    setTalking: (nextTalking: boolean) => {
      talking = nextTalking;
      redrawFace();
    },
  };
}

function fitModel(app: PIXI.Application, model: Live2DModelType) {
  model.anchor.set(0.5, 0.5);
  model.position.set(app.renderer.width / 2, app.renderer.height / 2);
  // internalModel.height is native px height (NOT scaled) — avoids a feedback loop.
  const target = app.renderer.height * 0.85;
  const nativeH = model.internalModel?.height ?? target;
  model.scale.set(target / nativeH);
}

/**
 * Mount the avatar onto `canvas`. Loads a real Live2D model when `modelUrl`
 * resolves; otherwise renders the placeholder. Never throws on a missing model.
 */
export async function createAvatar(canvas: HTMLCanvasElement, modelUrl: string): Promise<Avatar> {
  const app = new PIXI.Application({
    view: canvas,
    resizeTo: window,
    backgroundAlpha: 0, // transparent: the avatar floats over the UI
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  });

  const coreLoaded = typeof (window as unknown as { Live2DCubismCore?: unknown }).Live2DCubismCore !== 'undefined';
  const present = coreLoaded && (await modelExists(modelUrl));

  if (present) {
    try {
      const live2d = await loadLive2D();
      if (!live2d) throw new Error('Live2D runtime import failed');
      const model = await live2d.Live2DModel.from(modelUrl, { autoInteract: false });
      app.stage.addChild(model);
      const fit = () => fitModel(app, model);
      fit();
      window.addEventListener('resize', fit);
      console.info('[avatar] loaded Live2D model:', modelUrl);
      return { app, model, placeholder: null, hasModel: true };
    } catch (err) {
      // Loading failed despite the file existing (bad/missing texture, etc.).
      // Fall through to the placeholder rather than leaving a blank canvas.
      console.warn('[avatar] Live2D model failed to load, using placeholder:', err);
    }
  } else if (!coreLoaded) {
    console.warn('[avatar] Live2DCubismCore not loaded; using placeholder. See public/live2d/README.');
  } else {
    console.warn('[avatar] no model at', modelUrl, '— using placeholder.');
  }

  const placeholder = buildPlaceholder(app);
  return { app, model: null, placeholder, hasModel: false };
}
