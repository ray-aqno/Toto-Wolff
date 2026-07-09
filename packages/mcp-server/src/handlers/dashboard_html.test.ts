import { describe, it, expect } from 'vitest';
import { renderDashboardHtml, type DashboardResult } from './dashboard_html.js';

const emptyResult: DashboardResult = {
  councilSessions: { count: 0, recent: [] },
  p10Plans: { count: 0, recent: [] },
  blockedItems: [],
  generatedAt: '2026-07-08T00:00:00Z',
};

const populatedResult: DashboardResult = {
  councilSessions: {
    count: 3,
    recent: [
      { date: '2026-07-01', excerpt: 'Approved <script>alert(1)</script> ruling', status: 'approved' },
      { date: '2026-07-02', excerpt: 'Revision required on scope', status: 'revision-required' },
      { date: '2026-07-03', excerpt: 'Clean ruling', status: 'approved' },
    ],
  },
  p10Plans: {
    count: 2,
    recent: [
      { date: '2026-07-01', excerpt: 'Plan A', status: 'approved' },
      { date: '2026-07-02', excerpt: 'Plan B', status: 'blocked' },
    ],
  },
  blockedItems: [{ type: 'p10', date: '2026-07-02', excerpt: 'Blocked "quote" & entity test' }],
  generatedAt: '2026-07-08T00:00:00Z',
};

const mixedEmptyResult: DashboardResult = {
  councilSessions: { count: 2, recent: [{ date: '2026-07-01', excerpt: 'Session', status: 'approved' }] },
  p10Plans: { count: 0, recent: [] },
  blockedItems: [],
  generatedAt: '2026-07-08T00:00:00Z',
};

describe('renderDashboardHtml', () => {
  it('renders a valid HTML document', () => {
    const html = renderDashboardHtml(emptyResult);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html.trim().endsWith('</html>')).toBe(true);
  });

  it('renders the empty state when no sessions or plans exist', () => {
    const html = renderDashboardHtml(emptyResult);
    expect(html).toContain('PIT LANE CLEAR');
    expect(html).toContain('No sessions recorded');
  });

  it('renders populated cards and escapes vault-sourced strings in the decision list (XSS guard)', () => {
    // NOTE: the recentDecisions row goes through esc() and is properly escaped.
    // The raw jsonData dump embedded in the client <script> block (line 579,
    // `const D = ${jsonData}`) is a SEPARATE, pre-existing code path that does
    // NOT escape `<`/`>` — flagged out-of-scope for this refactor (T-DASHBOARD-LINT
    // is a mechanical lint-debt split, not a security fix). See spawned follow-up task.
    const html = renderDashboardHtml(populatedResult);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;quote&quot;');
    expect(html).toContain('id="card-velocity"');
    expect(html).toContain('id="card-p10"');
  });

  it('renders the mixed-empty-state per-card copy (T9 remainder)', () => {
    const html = renderDashboardHtml(mixedEmptyResult);
    expect(html).toContain('No plans yet — run /p10 to start');
    expect(html).toContain('No p10 plans yet — run /p10 to start');
  });

  it('escapes generatedAt in the header and footer', () => {
    const withSpecialChars: DashboardResult = { ...emptyResult, generatedAt: '2026-07-08T00:00:00Z & <tag>' };
    const html = renderDashboardHtml(withSpecialChars);
    expect(html).toContain('GENERATED &nbsp;<span class="val">2026-07-08T00:00:00Z &amp; &lt;tag&gt;</span>');
    expect(html).toContain('BRACKLEY · 2026-07-08T00:00:00Z &amp; &lt;tag&gt;');
  });
});
