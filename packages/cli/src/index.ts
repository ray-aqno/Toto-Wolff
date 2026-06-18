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
import { printLandingUI, plainUsage } from "./ui.js";

/** Print an "unknown command" error to stderr and exit 1. */
function unknownCommand(cmd: string): void {
  process.stderr.write(`toto: unknown command '${cmd}'\n\n${plainUsage()}`);
  process.exit(1);
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

  if (cmd === "radio") {
    await runRadio();
    return;
  }

  unknownCommand(cmd);
}

main().catch((err: unknown) => {
  process.stderr.write(`toto: unexpected error — ${String(err)}\n`);
  process.exit(1);
});
