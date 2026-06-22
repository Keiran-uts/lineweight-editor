// LineWeight Editor — local bridge (Node/Express)
//
// Why this exists: a browser-sandboxed React app can only see a file's *name*,
// never its absolute path, and it can't talk to the Illustrator MCP. This local
// bridge fills both gaps. In Phase 0b it does one job: pop a native OS file
// dialog and return the chosen file's absolute path back to the UI.
//
// The file dialog is driven through Windows PowerShell's System.Windows.Forms
// OpenFileDialog, spawned in STA mode (required for the WinForms dialog). This
// keeps the bridge dependency-free of any native modules — no Electron/Tauri.

import express from "express";
import cors from "cors";
import { spawn } from "node:child_process";
import path from "node:path";
import { planReweight, applyReweight } from "./reweight.mjs";

const PORT = process.env.BRIDGE_PORT ? Number(process.env.BRIDGE_PORT) : 8787;

const app = express();
app.use(cors());
app.use(express.json());

/**
 * Opens a native "Open File" dialog (Windows) and resolves with the selected
 * absolute path, or null if the user cancelled.
 */
function pickFileNative({ title = "Select an Illustrator file", filter } = {}) {
  const dialogFilter =
    filter ?? "Illustrator files (*.ai)|*.ai|All files (*.*)|*.*";

  // A tiny WinForms script. We print a sentinel-prefixed line so we can
  // distinguish the real result from any stray PowerShell noise on stdout.
  const ps = [
    "Add-Type -AssemblyName System.Windows.Forms | Out-Null",
    "$dlg = New-Object System.Windows.Forms.OpenFileDialog",
    `$dlg.Title = '${title.replace(/'/g, "''")}'`,
    `$dlg.Filter = '${dialogFilter.replace(/'/g, "''")}'`,
    "$dlg.Multiselect = $false",
    // Force the dialog in front of other windows.
    "$top = New-Object System.Windows.Forms.Form",
    "$top.TopMost = $true",
    "$result = $dlg.ShowDialog($top)",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output ('PICKED:' + $dlg.FileName) } else { Write-Output 'CANCELLED' }",
  ].join("; ");

  // If the dialog is never answered (e.g. the user walks away, or an automated
  // client triggered it), don't block forever — kill the child and report it
  // as cancelled so the request can resolve cleanly.
  const TIMEOUT_MS = 120_000;

  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-STA", "-NonInteractive", "-Command", ps],
      { windowsHide: true }
    );

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, TIMEOUT_MS);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return resolve(null);
      if (code !== 0) {
        return reject(
          new Error(`file dialog exited with code ${code}: ${stderr.trim()}`)
        );
      }
      const line = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.startsWith("PICKED:") || l === "CANCELLED");

      if (!line || line === "CANCELLED") return resolve(null);
      resolve(line.slice("PICKED:".length));
    });
  });
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "lineweight-bridge", port: PORT });
});

// Phase 0b proof endpoint: open the native dialog, return the real path.
app.get("/api/pick-file", async (_req, res) => {
  try {
    const filePath = await pickFileNative();
    if (!filePath) return res.json({ cancelled: true });

    const parsed = path.parse(filePath);
    res.json({
      cancelled: false,
      path: filePath,
      name: parsed.base,
      dir: parsed.dir,
      ext: parsed.ext.toLowerCase(),
    });
  } catch (err) {
    console.error("[pick-file] error:", err);
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

// NDJSON progress streaming helper: each line is a JSON event ({ phase, ... }).
function streamJob(res, runner) {
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  const send = (event) => res.write(JSON.stringify(event) + "\n");
  return runner(send)
    .catch((err) => {
      console.error("[job] error:", err);
      send({ phase: "error", message: String(err?.message ?? err) });
    })
    .finally(() => res.end());
}

// Phase 4 stage 1: classify the document and return a plan to confirm. No edits.
app.post("/api/plan", (req, res) => {
  const { filePath } = req.body ?? {};
  if (!filePath) return res.status(400).json({ error: "filePath is required" });
  streamJob(res, (send) => planReweight({ filePath }, send));
});

// Phase 4 stage 2: apply a confirmed plan and export the edited copy.
app.post("/api/apply", (req, res) => {
  const { filePath, plan, weights } = req.body ?? {};
  if (!filePath || !plan || !weights) {
    return res
      .status(400)
      .json({ error: "filePath, plan and weights are required" });
  }
  streamJob(res, (send) => applyReweight({ filePath, plan, weights }, send));
});

// Reveal a file in Windows Explorer (selects it). Used by the "Open folder"
// button on success.
app.post("/api/reveal", (req, res) => {
  const { path: filePath } = req.body ?? {};
  if (!filePath) return res.status(400).json({ error: "path is required" });
  try {
    // explorer.exe interprets its own quoting; spawn without shell.
    spawn("explorer.exe", [`/select,${filePath}`], { windowsHide: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

const server = app.listen(PORT, () => {
  console.log(`[bridge] listening on http://localhost:${PORT}`);
});

// Make re-launching idempotent: if a bridge is already up, don't crash.
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`[bridge] already running on :${PORT} — reusing it.`);
    process.exit(0);
  }
  throw err;
});
