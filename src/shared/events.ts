// src/shared/events.ts — the single canonical ActionEvent. Imported by main, preload, renderer.
// Owned by the executor-adapter; FROZEN. Do not add kinds without updating eventToAvatarState.
export type AgentKind = 'codex' | 'claude';

export type ActionEvent =
  | { kind: 'run.started';   agent: AgentKind; runId: string; threadId?: string; ts: number }
  | { kind: 'turn.started';  runId: string; ts: number }
  | { kind: 'reasoning';     runId: string; itemId: string; text: string; ts: number }            // ONLY event -> avatar 'thinking'
  | { kind: 'command';       runId: string; itemId: string; status: 'started' | 'completed' | 'failed'; command: string; output?: string; exitCode?: number; ts: number }
  | { kind: 'file_change';   runId: string; itemId: string; status: 'started' | 'completed' | 'failed'; files: { path: string; op: 'add' | 'update' | 'delete' }[]; ts: number }
  | { kind: 'tool';          runId: string; itemId: string; status: 'started' | 'completed' | 'failed'; server?: string; tool: string; summary?: string; ts: number }
  | { kind: 'message.delta'; runId: string; text: string; ts: number }                            // streaming assistant tokens
  | { kind: 'message';       runId: string; text: string; ts: number }                            // final assistant text
  | { kind: 'run.completed'; runId: string; ok: true;  finalText?: string; usage?: unknown; ts: number }
  | { kind: 'run.failed';    runId: string; ok: false; error: string; ts: number };

export interface ExecutorRunOptions { repo: string; prompt: string; agent?: AgentKind; signal?: AbortSignal }
export interface Executor { run(opts: ExecutorRunOptions): AsyncIterable<ActionEvent> }

export const newRunId = (): string => `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
