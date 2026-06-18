/**
 * dashboard_html.ts — server-renders a self-contained HTML dashboard from DashboardResult.
 * Pure function over the input: no filesystem reads, no external fetches.
 */

export interface DashboardItem {
  date: string;
  excerpt: string;
  status: string;
}

export interface DashboardResult {
  councilSessions: { count: number; recent: DashboardItem[] };
  p10Plans: { count: number; recent: DashboardItem[] };
  blockedItems: Array<{ type: 'council' | 'p10'; date: string; excerpt: string }>;
  generatedAt: string;
}

/** Renders a two-cell table row with a label and value. */
function buildRow(label: string, value: string | number): string {
  return `<tr><td class="lbl">${label}</td><td class="val">${value}</td></tr>`;
}

/**
 * Renders a self-contained HTML page for the Toto Wolff engineering dashboard.
 * Returns a string with inline CSS, no external assets, and four metric sections:
 * decision velocity, reversal rate, P10 compliance, and role adoption (blocked items).
 * Displays empty-state copy when no sessions exist.
 */
export function renderDashboardHtml(data: DashboardResult): string {
  const empty = data.councilSessions.count === 0 && data.p10Plans.count === 0;
  const emptyMsg = '<p class="empty">No sessions yet — run /council to start</p>';

  const revisions = data.councilSessions.recent.filter((i) => i.status === 'revision-required').length;
  const reversalRate = data.councilSessions.count === 0
    ? 'N/A'
    : `${revisions} / ${data.councilSessions.count}`;

  const approved = data.p10Plans.recent.filter((i) => i.status === 'approved').length;
  const p10Compliance = data.p10Plans.count === 0
    ? 'N/A'
    : `${approved} / ${data.p10Plans.count} recent approved`;

  const blockedRows = data.blockedItems.length === 0
    ? '<tr><td colspan="3" class="empty">No blocked items</td></tr>'
    : data.blockedItems.map((b) =>
        `<tr><td>${b.type}</td><td>${b.date}</td><td>${b.excerpt}</td></tr>`
      ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Toto Wolff Dashboard</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0d0d0d;color:#e8e8e8;margin:0;padding:2rem}
  h1{font-size:1.4rem;margin-bottom:1.5rem;letter-spacing:.05em;color:#f5f5f5}
  h2{font-size:1rem;color:#aaa;margin:1.5rem 0 .5rem}
  table{border-collapse:collapse;width:100%;margin-bottom:1rem}
  th,td{text-align:left;padding:.4rem .6rem;border-bottom:1px solid #222;font-size:.875rem}
  th{color:#888;font-weight:500}
  .lbl{color:#aaa;width:40%}.val{color:#e8e8e8}
  .empty{color:#555;font-style:italic;font-size:.875rem;margin:.5rem 0}
  .meta{color:#444;font-size:.75rem;margin-top:2rem}
</style>
</head>
<body>
<h1>Toto Wolff — Engineering Dashboard</h1>

<h2>Decision Velocity</h2>
${empty ? emptyMsg : `<table>${buildRow('Total council sessions', data.councilSessions.count)}</table>`}

<h2>Reversal Rate</h2>
${empty ? emptyMsg : `<table>${buildRow('Revision-required / total', reversalRate)}</table>`}

<h2>P10 Compliance</h2>
${empty ? emptyMsg : `<table>${buildRow('Approved plans (recent)', p10Compliance)}${buildRow('Total P10 plans', data.p10Plans.count)}</table>`}

<h2>Role Adoption — Blocked Items</h2>
${data.blockedItems.length === 0 && !empty ? '<p class="empty">No blocked items</p>' : ''}
${!empty && data.blockedItems.length > 0 ? `<table><thead><tr><th>Type</th><th>Date</th><th>Excerpt</th></tr></thead><tbody>${blockedRows}</tbody></table>` : ''}
${empty ? emptyMsg : ''}

<p class="meta">Generated: ${data.generatedAt}</p>
</body>
</html>`;
}
