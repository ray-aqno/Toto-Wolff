/**
 * Provenance binding check — fail-closed semantics.
 * Pure function, no I/O. Takes the verdict IDs the plan claims to have consumed
 * and the IDs actually returned by /vault/signal in this session.
 * Returns ok=false if any claimed ID was not in the session response.
 * Empty sessionIds is a first-class cold-start state, not an error.
 */
export function checkProvenance(
  claimedIds: string[],
  sessionIds: string[],
): { ok: boolean; missing: string[]; loop_informed: boolean } {
  const sessionSet = new Set(sessionIds);
  const missing = claimedIds.filter((id) => !sessionSet.has(id));
  const loop_informed = sessionIds.length > 0;
  return { ok: missing.length === 0, missing, loop_informed };
}
