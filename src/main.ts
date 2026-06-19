// src/main.ts — Electron MAIN process entry. Boots a secure window, gates the macOS mic via
// TCC, installs Chromium permission handlers, registers all typed IPC, and a summon shortcut.
//
// Ordering matters: session permission handlers + the mic TCC prompt run INSIDE whenReady,
// BEFORE the window is created, so the renderer's getUserMedia is never raced/denied.
import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';

import { ensureMicAccess, installPermissionHandlers } from './main/mic';
import { registerIpcHandlers } from './main/ipc';
import { createWindow, registerSummonShortcut, unregisterShortcuts } from './main/window';
import { cancelAllRuns } from './main/orchestrator';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// IPC handlers are stateless and safe to register before windows exist.
registerIpcHandlers();

app.whenReady().then(async () => {
  // 1. Chromium-level media permission grant for the renderer's getUserMedia (request+check).
  installPermissionHandlers();

  // 2. macOS TCC mic consent up-front (surfaces the system prompt before any Vapi call).
  const micStatus = await ensureMicAccess();
  if (micStatus !== 'granted') {
    console.warn(
      `[main] microphone access is '${micStatus}'. The renderer must prompt the user to ` +
        `enable it in System Settings and relaunch.`,
    );
  }

  // 3. Secure window + summon shortcut.
  createWindow();
  registerSummonShortcut();

  app.on('activate', () => {
    // macOS: re-create a window when the dock icon is clicked and none are open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS (menu bar stays active until Cmd+Q).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  unregisterShortcuts();
  cancelAllRuns();
});
