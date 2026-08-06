import { join, isAbsolute } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import assert from 'node:assert';
import type { DashboardItem, DashboardResult } from './dashboard_html.js';

export type { DashboardItem, DashboardResult };

/** Live stats payload streamed over SSE. */
export interface DashboardStats {
  councilCount: number;
  p10Count: number;
  blockedCount: number;
  cabinetCount: number;
  safetyCarCount: number;
  karpathyCount: number;
  drsCount: number;
  subagentCount: number;
  generatedAt: string;
}

/** Narrows an unknown value to the valid record type union. */
export function isValidItemType(t: unknown): t is 'council' | 'p10' | 'cabinet' | 'safety-car' | 'karpathy' | 'drs' | 'subagent' {
  assert(
    t === 'council' ||
    t === 'p10' ||
    t === 'cabinet' ||
    t === 'safety-car' ||
    t === 'karpathy' ||
    t === 'drs' ||
    t === 'subagent',
    `isValidItemType: unexpected type value '${String(t)}'`,
  );
  return true;
}

/** Extract YYYY-MM-DD from a filename. Returns 'unknown' if no date found. */
export function extractDate(filename: string): string {
  assert(typeof filename === 'string', 'extractDate: filename must be a string');
  assert(filename.length > 0, 'extractDate: filename must not be empty');
  const match = filename.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? (match[1] ?? 'unknown') : 'unknown';
}

/** Extract status from file content by scanning for "Status:" lines. */
export function extractStatus(content: string): string {
  assert(typeof content === 'string', 'extractStatus: content must be a string');
  const match = content.match(/[Ss]tatus:\s*(.+)/);
  if (!match) return 'unknown';
  const raw = (match[1] ?? '').trim().toLowerCase();
  if (raw.includes('approved')) return 'approved';
  if (raw.includes('blocked')) return 'blocked';
  if (raw.includes('revision')) return 'revision-required';
  if (raw.includes('pass')) return 'pass';
  if (raw.includes('fail')) return 'fail';
  if (raw.includes('conditional')) return 'conditional';
  const result = raw.slice(0, 40);
  assert(result.length <= 40, 'extractStatus: result must not exceed 40 chars');
  return result;
}

/**
 * Reads the last `limit` files from a directory, sorted by name descending.
 * Returns empty arrays if the directory does not exist.
 * Loop bound: at most Math.min(files.length, limit) iterations; limit ≤ 200.
 */
export async function readRecentItems(
  vaultPath: string,
  subDir: string,
  limit: number,
): Promise<{ all: string[]; items: DashboardItem[] }> {
  assert(isAbsolute(vaultPath), 'readRecentItems: vaultPath must be absolute');
  assert(limit > 0 && limit <= 200, 'readRecentItems: limit must be in [1, 200]');

  const dir = join(vaultPath, subDir);
  let filenames: string[];
  try {
    await stat(dir);
    filenames = (await readdir(dir)).filter((f) => !f.startsWith('.')).sort().reverse();
  } catch {
    return { all: [], items: [] };
  }

  // LOOP BOUND: Math.min(filenames.length, limit) iterations; limit ≤ 200
  const recent = filenames.slice(0, limit);
  const items: DashboardItem[] = [];

  for (const filename of recent) {
    const filepath = join(dir, filename);
    let content = '';
    try {
      content = await readFile(filepath, 'utf8');
    } catch {
      // unreadable file — skip gracefully
    }
    items.push({
      date: extractDate(filename),
      excerpt: content.slice(0, 80).replace(/\n/g, ' ').trim(),
      status: extractStatus(content),
    });
  }

  return { all: filenames, items };
}

/**
 * Builds a full DashboardResult snapshot from the vault.
 * Reads Council/Congressional-Records, P10-Plans, Cabinet, SafetyCar, Karpathy, DRS, and Subagent directories.
 */
export async function handleDashboardStatus(vaultPath: string): Promise<DashboardResult> {
  assert(isAbsolute(vaultPath), 'handleDashboardStatus: vaultPath must be absolute');

  const [
    councilData,
    p10Data,
    cabinetData,
    safetyCarData,
    karpathyData,
    drsData,
    subagentData,
  ] = await Promise.all([
    readRecentItems(vaultPath, 'Council/Congressional-Records', 5),
    readRecentItems(vaultPath, 'P10-Plans', 5),
    readRecentItems(vaultPath, 'Cabinet', 5),
    readRecentItems(vaultPath, 'SafetyCar', 5),
    readRecentItems(vaultPath, 'Karpathy', 5),
    readRecentItems(vaultPath, 'DRS', 5),
    readRecentItems(vaultPath, 'Subagent', 5),
  ]);

  const blockedItems: DashboardResult['blockedItems'] = [
    ...councilData.items
      .filter((i) => i.status === 'blocked')
      .map((i) => {
        isValidItemType('council');
        return { type: 'council' as const, date: i.date, excerpt: i.excerpt };
      }),
    ...p10Data.items
      .filter((i) => i.status === 'blocked')
      .map((i) => {
        isValidItemType('p10');
        return { type: 'p10' as const, date: i.date, excerpt: i.excerpt };
      }),
    ...cabinetData.items
      .filter((i) => i.status === 'held')
      .map((i) => {
        isValidItemType('cabinet');
        return { type: 'cabinet' as const, date: i.date, excerpt: i.excerpt };
      }),
    ...safetyCarData.items
      .filter((i) => i.status === 'fail')
      .map((i) => {
        isValidItemType('safety-car');
        return { type: 'safety-car' as const, date: i.date, excerpt: i.excerpt };
      }),
    ...karpathyData.items
      .filter((i) => i.status === 'fail')
      .map((i) => {
        isValidItemType('karpathy');
        return { type: 'karpathy' as const, date: i.date, excerpt: i.excerpt };
      }),
    ...drsData.items
      .filter((i) => i.status === 'blocked')
      .map((i) => {
        isValidItemType('drs');
        return { type: 'drs' as const, date: i.date, excerpt: i.excerpt };
      }),
  ];

  const result: DashboardResult = {
    councilSessions: { count: councilData.all.length, recent: councilData.items },
    p10Plans: { count: p10Data.all.length, recent: p10Data.items },
    cabinetSessions: { count: cabinetData.all.length, recent: cabinetData.items },
    safetyCarReports: { count: safetyCarData.all.length, recent: safetyCarData.items },
    karpathyChecks: { count: karpathyData.all.length, recent: karpathyData.items },
    drsEvents: { count: drsData.all.length, recent: drsData.items },
    subagentLists: { count: subagentData.all.length, recent: subagentData.items },
    blockedItems,
    generatedAt: new Date().toISOString(),
  };

  assert(Array.isArray(result.councilSessions.recent), 'handleDashboardStatus: recent must be array');
  return result;
}
