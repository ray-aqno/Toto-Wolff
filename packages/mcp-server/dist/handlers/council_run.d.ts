import type { CouncilService, CouncilResult } from '@toto-wolff/core';
/**
 * Derives coarse topic tags from a question when the caller doesn't supply
 * currentTags explicitly — this is what makes T5 reversal detection reachable
 * from a real council_run call instead of only from hand-supplied test tags.
 */
export declare function extractQuestionTags(question: string): string[];
export declare function handleCouncilRun(input: unknown, council: CouncilService, vaultPath: string): Promise<CouncilResult>;
//# sourceMappingURL=council_run.d.ts.map