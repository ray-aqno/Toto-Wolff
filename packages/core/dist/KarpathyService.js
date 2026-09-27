import assert from 'node:assert';
import { withLLMTimeout } from './utils/timeout.js';
import { createAnthropicClient } from './utils/anthropic.js';
const KARPATHY_RULES = [
    'simplicity',
    'surgical',
    'goal_driven',
    'think_before_coding',
];
const KARPATHY_PERSONA = `You are the Karpathy execution verifier.
Check the implementation against the approved P10 plan stage.
4 Rules to enforce:

1. SIMPLICITY — Minimum code that solves the problem. Nothing speculative.
   - No features beyond what the P10 stage specifies
   - No abstractions for single-use code
   - No "flexibility" or "configurability" not in the approved plan
   - If you wrote 200 lines and it could be 50, flag it

2. SURGICAL — Touch only what the P10 stage authorizes. Clean up only your own mess.
   - Don't improve adjacent code, comments, or formatting
   - Don't refactor things outside the P10 stage scope
   - Match existing style, even if you'd do it differently
   - Remove imports/variables/functions YOUR changes made unused
   - Don't remove pre-existing dead code unless P10 plan explicitly includes it

3. GOAL_DRIVEN — Define success criteria per P10 stage. Loop until verified.
   - Each stage has assertions and return-value requirements
   - Map them to verifiable goals
   - Strong success criteria let execution loop independently

4. THINK_BEFORE_CODING — Don't assume. Don't hide confusion. Surface tradeoffs.
   - State assumptions explicitly. If uncertain, ask.
   - If multiple interpretations exist, present them — don't pick silently
   - If a simpler approach exists, say so. Push back when warranted
   - If something is unclear, stop. Name what's confusing. Ask.

Input: P10 plan stage + implementation diff (or plan only if pre-execution).
Output EXACTLY this JSON:
{
  "violations": [
    {
      "rule": "simplicity|surgical|goal_driven|think_before_coding",
      "file": "path/to/file.ts",
      "line": 42,
      "description": "specific violation with evidence",
      "suggestion": "concrete fix"
    }
  ]
}

If no violations, return {"violations": []}. No preamble.`;
const REPORT_PERSONA = `You are the Karpathy report writer.
Input: violations found (already validated).
Output EXACTLY this JSON:
{
  "status": "pass|fail",
  "summary": "one paragraph — overall assessment"
}
Status: pass = 0 violations. fail = >0 violations.`;
export class KarpathyService {
    client;
    vault;
    constructor(vault) {
        assert(vault !== undefined, 'vault is required');
        this.vault = vault;
        this.client = createAnthropicClient();
    }
    async check(planPath, stage, diff) {
        assert(typeof planPath === 'string' && planPath.length > 0, 'planPath must be non-empty');
        assert(typeof stage === 'string' && stage.length > 0, 'stage must be non-empty');
        const violations = await this.verifyStage(planPath, stage, diff);
        return this.reportViolations(stage, violations);
    }
    async verifyStage(planPath, stage, diff) {
        const planContent = await this.loadPlan(planPath);
        const prompt = this.buildPrompt(planContent, stage, diff);
        const result = await withLLMTimeout((opts) => this.callModel(prompt, opts), 'karpathy-verify');
        return this.parseViolations(result);
    }
    buildPrompt(planContent, stage, diff) {
        let prompt = `P10 PLAN STAGE: ${stage}

PLAN CONTENT:
${planContent}`;
        if (diff) {
            prompt += `\n\nIMPLEMENTATION DIFF:\n${diff}`;
        }
        else {
            prompt += '\n\n(No diff provided — pre-execution check only)';
        }
        return prompt;
    }
    async callModel(prompt, opts) {
        const msg = await this.client.messages.create({
            model: 'claude-opus-4-8',
            max_tokens: 2048,
            temperature: 0,
            system: KARPATHY_PERSONA,
            messages: [{ role: 'user', content: prompt }],
        }, { signal: opts.signal });
        const block = msg.content[0];
        return block?.type === 'text' ? block.text : '';
    }
    async loadPlan(planPath) {
        const results = await this.vault.search(planPath);
        const match = results.find((r) => r.file.includes(planPath) || r.text.includes(planPath));
        if (!match) {
            throw new Error(`Plan not found in vault: ${planPath}`);
        }
        return match.text;
    }
    parseViolations(raw) {
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed.violations))
                return [];
            return parsed.violations
                .filter((v) => this.isValidViolation(v))
                .map((v) => v);
        }
        catch {
            return [];
        }
    }
    isValidViolation(v) {
        if (typeof v !== 'object' || v === null)
            return false;
        const r = v;
        if (!KARPATHY_RULES.includes(r.rule))
            return false;
        if (typeof r.file !== 'string' || r.file.length === 0)
            return false;
        if (typeof r.line !== 'number' || r.line < 0)
            return false;
        if (typeof r.description !== 'string' || r.description.length === 0)
            return false;
        if (typeof r.suggestion !== 'string' || r.suggestion.length === 0)
            return false;
        return true;
    }
    reportViolations(stage, violations) {
        const status = violations.length === 0 ? 'pass' : 'fail';
        const summary = this.buildSummary(violations, status);
        return { stage, status, violations, summary };
    }
    buildSummary(violations, status) {
        if (violations.length === 0) {
            return 'Karpathy check passed: no violations across all 4 rules.';
        }
        const byRule = new Map();
        for (const v of violations) {
            byRule.set(v.rule, (byRule.get(v.rule) ?? 0) + 1);
        }
        const parts = [`Karpathy check failed: ${violations.length} violation(s).`];
        for (const [rule, count] of byRule) {
            parts.push(`  ${rule}: ${count}`);
        }
        return parts.join(' ');
    }
}
//# sourceMappingURL=KarpathyService.js.map