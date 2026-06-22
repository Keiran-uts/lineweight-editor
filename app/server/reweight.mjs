// Re-weight engine — drives the Illustrator MCP (see REWEIGHT-ALGORITHM.md).
//
// Phase 4 splits the work into two stages so the user can confirm first:
//   planReweight()  → open + classify, return a proposed plan (NO changes)
//   applyReweight() → apply the confirmed plan's weights + export a copy
//
// Detection is layer-name first (shared/categories.js); if no layer matches,
// it falls back to clustering current stroke widths into 3 bands.

import path from "node:path";
import { IllustratorMcp } from "./mcp-client.mjs";
import { classifyLayerName, CATEGORIES } from "../shared/categories.js";

const CATS = /** @type {const} */ (["walls", "interiors", "entourage"]);
const LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

// Windows export-path roots the MCP will write to (see Phase 0 findings).
function exportRootAllowed(dir) {
  const home = (process.env.USERPROFILE ?? "").toLowerCase();
  const d = dir.toLowerCase();
  if (home && (d === home || d.startsWith(home + "\\"))) {
    const tempOk = d.includes("\\appdata\\local\\temp");
    const blocked = ["\\appdata\\roaming", "\\appdata\\local"];
    if (!tempOk && blocked.some((b) => d.includes(b))) return false;
    return true;
  }
  return /^[d-e]:\\/.test(d); // D:\ or E:\
}

function validateInput(filePath) {
  const parsed = path.parse(filePath);
  if (parsed.ext.toLowerCase() !== ".ai") {
    throw new Error(`Not an Illustrator file: ${parsed.base}`);
  }
  if (!exportRootAllowed(parsed.dir)) {
    throw new Error(
      `Can't write the edited copy to "${parsed.dir}". Move the file under your ` +
        `user folder (Documents/Downloads) or a D:/E: drive and try again.`
    );
  }
  return parsed;
}

/**
 * Stage 1 — open the document and propose a classification. Makes no changes.
 * @param {{ filePath: string }} job
 * @param {(e:{phase:string,[k:string]:any})=>void} onProgress
 * @returns {Promise<{plan: any}>}
 */
export async function planReweight(job, onProgress = () => {}) {
  const parsed = validateInput(job.filePath);
  const mcp = new IllustratorMcp();

  onProgress({ phase: "opening", file: parsed.base });
  try {
    await mcp.callTool("OpenDocument", { filePath: job.filePath });
  } catch (err) {
    throw new Error(
      `Couldn't open "${parsed.base}" in Illustrator — it may have been moved, ` +
        `renamed, or is open elsewhere. (${err?.message ?? err})`
    );
  }

  onProgress({ phase: "detecting" });
  const layers = await listLayers(mcp);

  const matched = layers.filter((l) => classifyLayerName(l.name));
  const plan =
    matched.length > 0
      ? await planByLayers(mcp, layers)
      : await planByBanding(mcp, layers);

  onProgress({ phase: "review", plan });
  return { plan };
}

/**
 * Stage 2 — apply a confirmed plan and export the edited copy.
 * @param {{ filePath:string, plan:any, weights:{walls:number,interiors:number,entourage:number} }} job
 * @param {(e:{phase:string,[k:string]:any})=>void} onProgress
 */
export async function applyReweight(job, onProgress = () => {}) {
  const parsed = validateInput(job.filePath);
  const { plan, weights } = job;
  const mcp = new IllustratorMcp();

  // Re-open to be sure the right document is active; uuids are stable within
  // the still-open document from the plan stage.
  await mcp.callTool("OpenDocument", { filePath: job.filePath });

  const summary = planSummary(plan);
  const active = CATS.filter(
    (c) => (plan.categories?.[c]?.uuids ?? []).length > 0
  );
  let step = 0;
  for (const cat of active) {
    step += 1;
    const uuids = plan.categories[cat].uuids;
    onProgress({
      phase: "applying",
      summary,
      detail: `${LABEL[cat]} — ${uuids.length} stroke${uuids.length === 1 ? "" : "s"} at ${weights[cat]} pt`,
      current: step,
      total: active.length,
    });
    await mcp.callTool("SetAppearance", { uuids, strokeWeight: weights[cat] });
  }

  onProgress({ phase: "saving" });
  const requestedName = `${parsed.name} - edited.ai`;
  const res = await mcp.callTool("Export", {
    format: "AI",
    outputPath: path.join(parsed.dir, requestedName),
    collisionStrategy: "autoSuffix",
  });
  // Resolve an absolute path from whatever filename was actually written
  // (autoSuffix may have appended "-2" when the target already existed).
  const writtenName =
    typeof res?.details === "string" ? path.basename(res.details) : requestedName;
  const written = path.join(parsed.dir, writtenName);
  const renamed = writtenName.toLowerCase() !== requestedName.toLowerCase();

  onProgress({
    phase: "done",
    outputPath: written,
    renamed,
    summary,
    warnings: plan.warnings ?? [],
  });
  return { outputPath: written, renamed };
}

// ── Layer-name classification ──────────────────────────────────────────────
async function planByLayers(mcp, layers) {
  const categories = emptyCategories();
  const warnings = [];

  for (const layer of layers) {
    const cat = classifyLayerName(layer.name);
    if (!cat) continue;
    const { uuids, livePaint } = await collectLeafPaths(mcp, layer.uuid);
    categories[cat].uuids.push(...uuids);
    categories[cat].sourceLayers.push(layer.name);
    if (livePaint) {
      warnings.push(
        `"${layer.name}" is a Live Paint group — its strokes can't be set ` +
          `automatically. In Illustrator: select it, Object ▸ Live Paint ▸ ` +
          `Expand, then re-run.`
      );
    }
  }
  for (const cat of CATS) categories[cat].count = categories[cat].uuids.length;

  return { method: "layers", categories, warnings };
}

// ── Stroke-weight banding fallback ───────────────────────────────────────────
async function planByBanding(mcp, layers) {
  const categories = emptyCategories();
  const warnings = [];

  // Gather every stroked path in the document and its current width.
  const allUuids = [];
  for (const layer of layers) {
    const { uuids } = await collectLeafPaths(mcp, layer.uuid);
    allUuids.push(...uuids);
  }
  const widths = await getStrokeWidths(mcp, allUuids); // [{uuid, width}]

  if (widths.length === 0) {
    return {
      method: "banding",
      categories,
      warnings: [
        "No named category layers and no stroked paths were found — nothing to " +
          "re-weight. Rename layers to Walls / Interiors / Entourage and retry.",
      ],
    };
  }

  const values = widths.map((w) => w.width);
  const { centroids, assign } = kmeans1d(values, 3);
  // Order bands heaviest → lightest, map to walls / interiors / entourage.
  const order = centroids
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c - a.c);
  const bandToCat = {};
  order.forEach((b, rank) => {
    bandToCat[b.i] = CATS[rank]; // rank 0 (heaviest)=walls, 1=interiors, 2=entourage
  });

  for (const { uuid, width } of widths) {
    const band = assign(width);
    const cat = bandToCat[band];
    if (cat) categories[cat].uuids.push(uuid);
  }

  // Annotate each category with its width band for the preview.
  for (const cat of CATS) {
    const us = new Set(categories[cat].uuids);
    const ws = widths.filter((w) => us.has(w.uuid)).map((w) => w.width);
    categories[cat].count = ws.length;
    categories[cat].band = ws.length
      ? { min: round(Math.min(...ws)), max: round(Math.max(...ws)) }
      : null;
  }

  if (centroids.length < 3) {
    warnings.push(
      `Only ${centroids.length} distinct stroke-weight band(s) found — the ` +
        `weight hierarchy is shallow, so review the split carefully.`
    );
  }
  warnings.push(
    "No named layers found — strokes were grouped by current weight (heaviest " +
      "→ Walls, lightest → Entourage). Check the split below before applying."
  );

  return { method: "banding", categories, warnings };
}

// Read stroke widths for many uuids, in chunks. Skips paths with no stroke.
async function getStrokeWidths(mcp, uuids, chunk = 80) {
  const out = [];
  for (let i = 0; i < uuids.length; i += chunk) {
    const batch = uuids.slice(i, i + chunk);
    const res = await mcp.callTool("GetVisualAppearance", { uuids: batch });
    for (const item of res?.visual_appearance ?? []) {
      const p = item.properties ?? {};
      if (!p.has_stroke) continue;
      const w = p.stroke_stack?.[0]?.width;
      if (typeof w === "number") out.push({ uuid: item.uuid, width: w });
    }
  }
  return out;
}

// Weighted 1-D k-means (Lloyd's). Collapses k to the number of distinct values.
function kmeans1d(values, k, iters = 60) {
  const uniq = [...new Set(values)].sort((a, b) => a - b);
  const realK = Math.min(k, uniq.length);
  // Spread initial centroids across the unique range.
  let centroids = Array.from({ length: realK }, (_, i) =>
    uniq[Math.round((i * (uniq.length - 1)) / Math.max(1, realK - 1))]
  );

  const nearest = (v, cs) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < cs.length; i++) {
      const d = Math.abs(v - cs[i]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };

  for (let it = 0; it < iters; it++) {
    const sums = new Array(realK).fill(0);
    const counts = new Array(realK).fill(0);
    for (const v of values) {
      const c = nearest(v, centroids);
      sums[c] += v;
      counts[c] += 1;
    }
    let moved = false;
    const next = centroids.map((c, i) => {
      if (counts[i] === 0) return c;
      const m = sums[i] / counts[i];
      if (m !== c) moved = true;
      return m;
    });
    centroids = next;
    if (!moved) break;
  }
  return { centroids, assign: (v) => nearest(v, centroids) };
}

// ── Shared MCP helpers ───────────────────────────────────────────────────────
async function listLayers(mcp) {
  const layers = [];
  const seen = new Set();
  let res = await mcp.callTool("GetCanvasStructure", { maxDepth: 0 });
  collectLayerNodes(res, layers, seen);
  let guard = 0;
  while (res?.truncated && Array.isArray(res.remaining_uuids) && guard++ < 20) {
    res = await mcp.callTool("GetCanvasStructure", {
      uuids: res.remaining_uuids,
      maxDepth: 0,
    });
    collectLayerNodes(res, layers, seen);
  }
  return layers;
}

function collectLayerNodes(res, out, seen) {
  for (const node of res?.objects_basic_details ?? []) {
    if (node.object_type === "layer" && !seen.has(node.uuid)) {
      seen.add(node.uuid);
      out.push({ name: node.name, uuid: node.uuid });
    }
  }
}

async function collectLeafPaths(mcp, layerUuid) {
  const uuids = [];
  let livePaint = false;
  const res = await mcp.callTool("GetObjectStructure", {
    uuids: [layerUuid],
    includeTypes: ["path", "compound_path"],
    maxDepth: -1,
  });
  for (const struct of res?.structures ?? []) walkPaths(struct, uuids);

  if (uuids.length === 0) {
    const raw = await mcp.callTool("GetObjectStructure", {
      uuids: [layerUuid],
      maxDepth: 2,
    });
    livePaint = hasPlugin(raw);
  }
  return { uuids, livePaint };
}

function walkPaths(node, out) {
  if (!node) return;
  if (node.type === "path" || node.type === "compound_path") out.push(node.uuid);
  for (const c of node.children ?? []) walkPaths(c, out);
}

function hasPlugin(res) {
  let found = false;
  const visit = (n) => {
    if (!n) return;
    if (n.type === "plugin" || n.object_type === "plugin") found = true;
    for (const c of n.children ?? []) visit(c);
  };
  for (const s of res?.structures ?? res?.objects_basic_details ?? []) visit(s);
  return found;
}

// ── small utils ──
function emptyCategories() {
  return {
    walls: { count: 0, uuids: [], sourceLayers: [], band: null },
    interiors: { count: 0, uuids: [], sourceLayers: [], band: null },
    entourage: { count: 0, uuids: [], sourceLayers: [], band: null },
  };
}

function planSummary(plan) {
  return {
    method: plan.method,
    walls: plan.categories?.walls?.count ?? 0,
    interiors: plan.categories?.interiors?.count ?? 0,
    entourage: plan.categories?.entourage?.count ?? 0,
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}
