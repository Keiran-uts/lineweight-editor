# Re-weight algorithm (Phase 1 — proven)

The core engine: given an input `.ai` and a target weight per category, set the
stroke weight of every stroke in each category and save a renamed copy.
Detection is by **layer name** (v1 contract — see `shared/categories.js`).

Validated live on `Unit Plan 2.ai` (2026-06-19): `Walls`, `Interiors`,
`People`, `Entourage` layers; 14 wall paths and 104 figure paths re-weighted and
verified; renamed copy written with the original untouched.

## Job spec (input)

```
{ filePath: string, weights: { walls: number, interiors: number, entourage: number } }
```

## Procedure (MCP tool calls)

1. **Open** — `OpenDocument({ filePath })`. The source on disk is never
   written back; we only `Export` a copy, so the original stays safe.
2. **List layers** — `GetCanvasStructure({ maxDepth: 0 })` to get top-level
   layer names + uuids. If the response is `truncated`, follow `resume_hint`
   (call again with `uuids: remaining_uuids`) until all layers are known.
3. **Classify** — run each layer name through `classifyLayerName()`. Multiple
   layers may map to one category (e.g. `People` + `Entourage` → entourage).
   Layers matching nothing (e.g. `Layer 01`, `Dimensions`) are skipped.
4. **Collect leaf strokes** — for each matched layer, `GetObjectStructure({
   uuids: [layerUuid], includeTypes: ["path", "compound_path"], maxDepth: -1 })`
   and gather every descendant path/compound_path uuid. Recursion handles
   nested groups. Paginate on `truncated` via the returned group uuids.
   - Do **not** set stroke weight on a group/layer uuid — it does not cascade
     to children in the Illustrator DOM. Always target leaf paths.
5. **Apply** — per category, `SetAppearance({ uuids: [...], strokeWeight })`.
   Batches of many uuids in one call are fine (104 in one call worked). Only
   `strokeWeight` is sent so color/cap/join are preserved.
6. **Export copy** — `Export({ format: "AI", outputPath: "<dir>/<base> - edited.ai",
   collisionStrategy: "autoSuffix" })`. `autoSuffix` yields ` - edited-2.ai`
   etc. when the target exists (the brief's `(2)` rule).
7. **Report** — return the written path (read from the Export `details`).

## Known limitations / edge cases

- **Live Paint groups** (Illustrator `plugin` object, subtype "Live Paint"):
  `Interiors` in the test file is one. `SetAppearance(strokeWeight)` on the
  plugin uuid **reports success but does not change the visible edge strokes**,
  and `GetVisualAppearance` returns no `stroke_stack` for it. v1 must DETECT
  this (a category layer whose only/primary content is a `plugin` object with
  no path/compound_path descendants) and surface a clear message: "Interiors is
  a Live Paint group — expand it in Illustrator (Object ▸ Live Paint ▸ Expand)
  and re-run." Do not silently report success.
- **Export path roots (Windows):** the MCP only writes under the user profile
  (`~`), `D:\`, `E:\`, or Temp. If the input `.ai` sits on a blocked root
  (Program Files, `AppData\Roaming`, a UNC share, …) the Export step fails —
  detect the input's root up front and warn before doing the work.
- **Multi-appearance / graphic-style strokes:** v1 targets the basic stroke.
  Objects with multiple stroke appearances via the Appearance panel are out of
  scope for v1.

## Execution model

In v1 this procedure is executed by the Claude Code agent driving the MCP. The
Illustrator MCP is an HTTP server (`localhost:18412`), so Phase 3 may instead
have the Node bridge speak MCP directly for a fully autonomous UI → bridge →
Illustrator path. The procedure above is identical either way.
