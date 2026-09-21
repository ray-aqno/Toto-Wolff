import { describe, expect, it } from 'vitest';
import { parseP10Ruling } from './P10Service.js';

describe('parseP10Ruling', () => {
  it.each([
    ['status: approved', 'approved'],
    ['Status: REVISION-REQUIRED', 'revision-required'],
    ['The plan.\nstatus:   blocked\nBecause.', 'blocked'],
  ])('reads the status from %j', (raw, expected) => {
    expect(parseP10Ruling(raw).status).toBe(expected);
  });

  it('fails closed to "blocked" when there is no status line', () => {
    expect(parseP10Ruling('The arbiter rambled and never ruled.').status).toBe('blocked');
  });

  it('fails closed to "blocked" for an unrecognized status value', () => {
    expect(parseP10Ruling('status: maybe').status).toBe('blocked');
  });

  it('extracts requiredChanges from a required-changes line, in either spelling', () => {
    expect(parseP10Ruling('status: revision-required\nrequired-changes: add a rollback step').requiredChanges).toBe(
      'add a rollback step',
    );
    expect(parseP10Ruling('status: revision-required\nRequired changes: tighten the scope').requiredChanges).toBe(
      'tighten the scope',
    );
  });

  it('omits requiredChanges entirely when there is no such line', () => {
    expect('requiredChanges' in parseP10Ruling('status: approved')).toBe(false);
  });

  it('keeps a short text whole as the summary and cuts a long one at 500 characters', () => {
    expect(parseP10Ruling('status: approved').summary).toBe('status: approved');
    expect(parseP10Ruling(`status: approved ${'x'.repeat(600)}`).summary).toHaveLength(500);
  });
});
