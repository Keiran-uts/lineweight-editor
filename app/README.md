# LineWeight Editor

Batch-adjusts stroke (line) weights in Adobe Illustrator drawings by semantic
category — **Walls**, **Interiors**, **Entourage / People** — so a plan follows
a consistent line-weight hierarchy without manual reselection.

Load an `.ai` file → pick three weights → review the detected classification →
apply. A renamed copy (`<name> - edited.ai`) is written next to the original;
the source is never modified.

## Requirements

- **Adobe Illustrator** open, with its **MCP server** running and registered in
  `~/.claude.json` (the app reads the URL + token from there). Register/refresh:
  ```
  claude mcp add --transport http --header "Authorization: Bearer <token>" \
    --scope user illustrator http://localhost:18412/v1/mcp
  ```
  The token changes when the MCP server restarts — re-run the command and the
  bridge picks up the new token automatically.
- **Node 18+** (developed on Node 24).

### Credentials (`.env`)

The bridge reads the Illustrator MCP URL + token from a local **`.env`** file
first, falling back to `~/.claude.json`. To use `.env`, copy the example and
fill it in (it's gitignored, so it never gets committed):

```
cp app/.env.example app/.env
# then set ILLUSTRATOR_MCP_URL and ILLUSTRATOR_MCP_TOKEN
```

## Run

```
npm install
npm run dev
```

This starts the Vite UI on **http://localhost:5173** and the local bridge on
**:8787** together. Open the UI in a normal browser.

> Don't drive it through an automated/headless browser — clicking **Add file**
> opens a native OS dialog that a headless browser can't complete and will leave
> blocking.

## How detection works

1. **By layer name (preferred).** Layers named `Walls`, `Interiors`,
   `Entourage`, `People` (case/spacing-insensitive; `People` and `Entourage`
   both count as entourage; indexed names like `Walls 2` are fine) are matched
   and every stroke inside is re-weighted.
2. **By stroke weight (fallback).** If no layer matches, current stroke widths
   are clustered into three bands (heaviest → Walls, lightest → Entourage).

Either way you get a **review step** showing the proposed split before anything
changes — confirm or cancel.

## Architecture

```
React UI (Vite, :5173)
  └─ /api/* → Local bridge (Express, :8787)
              ├─ /api/pick-file   native file dialog → absolute path
              ├─ /api/plan        open + classify (no changes)
              ├─ /api/apply       set weights + export "- edited.ai"
              └─ /api/reveal      open the output folder in Explorer
                     │
                     └─ MCP (Streamable HTTP) → Adobe Illustrator
```

- `shared/categories.js` — category model + layer-name matcher (UI + bridge).
- `server/mcp-client.mjs` — minimal MCP HTTP client.
- `server/reweight.mjs` — the engine (see `server/REWEIGHT-ALGORITHM.md`).

## Known limitations (v1)

- **Live Paint groups** can't be re-weighted automatically. The app detects them
  and asks you to expand first (Object ▸ Live Paint ▸ Expand) and re-run.
- Only basic strokes are changed (not multi-stroke graphic-style appearances).
- The output folder must be writable by the MCP: under your user profile,
  `D:\`, or `E:\` (Program Files, AppData\Roaming, network shares are blocked).
- Single file at a time.
