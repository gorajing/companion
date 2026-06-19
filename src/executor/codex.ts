// src/executor/codex.ts — Codex CLI-subprocess executor + pure event mapper.
//
// Drives the installed `codex` CLI (v0.139.0) via `codex exec --json` and normalizes
// its line-delimited JSON (JSONL) ThreadEvent stream into the canonical ActionEvent
// union (src/shared/events.ts). The mapper is PURE so it can be unit-tested against a
// captured fixture without spawning a process.
//
// Spawn invariants (see BUILD_GUIDE Executor Adapter, steps 3 + gotchas):
//   - stdin MUST be /dev/null (stdio[0]='ignore') or `codex exec` can block on a TTY.
//   - Parse STDOUT ONLY as JSONL; stderr carries logs/skill-load errors/telemetry — drain it.
//   - Tolerant parse: skip lines not starting with '{', wrap JSON.parse in try/catch.
//   - Unknown event/item types -> map to null (skip), never throw.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  ActionEvent,
  ExecutorRunOptions,
  Executor,
  newRunId,
} from '../shared/events';

// Absolute path to the installed codex binary. Packaged Electron strips PATH
// (/opt/homebrew/bin is gone), so resolve absolutely. Falls back to bare 'codex'
// for dev shells where PATH is intact.
const CODEX_BIN = process.env.COMPANION_CODEX_BIN ?? '/opt/homebrew/bin/codex';

/**
 * Pure mapper: one Codex ThreadEvent object -> at most one canonical ActionEvent.
 *
 * Maps the CURRENT codex v0.139.0 JSONL shapes (verified live, see __fixtures__):
 *   thread.started{thread_id}                       -> run.started(threadId)
 *   turn.started                                    -> turn.started
 *   item.started|completed / type=reasoning         -> reasoning (only on completed; carries text)
 *   item.started|completed / type=command_execution -> command(status, command, output, exitCode)
 *   item.started|completed / type=file_change       -> file_change(status, files[])
 *   item.started|completed / type=agent_message     -> message (only on completed; final text)
 *   item.started|completed / type=mcp_tool_call     -> tool(status, server, tool)
 *   item.started|completed / type=web_search        -> tool(status, tool='web_search', summary=query)
 *   item.* / type=error                             -> run.failed
 *   turn.completed{usage}                           -> run.completed
 *   turn.failed{error}                              -> run.failed
 *   error{message}                                  -> run.failed
 * Anything else (todo_list, unknown item/event types) -> null (skip; forward-compat).
 *
 * Item status note (v0.139.0): item.started carries status:'in_progress'; item.completed
 * carries 'completed' | 'failed'. We derive the canonical ActionEvent status from the
 * envelope event type (started -> 'started') plus the item's own failure signal on completion.
 */
export function mapCodexThreadEvent(
  obj: unknown,
  runId: string,
): ActionEvent | null {
  const ts = Date.now();
  if (!obj || typeof obj !== 'object') return null;
  const ev = obj as Record<string, unknown>;
  if (typeof ev.type !== 'string') return null;

  switch (ev.type) {
    case 'thread.started': {
      const threadId =
        typeof ev.thread_id === 'string' ? ev.thread_id : undefined;
      return { kind: 'run.started', agent: 'codex', runId, threadId, ts };
    }

    case 'turn.started':
      return { kind: 'turn.started', runId, ts };

    case 'item.started':
    case 'item.completed': {
      const completed = ev.type === 'item.completed';
      const it = ev.item;
      if (!it || typeof it !== 'object') return null;
      const item = it as Record<string, unknown>;
      const itemType =
        typeof item.type === 'string' ? item.type : undefined;
      const itemId = typeof item.id === 'string' ? item.id : '';

      switch (itemType) {
        case 'reasoning': {
          // Reasoning carries meaningful text only on completion.
          if (!completed) return null;
          const text = typeof item.text === 'string' ? item.text : '';
          return { kind: 'reasoning', runId, itemId, text, ts };
        }

        case 'command_execution': {
          const command =
            typeof item.command === 'string' ? item.command : '';
          const output =
            typeof item.aggregated_output === 'string'
              ? item.aggregated_output
              : undefined;
          const exitCode =
            typeof item.exit_code === 'number' ? item.exit_code : undefined;
          // Failure derivation: trust the item's own status, and treat any
          // non-zero exit code as a failure. exit_code is null/absent on start.
          const itemStatus =
            typeof item.status === 'string' ? item.status : undefined;
          const failed =
            itemStatus === 'failed' || (exitCode != null && exitCode !== 0);
          const status: 'started' | 'completed' | 'failed' = !completed
            ? 'started'
            : failed
              ? 'failed'
              : 'completed';
          return {
            kind: 'command',
            runId,
            itemId,
            status,
            command,
            output,
            exitCode,
            ts,
          };
        }

        case 'file_change': {
          const rawChanges = Array.isArray(item.changes) ? item.changes : [];
          const files = rawChanges
            .filter(
              (c): c is Record<string, unknown> =>
                !!c && typeof c === 'object',
            )
            .map((c) => ({
              path: typeof c.path === 'string' ? c.path : '',
              op: normalizeFileOp(c.kind),
            }));
          const itemStatus =
            typeof item.status === 'string' ? item.status : undefined;
          const status: 'started' | 'completed' | 'failed' = !completed
            ? 'started'
            : itemStatus === 'failed'
              ? 'failed'
              : 'completed';
          return { kind: 'file_change', runId, itemId, status, files, ts };
        }

        case 'mcp_tool_call': {
          const status: 'started' | 'completed' | 'failed' = !completed
            ? 'started'
            : item.status === 'failed' || item.error != null
              ? 'failed'
              : 'completed';
          return {
            kind: 'tool',
            runId,
            itemId,
            status,
            server: typeof item.server === 'string' ? item.server : undefined,
            tool: typeof item.tool === 'string' ? item.tool : 'mcp',
            ts,
          };
        }

        case 'web_search': {
          const status: 'started' | 'completed' | 'failed' = completed
            ? 'completed'
            : 'started';
          return {
            kind: 'tool',
            runId,
            itemId,
            status,
            tool: 'web_search',
            summary: typeof item.query === 'string' ? item.query : undefined,
            ts,
          };
        }

        case 'agent_message': {
          // Final assistant text only arrives on completion.
          if (!completed) return null;
          const text = typeof item.text === 'string' ? item.text : '';
          return { kind: 'message', runId, text, ts };
        }

        case 'error': {
          const error =
            typeof item.message === 'string' ? item.message : 'item error';
          return { kind: 'run.failed', runId, ok: false, error, ts };
        }

        // todo_list and any unknown item type -> skip (forward-compat).
        default:
          return null;
      }
    }

    case 'turn.completed':
      return { kind: 'run.completed', runId, ok: true, usage: ev.usage, ts };

    case 'turn.failed': {
      const err = ev.error;
      const error =
        err && typeof err === 'object' && typeof (err as Record<string, unknown>).message === 'string'
          ? ((err as Record<string, unknown>).message as string)
          : 'turn.failed';
      return { kind: 'run.failed', runId, ok: false, error, ts };
    }

    case 'error': {
      const error =
        typeof ev.message === 'string' ? ev.message : 'codex error';
      return { kind: 'run.failed', runId, ok: false, error, ts };
    }

    // Unknown top-level event type -> skip.
    default:
      return null;
  }
}

function normalizeFileOp(kind: unknown): 'add' | 'update' | 'delete' {
  return kind === 'add' || kind === 'delete' ? kind : 'update';
}

/**
 * Spawn the codex CLI and yield normalized ActionEvents.
 *
 * `codex exec --json --skip-git-repo-check -s workspace-write -C <repo> "<prompt>" </dev/null`
 * stdin = 'ignore' (== /dev/null), stdout = JSONL parsed via readline, stderr drained.
 */
export async function* runCodex(
  opts: ExecutorRunOptions,
): AsyncIterable<ActionEvent> {
  const runId = newRunId();

  if (opts.signal?.aborted) {
    yield { kind: 'run.failed', runId, ok: false, error: 'aborted', ts: Date.now() };
    return;
  }

  const args = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '-s',
    'workspace-write',
    '-C',
    opts.repo,
    opts.prompt,
  ];

  const child = spawn(CODEX_BIN, args, {
    stdio: ['ignore', 'pipe', 'pipe'], // stdin=/dev/null; no TTY hang
    env: { ...process.env },
    signal: opts.signal,
  });

  // Drain stderr; it is plain logs (skill-load errors, telemetry), NOT JSONL.
  child.stderr?.on('data', () => {});

  // Surface a clean run.failed if the binary cannot be spawned (ENOENT) or the
  // AbortSignal kills it — instead of letting the process error escape the loop.
  let spawnError: Error | null = null;
  child.on('error', (err) => {
    spawnError = err;
  });

  const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (opts.signal?.aborted) break;
      const s = line.trim();
      if (!s || s[0] !== '{') continue; // skip blanks / non-JSON banner lines
      let obj: unknown;
      try {
        obj = JSON.parse(s);
      } catch {
        continue; // tolerate partial/garbage lines
      }
      const mapped = mapCodexThreadEvent(obj, runId);
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

export const CodexExecutor: Executor = {
  run(opts: ExecutorRunOptions): AsyncIterable<ActionEvent> {
    return runCodex(opts);
  },
};
