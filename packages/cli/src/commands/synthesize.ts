import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert";
import { createAnthropicClient, withLLMTimeout } from "@toto-wolff/core";

const DEFAULT_VAULT_PATH = path.join(os.homedir(), ".toto", "vault");

/** Vault subdirectories scanned for cross-connection synthesis. */
const SYNTHESIS_DIRS = ["Council/Congressional-Records", "P10-Plans", "ADR", "Cabinet", "Signals"] as const;

// P10 Rule 2 — bounds vault scan. Declared locally, not imported from
// mcp-server's SignalIndex: the two packages intentionally don't
// cross-reference constants (see core/src/utils/constants.ts).
const MAX_RECORDS_PER_DIR = 20;
const MAX_RECORD_BYTES = 10_240;
const MAX_SUMMARY_CHARS = 2000;

const SCOUT_MODEL = "claude-haiku-4-5-20251001";
const ANALYST_MODEL = "claude-sonnet-4-6";

const SCOUT_PERSONA = "You are a governance archivist scout. Summarize recurring patterns, themes, and notable items in these vault records in 3-5 sentences. Be specific — name files and decisions. No preamble.";
const ANALYST_PERSONA = `You are a synthesis analyst reviewing summaries from 5 governance vault directories (Council rulings, P10 plans, ADRs, Cabinet records, Signals). Identify cross-cutting patterns: repeated architectural patterns resolved differently across projects, council rulings never referenced in a later P10 plan or commit, ADRs orphaned from follow-up work, and recurring builder-instinct patterns (what consistently recurs, what is consistently avoided).

After your prose analysis, end your response with a delimited block listing concrete references, one per line, in exactly this format:
REF: <dir>/<file-or-topic> | <one-line reason>

If you have no concrete references to cite, omit the REF block entirely.`;

interface PatternRef {
  path: string;
  dir: string;
  reason: string;
}

interface SynthesisRecord {
  date: string;
  pattern_refs: PatternRef[];
  summary: string;
  synthesis_status: "complete" | "degraded";
  tags: string[];
}

interface DirScan {
  dir: string;
  files: string[];
  excerpts: string[];
}

/**
 * Reads up to MAX_RECORDS_PER_DIR .md files from a vault subdirectory.
 * ENOENT is treated as an empty directory, not an error. Per-file read
 * errors are skipped, not fatal to the whole scan.
 */
export async function scanDirectory(dir: string, vaultPath: string): Promise<DirScan> {
  assert(SYNTHESIS_DIRS.includes(dir as (typeof SYNTHESIS_DIRS)[number]), "dir must be a known synthesis directory");

  let entries: string[];
  try {
    entries = (await fs.readdir(path.join(vaultPath, dir))).filter((e) => e.endsWith(".md")).slice(0, MAX_RECORDS_PER_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { dir, files: [], excerpts: [] };
    throw err;
  }

  assert(entries.length <= MAX_RECORDS_PER_DIR, "entries must be bounded by MAX_RECORDS_PER_DIR");

  const excerpts: string[] = [];
  for (let i = 0; i < entries.length; i++) { // P10 Rule 2: bounded by entries.length <= MAX_RECORDS_PER_DIR
    const filename = entries[i];
    if (filename == null) continue;
    try {
      const bytes = await fs.readFile(path.join(vaultPath, dir, filename));
      if (bytes.byteLength > MAX_RECORD_BYTES) continue;
      excerpts.push(bytes.toString("utf8"));
    } catch {
      // unreadable file — skip
    }
  }

  return { dir, files: entries, excerpts };
}

/**
 * Runs a Haiku scout over one directory's excerpts. Failures degrade to a
 * placeholder string rather than throwing — the caller relies on this to
 * keep the outer 5-way fan-out complete under partial failure.
 */
async function runScoutForDir(scan: DirScan, client: ReturnType<typeof createAnthropicClient>): Promise<string> {
  if (scan.excerpts.length === 0) return `[no records in ${scan.dir}]`;

  const prompt = `Records from ${scan.dir}:\n\n${scan.excerpts.join("\n---\n")}`;

  try {
    return await withLLMTimeout(async (opts) => {
      const msg = await client.messages.create(
        {
          model: SCOUT_MODEL,
          max_tokens: 512,
          system: SCOUT_PERSONA,
          messages: [{ role: "user", content: prompt }],
        },
        { signal: opts.signal },
      );
      const block = msg.content[0];
      return block?.type === "text" ? block.text : "";
    }, `scout-${scan.dir}`);
  } catch {
    return `[scan failed: ${scan.dir}]`;
  }
}

/**
 * Fans a Haiku scout out across all 5 synthesis directories. Uses
 * allSettled, not all — one scout's failure must not abort the others,
 * since runScoutForDir's degraded-placeholder path only helps if every
 * dir still gets a slot in the result array.
 */
async function runAllScouts(scans: DirScan[], client: ReturnType<typeof createAnthropicClient>): Promise<string[]> {
  assert(SYNTHESIS_DIRS.length === 5, "SYNTHESIS_DIRS must have exactly 5 entries");
  const settled = await Promise.allSettled(scans.map((scan) => runScoutForDir(scan, client)));
  return settled.map((result, i) => (result.status === "fulfilled" ? result.value : `[scan failed: ${scans[i]?.dir ?? "unknown"}]`));
}

/**
 * Parses "REF: <dir>/<path> | <reason>" lines from analyst response text.
 * Malformed or absent REF lines produce an empty array, not an error.
 */
export function parsePatternRefs(text: string): PatternRef[] {
  const refs: PatternRef[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) { // P10 Rule 2: bounded by lines.length (single LLM response)
    const line = lines[i];
    if (line == null) continue;
    const match = line.match(/^REF:\s*([^/]+)\/([^|]+)\|\s*(.+)$/);
    if (match === null) continue;
    const dir = (match[1] ?? "").trim();
    const refPath = (match[2] ?? "").trim();
    const reason = (match[3] ?? "").trim();
    if (dir.length === 0 || refPath.length === 0 || reason.length === 0) continue;
    refs.push({ path: refPath, dir, reason });
  }
  return refs;
}

/**
 * Runs the single Sonnet synthesis call over all 5 scout summaries.
 * An unparseable or ref-free response is a legal degraded outcome, not
 * an error — the record is still written with pattern_refs: [].
 */
export async function runAnalyst(summaries: string[], client: ReturnType<typeof createAnthropicClient>): Promise<{ text: string; refs: PatternRef[]; degraded: boolean }> {
  assert(summaries.length === 5, "runAnalyst requires exactly 5 summaries, one per synthesis dir");

  const truncated = summaries.map((s) => s.slice(0, MAX_SUMMARY_CHARS));
  const prompt = SYNTHESIS_DIRS.map((dir, i) => `## ${dir}\n${truncated[i] ?? ""}`).join("\n\n");

  const text = await withLLMTimeout(async (opts) => {
    const msg = await client.messages.create(
      {
        model: ANALYST_MODEL,
        max_tokens: 1024,
        system: ANALYST_PERSONA,
        messages: [{ role: "user", content: prompt }],
      },
      { signal: opts.signal },
    );
    const block = msg.content[0];
    return block?.type === "text" ? block.text : "";
  }, "synthesis-analyst");

  assert(text.length > 0, "analyst response must not be empty");

  const refs = parsePatternRefs(text);
  return { text, refs, degraded: refs.length === 0 };
}

/**
 * Writes the Synthesis/YYYY-MM-DD-connections.md record. Creates the
 * Synthesis/ directory if missing. Overwrites an existing same-day record
 * with a stderr warning rather than erroring — manual invocation only.
 */
export async function writeSynthesisRecord(analysis: { text: string; refs: PatternRef[]; degraded: boolean }, vaultPath: string): Promise<string> {
  assert(analysis.text.length > 0, "analysis text must not be empty before write");

  const date = new Date().toISOString().slice(0, 10);
  const synthesisDir = path.join(vaultPath, "Synthesis");
  const filename = `${date}-connections.md`;
  const outPath = path.join(synthesisDir, filename);

  assert(/^\d{4}-\d{2}-\d{2}-connections\.md$/.test(filename), "filename must match the expected synthesis record pattern");

  try {
    await fs.mkdir(synthesisDir, { recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }

  try {
    await fs.access(outPath);
    process.stderr.write(`[toto synthesize] overwriting existing record for today\n`);
  } catch {
    // no existing record for today — proceed
  }

  const record: SynthesisRecord = {
    date,
    pattern_refs: analysis.refs,
    summary: analysis.text,
    synthesis_status: analysis.degraded ? "degraded" : "complete",
    tags: ["synthesis", "toto-wolff", "cross-connection"],
  };

  const refsYaml = record.pattern_refs.length > 0
    ? record.pattern_refs.map((r) => `  - path: "${r.path}"\n    dir: "${r.dir}"\n    reason: "${r.reason.replace(/"/g, '\\"')}"`).join("\n")
    : "[]";

  const body = `---\ndate: "${record.date}"\nsynthesis_status: "${record.synthesis_status}"\npattern_refs:\n${refsYaml}\ntags: [${record.tags.map((t) => `"${t}"`).join(", ")}]\n---\n\n# Synthesis: ${record.date}\n\n${record.summary}\n`;

  await fs.writeFile(outPath, body, "utf8");
  return outPath;
}

/**
 * Entry point for `toto synthesize`. Scans 5 vault directories, runs
 * parallel Haiku scouts, synthesizes cross-cutting patterns with a single
 * Sonnet call, and writes a Synthesis/ vault record. No Opus call — this
 * is synthesis, not a governance gate.
 */
export async function runSynthesize(): Promise<void> {
  const vaultPath = process.env["TOTO_VAULT_PATH"] ?? process.env["VAULT_PATH"] ?? DEFAULT_VAULT_PATH;

  process.stdout.write("toto synthesize\n\n");

  let client: ReturnType<typeof createAnthropicClient>;
  try {
    client = createAnthropicClient();
  } catch (err) {
    process.stderr.write(`synthesize: no API credentials found — ${String(err)}\n`);
    process.exit(1);
    return;
  }

  const scans = await Promise.all(SYNTHESIS_DIRS.map((dir) => scanDirectory(dir, vaultPath)));
  const summaries = await runAllScouts(scans, client);
  const analysis = await runAnalyst(summaries, client);
  const outPath = await writeSynthesisRecord(analysis, vaultPath);

  process.stdout.write(`\nsynthesize: wrote ${outPath} (status=${analysis.degraded ? "degraded" : "complete"}, refs=${analysis.refs.length})\n`);
}
