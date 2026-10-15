// The built-in graphs (#63). Built through parseGraph on every call, so a
// built-in graph is validated like any user graph and no module state exists.
import assert from 'node:assert/strict';
import type { Graph } from './model.mts';
import { parseGraph } from './validate.mts';

export const IDEA_TO_PR = 'idea-to-pr';

const FALLBACK = 'If that skill is not available, do this step directly and start the evidence with "did directly: <reason>".';

function step(id: string, skill: string, instruction: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, kind: 'skill', skill, instruction: `${instruction} ${FALLBACK}`, ...extra };
}

function gate(id: string, instruction: string): Record<string, unknown> {
  return { id, kind: 'human_gate', instruction };
}

function doc(kind: 'rfc' | 'adr'): Record<string, unknown> {
  const name = kind.toUpperCase();
  return step(kind, 'graph_template', `Write the ${name}: get the template with graph_template({ kind: "${kind}" }), fill every section for this idea, and save it at the step's doc.path (create the folder if needed; never overwrite an existing file). Report pass with artifacts[0] set to that path.`, { check: `${kind}-doc` });
}

// spec -> council -> gate -> rfc|adr -> p10 -> gate -> safety-car -> karpathy loop -> gate -> pr
function ideaToPr(): unknown {
  return {
    id: IDEA_TO_PR,
    version: 1,
    nodes: [
      step('spec', 'spec', 'Turn the idea into a scoped brief: the problem, who has it, what is in and out of scope, and how success is measured.'),
      step('council', 'llm-council', 'Convene the council on the brief and record its ruling (decision, conditions, dissent).'),
      gate('approve-ruling', 'Ask the person whether to proceed on the council ruling.'),
      { id: 'kind', kind: 'choice', instruction: 'Ask the person whether this idea needs an RFC (a proposal to review) or an ADR (a decision to record), with your recommendation; report their pick as the choice.', options: { rfc: ['rfc'], adr: ['adr'] } },
      doc('rfc'),
      doc('adr'),
      step('p10', 'p10-bridge', 'Write the P10 implementation plan for the idea, based on the brief, the ruling and the RFC or ADR, and get it approved by its arbiter.'),
      gate('approve-plan', 'Ask the person whether to proceed with the approved P10 plan.'),
      step('safety-car', 'safety-car', 'Run the Safety Car on the approved P10 plan and fold its mitigations in; report fail if it stays DEPLOYED.'),
      { id: 'karpathy', kind: 'loop', skill: 'karpathy', maxIterations: 3, instruction: `Execute every remaining P10 stage, then verify each one with the Karpathy rules. The iteration passes only when every stage passes; the evidence lists each stage's verdict. ${FALLBACK}` },
      gate('approve-pr', 'Ask the person whether to open the pull request.'),
      step('pr', 'ship', 'Open the pull request for the work. Report pass with the evidence set to the pull request URL alone.', { check: 'pr-url' }),
    ],
    edges: [
      ['spec', 'council'], ['council', 'approve-ruling'], ['approve-ruling', 'kind'], ['kind', 'rfc'], ['kind', 'adr'],
      ['rfc', 'p10'], ['adr', 'p10'], ['p10', 'approve-plan'], ['approve-plan', 'safety-car'], ['safety-car', 'karpathy'],
      ['karpathy', 'approve-pr'], ['approve-pr', 'pr'],
    ],
  };
}

/** The built-in graphs, freshly built and validated. */
export function builtinGraphs(): Graph[] {
  const graphs = [parseGraph(ideaToPr())];
  assert.ok(graphs.every((g) => g.nodes.length > 0), 'built-in graphs have nodes');
  assert.equal(graphs[0]?.id, IDEA_TO_PR, 'idea-to-pr is built in');
  return graphs;
}
