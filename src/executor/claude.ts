// src/executor/claude.ts — Claude Code CLI-subprocess executor + pure message mapper.
//
// Drives the installed `claude` CLI (v2.1.177) in headless print mode and normalizes its
// stream-json SDKMessage output into the canonical ActionEvent union (src/shared/events.ts).
// The mapper is PURE so it can be unit-tested against hand-built / captured samples.
//
// Spawn invariants (see BUILD_GUIDE Executor Adapter, step 5 + gotchas):
//   - `--output-format stream-json` REQUIRES `--verbose`; token deltas REQUIRE
//     `--include-partial-messages`. Missing either silently changes the stream.
//   - cwd=repo, env passes through (ANTHROPIC_API_KEY must be present).
//   - stdin = /dev/null (stdio[0]='ignore'); STDOUT = JSONL; stderr = hook/diag spam (drain).
//   - Tolerant parse: skip lines not starting with '{', wrap JSON.parse in try/catch.
//   - Filter to KNOWN message types; unknown types (hook spam, status, replay) -> null.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  ActionEvent,
  ExecutorRunOptions,
  Executor,
  newRunId,
} from '../shared/events';

// Absolute path to the installed claude binary (packaged Electron strips ~/.local/bin
// from PATH). Falls back to bare 'claude' for dev shells.
const CLAUDE_BIN =
  process.env.COMPANION_CLAUDE_BIN ?? '/Users/jinchoi/.local/bin/claude';

// Tools whose input.file_path identifies a file mutation. Read is included so the
// renderer shows file activity; Write -> 'add', the rest -> 'update'.
const FILE_PATH_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit']);

// Per-mapping memory of which itemId (tool_use id) was a command vs a file_change,
// so the closing `user` tool_result can be emitted as the SAME canonical kind.
// The mapper is otherwise pure on (obj, runId); correlation state is threaded in by
// the caller (the executor owns one Map per run). For standalone unit checks, pass a
// fresh Map.
export interface ClaudeCorrelation {
  // tool_use_id -> the canonical kind that 'started' so completion closes it correctly.
  kindById: Map<string, 'command' | 'file_change' | 'tool'>;
}

export function newClaudeCorrelation(): ClaudeCorrelation {
  return { kindById: new Map() };
}

/**
 * Pure mapper: one Claude SDKMessage object -> at most one canonical ActionEvent.
 *
 * Maps stream-json SDKMessage shapes (claude 2.1.x):
 *   system/init{session_id}                          -> run.started(threadId) + turn.started*
 *   assistant tool_use Bash{input.command}           -> command(started)
 *   assistant tool_use Read/Edit/Write{file_path}    -> file_change(started)
 *   assistant tool_use thinking                      -> reasoning
 *   assistant text                                   -> message
 *   assistant other tool_use                         -> tool(started)
 *   user tool_result{tool_use_id,is_error}           -> command/file_change/tool completion
 *   result/success                                   -> run.completed
 *   result/error                                     -> run.failed
 * Anything else (stream_event deltas handled separately, hook spam, status, replay) -> null.
 *
 * `turn.started` is emitted by the executor right after the init `run.started`; the pure
 * mapper returns the single primary event per message. (run.started carries the threadId;
 * the executor synthesizes turn.started.)
 */
export function mapClaudeMessage(
  obj: unknown,
  runId: string,
  corr: ClaudeCorrelation = newClaudeCorrelation(),
): ActionEvent | null {
  const ts = Date.now();
  if (!obj || typeof obj !== 'object') return null;
  const m = obj as Record<string, unknown>;
  if (typeof m.type !== 'string') return null;

  switch (m.type) {
    case 'system': {
      if (m.subtype !== 'init') return null;
      const threadId =
        typeof m.session_id === 'string' ? m.session_id : undefined;
      return { kind: 'run.started', agent: 'claude', runId, threadId, ts };
    }

    case 'assistant': {
      const content = messageContent(m.message);
      // One assistant message may hold several blocks; emit the first meaningful one.
      // (The executor iterates all blocks; the pure single-event API returns the first.)
      for (const b of content) {
        const ev = mapAssistantBlock(b, runId, corr, ts);
        if (ev) return ev;
      }
      return null;
    }

    case 'user': {
      const content = messageContent(m.message);
      for (const b of content) {
        const ev = mapToolResultBlock(b, runId, corr, ts);
        if (ev) return ev;
      }
      return null;
    }

    case 'result': {
      if (m.subtype === 'success') {
        const finalText = typeof m.result === 'string' ? m.result : undefined;
        return {
          kind: 'run.completed',
          runId,
          ok: true,
          finalText,
          usage: m.usage,
          ts,
        };
      }
      const error =
        typeof m.subtype === 'string' ? m.subtype : 'result error';
      return { kind: 'run.failed', runId, ok: false, error, ts };
    }

    // stream_event (partial deltas) handled by the executor for message.delta;
    // everything else (status, replay, hook notices) -> skip.
    default:
      return null;
  }
}

/**
 * Map a partial-message stream_event into a message.delta (live narration tokens),
 * or null. Kept separate because it is a streaming side-channel, not a primary
 * SDKMessage.
 */
export function mapClaudeStreamEvent(
  obj: unknown,
  runId: string,
): ActionEvent | null {
  if (!obj || typeof obj !== 'object') return null;
  const m = obj as Record<string, unknown>;
  if (m.type !== 'stream_event') return null;
  const e = m.event as Record<string, unknown> | undefined;
  if (!e || typeof e !== 'object') return null;
  if (e.type !== 'content_block_delta') return null;
  const delta = e.delta as Record<string, unknown> | undefined;
  if (!delta) return null;
  if (delta.type === 'text_delta' && typeof delta.text === 'string') {
    return { kind: 'message.delta', runId, text: delta.text, ts: Date.now() };
  }
  return null;
}

/**
 * Map one assistant or user SDKMessage to ALL of its canonical ActionEvents (a single
 * message may carry several content blocks). This is the exact per-message fan-out the
 * executor performs; exported so it can be unit-tested against samples/fixtures.
 */
export function mapClaudeMessageBlocks(
  obj: unknown,
  runId: string,
  corr: ClaudeCorrelation = newClaudeCorrelation(),
): ActionEvent[] {
  if (!obj || typeof obj !== 'object') return [];
  const m = obj as Record<string, unknown>;
  const ts = Date.now();
  const out: ActionEvent[] = [];
  if (m.type === 'assistant') {
    for (const b of messageContent(m.message)) {
      const ev = mapAssistantBlock(b, runId, corr, ts);
      if (ev) out.push(ev);
    }
  } else if (m.type === 'user') {
    for (const b of messageContent(m.message)) {
      const ev = mapToolResultBlock(b, runId, corr, ts);
      if (ev) out.push(ev);
    }
  }
  return out;
}

function messageContent(message: unknown): Record<string, unknown>[] {
  if (!message || typeof message !== 'object') return [];
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];
  return content.filter(
    (b): b is Record<string, unknown> => !!b && typeof b === 'object',
  );
}

function mapAssistantBlock(
  b: Record<string, unknown>,
  runId: string,
  corr: ClaudeCorrelation,
  ts: number,
): ActionEvent | null {
  const type = typeof b.type === 'string' ? b.type : undefined;

  if (type === 'text') {
    const text = typeof b.text === 'string' ? b.text : '';
    if (!text) return null;
    return { kind: 'message', runId, text, ts };
  }

  if (type === 'thinking') {
    const text =
      typeof b.thinking === 'string'
        ? b.thinking
        : typeof b.text === 'string'
          ? b.text
          : '';
    return { kind: 'reasoning', runId, itemId: idOf(b), text, ts };
  }

  if (type === 'tool_use') {
    const name = typeof b.name === 'string' ? b.name : '';
    const input =
      b.input && typeof b.input === 'object'
        ? (b.input as Record<string, unknown>)
        : {};
    const itemId = idOf(b);

    if (name === 'Bash') {
      corr.kindById.set(itemId, 'command');
      return {
        kind: 'command',
        runId,
        itemId,
        status: 'started',
        command: typeof input.command === 'string' ? input.command : '',
        ts,
      };
    }

    if (FILE_PATH_TOOLS.has(name) && typeof input.file_path === 'string') {
      corr.kindById.set(itemId, 'file_change');
      return {
        kind: 'file_change',
        runId,
        itemId,
        status: 'started',
        files: [{ path: input.file_path, op: name === 'Write' ? 'add' : 'update' }],
        ts,
      };
    }

    corr.kindById.set(itemId, 'tool');
    return {
      kind: 'tool',
      runId,
      itemId,
      status: 'started',
      tool: name || 'tool',
      summary: summarize(input),
      ts,
    };
  }

  return null;
}

function mapToolResultBlock(
  b: Record<string, unknown>,
  runId: string,
  corr: ClaudeCorrelation,
  ts: number,
): ActionEvent | null {
  if (b.type !== 'tool_result') return null;
  const itemId =
    typeof b.tool_use_id === 'string' ? b.tool_use_id : '';
  const failed = b.is_error === true;
  const status: 'completed' | 'failed' = failed ? 'failed' : 'completed';
  const kind = corr.kindById.get(itemId) ?? 'tool';

  if (kind === 'command') {
    return {
      kind: 'command',
      runId,
      itemId,
      status,
      command: '', // completion doesn't restate the command; correlated by itemId
      output: toolResultText(b.content),
      ts,
    };
  }
  if (kind === 'file_change') {
    return {
      kind: 'file_change',
      runId,
      itemId,
      status,
      files: [], // completion correlated by itemId; files were given on 'started'
      ts,
    };
  }
  return { kind: 'tool', runId, itemId, status, tool: 'result', ts };
}

function idOf(b: Record<string, unknown>): string {
  return typeof b.id === 'string' ? b.id : '';
}

function summarize(input: Record<string, unknown>): string | undefined {
  try {
    const s = JSON.stringify(input);
    return s.length > 120 ? s.slice(0, 120) : s;
  } catch {
    return undefined;
  }
}

function toolResultText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content
      .filter(
        (c): c is Record<string, unknown> => !!c && typeof c === 'object',
      )
      .map((c) => (typeof c.text === 'string' ? c.text : ''))
      .filter(Boolean);
    return parts.length ? parts.join('') : undefined;
  }
  return undefined;
}

/**
 * Spawn the claude CLI and yield normalized ActionEvents.
 *
 * `claude -p "<prompt>" --output-format stream-json --verbose --include-partial-messages
 *  --permission-mode acceptEdits --allowedTools "Read,Edit,Write,Bash"` with cwd=repo.
 */
export async function* runClaude(
  opts: ExecutorRunOptions,
): AsyncIterable<ActionEvent> {
  const runId = newRunId();

  if (opts.signal?.aborted) {
    yield { kind: 'run.failed', runId, ok: false, error: 'aborted', ts: Date.now() };
    return;
  }

  const args = [
    '-p',
    opts.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode',
    'acceptEdits',
    '--allowedTools',
    'Read,Edit,Write,Bash',
  ];

  const child = spawn(CLAUDE_BIN, args, {
    cwd: opts.repo,
    stdio: ['ignore', 'pipe', 'pipe'], // stdin=/dev/null; STDOUT=JSONL; stderr=hook spam
    env: { ...process.env }, // ANTHROPIC_API_KEY passes through
    signal: opts.signal,
  });

  // Drain stderr; hook/diagnostic spam, never JSONL.
  child.stderr?.on('data', () => {});

  let spawnError: Error | null = null;
  child.on('error', (err) => {
    spawnError = err;
  });

  const corr = newClaudeCorrelation();
  let emittedStart = false;

  const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (opts.signal?.aborted) break;
      const s = line.trim();
      if (!s || s[0] !== '{') continue;
      let obj: unknown;
      try {
        obj = JSON.parse(s);
      } catch {
        continue;
      }

      // Live token deltas first (streaming side-channel).
      const delta = mapClaudeStreamEvent(obj, runId);
      if (delta) {
        yield delta;
        continue;
      }

      // Init: emit run.started THEN synthesize turn.started.
      if (
        !emittedStart &&
        (obj as Record<string, unknown>).type === 'system' &&
        (obj as Record<string, unknown>).subtype === 'init'
      ) {
        const started = mapClaudeMessage(obj, runId, corr);
        if (started) {
          emittedStart = true;
          yield started;
          yield { kind: 'turn.started', runId, ts: Date.now() };
        }
        continue;
      }

      // An assistant/user message may contain several blocks; emit each as its own event.
      const type = (obj as Record<string, unknown>).type;
      if (type === 'assistant' || type === 'user') {
        for (const ev of mapClaudeMessageBlocks(obj, runId, corr)) yield ev;
        continue;
      }

      const mapped = mapClaudeMessage(obj, runId, corr);
      if (mapped) yield mapped;
    }
  } catch (e) {
    yield {
      kind: 'run.failed',
      runId,
      ok: false,
      error: messageOf(e),
      ts: Date.now(),
    };
    return;
  }

  if (opts.signal?.aborted) {
    yield { kind: 'run.failed', runId, ok: false, error: 'aborted', ts: Date.now() };
    return;
  }
  if (spawnError) {
    yield {
      kind: 'run.failed',
      runId,
      ok: false,
      error: messageOf(spawnError),
      ts: Date.now(),
    };
  }
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export const ClaudeExecutor: Executor = {
  run(opts: ExecutorRunOptions): AsyncIterable<ActionEvent> {
    return runClaude(opts);
  },
};
