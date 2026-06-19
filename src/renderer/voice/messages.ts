// src/renderer/voice/messages.ts — minimal local types for the Vapi `message`
// event payload. The SDK types it as `any`, so we narrow it ourselves to the
// fields this component reads (transcript + tool-calls), per the documented
// VAPI->RENDERER event contract.

export interface VapiTranscriptMessage {
  type: 'transcript';
  role: 'user' | 'assistant';
  transcript: string;
  transcriptType: 'partial' | 'final';
}

export interface VapiToolCall {
  id: string;
  name: string;
  /** Already-parsed arguments object on the CLIENT tool-calls surface. */
  arguments: Record<string, unknown>;
}

export interface VapiToolCallsMessage {
  type: 'tool-calls';
  toolCallList: VapiToolCall[];
}

export interface VapiOtherMessage {
  type: 'conversation-update' | 'model-output' | 'status-update' | string;
  [k: string]: unknown;
}

export type VapiMessage = VapiTranscriptMessage | VapiToolCallsMessage | VapiOtherMessage;

export function isTranscript(m: VapiMessage): m is VapiTranscriptMessage {
  return m.type === 'transcript';
}

export function isToolCalls(m: VapiMessage): m is VapiToolCallsMessage {
  return m.type === 'tool-calls' && Array.isArray((m as VapiToolCallsMessage).toolCallList);
}
