import { describe, it, expect } from 'vitest';
import { renderDashboardHtml, type DashboardResult } from './dashboard_html.js';

const emptyResult: DashboardResult = {
  councilSessions: { count: 0, recent: [] },
  p10Plans: { count: 0, recent: [] },
  cabinetSessions: { count: 0, recent: [] },
  safetyCarReports: { count: 0, recent: [] },
  karpathyChecks: { count: 0, recent: [] },
  drsEvents: { count: 0, recent: [] },
  subagentLists: { count: 0, recent: [] },
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
  cabinetSessions: { count: 0, recent: [] },
  safetyCarReports: { count: 0, recent: [] },
  karpathyChecks: { count: 0, recent: [] },
  drsEvents: { count: 0, recent: [] },
  subagentLists: { count: 0, recent: [] },
  blockedItems: [{ type: 'p10', date: '2026-07-02', excerpt: 'Blocked "quote" & entity test' }],
  generatedAt: '2026-07-08T00:00:00Z',
};

const mixedEmptyResult: DashboardResult = {
  councilSessions: { count: 2, recent: [{ date: '2026-07-01', excerpt: 'Session', status: 'approved' }] },
  p10Plans: { count: 0, recent: [] },
  cabinetSessions: { count: 0, recent: [] },
  safetyCarReports: { count: 0, recent: [] },
  karpathyChecks: { count: 0, recent: [] },
  drsEvents: { count: 0, recent: [] },
  subagentLists: { count: 0, recent: [] },
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
    // The recentDecisions row goes through esc() and is properly escaped. The raw
    // jsonData dump embedded in the client <script> block is now also safe — see
    // the dedicated script-injection test below (fix/dashboard-json-script-escape).
    const html = renderDashboardHtml(populatedResult);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;quote&quot;');
    expect(html).toContain('id="card-velocity"');
    expect(html).toContain('id="card-p10"');
  });

  it('does not let a </script> substring in a vault excerpt close the inline script early', () => {
    const withInjection: DashboardResult = {
      ...emptyResult,
      councilSessions: {
        count: 1,
        recent: [{ date: '2026-07-08', excerpt: 'malicious excerpt </script><script>alert(1)</script>', status: 'approved' }],
      },
    };
    const html = renderDashboardHtml(withInjection);
    const scriptStart = html.indexOf('const D = ');
    const scriptBodyEnd = html.indexOf('</script>', scriptStart);
    const dataLine = html.slice(scriptStart, scriptBodyEnd);
    expect(dataLine).not.toContain('</script>');
    expect(html).not.toContain('<script>alert(1)</script>');
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

  // L6-001: a blocked item alone must not be swallowed by the empty-state
  // short-circuit, which previously keyed only off council/p10 counts.
  it('renders the blocked-items section, not the empty state, when only blockedItems is non-empty', () => {
    const blockedOnly: DashboardResult = {
      ...emptyResult,
      blockedItems: [{ type: 'council', date: '2026-07-08', excerpt: 'Blocked with zero sessions/plans' }],
    };
    const html = renderDashboardHtml(blockedOnly);
    // Not a bare .not.toContain('PIT LANE CLEAR') — that string also appears,
    // correctly, as inert client-side JS source inside buildBlockedPanel()'s
    // own (different, per-panel) empty-state branch, which never executes for
    // this fixture's non-empty blockedItems but is always present as source.
    expect(html).not.toContain('<div class="empty-heading">PIT LANE CLEAR</div>');
    expect(html).toContain('Blocked with zero sessions/plans');
  });

  // L6-002: fireAll() previously animated only spark-council/spark-p10, silently
  // skipping the cabinet and subagent sparklines.
  it('fires animateSpark for spark-cabinet and spark-subagent, not just council/p10', () => {
    const html = renderDashboardHtml(emptyResult);
    expect(html).toContain("animateSpark('spark-cabinet')");
    expect(html).toContain("animateSpark('spark-subagent')");
  });

  // L6-003: sparklines previously plotted a synthetic always-rising index
  // sequence (one point per item) regardless of real per-period distribution.
  // 4 council items across 2 distinct months must now produce a 2-point
  // bucketed polyline, not a 4-point index-sequence polyline.
  it('plots real per-period bucket counts in the council sparkline, not a monotonic per-item index', () => {
    const nonUniform: DashboardResult = {
      ...emptyResult,
      councilSessions: {
        count: 4,
        recent: [
          { date: '2026-05-01', excerpt: 'a', status: 'approved' },
          { date: '2026-06-01', excerpt: 'b', status: 'approved' },
          { date: '2026-06-02', excerpt: 'c', status: 'approved' },
          { date: '2026-06-03', excerpt: 'd', status: 'approved' },
        ],
      },
    };
    const html = renderDashboardHtml(nonUniform);
    const marker = 'id="spark-council" points="';
    const start = html.indexOf(marker) + marker.length;
    const end = html.indexOf('"', start);
    const pointCount = html.slice(start, end).trim().split(/\s+/).length;
    expect(pointCount).toBe(2); // 2 monthly buckets (2026-05, 2026-06), not 4 (one per item)
  });

  // L6-004: .card-label's contrast against --card (#181818) previously failed
  // WCAG AA via var(--dim) (#555, ~2.38:1). Repointed to a new --label token.
  it('repoints .card-label off var(--dim) to the new --label contrast token', () => {
    const html = renderDashboardHtml(emptyResult);
    expect(html).toContain('--label: #9a9a9a');
    expect(html).not.toContain('.card-label   { font-family: var(--mono); font-size: .62rem; color: var(--dim);');
    expect(html).toContain('.card-label   { font-family: var(--mono); font-size: .62rem; color: var(--label);');
  });

  // L6-007: the record-panel fetch handler previously rendered "Record not
  // found." for every failure, including network errors and non-404 statuses.
  it('branches the record-panel fetch failure message on 404 vs. any other status', () => {
    const html = renderDashboardHtml(emptyResult);
    expect(html).toContain("status === 404 ? 'Record not found.' : 'Could not load record — check your connection and try again.'");
  });
});
