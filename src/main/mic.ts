// src/main/mic.ts — macOS microphone TCC gate + Chromium session permission handlers.
//
// THE BUG this guards (BUILD_GUIDE gotcha): getUserMedia() in the Electron renderer RESOLVES
// with a (silent) MediaStream even when macOS TCC is 'denied'. So permission is gated here in
// MAIN via systemPreferences.getMediaAccessStatus — never inferred from getUserMedia.
//
// Two distinct handler shapes (easy to mix up):
//   - setPermissionRequestHandler callback is (boolean)=>void  (no return value)
//   - setPermissionCheckHandler RETURNS a boolean
// BOTH must be installed or the renderer's getUserMedia can hang or be silently denied.
import {
  session,
  systemPreferences,
  type Session,
  type MediaAccessPermissionRequest,
} from 'electron';
import type { MicStatus } from '../shared/ipc';

/**
 * Check current TCC mic status; if undecided, trigger the system prompt once.
 * Non-darwin platforms have no TCC gate, so report 'granted'.
 */
export async function ensureMicAccess(): Promise<MicStatus> {
  if (process.platform !== 'darwin') return 'granted';
  let status = systemPreferences.getMediaAccessStatus('microphone') as MicStatus;
  console.log(`[mic] initial TCC microphone status: '${status}'`);
  if (status === 'not-determined') {
    // askForMediaAccess prompts ONCE; if already denied it resolves false without prompting
    // and the app must be restarted after the user flips it in System Settings.
    console.log('[mic] requesting microphone access — the macOS permission prompt should appear now…');
    const ok = await systemPreferences.askForMediaAccess('microphone');
    status = ok ? 'granted' : 'denied';
    console.log(`[mic] askForMediaAccess resolved to: '${status}'`);
  } else {
    console.log(`[mic] status is '${status}' (not 'not-determined'), so no prompt will show. ` +
      `If denied/stuck, reset with: tccutil reset Microphone com.github.Electron`);
  }
  return status;
}

/** Read-only status check (no prompt). Used by CH.micStatus. */
export function getMicStatus(): MicStatus {
  if (process.platform !== 'darwin') return 'granted';
  return systemPreferences.getMediaAccessStatus('microphone') as MicStatus;
}

/**
 * Install Chromium-level permission handlers so the renderer's getUserMedia (audio) is
 * granted. MUST run inside whenReady, BEFORE creating the window.
 */
export function installPermissionHandlers(ses: Session = session.defaultSession): void {
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (permission === 'media') {
      // mediaTypes is present for media requests; allow when audio is requested (or when the
      // field is absent, to be permissive for the mic-only flow).
      const d = details as MediaAccessPermissionRequest;
      const wantsAudio =
        !('mediaTypes' in d) || !d.mediaTypes || d.mediaTypes.includes('audio');
      callback(wantsAudio); // (boolean) => void — NO return value
      return;
    }
    callback(false);
  });

  // Different shape: this one RETURNS a boolean.
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media');
}
