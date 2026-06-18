import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const DEFAULT_VAULT_PATH = path.join(os.homedir(), "Documents", "Obsidian Vault");
const P10_PLANS_DIR = "P10-Plans";
const MAX_P10_SCAN = 100;

/**
 * Infer the active persona from environment variables. Returns "Manifest"
 * when ANTHROPIC_BASE_URL contains localhost or a manifest domain; otherwise
 * returns "Anthropic (direct API)".
 */
function inferPersona(): string {
  const base = process.env["ANTHROPIC_BASE_URL"] ?? "";
  if (base.includes("localhost") || base.includes("manifest")) {
    return "Manifest";
  }
  const authToken = process.env["ANTHROPIC_AUTH_TOKEN"] ?? "";
  if (authToken.startsWith("mnfst_")) {
    return "Manifest";
  }
  return "Anthropic (direct API)";
}

/**
 * Count .md files in vaultPath/P10-Plans/ that are in-progress (status line
 * does not contain "approved" or "completed"). Bounded to MAX_P10_SCAN entries.
 * Returns 0 on ENOENT or read errors.
 */
async function countPendingP10s(vaultPath: string): Promise<number> {
  const dir = path.join(vaultPath, P10_PLANS_DIR);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return 0;
  }

  const mdFiles = entries.filter((e) => e.endsWith(".md"));
  const bounded = mdFiles.slice(0, MAX_P10_SCAN);
  let pending = 0;

  for (let i = 0; i < bounded.length; i++) {
    const name = bounded[i];
    if (name === undefined) continue;
    const filePath = path.join(dir, name);
    try {
      const content = await fs.readFile(filePath, "utf8");
      const lower = content.toLowerCase();
      const isApproved = lower.includes("status: approved") || lower.includes("status: completed");
      if (!isApproved) {
        pending++;
      }
    } catch {
      // skip unreadable files
    }
  }

  return pending;
}

/**
 * Run the whoami command: print the active persona, vault path, and count of
 * pending P10 plans. Always exits 0.
 */
export async function runWhoami(): Promise<void> {
  const vaultPath = process.env["VAULT_PATH"] ?? DEFAULT_VAULT_PATH;
  const persona = inferPersona();
  const pendingCount = await countPendingP10s(vaultPath);

  process.stdout.write(`persona:    ${persona}\n`);
  process.stdout.write(`vault:      ${vaultPath}\n`);
  process.stdout.write(`pending P10 plans: ${pendingCount}\n`);
}
