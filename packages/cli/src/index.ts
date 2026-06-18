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

const USAGE = `toto — governance CLI for toto-wolff

Usage:
  toto <command> [options]

Commands:
  init       Register the toto-wolff MCP server in ~/.claude/settings.json
  doctor     Check environment, MCP entry, and vault path
  whoami     Print active persona, vault path, and pending P10 plan count
  search     Search vault files with ripgrep (usage: toto search <query>)
  last       List the 5 most recently modified council/P10 records
  audit      Scan vault for stale P10 plans and orphaned council rulings
  dashboard  Open the toto-wolff web dashboard in the default browser

Run 'toto --help' for this message.
`;

/** Print usage to stdout and exit 0. */
function printHelp(): void {
  process.stdout.write(USAGE);
  process.exit(0);
}

/** Print an "unknown command" error to stderr and exit 1. */
function unknownCommand(cmd: string): void {
  process.stderr.write(`toto: unknown command '${cmd}'\n\n${USAGE}`);
  process.exit(1);
}

/** Route process.argv[2] to the correct handler. */
async function main(): Promise<void> {
  const cmd = process.argv[2];

  if (cmd === undefined || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }

  if (cmd === "init") {
    await runInit();
    return;
  }

  if (cmd === "doctor") {
    await runDoctor();
    return;
  }

  if (cmd === "whoami") {
    await runWhoami();
    return;
  }

  if (cmd === "search") {
    await runSearch();
    return;
  }

  if (cmd === "last") {
    await runLast();
    return;
  }

  if (cmd === "audit") {
    await runAudit();
    return;
  }

  if (cmd === "dashboard") {
    await runDashboard();
    return;
  }

  unknownCommand(cmd);
}

main().catch((err: unknown) => {
  process.stderr.write(`toto: unexpected error — ${String(err)}\n`);
  process.exit(1);
});
