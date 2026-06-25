import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const DEFAULT_VAULT_PATH = path.join(os.homedir(), ".toto", "vault");
const COUNCIL_DIR = "Council/Congressional-Records";
const P10_DIR = "P10-Plans";
const MAX_DISPLAY = 5;
const MAX_HEADING_LINES = 20;

interface FileEntry {
  filePath: string;
  mtime: Date;
  heading: string;
}

/**
 * Read the first heading (line starting with #) from a file. Scans at most
 * MAX_HEADING_LINES lines. Returns an empty string if no heading is found.
 */
async function readFirstHeading(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.split("\n");
    const limit = Math.min(lines.length, MAX_HEADING_LINES);
    for (let i = 0; i < limit; i++) {
      const line = (lines[i] ?? "").trim();
      if (line.startsWith("#")) {
        return line;
      }
    }
  } catch {
    // unreadable file — return empty
  }
  return "";
}

/**
 * Collect FileEntry records for all .md files in a directory. Returns an
 * empty array on ENOENT or any stat failure.
 */
async function collectEntries(dir: string): Promise<FileEntry[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }

  const mdNames = names.filter((n) => n.endsWith(".md"));
  const entries: FileEntry[] = [];

  for (let i = 0; i < mdNames.length; i++) {
    const name = mdNames[i];
    if (name === undefined) continue;
    const filePath = path.join(dir, name);
    try {
      const stat = await fs.stat(filePath);
      entries.push({ filePath, mtime: stat.mtime, heading: "" });
    } catch {
      // skip files that cannot be stat'd
    }
  }

  return entries;
}

/**
 * Run the last command: list the 5 most recently modified files across
 * Council/Congressional-Records/ and P10-Plans/ in the vault. Prints each
 * with its modification timestamp and first heading line. Exits 0 even when
 * the vault is empty or directories do not exist.
 */
export async function runLast(): Promise<void> {
  const vaultPath = process.env["TOTO_VAULT_PATH"] ?? process.env["VAULT_PATH"] ?? DEFAULT_VAULT_PATH;
  const councilDir = path.join(vaultPath, COUNCIL_DIR);
  const p10Dir = path.join(vaultPath, P10_DIR);

  const [councilEntries, p10Entries] = await Promise.all([
    collectEntries(councilDir),
    collectEntries(p10Dir),
  ]);

  const all = [...councilEntries, ...p10Entries];
  all.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  const top = all.slice(0, MAX_DISPLAY);

  if (top.length === 0) {
    process.stdout.write("no recent council or P10 records found\n");
    return;
  }

  // Read headings for top entries only
  for (let i = 0; i < top.length; i++) {
    const entry = top[i];
    if (entry === undefined) continue;
    entry.heading = await readFirstHeading(entry.filePath);
  }

  for (let i = 0; i < top.length; i++) {
    const entry = top[i];
    if (entry === undefined) continue;
    const ts = entry.mtime.toISOString().replace("T", " ").slice(0, 19);
    const heading = entry.heading.length > 0 ? `  ${entry.heading}` : "";
    process.stdout.write(`${ts}  ${entry.filePath}${heading}\n`);
  }
}
