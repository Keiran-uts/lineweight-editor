import { useState } from "react";
import "./app.css";
import {
  CATEGORIES,
  WEIGHT_OPTIONS,
  defaultWeights,
} from "../shared/categories.js";

type PickedFile = { path: string; name: string; dir: string; ext: string };
type CategoryKey = "walls" | "interiors" | "entourage";
type Weights = Record<CategoryKey, number>;

type CategoryPlan = {
  count: number;
  uuids: string[];
  sourceLayers: string[];
  band: { min: number; max: number } | null;
};
type Plan = {
  method: "layers" | "banding";
  warnings: string[];
  categories: Record<CategoryKey, CategoryPlan>;
};

type Phase =
  | "idle"
  | "planning"
  | "opening"
  | "detecting"
  | "review"
  | "applying"
  | "saving"
  | "done"
  | "error";

const PHASE_LABEL: Record<string, string> = {
  opening: "Opening in Illustrator…",
  detecting: "Detecting layers…",
  applying: "Applying line weights…",
  saving: "Saving edited copy…",
};

// Read an NDJSON progress stream, dispatching each event.
async function streamNdjson(
  res: Response,
  onEvent: (e: any) => void
): Promise<void> {
  if (!res.body) throw new Error("No response stream from bridge");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
  }
  if (buf.trim()) onEvent(JSON.parse(buf));
}

// Build a PickedFile from a raw absolute path the user typed/pasted. Used as a
// fallback where a native file dialog can't render (e.g. the Claude Code
// preview pane / any automated browser).
function fileFromPath(raw: string): PickedFile | null {
  const clean = raw.trim().replace(/^["']+|["']+$/g, "");
  if (!clean) return null;
  const norm = clean.replace(/\//g, "\\");
  const slash = norm.lastIndexOf("\\");
  const dir = slash >= 0 ? norm.slice(0, slash) : "";
  const base = slash >= 0 ? norm.slice(slash + 1) : norm;
  const dot = base.lastIndexOf(".");
  const ext = dot >= 0 ? base.slice(dot).toLowerCase() : "";
  return { path: norm, name: base, dir, ext };
}

// True inside the Claude Code preview pane (an Electron webview whose UA carries
// "Claude/") or any headless-automation browser. There the OS file dialog opens
// off-screen on the desktop instead of in the pane, so we use the paste-a-path
// fallback. A normal external browser (via `npm start`) keeps the native dialog.
const IS_PREVIEW =
  typeof navigator !== "undefined" &&
  (navigator.webdriver === true || /\bClaude\//.test(navigator.userAgent));

export default function App() {
  const [file, setFile] = useState<PickedFile | null>(null);
  const [picking, setPicking] = useState(false);
  const [manualPath, setManualPath] = useState("");
  const [showManual, setShowManual] = useState(IS_PREVIEW);
  const [weights, setWeights] = useState<Weights>(() => defaultWeights());

  const [phase, setPhase] = useState<Phase>("idle");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [renamed, setRenamed] = useState(false);
  const [applyDetail, setApplyDetail] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const busy = ["planning", "opening", "detecting", "applying", "saving"].includes(
    phase
  );
  const canPlan = !!file && file.ext === ".ai" && !busy && !picking;

  function resetRun() {
    setPhase("idle");
    setPlan(null);
    setSummary(null);
    setOutputPath(null);
    setRenamed(false);
    setApplyDetail(null);
    setWarnings([]);
    setErrorMsg(null);
    setCopied(false);
  }

  async function handleAddFile() {
    // Opens the bridge's native OS file dialog. In the Claude preview pane this
    // renders as a normal Windows dialog on the desktop (in front of Claude) —
    // a native dialog can't draw inside a web pane. The paste-a-path field below
    // stays available as an alternative.
    setPicking(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/pick-file");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Bridge returned ${res.status}`);
      if (!data.cancelled) {
        setFile(data as PickedFile);
        resetRun();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setPicking(false);
    }
  }

  function loadManualPath() {
    const f = fileFromPath(manualPath);
    if (!f) return;
    setFile(f);
    resetRun();
  }

  function handleEvent(e: { phase: Phase; [k: string]: unknown }) {
    setPhase(e.phase);
    if (e.plan) setPlan(e.plan as Plan);
    if (e.summary) setSummary(e.summary);
    if (e.detail) setApplyDetail(e.detail as string);
    if (typeof e.renamed === "boolean") setRenamed(e.renamed);
    if (e.warnings) setWarnings(e.warnings as string[]);
    if (e.outputPath) setOutputPath(e.outputPath as string);
    if (e.phase === "error") setErrorMsg((e.message as string) ?? "Unknown error");
  }

  async function handlePlan() {
    if (!file) return;
    resetRun();
    setPhase("planning");
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: file.path }),
      });
      await streamNdjson(res, handleEvent);
    } catch (err) {
      setPhase("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleApply() {
    if (!file || !plan) return;
    setPhase("applying");
    try {
      const res = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: file.path, plan, weights }),
      });
      await streamNdjson(res, handleEvent);
    } catch (err) {
      setPhase("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function copyPath() {
    if (!outputPath) return;
    await navigator.clipboard.writeText(outputPath);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function revealOutput() {
    if (!outputPath) return;
    await fetch("/api/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: outputPath }),
    }).catch(() => {});
  }

  return (
    <main className="shell">
      <header className="masthead">
        <p className="eyebrow">Adobe Illustrator · batch stroke weights</p>
        <h1 className="title">LINEWEIGHT EDITOR</h1>
        <p className="lede">
          Set wall, interior, and entourage line weights in one click.
        </p>
      </header>

      <section className="card">
        {/* Add file */}
        <button
          className={`dropzone ${file ? "dropzone-filled" : ""}`}
          onClick={handleAddFile}
          disabled={picking || busy}
        >
          {picking ? (
            <span className="dz-text">Waiting for file picker…</span>
          ) : file ? (
            <>
              <span className="dz-name">{file.name}</span>
              <span className="dz-sub">{file.dir}</span>
              {file.ext !== ".ai" && (
                <span className="dz-warn">Not an .ai file — pick another</span>
              )}
            </>
          ) : (
            <>
              <span className="dz-text">Add file</span>
              <span className="dz-sub">
                {IS_PREVIEW
                  ? "Opens a Windows file dialog on your desktop"
                  : "Choose an Illustrator .ai drawing"}
              </span>
            </>
          )}
        </button>

        {/* Paste-a-path fallback (always available; auto-shown in the preview
            pane where a native dialog can't render). */}
        {showManual ? (
          <div className="manual-row">
            <input
              className="manual-input"
              type="text"
              placeholder="Paste a full path, e.g. C:\Users\you\Downloads\Plan.ai"
              value={manualPath}
              spellCheck={false}
              disabled={busy}
              onChange={(e) => setManualPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadManualPath()}
            />
            <button
              className="btn-ghost"
              onClick={loadManualPath}
              disabled={busy || !manualPath.trim()}
            >
              Load
            </button>
          </div>
        ) : (
          <button className="link-btn" onClick={() => setShowManual(true)}>
            …or paste a file path
          </button>
        )}

        {/* Weight dropdowns */}
        <div className="weights">
          {CATEGORIES.map((cat: any) => (
            <label className="weight-row" key={cat.key}>
              <span className="weight-label">{cat.label}</span>
              <div className="select-wrap">
                <select
                  value={weights[cat.key as CategoryKey]}
                  disabled={busy}
                  onChange={(ev) =>
                    setWeights((w) => ({ ...w, [cat.key]: Number(ev.target.value) }))
                  }
                >
                  {WEIGHT_OPTIONS.map((v: number) => (
                    <option key={v} value={v}>
                      {v.toFixed(1)} pt
                    </option>
                  ))}
                </select>
              </div>
            </label>
          ))}
        </div>

        {/* Primary action — depends on phase */}
        {phase === "review" ? (
          <div className="action-row">
            <button className="btn-ghost grow" onClick={resetRun} disabled={busy}>
              Cancel
            </button>
            <button className="btn-primary grow" onClick={handleApply}>
              Confirm &amp; apply
            </button>
          </div>
        ) : (
          <button className="btn-primary" onClick={handlePlan} disabled={!canPlan}>
            {phase === "planning"
              ? "Detecting…"
              : busy
                ? "Working…"
                : "Initiate edits"}
          </button>
        )}

        <StatusArea
          phase={phase}
          plan={plan}
          summary={summary}
          applyDetail={applyDetail}
          renamed={renamed}
          warnings={warnings}
          outputPath={outputPath}
          errorMsg={errorMsg}
          copied={copied}
          onCopy={copyPath}
          onReveal={revealOutput}
          onRetry={handlePlan}
        />
      </section>
    </main>
  );
}

function ProgressSteps({ steps, phase }: { steps: string[]; phase: Phase }) {
  const idx = steps.indexOf(phase);
  const finished = phase === "done";
  return (
    <ol className="steps">
      {steps.map((p, i) => {
        const state =
          finished || i < idx ? "done" : i === idx ? "active" : "todo";
        return (
          <li key={p} className={`step step-${state}`}>
            <span className="step-dot" />
            <span className="step-label">{PHASE_LABEL[p]}</span>
          </li>
        );
      })}
    </ol>
  );
}

function StatusArea(props: {
  phase: Phase;
  plan: Plan | null;
  summary: any;
  applyDetail: string | null;
  renamed: boolean;
  warnings: string[];
  outputPath: string | null;
  errorMsg: string | null;
  copied: boolean;
  onCopy: () => void;
  onReveal: () => void;
  onRetry: () => void;
}) {
  const { phase, plan, summary, applyDetail, renamed, warnings, outputPath, errorMsg } =
    props;

  if (phase === "idle" && !errorMsg) {
    return (
      <p className="hint" aria-live="polite">
        Pick a file and choose weights, then initiate edits.
      </p>
    );
  }

  if (phase === "error") {
    return (
      <div className="status" aria-live="assertive">
        <p className="msg msg-error">⚠ {errorMsg}</p>
        <button className="btn-ghost" onClick={props.onRetry}>
          Retry
        </button>
      </div>
    );
  }

  if (phase === "opening" || phase === "detecting" || phase === "planning") {
    return (
      <div className="status" aria-live="polite">
        <ProgressSteps steps={["opening", "detecting"]} phase={phase} />
      </div>
    );
  }

  if (phase === "review" && plan) {
    return (
      <div className="status">
        <div className="review">
          <span className="badge badge-info">
            {plan.method === "layers"
              ? "Classified by layer name"
              : "Classified by stroke weight"}
          </span>
          <ul className="class-list">
            {CATEGORIES.map((cat: any) => {
              const cp = plan.categories[cat.key as CategoryKey];
              return (
                <li className="class-row" key={cat.key}>
                  <span className="class-name">{cat.label}</span>
                  <span className="class-meta">
                    {cp.count} stroke{cp.count === 1 ? "" : "s"}
                    {plan.method === "layers" && cp.sourceLayers.length
                      ? ` · ${cp.sourceLayers.join(", ")}`
                      : ""}
                    {plan.method === "banding" && cp.band
                      ? ` · ${cp.band.min}–${cp.band.max} pt now`
                      : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        {(plan.warnings ?? []).map((w, i) => (
          <p className="msg msg-warn" key={i}>
            ⚠ {w}
          </p>
        ))}
        <p className="hint">Review the split, then confirm to apply your weights.</p>
      </div>
    );
  }

  // applying / saving / done
  return (
    <div className="status" aria-live="polite">
      <ProgressSteps steps={["applying", "saving"]} phase={phase} />
      {phase === "applying" && applyDetail && (
        <p className="hint">{applyDetail}</p>
      )}
      {warnings.map((w, i) => (
        <p className="msg msg-warn" key={i}>
          ⚠ {w}
        </p>
      ))}
      {phase === "done" && (
        <div className="result">
          <span className="badge badge-ok">Done</span>
          {summary && (
            <p className="hint">
              Re-weighted {summary.walls} wall · {summary.interiors} interior ·{" "}
              {summary.entourage} entourage strokes.
            </p>
          )}
          {renamed && (
            <p className="hint">
              A file with that name already existed — saved as a new copy so
              nothing was overwritten.
            </p>
          )}
          {outputPath && (
            <div className="path-row">
              <code className="mono">{outputPath}</code>
              <div className="path-actions">
                <button className="btn-ghost" onClick={props.onCopy}>
                  {props.copied ? "Copied ✓" : "Copy path"}
                </button>
                <button className="btn-ghost" onClick={props.onReveal}>
                  Open folder
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
