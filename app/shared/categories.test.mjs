// Quick assertions for the layer-name matcher. Run: node shared/categories.test.mjs
import assert from "node:assert/strict";
import {
  classifyLayerName,
  defaultWeights,
  WEIGHT_OPTIONS,
} from "./categories.js";

let passed = 0;
function check(name, expected) {
  assert.equal(classifyLayerName(name), expected, `classify("${name}")`);
  passed++;
}

// Exact names from the real Unit Plan 2.ai file.
check("Walls", "walls");
check("Interiors", "interiors");
check("People", "entourage");
check("Entourage", "entourage");

// Case / whitespace / punctuation insensitivity.
check("walls", "walls");
check("  WALLS  ", "walls");
check("Interior", "interiors");
check("interior_layer", null); // not a clean synonym match
check("People_01", "entourage");
check("Walls 2", "walls"); // indexed duplicate
check("figures", "entourage");

// Non-matching layers are left alone.
check("Layer 01", null);
check("Dimensions", null);
check("", null);

// Weight model sanity.
assert.equal(WEIGHT_OPTIONS.length, 30, "30 weight options");
assert.equal(WEIGHT_OPTIONS[0], 0.1);
assert.equal(WEIGHT_OPTIONS[29], 3.0);
passed++;

assert.deepEqual(defaultWeights(), {
  walls: 2.0,
  interiors: 1.0,
  entourage: 0.5,
});
passed++;

console.log(`✓ all ${passed} category checks passed`);
