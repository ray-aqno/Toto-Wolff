import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
const MCP_KEY = "toto-wolff";
const DEFAULT_VAULT_PATH = path.join(
  os.homedir(),
  "Documents",
  "Obsidian Vault"
);

interface CheckResult {
  label: string;
  passed: boolean;
  detail: string;
}

/**
 * Pure function: return true if the given env map contains a non-empty
 * ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY. Accepts an env argument so
 * callers can inject test values without mutating process.env.
 */
export function checkEnv(env: Record<string, string | undefined> = process.env): boolean {
  const token = env["ANTHROPIC_AUTH_TOKEN"] ?? env["ANTHROPIC_API_KEY"];
  return typeof token === "string" && token.length > 0;
}

/** Check that at least one Anthropic auth env var is set and non-empty. */
function checkAuthToken(): CheckResult {
  const passed = checkEnv(process.env as Record<string, string | undefined>);
  return {
    label: "ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY",
    passed,
    detail: passed ? "set" : "not set — export ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY",
  };
}

/**
 * Check that ~/.claude/settings.json contains the toto-wolff MCP entry.
 * Handles ENOENT and JSON parse errors as failures (not crashes).
 */
async function checkMcpEntry(): Promise<CheckResult> {
  const label = `toto-wolff MCP entry in ${SETTINGS_PATH}`;
  try {
    const raw = await fs.readFile(SETTINGS_PATH, "utf8");
    const settings = JSON.parse(raw) as Record<string, unknown>;
    const mcpServers =
      (settings.mcpServers as Record<string, unknown> | undefined) ?? {};
    const passed = MCP_KEY in mcpServers;
    return {
      label,
      passed,
      detail: passed ? "present" : "missing — run `toto init`",
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const detail =
      code === "ENOENT"
        ? `${SETTINGS_PATH} not found — run \`toto init\``
        : `could not read settings — ${String(err)}`;
    return { label, passed: false, detail };
  }
}

/**
 * Check that the Obsidian vault directory exists. Reads VAULT_PATH env var
 * first; falls back to ~/Documents/Obsidian Vault.
 */
async function checkVaultPath(): Promise<CheckResult> {
  const vaultPath = process.env["VAULT_PATH"] ?? DEFAULT_VAULT_PATH;
  const label = `Vault path (${vaultPath})`;
  try {
    const stat = await fs.stat(vaultPath);
    const passed = stat.isDirectory();
    return {
      label,
      passed,
      detail: passed ? "exists" : `${vaultPath} is not a directory`,
    };
  } catch {
    return {
      label,
      passed: false,
      detail: `${vaultPath} does not exist — set VAULT_PATH or create the directory`,
    };
  }
}

/** Format and print a check result line. */
function printCheck(result: CheckResult): void {
  const icon = result.passed ? "PASS" : "FAIL";
  process.stdout.write(`  [${icon}] ${result.label}: ${result.detail}\n`);
}

/**
 * Run the doctor command: check auth token, MCP entry, and vault path.
 * Exits 1 if any check fails.
 */
export async function runDoctor(): Promise<void> {
  process.stdout.write("toto doctor\n\n");

  const authResult = checkAuthToken();
  const [mcpResult, vaultResult] = await Promise.all([
    checkMcpEntry(),
    checkVaultPath(),
  ]);

  const results: CheckResult[] = [authResult, mcpResult, vaultResult];
  for (const r of results) {
    printCheck(r);
  }

  process.stdout.write("\n");
  const anyFailed = results.some((r) => !r.passed);
  if (anyFailed) {
    process.stdout.write("doctor: one or more checks failed\n");
    process.exit(1);
  } else {
    process.stdout.write("doctor: all checks passed\n");
  }
}
