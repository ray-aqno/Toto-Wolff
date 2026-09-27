/** A single detected contradiction between a plan and its cited verdicts. */
export interface ContradictionEntry {
    plan_file: string;
    verdict_id: string;
    issue: string;
}
/** Result of one audit run. */
export interface AuditReport {
    checked: number;
    contradictions: ContradictionEntry[];
    generated_at: string;
}
/**
 * Scans all P10-Plans/ .md files with loop_informed: true in their frontmatter.
 * For each cited verdict ID, checks whether the signal exists in Signals/ and
 * has not expired. Flags missing or expired verdicts as contradictions.
 *
 * Pure audit function — does not write to vault. Caller decides what to do
 * with the AuditReport.
 */
export declare function auditContradictions(vaultPath: string): Promise<AuditReport>;
//# sourceMappingURL=contradiction_auditor.d.ts.map