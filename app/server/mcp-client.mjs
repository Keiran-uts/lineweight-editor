// Minimal MCP (Streamable HTTP) client for the Adobe Illustrator MCP server.
//
// Credentials come from getIllustratorConfig() (config.mjs): a local .env file
// first, else ~/.claude.json. Re-read on each connect so a rotated token is
// picked up without restarting the bridge.
//
// Protocol (verified against the server): POST `initialize` → capture the
// `Mcp-Session-Id` response header → POST `notifications/initialized` → then
// `tools/call`. Tool output arrives as JSON in result.content[0].text.

import { getIllustratorConfig } from "./config.mjs";

export class IllustratorMcp {
  constructor() {
    this.config = getIllustratorConfig();
    this.sessionId = null;
    this.nextId = 1;
  }

  get #headers() {
    const h = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: this.config.authorization,
    };
    if (this.sessionId) h["Mcp-Session-Id"] = this.sessionId;
    return h;
  }

  // Parse either a plain JSON-RPC response or an SSE stream, returning the
  // JSON-RPC message object.
  async #parse(res) {
    const ctype = res.headers.get("content-type") ?? "";
    const body = await res.text();
    if (ctype.includes("text/event-stream")) {
      // Take the last `data:` payload in the stream.
      const dataLines = body
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .filter(Boolean);
      const last = dataLines[dataLines.length - 1];
      return last ? JSON.parse(last) : null;
    }
    return body ? JSON.parse(body) : null;
  }

  async connect() {
    // Re-read config each connect so a rotated token (MCP server restarted) is
    // picked up without restarting the bridge.
    this.config = getIllustratorConfig();
    this.sessionId = null;

    let initRes;
    try {
      initRes = await fetch(this.config.url, {
        method: "POST",
        headers: this.#headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: this.nextId++,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "lineweight-bridge", version: "0.1.0" },
          },
        }),
      });
    } catch {
      throw new Error(
        "Couldn't reach Adobe Illustrator. Make sure Illustrator is open and " +
          "its MCP server is running, then try again."
      );
    }
    if (initRes.status === 401 || initRes.status === 403) {
      throw new Error(
        "Illustrator MCP rejected the access token. Re-run `claude mcp add` " +
          "with the current token (it changes when the MCP server restarts)."
      );
    }
    if (!initRes.ok) {
      throw new Error(`MCP initialize failed: HTTP ${initRes.status}`);
    }
    this.sessionId = initRes.headers.get("mcp-session-id");
    await this.#parse(initRes);

    // Acknowledge initialization (server replies 202, no body).
    await fetch(this.config.url, {
      method: "POST",
      headers: this.#headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
    return this;
  }

  /**
   * Call a tool and return its parsed structured result.
   * Throws on transport errors or tool-reported errors.
   * @param {string} name
   * @param {Record<string, unknown>} args
   */
  async callTool(name, args = {}, _retried = false) {
    if (!this.sessionId) await this.connect();
    let res;
    try {
      res = await fetch(this.config.url, {
        method: "POST",
        headers: this.#headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: this.nextId++,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      });
    } catch {
      throw new Error(
        "Lost connection to Adobe Illustrator. Make sure it's still open, then retry."
      );
    }
    // A stale/expired session or rotated token — reconnect once and retry.
    if ((res.status === 404 || res.status === 401 || res.status === 403) && !_retried) {
      this.sessionId = null;
      return this.callTool(name, args, true);
    }
    if (!res.ok) {
      throw new Error(`${name}: HTTP ${res.status} ${res.statusText}`);
    }
    const msg = await this.#parse(res);
    if (msg?.error) {
      throw new Error(`${name}: ${msg.error.message ?? "MCP error"}`);
    }
    const result = msg?.result;
    if (result?.isError) {
      const text = result.content?.map((c) => c.text).join("\n") ?? "";
      throw new Error(`${name} failed: ${text}`);
    }
    // Tool payloads come back as a JSON string in content[0].text.
    const text = result?.content?.[0]?.text;
    if (typeof text === "string") {
      try {
        return JSON.parse(text);
      } catch {
        return { text };
      }
    }
    return result ?? {};
  }
}
