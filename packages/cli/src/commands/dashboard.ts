import * as http from "node:http";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import * as os from "node:os";
import assert from "node:assert";

const DEFAULT_VAULT_PATH = join(os.homedir(), ".toto", "vault");
const MAX_FILES = 500;

interface Session {
  date: string;
  status: string | null;
  excerpt: string;
  filename: string;
}

interface BlockedItem {
  type: "council" | "p10";
  date: string;
  excerpt: string;
  filename: string;
}

interface ScanResult {
  sessions: Session[];
  unreadable: string[];
}

/** Resolves the vault path — TOTO_VAULT_PATH, then legacy VAULT_PATH, then default. Matches last.ts:75 verbatim. */
function resolveVaultPath(): string {
  return process.env["TOTO_VAULT_PATH"] ?? process.env["VAULT_PATH"] ?? DEFAULT_VAULT_PATH;
}

/** Extract a YYYY-MM-DD date prefix from a filename, or return 'unknown'. */
function parseDateFromFilename(filename: string): string {
  const m = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? (m[1] ?? "unknown") : "unknown";
}

/**
 * Parse status and first meaningful excerpt from markdown file content.
 * Status line must match /[Ss]tatus:\s*(approved|revision-required|blocked)/.
 * Excerpt is the first non-empty, non-heading line of content.
 */
function parseFileContent(content: string): { status: string | null; excerpt: string } {
  const lines = content.split("\n");
  let status: string | null = null;
  let excerpt = "";

  for (const line of lines) {
    const statusMatch = line.match(/[Ss]tatus:\s*(approved|revision-required|blocked)/i);
    if (statusMatch && !status) {
      status = (statusMatch[1] ?? "").toLowerCase();
    }
    if (!excerpt) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && trimmed !== "---" && !statusMatch) {
        excerpt = trimmed.length > 80 ? trimmed.slice(0, 77) + "..." : trimmed;
      }
    }
    if (status && excerpt) break;
  }

  return { status, excerpt: excerpt || "(no excerpt)" };
}

/**
 * Reads all markdown files from a vault subdirectory, sorted newest-first,
 * capped at MAX_FILES. Returns null if the directory does not exist
 * (distinct from an empty directory, which returns `{ sessions: [], ... }`)
 * — matches report.ts's listRecordFiles null/[] convention. A per-file read
 * failure is NOT silently swallowed (the packages/dashboard port source's
 * bug) — it's collected into `unreadable` so a partially-corrupted
 * directory is visibly different from a fully-clean one.
 */
async function scanVaultDir(dir: string): Promise<ScanResult | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return null;
    throw err;
  }

  const mdFiles = entries.filter((f) => f.endsWith(".md")).sort().reverse().slice(0, MAX_FILES);
  const sessions: Session[] = [];
  const unreadable: string[] = [];

  for (const filename of mdFiles) { // P10 Rule 2: bounded by mdFiles.length <= MAX_FILES
    const filepath = join(dir, filename);
    let content: string;
    try {
      content = await readFile(filepath, "utf8");
    } catch {
      unreadable.push(filename);
      continue;
    }
    const date = parseDateFromFilename(filename);
    const { status, excerpt } = parseFileContent(content);
    sessions.push({ date, status, excerpt, filename });
  }

  return { sessions, unreadable };
}

/**
 * Scans Council/Congressional-Records and P10-Plans for blocked items.
 * Returns `items: null` only when BOTH subdirectories are missing (the
 * vault itself isn't there) — a missing single subdirectory contributes
 * zero items rather than treating a partially-initialized vault as absent.
 */
async function collectBlockedItems(vaultPath: string): Promise<{ items: BlockedItem[] | null; unreadable: string[] }> {
  const councilDir = join(vaultPath, "Council", "Congressional-Records");
  const p10Dir = join(vaultPath, "P10-Plans");

  const [councilResult, p10Result] = await Promise.all([
    scanVaultDir(councilDir),
    scanVaultDir(p10Dir),
  ]);

  if (councilResult === null && p10Result === null) {
    return { items: null, unreadable: [] };
  }

  const unreadable: string[] = [...(councilResult?.unreadable ?? []), ...(p10Result?.unreadable ?? [])];
  assert(Array.isArray(unreadable), "unreadable must always be an array");

  const items: BlockedItem[] = [
    ...(councilResult?.sessions ?? [])
      .filter((s) => s.status === "blocked")
      .map((s) => ({ type: "council" as const, date: s.date, excerpt: s.excerpt, filename: s.filename })),
    ...(p10Result?.sessions ?? [])
      .filter((s) => s.status === "blocked")
      .map((s) => ({ type: "p10" as const, date: s.date, excerpt: s.excerpt, filename: s.filename })),
  ];

  return { items, unreadable };
}

/** Renders the blocked-items rollup to stdout; a per-file read failure warning goes to stderr. */
function renderTerminalDashboard(items: BlockedItem[] | null, unreadable: string[], vaultPath: string): void {
  if (items === null) {
    process.stdout.write(`vault not found at ${vaultPath}\n`);
    return;
  }

  if (items.length === 0) {
    process.stdout.write("ALL CLEAR — no blocked items\n");
  } else {
    for (const item of items) {
      process.stdout.write(`  ⚠ ${item.type}  ${item.date}  ${item.excerpt}\n`);
    }
  }

  if (unreadable.length > 0) {
    process.stderr.write(`toto dashboard: ${unreadable.length} file(s) could not be read and were skipped\n`);
  }
}

/** `toto dashboard --terminal`: prints the blocked-items rollup directly, no browser. */
async function runTerminalDashboard(): Promise<void> {
  const vaultPath = resolveVaultPath();
  assert(typeof vaultPath === "string" && vaultPath.length > 0, "resolved vault path must be non-empty"); // R5 assertion
  const { items, unreadable } = await collectBlockedItems(vaultPath);
  renderTerminalDashboard(items, unreadable, vaultPath);
}

/**
 * Resolves the dashboard URL from TOTO_MCP_PORT env (default 3099).
 * Always targets loopback — the MCP server rejects non-loopback connections.
 */
function dashboardUrl(): string {
  const port = process.env["TOTO_MCP_PORT"] ?? "3099";
  return `http://127.0.0.1:${port}/dashboard`;
}

/**
 * Issues a HEAD request to the given URL with a 2-second timeout.
 * Resolves true if the server responds with any HTTP status code.
 * Resolves false on connection error or timeout.
 */
function isServerReachable(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        method: "HEAD",
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
      },
      () => {
        resolve(true);
      }
    );
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => {
      resolve(false);
    });
    req.end();
  });
}

/**
 * Opens the given URL in the default browser using the platform-appropriate
 * command: 'open' on macOS, 'xdg-open' on Linux. Exits 1 on failure.
 * Windows is out of scope — the MCP server is loopback-only and this path
 * is never reached on win32.
 */
function openBrowser(url: string): void {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  execFile(opener, [url], (err) => {
    if (err) {
      process.stderr.write(`toto dashboard: failed to open browser — ${err.message}\n`);
      process.exit(1);
    }
  });
}

/**
 * Command handler for `toto dashboard`.
 * Checks that the MCP server is reachable before opening the browser.
 * Exits 1 with a clear error message if the server is down.
 */
export async function runDashboard(): Promise<void> {
  if (process.argv.includes("--terminal")) {
    return runTerminalDashboard();
  }

  const url = dashboardUrl();
  const reachable = await isServerReachable(url);

  if (!reachable) {
    process.stderr.write(
      `toto dashboard: MCP server not reachable at ${url}\n` +
        `Start the MCP server first, then run 'toto dashboard' again.\n` +
        `If the server crashes on startup, check that ANTHROPIC_AUTH_TOKEN is set in ~/.claude.json.\n`
    );
    process.exit(1);
  }

  openBrowser(url);
}
