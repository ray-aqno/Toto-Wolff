import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// ─── ANSI ─────────────────────────────────────────────────────────────────
const T  = "\x1b[36m";   // teal  (#00D2BE)
const S  = "\x1b[37m";   // silver
const B  = "\x1b[1m";    // bold
const D  = "\x1b[2m";    // dim
const G  = "\x1b[32m";   // green
const R  = "\x1b[0m";    // reset

// ─── Radio quotes pool ────────────────────────────────────────────────────
const QUOTES: string[] = [
  "Valtteri, it's James. Box, box.",
  "Hammer time.",
  "This is a safety car period. Stay calm, execute the plan.",
  "We are racing. We are racing.",
  "The pace is there. Push now — this is our window.",
  "DRS enabled. Let's go hunting.",
  "Box for softs. Undercut is on.",
  "Lewis, you are the fastest car on the track.",
  "We have a 1-2. Bring them home.",
  "Fastest lap is available. Push for the extra point.",
  "Gap to the leader: 1.2 seconds. We can do this.",
  "Tyre deg is under control. Keep the delta.",
  "We need to talk about the engine mode.",
  "Copy that. Looking after the tyres now.",
  "Pit window is open. Box this lap.",
];

/** Return a deterministic quote based on day-of-year so it changes daily. */
function dailyQuote(): string {
  const day = Math.floor(Date.now() / 86_400_000);
  return QUOTES[day % QUOTES.length] ?? QUOTES[0]!;
}

/**
 * Read a quick vault stat: count of .md files in a subdirectory.
 * Returns null on any read error (vault not configured, path wrong, etc.)
 */
async function countVaultFiles(subdir: string): Promise<number | null> {
  const vaultPath = process.env["VAULT_PATH"] ??
    path.join(os.homedir(), "Documents", "Obsidian Vault");
  const dir = path.join(vaultPath, subdir);
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((e) => e.endsWith(".md")).length;
  } catch {
    return null;
  }
}

/** Right-pad a string to width with spaces. */
function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

/**
 * Print the full styled landing UI for bare `toto` invocation.
 * Shows the Silver Arrows banner, command table, live vault stats if
 * readable, and a daily team-radio quote.
 */
export async function printLandingUI(): Promise<void> {
  const [councilCount, p10Count] = await Promise.all([
    countVaultFiles("Council/Congressional-Records"),
    countVaultFiles("P10-Plans"),
  ]);

  const statsLine = councilCount !== null && p10Count !== null
    ? `${T}${councilCount}${R} council sessions  ${T}${p10Count}${R} P10 plans`
    : `${D}vault not connected — run ${T}toto doctor${R}`;

  const cmds: Array<[string, string]> = [
    ["init",      "Register MCP server in Claude Code"],
    ["doctor",    "Check credentials, vault, MCP entry"],
    ["whoami",    "Active persona + pending P10 count"],
    ["search",    "Ripgrep across vault files"],
    ["last",      "Last 5 governance decisions"],
    ["audit",     "Stale plans + orphaned rulings"],
    ["dashboard", "Open web dashboard in browser"],
    ["radio",     "🎙  Pit wall chat  (requires API key)"],
  ];

  const cmdLines = cmds
    .map(([name, desc]) => `  ${T}${B}${pad(name, 11)}${R}${S}${desc}${R}`)
    .join("\n");

  const quote = dailyQuote();

  const ui = `
${T}${B}╔══════════════════════════════════════════════════╗
║  🏎   TOTO — Engineering Governance Stack        ║
║  Mercedes-AMG Petronas · Brackley HQ             ║
╚══════════════════════════════════════════════════╝${R}

${cmdLines}

  ${D}──────────────────────────────────────────────────${R}
  ${statsLine}

  ${D}"${quote}"${R}

  ${D}Run ${R}${T}toto <command> --help${R}${D} for usage.${R}

`;

  process.stdout.write(ui);
}

/**
 * Print a minimal plain-text usage string for --help and unknown-command
 * error paths where the full UI is not appropriate.
 */
export function plainUsage(): string {
  return `toto — governance CLI for toto-wolff

Usage: toto <command>

Commands: init  doctor  whoami  search  last  audit  dashboard  radio

Run 'toto' with no arguments for the full command reference.
`;
}
