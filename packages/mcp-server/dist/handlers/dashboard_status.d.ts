import { VaultServiceV2 } from '@toto-wolff/core';
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
export declare function isValidItemType(t: unknown): t is 'council' | 'p10' | 'cabinet' | 'safety-car' | 'karpathy' | 'drs' | 'subagent';
/** Extract YYYY-MM-DD from a filename. Returns 'unknown' if no date found. */
export declare function extractDate(filename: string): string;
/** Extract status from file content by scanning for "Status:" lines. */
export declare function extractStatus(content: string): string;
/**
 * Reads the last `limit` files from a directory, sorted by name descending.
 * Returns empty arrays if the directory does not exist.
 * Loop bound: at most Math.min(files.length, limit) iterations; limit ≤ 200.
 * Uses listDirAll() (uncapped), not listDir(), because these governance
 * subdirectories are append-oriented with no 1000-file invariant — sorting
 * a pre-capped, filesystem-order subset would both undercount and pick "most
 * recent" from an arbitrary slice rather than the true tail.
 */
export declare function readRecentItems(vault: VaultServiceV2, subDir: string, limit: number): Promise<{
    all: string[];
    items: DashboardItem[];
}>;
/**
 * Builds a full DashboardResult snapshot from the vault.
 * Reads Council/Congressional-Records, P10-Plans, Cabinet, SafetyCar, Karpathy, DRS, and Subagent directories.
 */
export declare function handleDashboardStatus(vaultPath: string): Promise<DashboardResult>;
//# sourceMappingURL=dashboard_status.d.ts.map