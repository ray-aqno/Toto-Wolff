#!/usr/bin/env node
/**
 * Terminal governance dashboard for toto-wolff.
 * Scans Council/Congressional-Records/ and P10-Plans/ from the Obsidian vault
 * and renders a status summary to stdout using ANSI escape codes only.
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Session {
  date: string;
  status: string | null;
  excerpt: string;
  filename: string;
}

export interface BlockedItem {
  type: 'council' | 'p10';
  date: string;
  excerpt: string;
  filename: string;
}

export interface DashboardData {
  council: Session[];
  p10: Session[];
  blocked: BlockedItem[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

/** Wrap text in a colour based on a normalised status string. */
function colorStatus(status: string | null): string {
  if (!status) return `${YELLOW}[unknown]${RESET}`;
  const s = status.toLowerCase();
  if (s === 'approved')          return `${GREEN}[approved]${RESET}`;
  if (s === 'revision-required') return `${YELLOW}[revision-required]${RESET}`;
  if (s === 'blocked')           return `${RED}[blocked]${RESET}`;
  return `[${status}]`;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/** Extract a YYYY-MM-DD date prefix from a filename, or return 'unknown'. */
function parseDateFromFilename(filename: string): string {
  const m = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : 'unknown';
}

/**
 * Parse status and first meaningful excerpt from markdown file content.
 * Status line must match /[Ss]tatus:\s*(approved|revision-required|blocked)/.
 * Excerpt is the first non-empty, non-heading line of content.
 */
function parseFileContent(content: string): { status: string | null; excerpt: string } {
  const lines = content.split('\n');
  let status: string | null = null;
  let excerpt = '';

  for (const line of lines) {
    const statusMatch = line.match(/[Ss]tatus:\s*(approved|revision-required|blocked)/i);
    if (statusMatch && !status) {
      status = statusMatch[1].toLowerCase();
    }
    if (!excerpt) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        // Skip YAML front-matter markers and status lines themselves
        if (trimmed !== '---' && !statusMatch) {
          excerpt = trimmed.length > 80 ? trimmed.slice(0, 77) + '...' : trimmed;
        }
      }
    }
    if (status && excerpt) break;
  }

  return { status, excerpt: excerpt || '(no excerpt)' };
}

/**
 * Read all markdown files from a directory and return parsed Session objects.
 * Silently skips the directory if it does not exist.
 */
async function scanDirectory(dir: string, type: 'council' | 'p10'): Promise<Session[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const mdFiles = entries.filter(f => f.endsWith('.md')).sort().reverse();
  const sessions: Session[] = [];

  for (const filename of mdFiles) {
    const filepath = join(dir, filename);
    let content = '';
    try {
      content = await readFile(filepath, 'utf8');
    } catch {
      continue;
    }
    const date = parseDateFromFilename(filename);
    const { status, excerpt } = parseFileContent(content);
    sessions.push({ date, status, excerpt, filename });
  }

  return sessions;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Gather council and P10 data from the vault and return structured DashboardData. */
export async function getDashboardData(): Promise<DashboardData> {
  const vaultPath = process.env['VAULT_PATH'] ?? ((process.env['HOME'] ?? '') + '/Documents/Obsidian Vault');
  const councilDir = join(vaultPath, 'Council', 'Congressional-Records');
  const p10Dir     = join(vaultPath, 'P10-Plans');

  const [council, p10] = await Promise.all([
    scanDirectory(councilDir, 'council'),
    scanDirectory(p10Dir, 'p10'),
  ]);

  const blocked: BlockedItem[] = [
    ...council.filter(s => s.status === 'blocked').map(s => ({ type: 'council' as const, date: s.date, excerpt: s.excerpt, filename: s.filename })),
    ...p10.filter(s => s.status === 'blocked').map(s => ({ type: 'p10' as const, date: s.date, excerpt: s.excerpt, filename: s.filename })),
  ];

  return { council, p10, blocked, generatedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/** Format a single session line for display. */
function sessionLine(session: Session): string {
  return `  ${BOLD}●${RESET} ${session.date}  ${colorStatus(session.status)}  ${session.excerpt}`;
}

/** Render the full dashboard to stdout. */
async function render(data: DashboardData): Promise<void> {
  const w = process.stdout.write.bind(process.stdout);

  w(`\n${BOLD}╔══════════════════════════════════════╗${RESET}\n`);
  w(`${BOLD}║  TOTO-WOLFF GOVERNANCE DASHBOARD    ║${RESET}\n`);
  w(`${BOLD}╚══════════════════════════════════════╝${RESET}\n\n`);

  w(`${BOLD}COUNCIL SESSIONS (${data.council.length} total)${RESET}\n`);
  if (data.council.length === 0) {
    w('  (none found)\n');
  } else {
    for (const s of data.council) w(sessionLine(s) + '\n');
  }

  w('\n');

  w(`${BOLD}P10 PLANS (${data.p10.length} total)${RESET}\n`);
  if (data.p10.length === 0) {
    w('  (none found)\n');
  } else {
    for (const s of data.p10) w(sessionLine(s) + '\n');
  }

  w('\n');

  w(`${BOLD}BLOCKED ITEMS${RESET}\n`);
  if (data.blocked.length === 0) {
    w('  (none)\n');
  } else {
    for (const b of data.blocked) {
      w(`  ${RED}${BOLD}⚠${RESET} ${b.type}  ${b.date}  ${b.excerpt}\n`);
    }
  }

  w('\n');
  w(`Generated: ${data.generatedAt}\n\n`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Main entry point: fetch dashboard data and render it. */
export async function main(): Promise<void> {
  const data = await getDashboardData();
  await render(data);
}

// Run when executed directly
if (import.meta.url === new URL(import.meta.url).href) {
  main().catch(err => {
    process.stderr.write(String(err) + '\n');
    process.exit(1);
  });
}
