import { join } from "node:path";
import assert from "node:assert";
import { VaultServiceV2 } from "@toto-wolff/core";

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
async function loadSignalIndex(vault: VaultServiceV2, signalsDir: string): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  // listDir() already returns [] for a missing directory; other errors propagate.
  const entries = (await vault.listDir(signalsDir)).filter((e) => e.endsWith(".md")).slice(0, MAX_SIGNALS);
  for (let i = 0; i < entries.length; i++) { // P10 Rule 2: bounded by entries.length <= MAX_SIGNALS
    const entry = entries[i];
    if (entry == null) continue;
    let raw: string | null;
    try {
      raw = await vault.read(join(signalsDir, entry));
    } catch {
      continue;
    }
    if (raw === null) continue;
    // MAX_FILE_BYTES is a byte-size cap; re-derive UTF-8 byte length from
    // the decoded string rather than truncating on character count.
    if (Buffer.byteLength(raw, "utf8") > MAX_FILE_BYTES) continue;
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

  const signalsDir = "Signals";
  const plansDir = "P10-Plans";
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const vault = await VaultServiceV2.create({ backend: "file", options: { rootPath: vaultPath } });
  const signalIndex = await loadSignalIndex(vault, signalsDir);

  // listDir() already returns [] for a missing directory; other errors propagate.
  const entries = (await vault.listDir(plansDir)).filter((e) => e.endsWith(".md")).slice(0, MAX_PLANS);

  let checked = 0;
  const contradictions: ContradictionEntry[] = [];

  for (let i = 0; i < entries.length; i++) { // P10 Rule 2: bounded by entries.length <= MAX_PLANS
    const entry = entries[i];
    if (entry == null) continue;
    let raw: string | null;
    try {
      raw = await vault.read(join(plansDir, entry));
    } catch {
      continue;
    }
    if (raw === null) continue;
    // MAX_FILE_BYTES is a byte-size cap; re-derive UTF-8 byte length from
    // the decoded string rather than truncating on character count.
    if (Buffer.byteLength(raw, "utf8") > MAX_FILE_BYTES) continue;
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
