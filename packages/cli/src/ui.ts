import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { TEAL, SILVER, BOLD, DIM, GREEN, RESET } from "./colors.js";

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
    ? `${TEAL}${councilCount}${RESET} council sessions  ${TEAL}${p10Count}${RESET} P10 plans`
    : `${DIM}vault not connected — run ${TEAL}toto doctor${RESET}`;

  const pitStatus = !vaultConnected
    ? ""
    : blockedCount > 0
      ? `\n  ${"\x1b[31m"}⚠  ${blockedCount} BLOCKED${RESET}${DIM} — execution halted on ${blockedCount} plan${blockedCount > 1 ? "s" : ""}. Run ${RESET}${TEAL}toto audit${RESET}${DIM} for details.${RESET}`
      : `\n  ${GREEN}●${RESET}${DIM}  pit lane clear — no blocked plans${RESET}`;

  const cmds: Array<[string, string]> = [
    ["init",      "Register MCP server in Claude Code"],
    ["doctor",    "Credentials · vault · MCP health check"],
    ["whoami",    "Active persona + pending P10 count"],
    ["search",    "Grep the vault — find any ruling or plan"],
    ["last",      "Last 5 rulings off the wall"],
    ["audit",     "Stale plans · orphaned rulings · blocked items"],
    ["dashboard", "Paddock interface — live in browser"],
    ["radio",     "Pit wall chat with Toto  (requires API key)"],
    ["upgrade",   "Pull latest release and rebuild in-place"],
    ["synthesize","Cross-connection patterns across the vault  (requires API key)"],
  ];

  const cmdLines = cmds
    .map(([name, desc]) => `  ${TEAL}${BOLD}${pad(name, 11)}${RESET}${SILVER}${desc}${RESET}`)
    .join("\n");

  const quote = dailyQuote();

  const ui = `
${TEAL}${BOLD}╔══════════════════════════════════════════════════╗
║  🏎   TOTO — Engineering Governance Stack        ║
║  Mercedes-AMG Petronas · Brackley HQ             ║
╚══════════════════════════════════════════════════╝${RESET}

${cmdLines}

  ${DIM}──────────────────────────────────────────────────${RESET}
  ${statsLine}${pitStatus}

  ${DIM}"${quote}"${RESET}

  ${DIM}Run ${RESET}${TEAL}toto <command> --help${RESET}${DIM} for usage.${RESET}

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

Commands: init  doctor  whoami  search  last  audit  dashboard  radio  upgrade  synthesize

Run 'toto' with no arguments for the full command reference.
`;
}
