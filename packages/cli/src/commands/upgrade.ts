import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Run the upgrade command: delegates to scripts/upgrade.sh in the repo root.
 * The script pulls origin/main, rebuilds, and re-runs setup non-destructively.
 * Vault, credentials, and config are untouched.
 */
export async function runUpgrade(): Promise<void> {
  const repoRoot = path.resolve(__dirname, "../../../../");
  const upgradeSh = path.join(repoRoot, "scripts", "upgrade.sh");

  process.stdout.write("toto upgrade\n\n");

  await new Promise<void>((resolve, reject) => {
    const child = spawn("bash", [upgradeSh], { stdio: "inherit" });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`upgrade script exited with code ${code ?? "unknown"}`));
      }
    });
    child.on("error", reject);
  });
}
