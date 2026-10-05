import { join, isAbsolute } from 'node:path';
import assert from 'node:assert';
import type { VaultService as VaultServiceV2 } from '../core/vault/VaultService.mts';
import { getCachedVault } from './vault_cache.mts';
import type { DashboardItem, DashboardResult } from './dashboard_html.mts';

export type { DashboardItem, DashboardResult };

function getVault(vaultPath: string): Promise<VaultServiceV2> {
  return getCachedVault(vaultPath);
}

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
 * Uses listDirAll() (uncapped), not listDir(), because these governance
 * subdirectories are append-oriented with no 1000-file invariant — sorting
 * a pre-capped, filesystem-order subset would both undercount and pick "most
 * recent" from an arbitrary slice rather than the true tail.
 */
export async function readRecentItems(
  vault: VaultServiceV2,
  subDir: string,
  limit: number,
): Promise<{ all: string[]; items: DashboardItem[] }> {
  assert(limit > 0 && limit <= 200, 'readRecentItems: limit must be in [1, 200]');

  let filenames: string[];
  try {
    filenames = (await vault.listDirAll(subDir)).filter((f) => !f.startsWith('.')).sort().reverse();
  } catch {
    return { all: [], items: [] };
  }

  // LOOP BOUND: Math.min(filenames.length, limit) iterations; limit ≤ 200
  const recent = filenames.slice(0, limit);
  const items: DashboardItem[] = [];

  for (const filename of recent) {
    const relPath = join(subDir, filename);
    let content = '';
    try {
      content = (await vault.read(relPath)) ?? '';
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

type BlockedItem = DashboardResult['blockedItems'][number];

/** The recent items of one record type whose status marks them as blocked. */
function blockedOf(type: BlockedItem['type'], data: { items: DashboardItem[] }, blockedStatus: string): BlockedItem[] {
  assert(isValidItemType(type), 'blockedOf: type must be a valid record type');
  assert(Array.isArray(data.items), 'blockedOf: items must be an array');
  return data.items
    .filter((i) => i.status === blockedStatus)
    .map((i) => ({ type, date: i.date, excerpt: i.excerpt }));
}

/**
 * Builds a full DashboardResult snapshot from the vault.
 * Reads Council/Congressional-Records, P10-Plans, Cabinet, SafetyCar, Karpathy, DRS, and Subagent directories.
 */
export async function handleDashboardStatus(vaultPath: string): Promise<DashboardResult> {
  assert(isAbsolute(vaultPath), 'handleDashboardStatus: vaultPath must be absolute');
  const vault = await getVault(vaultPath);

  const [
    councilData,
    p10Data,
    cabinetData,
    safetyCarData,
    karpathyData,
    drsData,
    subagentData,
  ] = await Promise.all([
    readRecentItems(vault, 'Council/Congressional-Records', 5),
    readRecentItems(vault, 'P10-Plans', 5),
    readRecentItems(vault, 'Cabinet', 5),
    readRecentItems(vault, 'SafetyCar', 5),
    readRecentItems(vault, 'Karpathy', 5),
    readRecentItems(vault, 'DRS', 5),
    readRecentItems(vault, 'Subagent', 5),
  ]);

  const blockedItems: DashboardResult['blockedItems'] = [
    ...blockedOf('council', councilData, 'blocked'),
    ...blockedOf('p10', p10Data, 'blocked'),
    ...blockedOf('cabinet', cabinetData, 'held'),
    ...blockedOf('safety-car', safetyCarData, 'fail'),
    ...blockedOf('karpathy', karpathyData, 'fail'),
    ...blockedOf('drs', drsData, 'blocked'),
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
