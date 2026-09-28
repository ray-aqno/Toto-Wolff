import type Anthropic from '@anthropic-ai/sdk';
export declare const COUNCIL_MAX_CALLS = 9;
export declare const COUNCIL_STATIC_CEILING: number;
export declare const P10_MAX_CALLS = 9;
export declare const P10_STATIC_CEILING: number;
export interface UsageRecord {
    usage: Anthropic.Usage;
    callSite: string;
}
/** Shared vault-record flag value — reused by CouncilResult and P10Result. */
export type BudgetFlag = 'fanout_overrun';
export type BudgetVerdict = {
    kind: 'ok';
} | {
    kind: 'seat_overrun';
    totalTokens: number;
} | {
    kind: 'fanout_overrun';
    totalTokens: number;
    ceiling: number;
};
/**
 * Wraps a model response's usage field into a UsageRecord. Never throws —
 * degrades to a zeroed record on missing/malformed usage data, matching the
 * degrade-don't-throw pattern in CouncilService.run()'s detectReversal call.
 */
export declare function trackUsage(usage: Anthropic.Usage | undefined, callSite: string): UsageRecord;
/**
 * Pure verdict function — no console, no I/O. Distinguishes a legitimate
 * deep session (seat_overrun: call count within maxCalls, tokens trending
 * high) from a structural fan-out bug (fanout_overrun: call count or
 * aggregate usage exceeds what the fixed call graph can produce).
 */
export declare function checkSessionBudget(records: UsageRecord[], ceiling: number, maxCalls: number): BudgetVerdict;
//# sourceMappingURL=TokenBudget.d.ts.map