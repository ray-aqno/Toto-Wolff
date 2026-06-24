import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert";

const MAX_PLANS = 500; // P10 Rule 2 — upper bound on P10-Plans/ scan
const MAX_SIGNALS = 500; // P10 Rule 2 — upper bound on Signals/ scan
const MAX_FILE_BYTES = 10_240; // P10 Rule 3 — skip oversized files

/** A single detected contradiction between a plan and its cited verdicts. */
export interface ContradictionEntry {
  plan_file: string;
  verdict_id: string;
  issue: string;
}

/** Result of one audit run. */
export interface AuditReport {
  checked: number;
  contradictions: ContradictionEntry[];
  generated_at: string;
}

/**
 * Extracts the session_verdicts list from a plan file's YAML frontmatter.
 * Returns empty array if the field is absent or the plan is not loop-informed.
 */
function extractSessionVerdicts(content: string): string[] {
  assert(typeof content === "string", "content must be a string");
  const loopMatch = content.match(/^loop_informed:\s*(\S+)/m);
  const loopInformed = loopMatch !== null && (loopMatch[1] ?? "").trim().toLowerCase() === "true";
  if (!loopInformed) return [];
  const match = content.match(/^session_verdicts:\s*([^\n]+)/m);
  if (match === null) return [];
  const raw = (match[1] ?? "").trim();
  if (raw === "[]" || raw === "") return [];
  const stripped = raw.replace(/^\[|\]$/g, "");
  return stripped
    .split(/[\s,]+/)
    .map((s) => s.replace(/^["']|["']$/g, "").trim())
    .filter((s) => s.length > 0);
}

/**
 * Extracts the valid_until date string from a signal record's frontmatter.
 * Returns undefined if absent.
 */
function extractValidUntil(content: string): string | undefined {
  assert(typeof content === "string", "content must be a string");
  const match = content.match(/^valid_until:\s*"?([^"\n]+)"?/m);
  if (match === null) return undefined;
  return (match[1] ?? "").trim();
}

/**
 * Loads a map of signal id → valid_until from VAULT_PATH/Signals/.
 * Missing or unreadable files are skipped. Capped at MAX_SIGNALS.
 */
async function loadSignalIndex(signalsDir: string): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  let entries: string[];
  try {
    entries = (await readdir(signalsDir)).filter((e) => e.endsWith(".md")).slice(0, MAX_SIGNALS);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return index;
    throw err;
  }
  for (let i = 0; i < entries.length; i++) { // P10 Rule 2: bounded by entries.length <= MAX_SIGNALS
    const entry = entries[i];
    if (entry == null) continue;
    let raw: string;
    try {
      const bytes = await readFile(join(signalsDir, entry));
      if (bytes.byteLength > MAX_FILE_BYTES) continue;
      raw = bytes.toString("utf8");
    } catch {
      continue;
    }
    // id is the filename slug
    const id = entry.endsWith(".md") ? entry.slice(0, -3) : entry;
    const validUntil = extractValidUntil(raw);
    index.set(id, validUntil ?? "");
  }
  return index;
}

/**
 * Scans all P10-Plans/ .md files with loop_informed: true in their frontmatter.
 * For each cited verdict ID, checks whether the signal exists in Signals/ and
 * has not expired. Flags missing or expired verdicts as contradictions.
 *
 * Pure audit function — does not write to vault. Caller decides what to do
 * with the AuditReport.
 */
export async function auditContradictions(vaultPath: string): Promise<AuditReport> {
  assert(vaultPath.length > 0, "vaultPath must be non-empty");

  const signalsDir = join(vaultPath, "Signals");
  const plansDir = join(vaultPath, "P10-Plans");
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const signalIndex = await loadSignalIndex(signalsDir);

  let entries: string[];
  try {
    entries = (await readdir(plansDir)).filter((e) => e.endsWith(".md")).slice(0, MAX_PLANS);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { checked: 0, contradictions: [], generated_at: today };
    }
    throw err;
  }

  let checked = 0;
  const contradictions: ContradictionEntry[] = [];

  for (let i = 0; i < entries.length; i++) { // P10 Rule 2: bounded by entries.length <= MAX_PLANS
    const entry = entries[i];
    if (entry == null) continue;
    let raw: string;
    try {
      const bytes = await readFile(join(plansDir, entry));
      if (bytes.byteLength > MAX_FILE_BYTES) continue;
      raw = bytes.toString("utf8");
    } catch {
      continue;
    }
    const citedIds = extractSessionVerdicts(raw);
    if (citedIds.length === 0) continue;
    checked++;

    for (let j = 0; j < citedIds.length; j++) { // P10 Rule 2: bounded by citedIds.length (small list)
      const verdictId = citedIds[j];
      if (verdictId == null) continue;

      if (!signalIndex.has(verdictId)) {
        contradictions.push({ plan_file: entry, verdict_id: verdictId, issue: "cited verdict not found in Signals/" });
        continue;
      }

      const validUntil = signalIndex.get(verdictId) ?? "";
      if (validUntil.length > 0 && validUntil < today) {
        contradictions.push({ plan_file: entry, verdict_id: verdictId, issue: `cited verdict expired on ${validUntil}` });
      }
    }
  }

  return { checked, contradictions, generated_at: today };
}
