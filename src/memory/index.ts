import type { MemoryMatch, MemoryRow, RememberInput } from '../shared/memory';

const NEBIUS_BASE_URL = 'https://api.tokenfactory.nebius.com/v1/';
const NEBIUS_EMBEDDING_MODEL = process.env.NEBIUS_EMBED_MODEL || 'Qwen/Qwen3-Embedding-8B';
const EMBEDDING_DIMENSION = 1536;

declare const process: { env: Record<string, string | undefined> };

type BrainEmbed = (text: string) => Promise<number[]> | number[];
type BrainModule = {
  embed?: unknown;
  default?: { embed?: unknown };
};
type NebiusEmbeddingResponse = {
  data?: Array<{ embedding?: unknown }>;
};

let checkedBrainEmbed = false;
let brainEmbed: BrainEmbed | null = null;

export async function remember(input: RememberInput): Promise<MemoryRow> {
  requireText(input.text, 'remember text');

  const embedding = await embedText(input.text);
  const rows = await insforgeFetch<unknown>('/api/database/records/memory', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([
      {
        session_id: input.session_id,
        kind: input.kind,
        text: input.text,
        payload: input.payload ?? null,
        embedding,
      },
    ]),
  });

  if (!Array.isArray(rows) || !isMemoryRow(rows[0])) {
    throw new Error('Insforge insert returned an unexpected memory row payload');
  }

  return rows[0];
}

export async function recall(input: {
  query: string;
  k?: number;
  sessionId?: string;
}): Promise<MemoryMatch[]> {
  requireText(input.query, 'recall query');
  const k = normalizeK(input.k);
  const queryEmbedding = await embedText(input.query);

  const rows = await insforgeFetch<unknown>('/api/database/rpc/match_memory', {
    method: 'POST',
    body: JSON.stringify({
      query_embedding: queryEmbedding,
      k,
      p_session_id: input.sessionId ?? null,
    }),
  });

  if (!Array.isArray(rows) || !rows.every(isMemoryMatch)) {
    throw new Error('Insforge match_memory returned an unexpected payload');
  }

  return rows;
}

async function embedText(text: string): Promise<number[]> {
  const localEmbed = await loadBrainEmbed();
  const embedding = localEmbed ? await localEmbed(text) : await embedWithNebius(text);

  return assertEmbedding(embedding);
}

async function loadBrainEmbed(): Promise<BrainEmbed | null> {
  if (checkedBrainEmbed) {
    return brainEmbed;
  }

  checkedBrainEmbed = true;

  try {
    // Computed import keeps this module compiling while src/brain is not built yet.
    const brain = (await import('../' + 'brain')) as BrainModule;
    const candidate =
      typeof brain.embed === 'function' ? brain.embed : brain.default?.embed;

    brainEmbed = typeof candidate === 'function' ? (candidate as BrainEmbed) : null;
    return brainEmbed;
  } catch (error) {
    if (isMissingBrainModule(error)) {
      brainEmbed = null;
      return null;
    }

    throw error;
  }
}

async function embedWithNebius(text: string): Promise<number[]> {
  const response = await fetch(`${NEBIUS_BASE_URL}embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requiredEnv('NEBIUS_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: NEBIUS_EMBEDDING_MODEL,
      input: text,
      encoding_format: 'float',
      dimensions: EMBEDDING_DIMENSION,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Nebius embedding failed ${response.status}: ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as NebiusEmbeddingResponse;
  return assertEmbedding(payload.data?.[0]?.embedding);
}

async function insforgeFetch<T>(
  path: string,
  init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
): Promise<T> {
  const baseUrl = requiredEnv('INSFORGE_URL').replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': requiredEnv('INSFORGE_KEY'),
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Insforge ${path} failed ${response.status}: ${await response.text()}`,
    );
  }

  return (await response.json()) as T;
}

function assertEmbedding(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new Error('Embedding provider returned a non-array embedding');
  }

  if (value.length !== EMBEDDING_DIMENSION) {
    throw new Error(
      `Embedding dimension ${value.length} does not match vector(${EMBEDDING_DIMENSION})`,
    );
  }

  if (!value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    throw new Error('Embedding provider returned a non-numeric embedding value');
  }

  return value;
}

function isMemoryRow(value: unknown): value is MemoryRow {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    typeof row.session_id === 'string' &&
    typeof row.kind === 'string' &&
    typeof row.text === 'string' &&
    'payload' in row &&
    typeof row.created_at === 'string'
  );
}

function isMemoryMatch(value: unknown): value is MemoryMatch {
  return (
    isMemoryRow(value) &&
    typeof (value as { similarity?: unknown }).similarity === 'number'
  );
}

function isMissingBrainModule(error: unknown): boolean {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;

  if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') {
    return true;
  }

  return error instanceof Error && error.message.includes('../brain');
}

function normalizeK(k = 5): number {
  if (!Number.isInteger(k) || k < 1) {
    throw new Error(`recall k must be a positive integer, got ${k}`);
  }

  return k;
}

function requireText(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} must be non-empty`);
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}
