// src/shared/memory.ts — Insforge pgvector memory contract.
export type MemoryKind = 'action' | 'narration' | 'observation' | 'fact';
export interface RememberInput { session_id: string; kind: MemoryKind; text: string; payload?: unknown }
export interface MemoryRow { id: string; session_id: string; kind: string; text: string; payload: unknown; created_at: string }
export interface MemoryMatch extends MemoryRow { similarity: number }
