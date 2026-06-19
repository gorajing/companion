// src/shared/brain.ts — Brain <-> Executor <-> Avatar contract. `command` enum MUST match the orchestrator dispatch.
export type Command = 'run_agent' | 'answer' | 'capture_screen' | 'clarify';
export interface Decision { narration: string; command: Command; args: Record<string, unknown> }
export interface DecideInput { transcript: string; memory?: string; screen?: string }
