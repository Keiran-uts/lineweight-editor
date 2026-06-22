# Product Brief — LineWeight Editor for Adobe Illustrator

**Working title:** LineWeight Editor (placeholder)
**Author:** Bro
**Date:** 19 June 2026
**Status:** Draft v1 — product + technical specification

---

## 1. Summary

LineWeight Editor is a desktop-oriented tool, built as a Vite + React app and orchestrated by Claude Code, that batch-adjusts stroke (line) weights in Adobe Illustrator vector drawings. The user loads an `.ai` file, chooses target line weights for three semantic categories — **walls**, **interiors**, and **entourage/people** — and the tool drives Adobe Illustrator (Beta) through an Illustrator MCP connection to detect, re-weight, and re-save the artwork as a new `.ai` file.

The primary user is an architecture/design student or practitioner who produces line drawings (plans, elevations, sections) and needs consistent, standards-compliant line weights without manually selecting and re-stroking objects.

---

## 2. Problem & motivation

Adjusting line weights by hand in Illustrator is slow and error-prone. A typical plan has dozens of strokes that *should* follow a line-weight hierarchy (heavy walls, medium interior elements, light entourage), but in practice weights drift as drawings are edited or imported from CAD. Manually reselecting every wall, every interior line, and every figure to restroke them is repetitive work that scales badly across multiple sheets.

The goal is to compress that workflow into: **load file → pick three weights → run**.

---

## 3. Goals & non-goals

### Goals
- Accept a single `.ai` file as input.
- Let the user set a target line weight per category (walls / interiors / entourage) from `0.1 pt` to `3.0 pt` in `0.1 pt` increments.
- Automatically classify vector strokes into the three categories inside Illustrator.
- Apply the chosen weights and save a new file named `[ORIGINAL NAME] - edited.ai` in the **same folder** as the input.
- Report the output file path back to the user in Claude.
- Present a minimal UI that matches Claude's dark-mode aesthetic.

### Non-goals (v1)
- Editing colours, fills, fonts, or non-stroke properties.
- Batch processing of multiple files at once (single file in v1).
- Cloud processing — this runs locally against a local Illustrator install.
- Manual per-object override UI (a stretch goal, see §10).

---

## 4. User workflow

1. The app opens (launched in / alongside Claude).
2. The user clicks **Add file**, which opens a native file picker, and selects an `.ai` file.
3. The user sets three line weights via dropdowns: **Walls**, **Interiors**, **Entourage / People** — each `0.1`–`3.0 pt` in `0.1` steps.
4. The user clicks **Initiate edits**.
5. The tool opens Adobe Illustrator (Beta) via the Illustrator MCP and opens the input file.
6. The tool detects which strokes are walls, interiors, and entourage/people.
7. The chosen weight is applied to every stroke in each category.
8. The file is saved as `[NAME] - edited.ai` in the input file's folder.
9. Claude returns the output file path to the user.

### UI flow (top to bottom)
`Add file` → `Walls` dropdown → `Interiors` dropdown → `Entourage / People` dropdown → `Initiate edits` button → status / result area.

---

## 5. Design specification (UI/UX)

The interface should be simple and visually consistent with Claude dark mode.

- **Layout:** single vertical column, generous spacing, centred content, max width ~480px.
- **Palette (suggested tokens):**
  - Background `#1F1E1D` / surface `#262624`
  - Border / divider `#3A3937`
  - Primary text `#F5F4F0`, secondary text `#A3A09A`
  - Accent (buttons, focus) — a warm Claude-style orange, e.g. `#D97757`
- **Typography:** system UI / `-apple-system, Segoe UI, sans-serif`; clear hierarchy, no decorative fonts.
- **Components:**
  - *Add file* — dashed drop-zone / button showing the selected filename once chosen.
  - *Three dropdowns* — labelled, default to sensible values (e.g. Walls `2.0`, Interiors `1.0`, Entourage `0.5`), values `0.1`–`3.0` at `0.1` steps (30 options each).
  - *Initiate edits* — full-width primary button, disabled until a file is selected.
  - *Status area* — shows progress states (idle → opening Illustrator → detecting → applying → saving → done) and the final output path with a copy button.
- **States to design:** empty, file-selected, running (with progress), success (path shown), error (clear message + retry).
- **Tone:** calm, minimal, no clutter; one clear action at a time.

---

## 6. System architecture

> **Key architectural reality:** A browser-sandboxed Vite + React app cannot, on its own, read absolute filesystem paths or talk to an MCP server / Illustrator directly. Those capabilities live outside the browser. The app therefore needs a thin local bridge, and Claude Code acts as the agent that drives the Illustrator MCP. The brief below assumes that division of responsibility.

### Components

1. **React UI (Vite)** — collects the file selection and the three weight values; renders status. Runs in a local browser or an embedded webview.
2. **Local bridge (Node/Express)** — small local server that:
   - serves the React build,
   - exposes the native file path of the chosen file (browsers only give a filename, not a path — see §8),
   - receives the "run" request (file path + three weights) and hands it to the agent layer.
3. **Agent / orchestration layer (Claude Code)** — receives the job spec and calls the **Illustrator MCP** to execute the edit. This is where the actual automation logic lives.
4. **Illustrator MCP + Adobe Illustrator (Beta)** — the MCP receives commands and runs **ExtendScript (JSX)** inside Illustrator. On Windows this is via COM automation; on macOS via AppleScript `do javascript`. The JSX does the detection, re-weighting, and save.

### Data flow

```
React UI
  │  { filePath, weights: { walls, interiors, entourage } }
  ▼
Local bridge (Express)
  │  job spec
  ▼
Claude Code (agent)
  │  ExtendScript / MCP tool calls
  ▼
Illustrator MCP ──► Adobe Illustrator (Beta) runs JSX
  │  saves "[NAME] - edited.ai"
  ▼
returns output path ──► UI / Claude
```

### Why this shape
The Illustrator MCP servers in the wild work by generating ExtendScript and executing it inside Illustrator (write JSX to a temp file → run via COM/AppleScript). So the heavy lifting is JSX that runs *inside* Illustrator, and the MCP is the transport. The React app is deliberately thin.

---

## 7. The hard problem: category detection

This is the central technical risk and deserves the most design attention. Vector strokes in an `.ai` file carry **no inherent semantic label** that says "I am a wall." The tool has to infer category. Plan for a layered strategy, from most reliable to least:

1. **Layer / group names (most reliable).** If the artwork uses named layers (e.g. `Walls`, `Interior`, `People`, `Entourage`), classify by membership. This is by far the most robust approach and is common in CAD-exported and well-organised AI files. **Recommend documenting an expected layer-naming convention** as the supported "happy path."
2. **Existing stroke-weight banding.** Walls are usually the heaviest strokes, interiors medium, entourage lightest. Cluster current stroke widths into three bands and map bands → categories. Works when the drawing already has *some* hierarchy.
3. **Colour / swatch grouping.** If categories are colour-coded, group by stroke colour.
4. **Heuristics on geometry.** Walls tend to be long, mostly orthogonal, closed/connected paths; entourage tends to be small, organic, clustered. This is fuzzy and should be a last resort.

**Recommendation for v1:** lead with **layer-name detection** (define the supported convention), fall back to **stroke-weight banding**, and surface a confirmation/preview step so the user can verify the classification before committing. Fully automatic "detect walls vs people" from raw geometry alone is unreliable and should be framed as a research/stretch goal, not a v1 guarantee.

---

## 8. File handling details

- **Native path problem:** an HTML `<input type="file">` exposes only the filename, not the absolute path, for security reasons. To save the edited file "in the same folder," the tool must obtain the real path. Options:
  - Run the picker through the **local bridge / a desktop wrapper** (e.g. an Electron/Tauri shell, or a native OS dialog invoked by the Node bridge) so it returns a full path.
  - Or have the user paste/confirm the folder path.
  - **Recommended:** native dialog via the bridge so the workflow stays one click.
- **Output naming:** `"<basename> - edited.ai"` written to the same directory. If that file already exists, append a counter (`- edited (2)`) or prompt to overwrite (decide and document).
- **Format fidelity:** save as native `.ai` (Illustrator's `saveAs` with `IllustratorSaveOptions`), preserving the original document's version/compatibility settings where possible.
- **Source safety:** never modify the original — open, edit in memory, `saveAs` to the new name. Consider opening a copy to avoid touching the source document at all.

---

## 9. Tech stack

- **Frontend:** Vite + React (+ TypeScript recommended), minimal CSS (CSS variables or Tailwind) for the dark theme.
- **Bridge:** Node + Express (or a Tauri/Electron shell if a true desktop app is preferred — Tauri is lighter).
- **Automation:** Illustrator MCP server (e.g. one of the community ExtendScript-based servers) driving **Adobe Illustrator Beta**.
- **Scripting inside Illustrator:** ExtendScript (JSX).
- **Platform:** assume **Windows** (your environment) → Illustrator automation via COM; keep the JSX portable so macOS (AppleScript) also works later.

---

## 10. Build phases (suggested)

**Phase 0 — Spike / feasibility (de-risk first):**
Confirm the Illustrator MCP can open an `.ai`, change one path's stroke weight, and `saveAs` a renamed copy on your machine. Confirm you can get a native file path into the app. This validates the riskiest assumptions before building UI.

**Phase 1 — Core JSX:**
Write and test the ExtendScript that: opens a file, iterates strokes, applies a weight to a target set, and saves `- edited.ai`. Start with layer-name-based selection.

**Phase 2 — UI:**
Build the React dark-mode interface (add file → 3 dropdowns → initiate → status), wired to mock data.

**Phase 3 — Integration:**
Connect UI → bridge → Claude Code/MCP → JSX. End-to-end with a real file.

**Phase 4 — Detection robustness:**
Add stroke-weight banding fallback and a classification preview/confirm step.

**Phase 5 — Polish:**
Error handling, overwrite logic, progress states, output-path copy button.

---

## 11. Success criteria

- A user can take a real plan `.ai`, set three weights, click once, and get a correctly re-weighted `- edited.ai` in the same folder within a reasonable time.
- Walls/interiors/entourage are weighted as specified with no manual selection, **given a file that follows the supported layer convention.**
- The original file is untouched.
- The output path is clearly reported.

---

## 12. Open questions / decisions needed

1. **Detection contract:** will you commit to a layer-naming convention (most reliable), or must it work on arbitrary unlabelled files (much harder)?
2. **Desktop shell:** plain browser + local bridge, or a packaged Tauri/Electron app (needed for a clean native file dialog and a single launchable program)?
3. **"Opens in Claude":** does the app run as a panel/artifact inside Claude, or as a standalone local app that Claude Code orchestrates? This affects how the UI and the agent communicate.
4. **Overwrite behaviour** when `- edited.ai` already exists.
5. **Stroke vs. appearance:** should weights apply to objects with multiple stroke appearances / graphic styles, or only basic strokes?
6. **Preview/confirm step:** acceptable to add one click for classification review, or must it be fully one-shot?

---

## 13. Risks

- **Auto-classification accuracy** is the biggest risk — raw geometry rarely tells you "wall vs person." Mitigate via layer conventions + a confirm step.
- **Native file paths from the browser** — requires a bridge or desktop wrapper; pure web won't do it.
- **Illustrator Beta + MCP stability** — community MCP servers vary in maturity; pin a working version and test on your machine early (Phase 0).
- **AI file version compatibility** on save — verify round-trip fidelity.

---

## Appendix — References

- illustrator-mcp (krVatsal) — ExtendScript-based MCP, Windows COM / macOS AppleScript: https://github.com/krVatsal/illustrator-mcp
- illustrator-mcp-server (ie3jp) — MCP for reading/manipulating/exporting AI design data (63 tools): https://github.com/ie3jp/illustrator-mcp-server
- illustrator-mcp-server on npm: https://www.npmjs.com/package/illustrator-mcp-server
- Adobe Illustrator MCP overview (Playbooks): https://playbooks.com/mcp/spencerhhubert-adobe-illustrator
