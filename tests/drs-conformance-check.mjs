// Constructs DRSService (TS side) exactly as production does — zero-arg,
// cwd-relative resolution — and prints its check() result as JSON.
// Used by tests/drs-conformance.bats to assert the bash hook and the TS
// implementation agree on known inputs. Requires `pnpm build` to have run
// (imports the built dist, not the TS source, matching what production
// actually executes).
import { DRSService } from '../packages/core/dist/DRSService.js';

const [, , tool, targetOrCommand] = process.argv;
if (tool === undefined || targetOrCommand === undefined) {
  process.stderr.write('usage: drs-conformance-check.mjs <tool> <targetPath-or-command>\n');
  process.exit(1);
}

const drs = new DRSService();
const input = tool === 'Bash' ? { tool, command: targetOrCommand } : { tool, targetPath: targetOrCommand };
const result = await drs.check(input);

process.stdout.write(JSON.stringify({ allowed: result.allowed, ruleFired: result.ruleFired ?? null, configSource: drs.configSource }) + '\n');
