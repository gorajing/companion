// src/main/siblings.ts — lazy, build-safe access to the sibling MAIN-process modules
// (brain / memory / vision) that are authored by OTHER agents and may not exist on disk yet.
//
// WHY THIS SHAPE:
//   - Each sibling is imported via a LAZY dynamic import wrapped in try/catch, so a missing
//     module degrades gracefully AT RUNTIME (a clear thrown error when the feature is used)
//     instead of breaking `tsc` / the bundle for the whole MAIN process.
//   - We type each sibling against a THIN LOCAL interface (below) — NOT against the real
//     module's types — so this file compiles even when src/brain, src/memory, src/vision
//     are absent. The dynamic import specifiers are kept as runtime strings the bundler
//     resolves lazily.
//
// Documented sibling contracts (from the BUILD_GUIDE), which these interfaces mirror:
//   brain:  decide(DecideInput) -> Decision
//           describeScreen({b64,mime}) -> string
//           embed(string|string[]) -> number[]|number[][]
//   memory: remember(RememberInput) -> MemoryRow
//           recall({query,k?,sessionId?}) -> MemoryMatch[]
//   vision: captureScreen() -> {b64,mime}
//           askScreen(prompt, describe) -> string
//             (`describe` is a CALLBACK ({b64,mime}) => Promise<string> — the brain's
//              describeScreen injected as a dependency, NOT a boolean flag)
//
// The brain additionally streams reasoning_content / content deltas. Because its exact
// streaming API is owned by the other agent, we accept OPTIONAL callback overloads on
// decide() (onReasoning / onContent) and fall back to a non-streaming decide() if the
// sibling doesn't accept them. The orchestrator wires those callbacks to webContents.send.

import type { Decision, DecideInput } from '../shared/brain';
import type { RememberInput, MemoryRow, MemoryMatch } from '../shared/memory';

// ---- Thin local interfaces (structural; the real modules satisfy a superset) ----

export interface BrainStreamHooks {
  onReasoning?: (delta: string) => void;
  onContent?: (delta: string) => void;
}

export interface BrainModule {
  // Streaming hooks are optional; siblings that ignore the 2nd arg still satisfy this.
  decide(input: DecideInput, hooks?: BrainStreamHooks): Promise<Decision>;
  describeScreen(input: { b64: string; mime: string }): Promise<string>;
  embed(input: string | string[]): Promise<number[] | number[][]>;
}

export interface MemoryModule {
  remember(input: RememberInput): Promise<MemoryRow>;
  recall(input: { query: string; k?: number; sessionId?: string }): Promise<MemoryMatch[]>;
}

export interface CaptureResult {
  b64: string;
  mime: string;
}

/** Callback the vision module invokes to caption a captured frame (the brain's describeScreen). */
export type DescribeFn = (img: CaptureResult) => Promise<string>;

export interface VisionModule {
  captureScreen(): Promise<CaptureResult>;
  // `describe` is injected: vision captures the screen, then calls describe(frame) to caption it.
  askScreen(prompt: string, describe: DescribeFn): Promise<string>;
}

// ---- Lazy loaders. Each caches the resolved module (or the failure) once. ----

type Loaded<T> = { ok: true; mod: T } | { ok: false; err: Error };

function makeLoader<T>(
  label: 'brain' | 'memory' | 'vision',
  importer: () => Promise<unknown>,
): () => Promise<T> {
  let cached: Loaded<T> | null = null;
  return async (): Promise<T> => {
    if (cached?.ok) return cached.mod;
    // Re-attempt on a previous failure: the sibling agent may have finished since.
    try {
      const raw = (await importer()) as Record<string, unknown>;
      // Accept either a namespace export shape (decide/remember/etc. as named exports)
      // or a `default` export carrying them.
      const mod = (raw && typeof raw === 'object' && 'default' in raw &&
        raw.default && typeof raw.default === 'object'
        ? raw.default
        : raw) as T;
      cached = { ok: true, mod };
      return mod;
    } catch (e) {
      const err =
        e instanceof Error
          ? e
          : new Error(`failed to load ${label} module: ${String(e)}`);
      cached = { ok: false, err };
      throw new Error(
        `[main] ${label} module unavailable (sibling not built yet?): ${err.message}`,
      );
    }
  };
}

// NOTE: the specifiers below are written so the bundler treats them as dynamic (lazy)
// imports. They point at the sibling index modules the other agents are authoring.
// `@vite-ignore` keeps Vite from eagerly trying to resolve a possibly-absent path at
// build time; the try/catch above turns any runtime resolution failure into a clean error.
export const loadBrain = makeLoader<BrainModule>('brain', () =>
  import(/* @vite-ignore */ '../brain/index'),
);
export const loadMemory = makeLoader<MemoryModule>('memory', () =>
  import(/* @vite-ignore */ '../memory/index'),
);
export const loadVision = makeLoader<VisionModule>('vision', () =>
  import(/* @vite-ignore */ '../vision/index'),
);
