/**
 * MCP tool handler for score_confidence.
 * Takes a free-text council `ruling`, loads the vault's active SignalRecords,
 * selects those topically relevant to the ruling (whole-word tag match), and
 * scores that set as of today. When no active records exist at all — dir
 * absent, empty, or holding only expired/invalid files (SignalIndex.load drops
 * all three) — returns LOW with cold-start guidance. Having records but none
 * relevant falls to LOW via scoreConfidence's distinct-record floor.
 */
export declare function handleScoreConfidence(body: unknown, vaultPath: string): Promise<{
    tier: 'HIGH' | 'LOW';
    matchCount: number;
    disqualifiers: string[];
}>;
//# sourceMappingURL=score_confidence_tool.d.ts.map