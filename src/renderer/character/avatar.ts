// src/renderer/character/avatar.ts — the canvas/mount layer.
//
// createAvatar() tries to load a real Cubism 4 Live2D model from the public dir.
// If the model file is absent (the repo ships NO model yet) OR Cubism Core failed
// to load OR Live2DModel.from() throws, we fall back to a PLACEHOLDER: a
// 16-bit pixel cat whose expression is driven by avatar state. Either way the
// returned `Avatar` exposes the SAME shape, so the state machine,
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

  const PIXEL = 16;
  const GRID_W = 18;
  const GRID_H = 17;
  const CAT = {
    rim: 0x2b2d48,
    black: 0x191a2f,
    blackShade: 0x0b0c18,
    white: 0xf4f2ec,
    whiteShade: 0xd8d6cf,
    eye: 0xffdd19,
    gray: 0x555a59,
    mouth: 0xff6b8a,
    shadow: 0x000000,
  } as const;

  const aura = new PIXI.Graphics();
  aura.zIndex = 0;

  const shadow = new PIXI.Graphics();
  shadow.beginFill(CAT.shadow, 0.22);
  shadow.drawRect(-80, 108, 56, 12);
  shadow.drawRect(-8, 108, 104, 12);
  shadow.drawRect(-64, 120, 128, 8);
  shadow.endFill();
  shadow.zIndex = 1;

  const body = new PIXI.Container();
  body.zIndex = 2;

  const tail = new PIXI.Graphics();
  const cat = new PIXI.Graphics();
  const eyes = new PIXI.Graphics();
  const mouth = new PIXI.Graphics();
  const foreground = new PIXI.Graphics();
  const signal = new PIXI.Graphics();

  const px = (g: PIXI.Graphics, x: number, y: number, w: number, h: number, color: number, alpha = 1) => {
    g.beginFill(color, alpha);
    g.drawRect((x - GRID_W / 2) * PIXEL, (y - GRID_H / 2) * PIXEL, w * PIXEL, h * PIXEL);
    g.endFill();
  };

  const drawTail = (tick = 0) => {
    tail.clear();
    const wag = Math.floor(tick / 28) % 2;

    if (state === 'error') {
      px(tail, 2, 8, 2, 4, CAT.rim, 0.5);
      px(tail, 4, 11, 2, 2, CAT.rim, 0.5);
      px(tail, 3, 8, 1, 4, CAT.black);
      px(tail, 4, 11, 1, 1, CAT.black);
      px(tail, 5, 12, 1, 1, CAT.black);
      return;
    }

    px(tail, 2, 7, 2, 4, CAT.rim, 0.5);
    px(tail, 3, 6, 2, 1, CAT.rim, 0.5);
    px(tail, 4, 11, 3, 2, CAT.rim, 0.5);
    px(tail, 3, 7, 1, 4, CAT.black);
    px(tail, 4, 6, 1, 1, CAT.black);
    px(tail, 4, 11, 1, 1, CAT.black);
    px(tail, 5, 12, 2, 1, CAT.black);

    if (state === 'listening' || talking) {
      px(tail, 4, 5 + wag, 1, 1, CAT.black);
    } else if (state === 'thinking') {
      px(tail, 2 + wag, 6, 1, 1, CAT.black);
    } else if (state === 'done') {
      px(tail, 5, 5, 1, 1, CAT.black);
    }
  };

  const drawCat = () => {
    cat.clear();

    const earsFlat = state === 'error';
    const earsPerked = state === 'listening' || talking;
    const earTop = earsPerked ? 2 : 3;

    px(cat, 4, 10, 8, 5, CAT.rim, 0.52);
    px(cat, 7, 9, 4, 1, CAT.rim, 0.52);
    px(cat, 9, 8, 5, 6, CAT.rim, 0.52);
    px(cat, 7, 4, 8, 6, CAT.rim, 0.52);
    px(cat, 6, 6, 10, 3, CAT.rim, 0.52);

    px(cat, 5, 11, 6, 3, CAT.black);
    px(cat, 7, 10, 3, 1, CAT.black);
    px(cat, 10, 9, 3, 4, CAT.white);
    px(cat, 11, 12, 2, 2, CAT.white);
    px(cat, 9, 13, 1, 1, CAT.white);
    px(cat, 13, 13, 1, 1, CAT.white);
    px(cat, 12, 11, 1, 1, CAT.black);
    px(cat, 5, 13, 4, 1, CAT.blackShade, 0.7);

    px(cat, 8, 5, 6, 4, CAT.black);
    px(cat, 7, 6, 1, 1, CAT.black);
    px(cat, 14, 6, 1, 1, CAT.black);
    px(cat, 7, 8, 2, 1, CAT.black);

    if (earsFlat) {
      px(cat, 7, 4, 2, 1, CAT.black);
      px(cat, 13, 4, 2, 1, CAT.black);
      px(cat, 8, 4, 1, 1, CAT.gray);
      px(cat, 13, 4, 1, 1, CAT.gray);
    } else {
      px(cat, 7, earTop, 3, 3, CAT.rim, 0.52);
      px(cat, 12, earTop, 3, 3, CAT.rim, 0.52);
      px(cat, 8, earTop, 1, 2, CAT.black);
      px(cat, 9, earTop + 1, 1, 1, CAT.black);
      px(cat, 13, earTop, 1, 2, CAT.black);
      px(cat, 12, earTop + 1, 1, 1, CAT.black);
      px(cat, 8, earTop + 1, 1, 1, CAT.gray);
      px(cat, 13, earTop + 1, 1, 1, CAT.gray);
    }

    px(cat, 6, 6, 1, 1, CAT.black);
    px(cat, 5, 5, 1, 1, CAT.black);
    px(cat, 6, 8, 1, 1, CAT.black);
    px(cat, 15, 6, 1, 1, CAT.black);
    px(cat, 16, 5, 1, 1, CAT.black);
    px(cat, 15, 8, 1, 1, CAT.black);

    if (state === 'working') {
      px(cat, 8, 9, 6, 1, tint, 0.2);
    }
  };

  const redrawFace = () => {
    const blink = performance.now() < blinkUntil;
    const eyeColor = state === 'error' ? 0xef5350 : CAT.eye;
    const lookX = state === 'working' ? 1 : state === 'thinking' ? -1 : 0;
    const lookY = state === 'thinking' ? -1 : 0;

    eyes.clear();
    if (blink) {
      px(eyes, 10, 7, 1, 1, CAT.gray);
      px(eyes, 13, 7, 1, 1, CAT.gray);
    } else {
      px(eyes, 10 + lookX, 6 + lookY, 1, 1, eyeColor);
      px(eyes, 13 + lookX, 6 + lookY, 1, 1, eyeColor);
      if (state === 'done') {
        px(eyes, 11, 6, 1, 1, CAT.eye);
        px(eyes, 14, 6, 1, 1, CAT.eye);
      }
    }

    mouth.clear();
    if (state === 'done' && !talking) {
      px(mouth, 11, 8, 1, 1, CAT.whiteShade);
      px(mouth, 12, 8, 1, 1, CAT.whiteShade);
    } else if (state === 'error') {
      px(mouth, 11, 8, 2, 1, 0xef5350);
    } else if (talking || mouthOpen > 0.16) {
      px(mouth, 11, 8, 1, 1, CAT.mouth);
      if (mouthOpen > 0.48 || talking) px(mouth, 12, 8, 1, 1, CAT.mouth);
    }
  };

  const redrawAura = (tick = 0) => {
    aura.clear();
    const blink = Math.floor(tick / 18) % 2;
    if (state === 'thinking') {
      px(aura, 10, 1, 1, 1, 0xffd166, 0.8);
      px(aura, 12, 0, 1, 1, 0xffd166, 0.65 + blink * 0.25);
      px(aura, 13, 1, 1, 1, 0xffd166, 0.5);
    }
    if (state === 'done') {
      px(aura, 5, 3, 1, 1, 0xffffff, 0.65 + blink * 0.25);
      px(aura, 4, 4, 1, 1, tint, 0.75);
      px(aura, 15, 4, 1, 1, 0xffffff, 0.7);
      px(aura, 16, 5, 1, 1, tint, 0.65 + blink * 0.2);
      px(aura, 14, 10, 1, 1, 0xffffff, 0.6);
    }
    if (state === 'error') {
      px(aura, 6, 3, 1, 1, 0xef5350, 0.8);
      px(aura, 15, 3, 1, 1, 0xef5350, 0.55 + blink * 0.25);
    }
  };

  const redrawSignal = (tick = 0) => {
    signal.clear();
    foreground.clear();

    if (state === 'working') {
      const scanY = 5 + (Math.floor(tick / 9) % 4);
      px(foreground, 8, scanY, 7, 1, 0x29b6f6, 0.36);
    }

    if (talking || state === 'listening') {
      const frame = Math.floor(tick / 16) % 3;
      const alpha = talking ? 0.9 : 0.52;
      px(signal, 15, 5, 1, 1, tint, alpha);
      px(signal, 16, 4, 1, 1, tint, frame > 0 ? alpha : 0.18);
      px(signal, 16, 7, 1, 1, tint, frame > 1 ? alpha : 0.18);
      px(signal, 6, 5, 1, 1, tint, alpha * 0.72);
      px(signal, 5, 4, 1, 1, tint, frame > 0 ? alpha * 0.72 : 0.16);
    }
  };

  const label = new PIXI.Text('idle', {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
    fontSize: 18,
    fontWeight: '700',
    fill: 0xffffff,
    align: 'center',
  });
  label.anchor.set(0.5, 0);
  label.position.set(0, 142);

  body.addChild(tail, cat, eyes, mouth, foreground, signal);
  container.addChild(aura, shadow, body, label);
  app.stage.addChild(container);

  let lastFitWidth = 0;
  let lastFitHeight = 0;
  const fit = () => {
    const width = app.screen.width;
    const height = app.screen.height;
    const scale = Math.min(1.35, Math.max(0.72, Math.min(width / 380, height / 390)));
    container.scale.set(scale);
    container.position.set(width / 2, height / 2 - 16);
    lastFitWidth = width;
    lastFitHeight = height;
  };
  fit();
  window.addEventListener('resize', fit);

  drawTail();
  drawCat();
  redrawFace();
  redrawAura();

  app.ticker.add(() => {
    if (app.screen.width !== lastFitWidth || app.screen.height !== lastFitHeight) fit();

    const now = performance.now();
    if (now > nextBlink) {
      blinkUntil = now + 90;
      nextBlink = now + 1600 + Math.random() * 2200;
    }
    const tick = app.ticker.lastTime / 16.67;
    const breathe = Math.round(Math.sin(tick / 34) * 2) * 2;
    const focusLift = state === 'working' ? -6 : state === 'thinking' ? -4 : state === 'error' ? 4 : 0;
    body.position.y = breathe + focusLift;
    shadow.scale.set(1 + Math.sin(tick / 34) * 0.03, 1);
    drawTail(tick);
    drawCat();
    redrawFace();
    redrawAura(tick);
    redrawSignal(tick);
  }, undefined, PIXI.UPDATE_PRIORITY.LOW);

  const applyState = (nextState: AvatarState, color: number) => {
    state = nextState;
    tint = color;
    drawCat();
    redrawFace();
    redrawAura();
    redrawSignal();
  };

  return {
    container,
    aura,
    body,
    mouth,
    label,
    setTint: (color: number) => {
      tint = color;
      redrawSignal();
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
