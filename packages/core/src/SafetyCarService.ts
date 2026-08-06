import type Anthropic from '@anthropic-ai/sdk';
import assert from 'node:assert';
import { withLLMTimeout } from './utils/timeout.js';
import { createAnthropicClient } from './utils/anthropic.js';
import type { VaultService } from './VaultService.js';
import type { SafetyCarReport, SafetyCarRisk, SafetyCarCategory, SafetyCarSeverity } from './types.js';

const SAFETY_CAR_CATEGORIES: SafetyCarCategory[] = [
  'runtime_failure',
  'abuse_vector',
  'blast_radius',
  'wrong_assumption',
  'partial_failure',
];

const SEVERITY_ORDER: Record<SafetyCarSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const SAFETY_CAR_PERSONA = `You are the Safety Car — adversarial stress test of an approved P10 plan.
Your job: find failure modes the plan missed. Be thorough. Be specific.
Categories (check ALL):
1. runtime_failure — unhandled errors, missing try/catch, null derefs, unchecked returns
2. abuse_vector — input validation gaps, injection, path traversal, auth bypass
3. blast_radius — single change affects unrelated modules, cascading failures, shared mutable state
4. wrong_assumption — env vars present, API stable, user behavior predictable, external deps reliable
5. partial_failure — network timeout, partial write, inconsistent state, partial rollback

For each risk found, return EXACTLY this JSON shape:
{
  "risks": [
    {
      "category": "runtime_failure|abuse_vector|blast_radius|wrong_assumption|partial_failure",
      "severity": "critical|high|medium|low",
      "description": "specific failure scenario with file:line if possible",
      "mitigation": "concrete fix or guard to add",
      "planRef": "plan-file.md:123"
    }
  ]
}

If no risks in a category, omit it. No preamble. No hedging.`;

const REPORT_PERSONA = `You are the Safety Car report writer.
Input: Safety Car risks (already found).
Output EXACTLY this JSON:
{
  "verdict": "pass|fail|conditional",
  "summary": "one paragraph — overall assessment"
}
Verdict rules: pass = 0 critical, 0 high. conditional = 0 critical, >0 high. fail = >0 critical.`;

export class SafetyCarService {
  private readonly client: Anthropic;
  private readonly vault: VaultService;

  constructor(vault: VaultService) {
    assert(vault !== undefined, 'vault is required');
    this.vault = vault;
    this.client = createAnthropicClient();
  }

  async run(planPath: string): Promise<SafetyCarReport> {
    assert(typeof planPath === 'string' && planPath.length > 0, 'planPath must be non-empty');

    const planContent = await this.loadPlan(planPath);
    const risks = await this.adversarialReview(planContent, planPath);
    return this.emitReport(planPath, risks);
  }

  private async loadPlan(planPath: string): Promise<string> {
    const results = await this.vault.search(planPath);
    const match = results.find((r) => r.file.includes(planPath) || r.text.includes(planPath));
    if (!match) {
      throw new Error(`Plan not found in vault: ${planPath}`);
    }
    return match.text;
  }

  private async adversarialReview(
    planContent: string,
    planPath: string
  ): Promise<SafetyCarRisk[]> {
    const prompt = `PLAN UNDER REVIEW:
${planContent}

PLAN PATH: ${planPath}`;

    const result = await withLLMTimeout(
      (opts) => this.callModel(prompt, opts),
      'safety-car-review',
    );

    const risks = this.parseRisks(result, planPath);
    return this.validateRisks(risks);
  }

  private async callModel(prompt: string, opts: { signal: AbortSignal }): Promise<string> {
    const msg = await this.client.messages.create(
      {
        model: 'claude-opus-4-8',
        max_tokens: 2048,
        temperature: 0,
        system: SAFETY_CAR_PERSONA,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: opts.signal },
    );

    const block = msg.content[0];
    return block?.type === 'text' ? block.text : '';
  }

  private parseRisks(raw: string, planPath: string): SafetyCarRisk[] {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.risks)) return [];
      return parsed.risks.map((r: unknown) => {
        const risk = r as Record<string, unknown>;
        return {
          category: risk.category as SafetyCarCategory,
          severity: risk.severity as SafetyCarSeverity,
          description: String(risk.description ?? ''),
          mitigation: String(risk.mitigation ?? ''),
          planRef: String(risk.planRef ?? planPath),
        };
      });
    } catch {
      return [];
    }
  }

  private validateRisks(risks: SafetyCarRisk[]): SafetyCarRisk[] {
    return risks.filter((r) => {
      if (!SAFETY_CAR_CATEGORIES.includes(r.category)) return false;
      if (!Object.keys(SEVERITY_ORDER).includes(r.severity)) return false;
      if (typeof r.description !== 'string' || r.description.length === 0) return false;
      if (typeof r.mitigation !== 'string' || r.mitigation.length === 0) return false;
      if (typeof r.planRef !== 'string' || r.planRef.length === 0) return false;
      return true;
    });
  }

  private emitReport(planPath: string, risks: SafetyCarRisk[]): SafetyCarReport {
    const criticalCount = risks.filter((r) => r.severity === 'critical').length;
    const highCount = risks.filter((r) => r.severity === 'high').length;

    let verdict: 'pass' | 'fail' | 'conditional';
    if (criticalCount > 0) verdict = 'fail';
    else if (highCount > 0) verdict = 'conditional';
    else verdict = 'pass';

    const summary = this.buildSummary(risks, verdict);

    return {
      planPath,
      risks,
      criticalCount,
      highCount,
      verdict,
      summary,
    };
  }

  private buildSummary(risks: SafetyCarRisk[], verdict: 'pass' | 'fail' | 'conditional'): string {
    const byCategory = new Map<SafetyCarCategory, SafetyCarRisk[]>();
    for (const r of risks) {
      const arr = byCategory.get(r.category) ?? [];
      arr.push(r);
      byCategory.set(r.category, arr);
    }

    const parts = [`Safety Car verdict: ${verdict}.`];
    if (risks.length === 0) {
      parts.push('No risks detected across all 5 categories.');
    } else {
      parts.push(`Found ${risks.length} risk(s):`);
      for (const [cat, catRisks] of byCategory) {
        const maxSev = catRisks.reduce((max, r) =>
          SEVERITY_ORDER[r.severity] > SEVERITY_ORDER[max] ? r.severity : max,
          'low' as SafetyCarSeverity
        );
        parts.push(`  ${cat}: ${catRisks.length} (max ${maxSev})`);
      }
    }
    return parts.join(' ');
  }
}