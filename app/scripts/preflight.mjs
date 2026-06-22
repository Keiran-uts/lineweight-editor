// Pre-launch check: is the Illustrator MCP reachable? Prints a clear status
// line either way and always exits 0 — a down MCP shouldn't block the UI from
// starting (the user may open Illustrator after launching).

import { getIllustratorConfig } from "../server/config.mjs";

let ill;
try {
  ill = getIllustratorConfig();
} catch {
  console.log(
    "⚠  Illustrator MCP config not found. Set ILLUSTRATOR_MCP_URL and " +
      "ILLUSTRATOR_MCP_TOKEN in app/.env, or register it with `claude mcp add`."
  );
  process.exit(0);
}

try {
  const res = await fetch(ill.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: ill.authorization ?? "",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "preflight", version: "0.1.0" },
      },
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (res.ok) {
    console.log(`✓  Illustrator MCP reachable at ${ill.url} (from ${ill.source})`);
  } else if (res.status === 401 || res.status === 403) {
    console.log(
      "⚠  Illustrator MCP token rejected — re-run `claude mcp add` with the " +
        "current token (it changes when the MCP server restarts)."
    );
  } else {
    console.log(`⚠  Illustrator MCP responded HTTP ${res.status}.`);
  }
} catch {
  console.log(
    "⚠  Couldn't reach Illustrator MCP. Open Adobe Illustrator with its MCP " +
      "server running, then you can run edits. Starting the UI anyway…"
  );
}
process.exit(0);
