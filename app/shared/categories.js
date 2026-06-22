// Category model — the single source of truth shared by the UI (labels,
// dropdown defaults) and the bridge/agent logic (layer-name detection).
//
// v1 detection contract: classify strokes by the *name of the layer* they live
// on. A drawing follows the supported convention when its top-level layers are
// named for these categories (synonyms below). Anything that doesn't match is
// left untouched.

/**
 * @typedef {"walls" | "interiors" | "entourage"} CategoryKey
 * @typedef {{ key: CategoryKey, label: string, default: number, synonyms: string[] }} Category
 */

/** @type {Category[]} */
export const CATEGORIES = [
  { key: "walls", label: "Walls", default: 2.0, synonyms: ["wall", "walls"] },
  {
    key: "interiors",
    label: "Interiors",
    default: 1.0,
    synonyms: ["interior", "interiors"],
  },
  {
    key: "entourage",
    label: "Entourage / People",
    default: 0.5,
    // Real files split these across multiple layers (e.g. "People" AND
    // "Entourage") — they all fold into the single entourage category.
    synonyms: [
      "entourage",
      "people",
      "person",
      "persons",
      "figure",
      "figures",
    ],
  },
];

/** Stroke-weight bounds (points), per the product brief. */
export const WEIGHT_MIN = 0.1;
export const WEIGHT_MAX = 3.0;
export const WEIGHT_STEP = 0.1;

/** The 30 selectable weight values, "0.1".."3.0". */
export const WEIGHT_OPTIONS = Array.from({ length: 30 }, (_, i) =>
  Number((WEIGHT_MIN + i * WEIGHT_STEP).toFixed(1))
);

/**
 * Normalize a layer name for matching: lowercase, drop anything that isn't a
 * letter or digit. So "People ", "PEOPLE", "People_01", and "people" all
 * collapse to "people" — but a trailing index like "People 2" becomes
 * "people2" and is handled by the prefix rule in classifyLayerName.
 * @param {string} name
 */
function normalize(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Map a layer name to a category key, or null if it matches none.
 * Matches either an exact synonym ("walls") or a synonym followed by a numeric
 * suffix ("walls2", "people01") so indexed duplicate layers still classify.
 * @param {string} layerName
 * @returns {CategoryKey | null}
 */
export function classifyLayerName(layerName) {
  const n = normalize(layerName);
  if (!n) return null;
  for (const cat of CATEGORIES) {
    for (const syn of cat.synonyms) {
      const s = normalize(syn);
      if (n === s || new RegExp(`^${s}[0-9]*$`).test(n)) {
        return cat.key;
      }
    }
  }
  return null;
}

/** Default weight map, e.g. { walls: 2.0, interiors: 1.0, entourage: 0.5 }. */
export function defaultWeights() {
  /** @type {Record<CategoryKey, number>} */
  const out = /** @type {any} */ ({});
  for (const c of CATEGORIES) out[c.key] = c.default;
  return out;
}
