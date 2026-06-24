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
 * All credential candidates, in priority order: `.env` first, then
 * ~/.claude.json. Deduped by url+authorization. The client tries each in turn
 * so a stale token in one source self-heals from the other (e.g. `.env` token
 * went stale but `claude mcp add` refreshed ~/.claude.json).
 * @returns {{ url: string, authorization: string, source: string }[]}
 */
export function getIllustratorConfigs() {
  const candidates = [];

  // 1. .env
  const url = process.env.ILLUSTRATOR_MCP_URL;
  const token = process.env.ILLUSTRATOR_MCP_TOKEN;
  const auth = process.env.ILLUSTRATOR_MCP_AUTH;
  if (url && (auth || token)) {
    candidates.push({
      url,
      authorization: auth || `Bearer ${token}`,
      source: ".env",
    });
  }

  // 2. ~/.claude.json
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".claude.json"), "utf8")
    );
    const ill = cfg?.mcpServers?.illustrator;
    if (ill?.url) {
      candidates.push({
        url: ill.url,
        authorization: ill.headers?.Authorization ?? "",
        source: "~/.claude.json",
      });
    }
  } catch {
    /* ignore */
  }

  // Dedupe identical url+token pairs (common: .env and ~/.claude.json match).
  const seen = new Set();
  const unique = candidates.filter((c) => {
    const key = `${c.url}|${c.authorization}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (unique.length === 0) {
    throw new Error(
      "Illustrator MCP config not found. Set ILLUSTRATOR_MCP_URL and " +
        "ILLUSTRATOR_MCP_TOKEN in app/.env (copy app/.env.example), or register " +
        "the server with `claude mcp add`."
    );
  }
  return unique;
}

/** The highest-priority candidate (used by the preflight check). */
export function getIllustratorConfig() {
  return getIllustratorConfigs()[0];
}
