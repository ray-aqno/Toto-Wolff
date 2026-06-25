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
  "Council is convened. Scouts are in the tunnel.",
  "P10 plan approved. Execution window is open.",
  "BLOCKED item on the wall. This needs a ruling before we move.",
  "Architecture decision logged. Congressional record filed.",
  "Chairman has ruled. Conditional: address the T8 spec.",
  "Compliance at 67%. Push for full green before the sprint.",
  "Reversal rate zero. All rulings clean. That's how we do it.",
  "Persona hot-swap confirmed. Engineering stack is live.",
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
  const vaultPath = process.env["TOTO_VAULT_PATH"] ?? process.env["VAULT_PATH"] ??
    path.join(os.homedir(), ".toto", "vault");
  const dir = path.join(vaultPath, subdir);
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((e) => e.endsWith(".md")).length;
  } catch {
    return null;
  }
}

/**
 * Count P10 plans with BLOCKED status by scanning plan files for the status line.
 * Returns 0 on any read error.
 */
async function countBlockedPlans(): Promise<number> {
  const vaultPath = process.env["TOTO_VAULT_PATH"] ?? process.env["VAULT_PATH"] ??
    path.join(os.homedir(), ".toto", "vault");
  const dir = path.join(vaultPath, "P10-Plans");
  try {
    const entries = await fs.readdir(dir);
    let blocked = 0;
    await Promise.all(
      entries.filter((e) => e.endsWith(".md")).map(async (e) => {
        try {
          const content = await fs.readFile(path.join(dir, e), "utf8");
          if (/status:\s*blocked/i.test(content)) blocked++;
        } catch { /* skip unreadable files */ }
      })
    );
    return blocked;
  } catch {
    return 0;
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
  const [councilCount, p10Count, blockedCount] = await Promise.all([
    countVaultFiles("Council/Congressional-Records"),
    countVaultFiles("P10-Plans"),
    countBlockedPlans(),
  ]);

  const vaultConnected = councilCount !== null && p10Count !== null;
  const statsLine = vaultConnected
    ? `${T}${councilCount}${R} council sessions  ${T}${p10Count}${R} P10 plans`
    : `${D}vault not connected — run ${T}toto doctor${R}`;

  const pitStatus = !vaultConnected
    ? ""
    : blockedCount > 0
      ? `\n  ${"\x1b[31m"}⚠  ${blockedCount} BLOCKED${R}${D} — execution halted on ${blockedCount} plan${blockedCount > 1 ? "s" : ""}. Run ${R}${T}toto audit${R}${D} for details.${R}`
      : `\n  ${G}●${R}${D}  pit lane clear — no blocked plans${R}`;

  const cmds: Array<[string, string]> = [
    ["init",      "Register MCP server in Claude Code"],
    ["doctor",    "Credentials · vault · MCP health check"],
    ["whoami",    "Active persona + pending P10 count"],
    ["search",    "Grep the vault — find any ruling or plan"],
    ["last",      "Last 5 rulings off the wall"],
    ["audit",     "Stale plans · orphaned rulings · blocked items"],
    ["dashboard", "Paddock interface — live in browser"],
    ["radio",     "Pit wall chat with Toto  (requires API key)"],
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
  ${statsLine}${pitStatus}

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
