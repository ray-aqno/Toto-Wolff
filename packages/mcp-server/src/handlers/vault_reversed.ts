import { join } from "node:path";
import assert from "node:assert";
import type { IncomingMessage, ServerResponse } from "node:http";
import { VaultServiceV2 } from "@toto-wolff/core";

const MAX_PLAN_FILES = 500; // P10 Rule 2 — upper bound on P10-Plans/ scan
const MAX_FILE_BYTES = 10_240; // P10 Rule 3 — skip oversized plan files

let vaultPromise: Promise<VaultServiceV2> | null = null;

/**
 * Lazily construct (and memoize) the V2 vault facade for this vaultPath.
 * On construction failure the memo is cleared so the next call retries.
 */
function getVault(vaultPath: string): Promise<VaultServiceV2> {
  if (vaultPromise === null) {
    vaultPromise = VaultServiceV2.create({ backend: "file", options: { rootPath: vaultPath } }).catch(
      (err: unknown) => {
        vaultPromise = null;
        throw err;
      },
    );
  }
  return vaultPromise;
}

/**
 * Lists P10-Plans/ .md files for this vaultPath, or null if the directory
 * is missing or unreadable — this endpoint's contract treats a missing dir
 * as a failure (500), not an empty match list.
 */
async function listPlanFiles(
  vaultPath: string,
  plansDir: string,
): Promise<{ vault: VaultServiceV2; entries: string[] } | null> {
  try {
    const vault = await getVault(vaultPath);
    const dirExists = await vault.exists(plansDir);
    if (!dirExists) return null;
    const entries = (await vault.listDir(plansDir)).filter((e) => e.endsWith(".md")).slice(0, MAX_PLAN_FILES);
    return { vault, entries };
  } catch {
    return null;
  }
}

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

  const plansDir = "P10-Plans";
  const listed = await listPlanFiles(vaultPath, plansDir);
  if (listed === null) {
    res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "vault read failed" }));
    return;
  }
  const { vault, entries } = listed;

  const matches: ReversedEntry[] = [];

  for (let i = 0; i < entries.length; i++) { // P10 Rule 2: bounded by entries.length <= MAX_PLAN_FILES
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
