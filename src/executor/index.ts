// src/executor/index.ts — the single public surface of the executor adapter.
//
// Selects a backend Executor by AgentKind. Both backends yield the IDENTICAL canonical
// ActionEvent union (src/shared/events.ts) so the renderer/Brain/Avatar treat them the
// same. Defaults to codex.
import { AgentKind, Executor } from '../shared/events';
import { CodexExecutor } from './codex';
import { ClaudeExecutor } from './claude';

export { CodexExecutor, runCodex, mapCodexThreadEvent } from './codex';
export {
  ClaudeExecutor,
  runClaude,
  mapClaudeMessage,
  mapClaudeMessageBlocks,
  mapClaudeStreamEvent,
  newClaudeCorrelation,
} from './claude';

export function getExecutor(kind: AgentKind): Executor {
  return kind === 'claude' ? ClaudeExecutor : CodexExecutor;
}
