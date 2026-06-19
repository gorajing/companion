// src/shared/avatar.ts — the 6 avatar states + the ONE mapper the renderer uses.
// No other component invents states; the renderer drives the character off eventToAvatarState() only.
import type { ActionEvent } from './events';

export type AvatarState = 'idle' | 'listening' | 'thinking' | 'working' | 'done' | 'error';

export function eventToAvatarState(e: ActionEvent): AvatarState | null {
  switch (e.kind) {
    case 'reasoning':
      return 'thinking';
    case 'command':
    case 'file_change':
    case 'tool':
      return e.status === 'failed' ? 'error' : 'working';
    case 'run.completed':
      return 'done';
    case 'run.failed':
      return 'error';
    case 'run.started':
    case 'turn.started':
      return 'working';
    default:
      return null; // message / message.delta don't change state
  }
}
