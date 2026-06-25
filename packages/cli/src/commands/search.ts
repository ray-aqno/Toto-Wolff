import { execFile } from "node:child_process";
import path from "node:path";
import os from "node:os";

const DEFAULT_VAULT_PATH = path.join(os.homedir(), ".toto", "vault");
const MAX_RESULT_LINES = 200;

/**
 * Parse the stdout from `rg -l` into a list of file paths. Bounded to
 * MAX_RESULT_LINES. Each non-empty line is treated as a file path. Empty
 * lines are skipped.
 */
export function parseRgOutput(stdout: string): string[] {
  const lines = stdout.split("\n");
  const results: string[] = [];
  const limit = Math.min(lines.length, MAX_RESULT_LINES);

  for (let i = 0; i < limit; i++) {
    const line = (lines[i] ?? "").trim();
    if (line.length > 0) {
      results.push(line);
    }
  }

  return results;
}

/**
 * Run the search command: accept a query string from process.argv[3], call
 * `rg --json -l <query> <vaultPath>` via execFile, and print matching file
 * paths. Exits 1 if query is missing or rg is unavailable.
 */
export async function runSearch(): Promise<void> {
  const query = process.argv[3];
  if (typeof query !== "string" || query.trim().length === 0) {
    process.stderr.write("toto search: query argument required\n\nUsage: toto search <query>\n");
    process.exit(1);
  }

  const vaultPath = process.env["TOTO_VAULT_PATH"] ?? process.env["VAULT_PATH"] ?? DEFAULT_VAULT_PATH;

  await new Promise<void>((resolve, reject) => {
    execFile(
      "rg",
      ["-l", query, vaultPath],
      { maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          // rg exits 1 when no matches found — that is not an error
          const noMatches = err.code === 1 && stderr.trim().length === 0;
          if (noMatches) {
            process.stdout.write("no matches found\n");
            resolve();
            return;
          }
          // rg not on PATH or other fatal error
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            process.stderr.write("toto search: ripgrep (rg) not found — install it and ensure it is on PATH\n");
          } else {
            process.stderr.write(`toto search: rg failed — ${String(err)}\n`);
          }
          reject(err);
          return;
        }

        const paths = parseRgOutput(stdout);
        if (paths.length === 0) {
          process.stdout.write("no matches found\n");
        } else {
          for (let i = 0; i < paths.length; i++) {
            process.stdout.write(`${paths[i]}\n`);
          }
        }
        resolve();
      }
    );
  }).catch(() => {
    process.exit(1);
  });
}
