// src/renderer/session.ts — one sessionId per app launch (used for turnRun +
// memory). Kept tiny and dependency-free.

export const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
