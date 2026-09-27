export declare class VaultCommitError extends Error {
    constructor(message: string);
}
export declare class VaultSearchError extends Error {
    constructor(message: string);
}
export declare class LLMTimeoutError extends Error {
    constructor(message: string);
}
export declare class P10BlockedError extends Error {
    constructor(message: string);
}
export interface VaultWriteResult {
    success: boolean;
    path: string;
}
export interface SearchResult {
    file: string;
    line: number;
    text: string;
}
export type CouncilStatus = 'approved' | 'revision-required' | 'blocked';
export type P10Status = 'approved' | 'revision-required' | 'blocked';
export interface CouncilRuling {
    status: CouncilStatus;
    summary: string;
    conditions?: string[];
}
export interface P10Ruling {
    status: P10Status;
    summary: string;
    requiredChanges?: string;
}
export interface P10Result {
    status: P10Status | 'error';
    planPath?: string;
    error?: string;
    /** Set only when checkSessionBudget() detects a structural fan-out violation. */
    budgetFlag?: 'fanout_overrun';
}
export type CabinetVerdict = 'ship' | 'conditional' | 'block';
export type CabinetSeat = 'garry_tan' | 'feynman' | 'karpathy';
export interface CabinetSeatResult {
    seat: CabinetSeat;
    verdict: CabinetVerdict;
    oneLine: string;
    reasoning: string;
    condition?: string;
    blockingDefect?: string;
    whatWouldChangeVote: string;
}
export interface CabinetResult {
    ruling: 'approved' | 'approved-with-conditions' | 'held';
    seats: CabinetSeatResult[];
    convergence: string;
    tension: string;
    blockingDefect?: string;
    conditions: string[];
    recordPath: string;
}
export type SafetyCarCategory = 'runtime_failure' | 'abuse_vector' | 'blast_radius' | 'wrong_assumption' | 'partial_failure';
export type SafetyCarSeverity = 'critical' | 'high' | 'medium' | 'low';
export interface SafetyCarRisk {
    category: SafetyCarCategory;
    severity: SafetyCarSeverity;
    description: string;
    mitigation: string;
    planRef: string;
}
export interface SafetyCarReport {
    planPath: string;
    risks: SafetyCarRisk[];
    criticalCount: number;
    highCount: number;
    verdict: 'pass' | 'fail' | 'conditional';
    summary: string;
}
export type KarpathyRule = 'simplicity' | 'surgical' | 'goal_driven' | 'think_before_coding';
export interface KarpathyViolation {
    rule: KarpathyRule;
    file: string;
    line: number;
    description: string;
    suggestion: string;
}
export interface KarpathyCheck {
    stage: string;
    status: 'pass' | 'fail';
    violations: KarpathyViolation[];
    summary: string;
}
export type DRSRule = 1 | 2 | 3 | 4 | 5;
export type DRSTool = 'Write' | 'Edit' | 'NotebookEdit' | 'Bash';
export interface DRSCheckInput {
    tool: DRSTool;
    targetPath?: string;
    command?: string;
    messageBefore?: string;
}
export interface DRSResult {
    allowed: boolean;
    ruleFired?: DRSRule;
    reason?: string;
    override?: boolean;
    overrideReason?: string;
}
export interface DRSConfig {
    freezePaths: string[];
    allowedPaths: string[];
    tenantNamespaces: string[];
    currentTenant: string;
    haltPatterns: string[];
    /** Explicit opt-out: when true, an empty allowedPaths means "no restriction" instead of deny-all. */
    permissive?: boolean;
}
export interface AgentConfig {
    name: string;
    description: string;
    tools: string;
    model: string;
    thinking: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'max';
    systemPrompt: string;
    source: 'user' | 'project';
    filePath: string;
}
/**
 * Closed enum of valid pattern values for SignalRecord.
 * Adding a new pattern requires a code change — this is intentional (write-path enforcement).
 * Per council ruling 2026-06-23-toto-wolff-v1-confidence-scoring-contract.
 */
export declare const SIGNAL_PATTERNS: readonly ["shared-session-state-auth-extraction", "architectural-decision-record", "p10-approved-plan"];
export type SignalPattern = typeof SIGNAL_PATTERNS[number];
/** Typed governance signal record — core fields plus optional scoring fields. */
export interface SignalRecord {
    id: string;
    content_hash: string;
    valid_until: string;
    verdict: 'approved' | 'blocked' | 'conditional-approve' | 'revision-required';
    /** Closed enum value from SIGNAL_PATTERNS — absent on legacy records. */
    pattern?: string;
    /** Exact-membership tag set for Jaccard scoring — absent on legacy records. */
    topic_tags?: string[];
}
/** isSignalRecord is the only legal path from unknown to SignalRecord. */
export declare function isSignalRecord(v: unknown): v is SignalRecord;
//# sourceMappingURL=types.d.ts.map