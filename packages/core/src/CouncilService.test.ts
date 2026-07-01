import { describe, expect, it } from 'vitest';
import { CouncilService } from './CouncilService.js';

function makeService() {
  return {
    _isFactualQuestion(question: string) {
      return CouncilService.prototype['_isFactualQuestion'].call(this, question);
    },
  };
}

describe('CouncilService T10 factual-question heuristic', () => {
  it('treats comparison questions as non-factual even when they use the word versus', () => {
    const service = makeService();

    const isFactual = (service as unknown as { _isFactualQuestion(question: string): boolean })._isFactualQuestion(
      'Which approach is better versus the current rollout?',
    );

    expect(isFactual).toBe(false);
  });

  it('keeps direct factual lookups eligible for the fast path', () => {
    const service = makeService();

    const isFactual = (service as unknown as { _isFactualQuestion(question: string): boolean })._isFactualQuestion(
      'Which pattern did we use for reversal detection?',
    );

    expect(isFactual).toBe(true);
  });
});
