// Resolves the Illustrator MCP credentials. Precedence:
//   1. A local `.env` file (gitignored) — ILLUSTRATOR_MCP_URL + ILLUSTRATOR_MCP_TOKEN
//      (or ILLUSTRATOR_MCP_AUTH for a full "Bearer …" header).
//   2. ~/.claude.json (mcpServers.illustrator) — auto-synced by `claude mcp add`.
//
// Keeping secrets in `.env` keeps them out of the repo; the ~/.claude.json
// fallback means it still "just works" if you haven't created a .env.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load app/.env (one level up from this file) if present. process.loadEnvFile
// is built into modern Node — no dotenv dependency needed.
const envPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".env"
);
try {
  if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
} catch {
  /* ignore malformed/locked .env — fall back to ~/.claude.json */
}

/**
 * @returns {{ url: string, authorization: string, source: string }}
 */
export function getIllustratorConfig() {
  const url = process.env.ILLUSTRATOR_MCP_URL;
  const token = process.env.ILLUSTRATOR_MCP_TOKEN;
  const auth = process.env.ILLUSTRATOR_MCP_AUTH;
  if (url && (auth || token)) {
    return {
      url,
      authorization: auth || `Bearer ${token}`,
      source: ".env",
    };
  }

  // Fall back to ~/.claude.json
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".claude.json"), "utf8")
    );
    const ill = cfg?.mcpServers?.illustrator;
    if (ill?.url) {
      return {
        url: ill.url,
        authorization: ill.headers?.Authorization ?? "",
        source: "~/.claude.json",
      };
    }
  } catch {
    /* fall through to the error below */
  }

  throw new Error(
    "Illustrator MCP config not found. Set ILLUSTRATOR_MCP_URL and " +
      "ILLUSTRATOR_MCP_TOKEN in app/.env (copy app/.env.example), or register " +
      "the server with `claude mcp add`."
  );
}
