import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert";
import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_PLAN_FILES = 500; // P10 Rule 2 — upper bound on P10-Plans/ scan
const MAX_FILE_BYTES = 10_240; // P10 Rule 3 — skip oversized plan files

/** Shape of one citation match returned by the endpoint. */
interface ReversedEntry {
  plan_file: string;
  loop_informed: boolean;
  cited_ids: string[];
}

/**
 * Extracts the session_verdicts list from a plan file's YAML frontmatter.
 * Handles both inline list ("id1, id2") and YAML block list formats.
 * Returns empty array if the field is absent or unparseable.
 */
function extractCitedIds(content: string): string[] {
  assert(typeof content === "string", "content must be a string");
  // Match: session_verdicts: ["id1","id2"] or session_verdicts: id1, id2
  const match = content.match(/^session_verdicts:\s*([^\n]+)/m);
  if (match === null) return [];
  const raw = (match[1] ?? "").trim();
  if (raw === "[]" || raw === "") return [];
  // Strip JSON array brackets if present
  const stripped = raw.replace(/^\[|\]$/g, "");
  return stripped
    .split(/[\s,]+/)
    .map((s) => s.replace(/^["']|["']$/g, "").trim())
    .filter((s) => s.length > 0);
}

/**
 * Extracts loop_informed boolean from a plan file's YAML frontmatter.
 * Returns false if the field is absent or not "true".
 */
function extractLoopInformed(content: string): boolean {
  assert(typeof content === "string", "content must be a string");
  const match = content.match(/^loop_informed:\s*(\S+)/m);
  if (match === null) return false;
  return (match[1] ?? "").trim().toLowerCase() === "true";
}

/**
 * Scans VAULT_PATH/P10-Plans/ for plan files that cite the given verdict ID
 * in their session_verdicts frontmatter field. Returns all matching entries.
 * 200+[] on no matches (not an error). 500 only on readdir failure.
 */
export async function handleVaultReversed(
  req: IncomingMessage,
  res: ServerResponse,
  vaultPath: string,
): Promise<void> {
  assert(vaultPath.length > 0, "vaultPath must be non-empty");

  // Parse query param ?id=
  const urlStr = req.url ?? "";
  const qIdx = urlStr.indexOf("?");
  const rawParams = qIdx !== -1 ? urlStr.slice(qIdx + 1) : "";
  const params = new URLSearchParams(rawParams);
  const verdictId = params.get("id");

  if (verdictId === null || verdictId.length === 0) {
    res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "missing required param: id" }));
    return;
  }

  // Reject path traversal
  if (verdictId.includes("/") || verdictId.includes("..")) {
    res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "invalid id" }));
    return;
  }

  const plansDir = join(vaultPath, "P10-Plans");
  let entries: string[];
  try {
    entries = (await readdir(plansDir)).filter((e) => e.endsWith(".md")).slice(0, MAX_PLAN_FILES);
  } catch {
    res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "vault read failed" }));
    return;
  }

  const matches: ReversedEntry[] = [];

  for (let i = 0; i < entries.length; i++) { // P10 Rule 2: bounded by entries.length <= MAX_PLAN_FILES
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
    const citedIds = extractCitedIds(raw);
    if (!citedIds.includes(verdictId)) continue;
    matches.push({
      plan_file: entry,
      loop_informed: extractLoopInformed(raw),
      cited_ids: citedIds,
    });
  }

  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(matches));
}
