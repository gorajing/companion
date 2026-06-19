// Standalone verification: feed the captured codex JSONL fixture through the pure
// mapper and print the resulting canonical ActionEvent kind-sequence. Eyeball that it
// is run.started -> turn.started -> ... -> command/file_change -> run.completed.
//
// Run:  npx tsx src/executor/__fixtures__/check.ts
//
// Also synthesizes a hand-built Claude stream-json sample and runs it through the Claude
// mapper, since the live Claude path needs ANTHROPIC_API_KEY (absent in this env).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapCodexThreadEvent } from '../codex';
import {
  mapClaudeMessage,
  mapClaudeMessageBlocks,
  mapClaudeStreamEvent,
  newClaudeCorrelation,
} from '../claude';
import type { ActionEvent } from '../../shared/events';

function describe(ev: ActionEvent): string {
  switch (ev.kind) {
    case 'run.started':
      return `run.started(agent=${ev.agent}, threadId=${ev.threadId ?? '-'})`;
    case 'command':
      return `command[${ev.status}](${truncate(ev.command)}${ev.exitCode != null ? `, exit=${ev.exitCode}` : ''})`;
    case 'file_change':
      return `file_change[${ev.status}](${ev.files.map((f) => `${f.op}:${base(f.path)}`).join(',')})`;
    case 'tool':
      return `tool[${ev.status}](${ev.tool})`;
    case 'reasoning':
      return `reasoning(${truncate(ev.text)})`;
    case 'message':
      return `message(${truncate(ev.text)})`;
    case 'message.delta':
      return `message.delta(${truncate(ev.text)})`;
    case 'run.completed':
      return `run.completed(ok)`;
    case 'run.failed':
      return `run.failed(${ev.error})`;
    default:
      return (ev as { kind: string }).kind;
  }
}

const truncate = (s: string) => (s.length > 40 ? s.slice(0, 40) + '…' : s).replace(/\n/g, ' ');
const base = (p: string) => p.split('/').pop() ?? p;

function runCodexFixture() {
  const path = join(__dirname, 'codex_hello.jsonl');
  const lines = readFileSync(path, 'utf8').split('\n');
  const runId = 'run_test_codex';
  const out: ActionEvent[] = [];
  let parsed = 0;
  let skipped = 0;
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    if (s[0] !== '{') {
      skipped++;
      continue;
    }
    let obj: unknown;
    try {
      obj = JSON.parse(s);
    } catch {
      skipped++;
      continue;
    }
    parsed++;
    const ev = mapCodexThreadEvent(obj, runId);
    if (ev) out.push(ev);
  }

  console.log('=== CODEX (live fixture: codex_hello.jsonl) ===');
  console.log(`parsed ${parsed} JSON lines, mapped ${out.length} ActionEvents`);
  out.forEach((ev, i) => console.log(`  ${String(i + 1).padStart(2)}. ${describe(ev)}`));
  console.log('kinds:', out.map((e) => e.kind).join(' -> '));

  // Assertions on the canonical sequence.
  const kinds = out.map((e) => e.kind);
  assert(kinds[0] === 'run.started', 'first event is run.started');
  assert(kinds[1] === 'turn.started', 'second event is turn.started');
  assert(kinds[kinds.length - 1] === 'run.completed', 'last event is run.completed');
  assert(kinds.includes('command'), 'contains at least one command');
  assert(kinds.includes('file_change'), 'contains at least one file_change');
  const fc = out.find((e) => e.kind === 'file_change' && e.status === 'completed');
  assert(!!fc, 'has a completed file_change');
  const failedCmd = out.find((e) => e.kind === 'command' && e.status === 'failed');
  assert(!!failedCmd, 'rg-files command correctly mapped to failed (exit 1)');
  console.log('CODEX assertions: PASS\n');
}

function runClaudeSample() {
  // Hand-built stream-json sample mirroring the documented SDKMessage shapes
  // (claude 2.1.x). Live run not possible without ANTHROPIC_API_KEY.
  const sample: unknown[] = [
    { type: 'system', subtype: 'init', session_id: 'sess_abc123' },
    {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: "I'll create " } },
    },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: "I'll create hello.py for you." },
          { type: 'tool_use', id: 'tu_1', name: 'Write', input: { file_path: '/tmp/x/hello.py', content: 'print("hi")' } },
        ],
      },
    },
    {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', is_error: false, content: 'File created' }] },
    },
    {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tu_2', name: 'Bash', input: { command: 'python3 hello.py' } }],
      },
    },
    {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tu_2', is_error: false, content: 'hi\n' }] },
    },
    { type: 'result', subtype: 'success', result: 'Created hello.py and verified it prints hi.', usage: { input_tokens: 10 } },
  ];

  const runId = 'run_test_claude';
  const corr = newClaudeCorrelation();
  const out: ActionEvent[] = [];
  let emittedStart = false;
  for (const obj of sample) {
    const delta = mapClaudeStreamEvent(obj, runId);
    if (delta) {
      out.push(delta);
      continue;
    }
    const o = obj as Record<string, unknown>;
    if (!emittedStart && o.type === 'system' && o.subtype === 'init') {
      const started = mapClaudeMessage(obj, runId, corr);
      if (started) {
        emittedStart = true;
        out.push(started);
        out.push({ kind: 'turn.started', runId, ts: Date.now() });
      }
      continue;
    }
    if (o.type === 'assistant' || o.type === 'user') {
      for (const ev of mapClaudeMessageBlocks(obj, runId, corr)) out.push(ev);
      continue;
    }
    const mapped = mapClaudeMessage(obj, runId, corr);
    if (mapped) out.push(mapped);
  }

  console.log('=== CLAUDE (hand-built sample — NOT a live run; no ANTHROPIC_API_KEY) ===');
  out.forEach((ev, i) => console.log(`  ${String(i + 1).padStart(2)}. ${describe(ev)}`));
  console.log('kinds:', out.map((e) => e.kind).join(' -> '));

  const kinds = out.map((e) => e.kind);
  assert(kinds[0] === 'run.started', 'first event is run.started');
  assert(kinds[1] === 'turn.started', 'second event is turn.started');
  assert(kinds.includes('message.delta'), 'has a live message.delta token');
  assert(kinds.includes('message'), 'has a final message');
  const fcStart = out.find((e) => e.kind === 'file_change' && e.status === 'started');
  const fcDone = out.find((e) => e.kind === 'file_change' && e.status === 'completed');
  assert(!!fcStart && !!fcDone, 'file_change started then completed (correlated by tool_use_id)');
  const cmdStart = out.find((e) => e.kind === 'command' && e.status === 'started');
  const cmdDone = out.find((e) => e.kind === 'command' && e.status === 'completed');
  assert(!!cmdStart && !!cmdDone, 'command started then completed (correlated by tool_use_id)');
  assert(kinds[kinds.length - 1] === 'run.completed', 'last event is run.completed');
  console.log('CLAUDE assertions: PASS\n');
}

function assert(cond: boolean, label: string) {
  if (!cond) {
    console.error(`  ASSERTION FAILED: ${label}`);
    process.exitCode = 1;
  }
}

runCodexFixture();
runClaudeSample();
