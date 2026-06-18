import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const DEFAULT_VAULT_PATH = path.join(os.homedir(), "Documents", "Obsidian Vault");
const STALE_DAYS = 30;
const MAX_FILES = 500;

interface AuditFinding {
  filePath: string;
  reason: string;
}

/**
 * Return true if the file's mtime is older than STALE_DAYS days from now.
 */
function isStale(mtimeMs: number): boolean {
  const ageMs = Date.now() - mtimeMs;
  return ageMs > STALE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Read a text file and return its content. Returns empty string on ENOENT or
 * read errors so callers can proceed without crashing.
 */
async function readFileSafe(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

/**
 * Scan a directory (non-recursively) for files matching a suffix. Returns up
 * to MAX_FILES entries sorted by name. Returns empty array if the directory
 * does not exist.
 */
async function listFiles(dir: string, suffix: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const results: string[] = [];
    for (let i = 0; i < entries.length && results.length < MAX_FILES; i++) {
      const entry = entries[i];
      if (entry != null && entry.isFile() && entry.name.endsWith(suffix)) {
        results.push(path.join(dir, entry.name));
      }
    }
    return results;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

/**
 * Scan vault P10-Plans/ for .md files older than STALE_DAYS whose content
 * does not contain "status: approved" or "status: blocked" (case-insensitive).
 * Returns one finding per stale file.
 */
async function findStalePlans(vaultPath: string): Promise<AuditFinding[]> {
  const plansDir = path.join(vaultPath, "P10-Plans");
  const files = await listFiles(plansDir, ".md");
  const findings: AuditFinding[] = [];

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    if (filePath == null) {
      continue;
    }
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      continue;
    }
    if (!isStale(stat.mtimeMs)) {
      continue;
    }
    const content = await readFileSafe(filePath);
    const lower = content.toLowerCase();
    const hasTerminalStatus =
      lower.includes("status: approved") || lower.includes("status: blocked");
    if (!hasTerminalStatus) {
      findings.push({
        filePath,
        reason: `stale plan (last modified ${new Date(stat.mtimeMs).toISOString().slice(0, 10)}) with no approved/blocked status`,
      });
    }
  }

  return findings;
}

/**
 * Extract all path-like tokens from a ruling file's content. A path token is
 * any word containing "/" that looks like a relative path segment (no
 * protocol prefix). Bounded to first 1000 tokens to keep cost O(1).
 */
function extractPathRefs(content: string): string[] {
  const tokens = content.split(/\s+/);
  const refs: string[] = [];
  const limit = Math.min(tokens.length, 1000);
  for (let i = 0; i < limit; i++) {
    const tok = tokens[i] ?? "";
    if (tok.includes("/") && !tok.includes("://") && tok.length > 2) {
      refs.push(tok.replace(/[`'"*]/g, ""));
    }
  }
  return refs;
}

/**
 * Check whether any of the path refs extracted from a ruling actually exist
 * on disk. An orphaned ruling is one where at least one extracted path ref
 * resolves to an absolute path that does not exist under the vault, AND none
 * of the refs resolve to an existing path.
 *
 * Heuristic: if every ref is missing from the vault, the ruling is orphaned.
 * If at least one ref exists the ruling is still live.
 */
async function isOrphanedRuling(
  filePath: string,
  vaultPath: string
): Promise<boolean> {
  const content = await readFileSafe(filePath);
  const refs = extractPathRefs(content);
  if (refs.length === 0) {
    return false;
  }

  let anyExists = false;
  const vaultRoot = vaultPath.endsWith(path.sep) ? vaultPath : vaultPath + path.sep;
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i] ?? "";
    // Clamp to vault — never probe paths outside it (filesystem oracle risk)
    const raw = ref.startsWith("/") ? ref.slice(1) : ref;
    const candidate = path.resolve(vaultPath, raw);
    if (!candidate.startsWith(vaultRoot) && candidate !== vaultPath) {
      continue;
    }
    try {
      await fs.access(candidate);
      anyExists = true;
      break;
    } catch {
      // not found — continue
    }
  }

  return !anyExists;
}

/**
 * Scan vault Council/Congressional-Records/ for .md rulings where all
 * extracted path references are missing from the vault (orphaned heuristic).
 * Returns one finding per orphaned ruling.
 */
async function findOrphanedRulings(vaultPath: string): Promise<AuditFinding[]> {
  const recordsDir = path.join(vaultPath, "Council", "Congressional-Records");
  const files = await listFiles(recordsDir, ".md");
  const findings: AuditFinding[] = [];

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    if (filePath == null) {
      continue;
    }
    const orphaned = await isOrphanedRuling(filePath, vaultPath);
    if (orphaned) {
      findings.push({
        filePath,
        reason: "orphaned ruling — all referenced paths are missing from vault",
      });
    }
  }

  return findings;
}

/**
 * Run the audit command. Scans vault for stale P10 plans and orphaned council
 * rulings. Prints each finding with file path and reason. Always exits 0
 * (audit is informational).
 */
export async function runAudit(): Promise<void> {
  const vaultPath = process.env["VAULT_PATH"] ?? DEFAULT_VAULT_PATH;

  process.stdout.write("toto audit\n\n");

  const [stalePlans, orphanedRulings] = await Promise.all([
    findStalePlans(vaultPath),
    findOrphanedRulings(vaultPath),
  ]);

  const total = stalePlans.length + orphanedRulings.length;

  if (stalePlans.length > 0) {
    process.stdout.write(`Stale P10 plans (${stalePlans.length}):\n`);
    for (let i = 0; i < stalePlans.length; i++) {
      const f = stalePlans[i];
      if (f != null) {
        process.stdout.write(`  ${f.filePath}\n    reason: ${f.reason}\n`);
      }
    }
    process.stdout.write("\n");
  }

  if (orphanedRulings.length > 0) {
    process.stdout.write(`Orphaned council rulings (${orphanedRulings.length}):\n`);
    for (let i = 0; i < orphanedRulings.length; i++) {
      const f = orphanedRulings[i];
      if (f != null) {
        process.stdout.write(`  ${f.filePath}\n    reason: ${f.reason}\n`);
      }
    }
    process.stdout.write("\n");
  }

  if (total === 0) {
    process.stdout.write("audit: no findings\n");
  } else {
    process.stdout.write(`audit: ${total} finding(s) — review and clean up\n`);
  }
}
