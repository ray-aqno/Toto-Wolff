import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const DEFAULT_VAULT_PATH = path.join(os.homedir(), ".toto", "vault");
const MAX_FILES = 500;

// Real vault records use `chairman_action`; the original bats fixtures assumed
// a `status`/`ruling` schema that predates real records. Check all three so
// this tallies correctly against both, per Arbiter ruling 2026-07-07.
const STATUS_KEYS = ["chairman_action", "status", "decision", "ruling"] as const;

interface ParsedFrontmatter {
  fields: Record<string, string> | null;
  malformed: boolean;
}

interface ReportAggregate {
  sessions: number;
  malformedCount: number;
  dateRange: [string, string] | null;
  statusCounts: Record<string, number>;
}

/**
 * Extract a `---`-fenced frontmatter block by hand (no YAML dependency exists
 * in this repo — matches dashboard_html.ts's parseFileContent convention).
 * Any interior line that doesn't match `key: value` shape, or an unbalanced
 * bracket, or a missing closing fence, marks the block malformed.
 */
function parseFrontmatter(content: string): ParsedFrontmatter {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return { fields: null, malformed: true };

  const fields: Record<string, string> = {};
  let closed = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (line.trim() === "---") {
      closed = true;
      break;
    }
    if (line.trim() === "") continue; // blank lines inside a frontmatter block are valid YAML
    const match = line.match(/^([\w-]+):\s*(.*)$/);
    if (!match) return { fields: null, malformed: true };
    const key = match[1];
    const value = match[2] ?? "";
    if (key === undefined) return { fields: null, malformed: true };
    const opens = (value.match(/[[{]/g) ?? []).length;
    const closes = (value.match(/[\]}]/g) ?? []).length;
    if (opens !== closes) return { fields: null, malformed: true };
    fields[key] = value.trim();
  }

  if (!closed) return { fields: null, malformed: true };
  return { fields, malformed: false };
}

/**
 * List `.md` files in dir, sorted, capped at MAX_FILES. Returns null if dir
 * does not exist (distinct from an empty directory) so the caller can tell
 * "no analytics dir" apart from "dir exists, zero records".
 */
async function listRecordFiles(dir: string): Promise<string[] | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return entries
    .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "index.md")
    .sort()
    .slice(0, MAX_FILES);
}

/**
 * Read each record, parse its frontmatter, and tally status-like fields and
 * date range. First matching key in STATUS_KEYS wins per record; records
 * matching none tally into "(none)" so the total always equals record count.
 */
async function aggregateReport(files: string[], dir: string): Promise<ReportAggregate> {
  let malformedCount = 0;
  const statusCounts: Record<string, number> = {};
  const dates: string[] = [];

  for (const file of files) {
    const content = await fs.readFile(path.join(dir, file), "utf8");
    const { fields, malformed } = parseFrontmatter(content);
    if (malformed || fields === null) {
      malformedCount++;
      continue;
    }
    const dateField = fields["date"];
    if (dateField !== undefined && dateField.length > 0) dates.push(dateField);

    let matchedKey: string | undefined;
    for (const key of STATUS_KEYS) {
      if (fields[key] !== undefined) {
        matchedKey = fields[key];
        break;
      }
    }
    const bucket = matchedKey ?? "(none)";
    statusCounts[bucket] = (statusCounts[bucket] ?? 0) + 1;
  }

  dates.sort();
  const dateRange: [string, string] | null =
    dates.length > 0 ? [dates[0] as string, dates[dates.length - 1] as string] : null;

  return { sessions: files.length, malformedCount, dateRange, statusCounts };
}

/**
 * Build the printed report string. Must contain "report", "session", and a
 * dated line when data exists — asserted by tests/toto-report.bats.
 */
function formatReport(agg: ReportAggregate): string {
  let out = "toto report — Council session summary\n\n";
  out += `sessions: ${agg.sessions}\n`;
  if (agg.dateRange !== null) {
    out += `date range: ${agg.dateRange[0]} .. ${agg.dateRange[1]}\n`;
  }
  out += "status breakdown:\n";
  for (const [key, count] of Object.entries(agg.statusCounts)) {
    out += `  ${key}: ${count}\n`;
  }
  return out;
}

/**
 * Run `toto report`. Scans Council/Congressional-Records for session
 * frontmatter and prints an aggregate summary. Exits 1 if the analytics dir
 * is missing or any record's frontmatter is malformed; exits 0 otherwise.
 */
export async function runReport(): Promise<void> {
  const vaultPath = process.env["TOTO_VAULT_PATH"] ?? process.env["VAULT_PATH"] ?? DEFAULT_VAULT_PATH;
  const recordsDir = path.join(vaultPath, "Council", "Congressional-Records");

  const files = await listRecordFiles(recordsDir);
  if (files === null) {
    process.stderr.write("toto report: no analytics dir found — run /council to generate records\n");
    process.exit(1);
  }

  const agg = await aggregateReport(files, recordsDir);
  if (agg.malformedCount > 0) {
    process.stderr.write(`toto report: parse error — ${agg.malformedCount} record(s) have invalid frontmatter\n`);
    process.exit(1);
  }

  process.stdout.write(formatReport(agg));
}
