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

## Hosting the UI (e.g. Vercel) + local bridge

The editing engine must run on the machine that has Illustrator, so the tool
can't be *fully* hosted. But you can host the **UI** and have it talk to a
**bridge running locally** on the user's machine:

1. **Deploy the UI to Vercel**
   - Import the GitHub repo. In **Project → Settings → General**, set
     **Root Directory = `app`** (the Vite app lives in a subfolder).
   - Framework preset auto-detects as **Vite** (`vercel.json` pins it too).
   - Add an **Environment Variable**: `VITE_API_BASE = http://localhost:8787`.
   - Deploy.
2. **Run the bridge locally** on the machine with Illustrator:
   ```
   npm run bridge      # preflights the MCP, then serves :8787
   ```
   with Adobe Illustrator + its MCP server open.
3. Open your Vercel URL. The page reaches the local bridge at
   `http://localhost:8787` (browsers allow HTTPS→`http://localhost`, and the
   bridge sends permissive CORS). The header shows a **Connected to local
   bridge** indicator; if the bridge isn't running it tells you how to start it.

Leaving `VITE_API_BASE` unset (the default) keeps `/api` relative for plain
local use via `npm start`.

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
