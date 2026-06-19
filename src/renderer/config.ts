// src/renderer/config.ts — renderer-side configuration.
//
// Secrets that the renderer is ALLOWED to hold are the Vapi PUBLIC (publishable)
// key and the proxy/ngrok base URL the inline custom-llm assistant points at.
// Everything else (Nebius/Anthropic/Vapi-private/Insforge admin keys) lives ONLY
// in MAIN — never read those here.
//
// Resolution order for each value:
//   1. window.COMPANION_CFG.<field>  (injected at runtime by MAIN/preload or a
//      <script> tag; the deployment-time placeholder this component consumes)
//   2. import.meta.env.VITE_*         (Vite build-time env, optional)
//   3. a safe empty default
//
// When the public key is empty we DON'T crash the renderer — the avatar + event
// pipeline must still come alive for a model/keys-absent demo. Voice simply
// refuses to start a call and the UI shows why (see voice/wireEvents + ui).
//
// NOTE: ambient.d.ts (which declares window.COMPANION_CFG) is a global type-only
// declaration picked up automatically by tsc/Vite; it is NOT runtime-imported
// here (a .d.ts has no JS to import).

export interface CompanionConfig {
  /** Vapi PUBLISHABLE key — safe to ship in the renderer. */
  vapiPublicKey: string;
  /**
   * Base URL of the OpenAI-compatible custom-llm SSE proxy (ngrok ROOT, no
   * trailing /chat/completions — Vapi appends the path itself).
   */
  customLlmUrl: string;
  /** Nebius model id forwarded in the POST body as `model`. */
  customLlmModel: string;
  /** STT provider/model for the user's mic audio. */
  transcriberModel: string;
  /** 11labs voiceId the character speaks with. */
  voiceId: string;
  /** Live2D model path under /live2d (public dir). Absent file -> placeholder. */
  modelUrl: string;
}

function viteEnv(_key: string): string | undefined {
  // Vite's import.meta.env is omitted here so the shared (commonjs) tsconfig type-checks;
  // inject runtime config via window.COMPANION_CFG instead (set in index.html / preload).
  return undefined;
}

function read(field: keyof CompanionConfig, viteKey: string, fallback: string): string {
  const fromWindow = typeof window !== 'undefined' ? window.COMPANION_CFG?.[field] : undefined;
  return fromWindow ?? viteEnv(viteKey) ?? fallback;
}

export function loadConfig(): CompanionConfig {
  return {
    vapiPublicKey: read('vapiPublicKey', 'VITE_VAPI_PUBLIC_KEY', ''),
    // Proxy base; MAIN PATCHes the live ngrok URL onto the Vapi assistant each
    // launch, but the renderer-side inline assistant still needs a value.
    customLlmUrl: read('customLlmUrl', 'VITE_CUSTOM_LLM_URL', 'http://127.0.0.1:8787'),
    customLlmModel: read('customLlmModel', 'VITE_CUSTOM_LLM_MODEL', 'deepseek-ai/DeepSeek-R1-0528'),
    transcriberModel: read('transcriberModel', 'VITE_TRANSCRIBER_MODEL', 'nova-2'),
    voiceId: read('voiceId', 'VITE_VAPI_VOICE_ID', 'burt'),
    modelUrl: read('modelUrl', 'VITE_LIVE2D_MODEL_URL', './live2d/Haru.model3.json'),
  };
}
