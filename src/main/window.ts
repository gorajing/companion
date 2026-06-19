// src/main/window.ts — secure BrowserWindow creation + the summon/focus globalShortcut.
//
// Security posture (locked per BUILD_GUIDE step 2): contextIsolation ON, sandbox ON,
// nodeIntegration OFF. The renderer reaches MAIN only through the preload contextBridge.
// The MAIN_WINDOW_VITE_* magic constants are injected by @electron-forge/plugin-vite and
// typed via forge.env.d.ts — do NOT redeclare them.
import { BrowserWindow, globalShortcut } from 'electron';
import path from 'node:path';

const SUMMON_ACCELERATOR = 'CommandOrControl+Shift+Space';

export function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // compiled name is .js
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Keep the template's MAIN_WINDOW_VITE_* loading logic (dev server vs packaged file).
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  return mainWindow;
}

/**
 * Register the global summon/toggle shortcut. register() returns false (does not throw)
 * if the accelerator is already taken — we log loud on failure. Call after whenReady.
 */
export function registerSummonShortcut(): void {
  const ok = globalShortcut.register(SUMMON_ACCELERATOR, () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isVisible() && win.isFocused()) {
      win.hide();
    } else {
      win.show();
      win.focus();
    }
  });
  if (!ok) {
    console.error(
      `[main] globalShortcut '${SUMMON_ACCELERATOR}' registration failed (already taken)`,
    );
  }
}

/** Unregister all global shortcuts (call on will-quit). */
export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
}
