#!/usr/bin/env node

/**
 * Entry point for the toto CLI. Dispatches on process.argv[2] to the
 * appropriate command handler. Unknown commands print usage and exit 1.
 */

import { runInit } from "./commands/init.js";
import { runDoctor } from "./commands/doctor.js";
import { runWhoami } from "./commands/whoami.js";
import { runSearch } from "./commands/search.js";
import { runLast } from "./commands/last.js";
import { runAudit } from "./commands/audit.js";
import { runDashboard } from "./commands/dashboard.js";
import { runRadio } from "./commands/radio.js";
import { runBackfill } from "./commands/backfill.js";
import { runUpgrade } from "./commands/upgrade.js";
import { runSynthesize } from "./commands/synthesize.js";
import { runReport } from "./commands/report.js";
import { printLandingUI, plainUsage } from "./ui.js";

/** Print an "unknown command" error to stderr and exit 1. */
function unknownCommand(cmd: string): void {
  process.stderr.write(`toto: unknown command '${cmd}'\n\n${plainUsage()}`);
  process.exit(1);
}

// Lookup table, not a growing if-chain — a flat if-chain for this many
// commands cannot stay under the 60-line ESLint cap and would only get worse
// as commands are added. Same dispatch semantics: one command, one handler.
const COMMAND_HANDLERS: Record<string, () => Promise<void>> = {
  init: runInit,
  doctor: runDoctor,
  whoami: runWhoami,
  search: runSearch,
  last: runLast,
  audit: runAudit,
  dashboard: runDashboard,
  radio: runRadio,
  backfill: runBackfill,
  upgrade: runUpgrade,
  synthesize: runSynthesize,
  report: runReport,
};

/**
 * Look up and run the handler for `cmd`. Returns true if `cmd` matched a
 * handler (and was awaited to completion), false if nothing matched.
 */
async function dispatchCommand(cmd: string): Promise<boolean> {
  const handler = COMMAND_HANDLERS[cmd];
  if (handler === undefined) return false;
  await handler();
  return true;
}

/** Route process.argv[2] to the correct handler. */
async function main(): Promise<void> {
  const cmd = process.argv[2];

  if (cmd === undefined) {
    await printLandingUI();
    process.exit(0);
    return;
  }

  if (cmd === "--help" || cmd === "-h") {
    process.stdout.write(plainUsage());
    process.exit(0);
    return;
  }

  const handled = await dispatchCommand(cmd);
  if (!handled) unknownCommand(cmd);
}

main().catch((err: unknown) => {
  process.stderr.write(`toto: unexpected error — ${String(err)}\n`);
  process.exit(1);
});
