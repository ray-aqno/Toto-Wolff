/**
 * Provenance binding check — fail-closed semantics.
 * Pure function, no I/O. Takes the verdict IDs the plan claims to have consumed
 * and the IDs actually returned by /vault/signal in this session.
 * Returns ok=false if any claimed ID was not in the session response.
 * Empty sessionIds is a first-class cold-start state, not an error.
 */
export declare function checkProvenance(claimedIds: string[], sessionIds: string[]): {
    ok: boolean;
    missing: string[];
    loop_informed: boolean;
};
//# sourceMappingURL=checkProvenance.d.ts.map