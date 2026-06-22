// Where the bridge lives.
//
// - Local dev / `npm start`: leave VITE_API_BASE unset → calls are relative
//   ("/api/…"), served same-origin (Vite proxy in dev, the bridge in prod).
// - Hosted UI (e.g. Vercel): set VITE_API_BASE=http://localhost:8787 at build
//   time → the hosted page calls the bridge running on the user's own machine.
//   Browsers allow HTTPS pages to reach http://localhost, and the bridge sends
//   permissive CORS headers, so this works.
export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ??
  "";

/** Whether the UI is configured to talk to a separate (local) bridge origin. */
export const REMOTE_BRIDGE = API_BASE !== "";

/** Build a full API URL for a "/api/…" path. */
export const api = (path: string): string => `${API_BASE}${path}`;
