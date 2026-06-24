import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import assert from "node:assert";

const DEFAULT_VAULT_PATH = path.join(os.homedir(), ".toto", "vault");
const MAX_SOURCE_FILES = 500; // P10 Rule 2 — upper bound on directory scan per source

/** Directories under VAULT_PATH to ingest as signal sources. */
const SOURCE_DIRS = ["ADR", "P10-Plans"] as const;

/** Maps source directory name to the pattern value written on backfilled records. */
const PATTERN_MAP: Record<string, string> = {
  ADR: "architectural-decision-record",
  "P10-Plans": "p10-approved-plan",
};

/** Maps vault frontmatter status values to SignalRecord verdict values. */
const VERDICT_MAP: Record<string, string> = {
  accepted: "approved",
  approved: "approved",
  blocked: "blocked",
  "revision-required": "revision-required",
  "conditional-approve": "conditional-approve",
};

interface BackfillStats {
  scanned: number;
  written: number;
  skipped: number;
  errors: number;
}

/**
 * Derives a slug from a filename by stripping the .md extension.
 * Used as the SignalRecord id.
 */
function slugFromFilename(filename: string): string {
  assert(filename.length > 0, "filename must be non-empty");
  return filename.endsWith(".md") ? filename.slice(0, -3) : filename;
}

/**
 * Extracts the first scalar value for a given key from a YAML frontmatter
 * block. Returns undefined if the key is absent. Handles quoted and unquoted
 * values. Does not parse nested YAML.
 */
function extractFrontmatterValue(content: string, key: string): string | undefined {
  assert(key.length > 0, "key must be non-empty");
  const match = content.match(new RegExp(`^${key}:\\s*([^\\n]+)`, "m"));
  if (match === null) return undefined;
  return (match[1] ?? "").trim().replace(/^["']|["']$/g, "");
}

/**
 * Extracts the tags array from a YAML frontmatter block.
 * Handles both inline `tags: [a, b]` and block `tags:\n  - a` forms.
 * Returns an empty array when the key is absent or unparseable.
 */
function extractTopicTags(content: string): string[] {
  assert(typeof content === 'string', 'content must be a string');
  // Inline form: tags: [a, b, c]
  const inlineMatch = content.match(/^tags:\s*\[([^\]]*)\]/m);
  if (inlineMatch) {
    return (inlineMatch[1] ?? '').split(',').map((t) => t.trim().replace(/^["']|["']$/g, '')).filter((t) => t.length > 0);
  }
  // Block form: tags:\n  - a\n  - b
  const blockMatch = content.match(/^tags:\s*\n((?:\s+-\s+[^\n]+\n?)+)/m);
  if (blockMatch) {
    return (blockMatch[1] ?? '').split('\n').map((l) => l.replace(/^\s+-\s+/, '').trim().replace(/^["']|["']$/g, '')).filter((t) => t.length > 0);
  }
  return [];
}

/**
 * Computes a short content hash (first 40 hex chars of SHA-256) for a vault
 * record body. Used as the SignalRecord content_hash field.
 */
function contentHash(content: string): string {
  assert(content.length >= 0, "content must be a string");
  return crypto.createHash("sha256").update(content, "utf8").digest("hex").slice(0, 40);
}

/**
 * Reads all .md files from a source directory, capped at MAX_SOURCE_FILES.
 * Returns { filename, content } pairs. ENOENT is treated as empty (source
 * directory may not exist yet).
 */
async function readSourceDir(dir: string): Promise<{ filename: string; content: string }[]> {
  let entries: string[];
  try {
    entries = (await fs.readdir(dir)).filter((e) => e.endsWith(".md")).slice(0, MAX_SOURCE_FILES);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const results: { filename: string; content: string }[] = [];
  for (let i = 0; i < entries.length; i++) { // P10 Rule 2: bounded by entries.length <= MAX_SOURCE_FILES
    const filename = entries[i];
    if (filename == null) continue;
    try {
      const content = await fs.readFile(path.join(dir, filename), "utf8");
      results.push({ filename, content });
    } catch {
      // unreadable file — skip
    }
  }
  return results;
}

/**
 * Writes a typed SignalRecord .md file into the Signals/ directory.
 * Includes pattern and topic_tags so scoreConfidence HIGH tier is reachable.
 */
async function writeSignalRecord(
  signalsDir: string,
  id: string,
  hash: string,
  verdict: string,
  sourceDir: string,
  pattern: string,
  topicTags: string[],
): Promise<void> {
  assert(id.length > 0, "id must be non-empty");
  assert(hash.length > 0, "content_hash must be non-empty");
  assert(pattern.length > 0, "pattern must be non-empty");
  const tagsYaml = topicTags.length > 0 ? `[${topicTags.map((t) => `"${t}"`).join(", ")}]` : "[]";
  const body = `---\nid: "${id}"\ncontent_hash: "${hash}"\nvalid_until: "2027-12-31"\nverdict: "${verdict}"\nsource: "${sourceDir}"\npattern: "${pattern}"\ntopic_tags: ${tagsYaml}\n---\n\n# Signal: ${id}\n\nBackfilled from ${sourceDir}/ by \`toto backfill\`.\n`;
  await fs.writeFile(path.join(signalsDir, `${id}.md`), body, "utf8");
}

/**
 * Run the backfill command. Reads ADR/ and P10-Plans/ under the vault,
 * writes a typed Signals/ record for each .md file that does not already
 * have one. Prints a summary on completion.
 */
export async function runBackfill(): Promise<void> {
  const vaultPath = process.env["VAULT_PATH"] ?? DEFAULT_VAULT_PATH;
  const signalsDir = path.join(vaultPath, "Signals");

  process.stdout.write("toto backfill\n\n");

  // Ensure Signals/ exists
  try {
    await fs.mkdir(signalsDir, { recursive: true });
  } catch (err) {
    process.stderr.write(`backfill: cannot create Signals/ — ${String(err)}\n`);
    process.exit(1);
    return;
  }

  // Read existing signal IDs to avoid duplicates — lowercased for macOS HFS+ case-insensitivity
  let existingIds: Set<string>;
  try {
    const existing = (await fs.readdir(signalsDir)).filter((e) => e.endsWith(".md"));
    existingIds = new Set(existing.map((e) => slugFromFilename(e).toLowerCase()));
  } catch {
    existingIds = new Set();
  }

  const stats: BackfillStats = { scanned: 0, written: 0, skipped: 0, errors: 0 };

  for (let d = 0; d < SOURCE_DIRS.length; d++) { // P10 Rule 2: bounded by SOURCE_DIRS.length === 2
    const sourceDir = SOURCE_DIRS[d];
    if (sourceDir == null) continue;
    const dir = path.join(vaultPath, sourceDir);
    const files = await readSourceDir(dir);

    for (let i = 0; i < files.length; i++) { // P10 Rule 2: bounded by files.length <= MAX_SOURCE_FILES
      const file = files[i];
      if (file == null) continue;
      stats.scanned++;

      const id = slugFromFilename(file.filename);
      if (existingIds.has(id.toLowerCase())) {
        stats.skipped++;
        continue;
      }

      const rawVerdict = extractFrontmatterValue(file.content, "status");
      const verdict = rawVerdict != null ? (VERDICT_MAP[rawVerdict] ?? "conditional-approve") : "conditional-approve";
      const hash = contentHash(file.content);
      const pattern = PATTERN_MAP[sourceDir] ?? "architectural-decision-record";
      const topicTags = extractTopicTags(file.content);

      try {
        await writeSignalRecord(signalsDir, id, hash, verdict, sourceDir, pattern, topicTags);
        existingIds.add(id.toLowerCase());
        stats.written++;
        process.stdout.write(`  + ${id}\n`);
      } catch (err) {
        stats.errors++;
        process.stderr.write(`  ! ${id}: ${String(err)}\n`);
      }
    }
  }

  process.stdout.write(`\nbackfill: scanned=${stats.scanned} written=${stats.written} skipped=${stats.skipped} errors=${stats.errors}\n`);
  if (stats.errors > 0) process.exit(1);
}
