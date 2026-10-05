// The RFC and ADR templates served by graph_template. Kept as strings in a
// .mts file because the plugin ships only .mts files under server/. #63
// checks a written document against these `## ` headings.
import assert from 'node:assert/strict';

export const TEMPLATE_KINDS = ['rfc', 'adr'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

const RFC = `# RFC NNNN: <title>

- Status: draft
- Date: <YYYY-MM-DD>
- Run: <runId>

## Summary

One paragraph: what is proposed and why, in plain words.

## Motivation

The problem, who has it, and what happens if nothing changes.

## Design

How it works. Interfaces, data, and behavior a reader needs to build or review it.

## Alternatives

Other approaches considered, and why each was not chosen.

## Risks

What could go wrong, how likely it is, and how it is contained or detected.

## Rollout

How it ships: steps, migration, how it is turned off or rolled back.

## Open questions

What is still undecided, and who decides it.
`;

const ADR = `# ADR NNNN: <decision title>

- Date: <YYYY-MM-DD>
- Run: <runId>

## Status

Proposed, accepted, superseded (by ADR NNNN) or deprecated.

## Context

The forces at play: the problem, the constraints, and the facts that make a decision necessary now.

## Decision

The decision, stated in one or two sentences, then the details that matter.

## Consequences

What becomes easier, what becomes harder, and what must now be done because of this decision.
`;

/** Whether a value names a template (`rfc` or `adr`). */
export function isTemplateKind(value: unknown): value is TemplateKind {
  return typeof value === 'string' && (TEMPLATE_KINDS as readonly string[]).includes(value);
}

/** The template's Markdown. */
export function templateFor(kind: TemplateKind): string {
  const markdown = kind === 'rfc' ? RFC : ADR;
  assert.ok(markdown.includes('\n## '), 'a template has level-2 headings');
  assert.ok(markdown.endsWith('\n'), 'a template ends with a newline');
  return markdown;
}

/** The `## ` headings a document must contain (used by #63). */
export function templateHeadings(kind: TemplateKind): string[] {
  const headings = templateFor(kind).split('\n').filter((line) => line.startsWith('## '));
  assert.ok(headings.length >= 4, 'a template has at least four sections');
  return headings;
}
