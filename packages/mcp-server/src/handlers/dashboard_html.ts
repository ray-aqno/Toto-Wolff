/**
 * dashboard_html.ts — renders the Toto Wolff paddock interface.
 * F1 timing-screen aesthetic: near-black canvas, Mercedes teal accents,
 * monospace data values, SVG charts, click-to-detail slide panel.
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

/** Escapes HTML special characters to prevent XSS from vault-sourced strings. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Clamps n to [min, max]. */
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function arcGauge(pct: number, color: string, label: string, id: string): string {
  const r = 52; const cx = 70; const cy = 70;
  const startAngle = -210; const sweepAngle = 240;
  function polar(deg: number, radius: number) {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  }
  function arc(from: number, to: number, radius: number): string {
    const s = polar(from, radius); const e = polar(to, radius);
    const large = to - from > 180 ? 1 : 0;
    return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
  }
  const trackEnd = startAngle + sweepAngle;
  const arcLen = (sweepAngle / 360) * 2 * Math.PI * r;
  return `<svg id="${id}" viewBox="0 0 140 120" xmlns="http://www.w3.org/2000/svg" style="width:140px;height:120px" data-pct="${clamp(pct, 0, 100)}" data-color="${color}" data-arclen="${arcLen.toFixed(2)}">
    <path d="${arc(startAngle, trackEnd, r)}" fill="none" stroke="#2a2a2a" stroke-width="10" stroke-linecap="round"/>
    <path class="gauge-fill" d="${arc(startAngle, trackEnd, r)}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="0 ${arcLen.toFixed(2)}" style="transition:stroke-dasharray 1.2s cubic-bezier(.4,0,.2,1)"/>
    <text class="gauge-val" x="${cx}" y="${cy - 4}" text-anchor="middle" fill="white" font-family="'JetBrains Mono',monospace" font-size="20" font-weight="700">0%</text>
    <text x="${cx}" y="${cy + 16}" text-anchor="middle" fill="#666" font-family="system-ui,sans-serif" font-size="10">${label}</text>
  </svg>`;
}

function sparkline(values: number[], color: string, id: string): string {
  if (values.length < 2) return `<svg viewBox="0 0 160 40" xmlns="http://www.w3.org/2000/svg" style="width:160px;height:40px"><text x="80" y="24" text-anchor="middle" fill="#444" font-size="10">no data</text></svg>`;
  const max = Math.max(...values); const min = Math.min(...values); const range = max - min || 1;
  const w = 160; const h = 40; const pad = 4;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const lastPt = pts[pts.length - 1]!.split(',');
  const pathLen = (w - pad * 2) * 1.2;
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:${w}px;height:${h}px">
    <polyline id="${id}" points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-dasharray="${pathLen}" stroke-dashoffset="${pathLen}" style="transition:stroke-dashoffset 1.4s ease-out"/>
    <circle class="spark-dot" cx="${lastPt[0]}" cy="${lastPt[1]}" r="3" fill="${color}" opacity="0"/>
  </svg>`;
}

function sessionBarChart(items: DashboardItem[]): string {
  if (items.length === 0) return `<div style="color:#444;font-size:.75rem;font-style:italic;padding:.5rem 0">No sessions recorded</div>`;
  const groups: Record<string, number> = {};
  for (const item of items) { const key = item.date.slice(0, 7) || 'unknown'; groups[key] = (groups[key] ?? 0) + 1; }
  const entries = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).slice(-8);
  const maxVal = Math.max(...entries.map(([, v]) => v), 1);
  const barH = 18; const gap = 5; const labelW = 64; const chartW = 220;
  const svgH = entries.length * (barH + gap) + 4;
  const bars = entries.map(([label, val], i) => {
    const y = i * (barH + gap) + 2;
    const targetW = Math.max(4, (val / maxVal) * chartW);
    return `<text x="${labelW - 6}" y="${y + barH - 4}" text-anchor="end" fill="#666" font-family="'JetBrains Mono',monospace" font-size="9">${label}</text>
    <rect class="bar-rect" x="${labelW}" y="${y}" width="0" height="${barH}" rx="2" fill="#00D2BE" opacity="0.85" data-w="${targetW.toFixed(1)}" style="transition:width .8s cubic-bezier(.4,0,.2,1)"/>
    <text class="bar-val" x="${labelW + 4}" y="${y + barH - 4}" fill="#00D2BE" font-family="'JetBrains Mono',monospace" font-size="9" opacity="0">${val}</text>`;
  }).join('\n    ');
  return `<svg id="bar-chart" viewBox="0 0 ${labelW + chartW + 32} ${svgH}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:${labelW + chartW + 32}px;height:${svgH}px">${bars}</svg>`;
}

function sectorBadge(type: 'council' | 'p10'): string {
  const color = type === 'council' ? '#00D2BE' : '#C0C0C0';
  return `<span style="display:inline-block;background:${color};color:#0d0d0d;font-family:'JetBrains Mono',monospace;font-size:.65rem;font-weight:700;padding:1px 6px;border-radius:2px;letter-spacing:.05em">${type === 'council' ? 'COUNCIL' : 'P10'}</span>`;
}

export function renderDashboardHtml(data: DashboardResult): string {
  const empty = data.councilSessions.count === 0 && data.p10Plans.count === 0;
  const revisions = data.councilSessions.recent.filter((i) => i.status === 'revision-required').length;
  const reversalPct = data.councilSessions.count === 0 ? 0 : Math.round((revisions / data.councilSessions.count) * 100);
  const reversalLabel = data.councilSessions.count === 0 ? 'N/A' : `${revisions} / ${data.councilSessions.count}`;
  const approved = data.p10Plans.recent.filter((i) => i.status === 'approved').length;
  const compliancePct = data.p10Plans.recent.length === 0 ? 0 : Math.round((approved / data.p10Plans.recent.length) * 100);
  const reversalColor = reversalPct > 30 ? '#e03030' : reversalPct > 15 ? '#e09020' : '#00D2BE';
  const gaugeColor = compliancePct < 60 ? '#e03030' : compliancePct < 80 ? '#e09020' : '#00D2BE';
  const wcc = 8;

  const blockedRows = data.blockedItems.length === 0
    ? `<div class="blocked-empty">ALL CLEAR — no blocked items</div>`
    : data.blockedItems.map((b) => `<div class="blocked-row" tabindex="0">${sectorBadge(b.type as 'council' | 'p10')} <span class="blocked-date">${esc(b.date)}</span> <span class="blocked-excerpt">${esc(b.excerpt)}</span></div>`).join('');

  const recentDecisions = data.councilSessions.recent.slice(-5).reverse().map((item) => {
    const sc = item.status === 'revision-required' ? '#e03030' : item.status === 'approved' ? '#00D2BE' : '#888';
    const sl = item.status === 'revision-required' ? 'REVISE' : item.status === 'approved' ? 'CLEAN' : 'PENDING';
    return `<div class="decision-row" tabindex="0"><span class="decision-pill" style="background:${sc}20;color:${sc};border:1px solid ${sc}40">${sl}</span><span class="decision-date">${esc(item.date.slice(0, 10))}</span><span class="decision-excerpt">${esc(item.excerpt.slice(0, 72))}${item.excerpt.length > 72 ? '…' : ''}</span></div>`;
  }).join('');

  // Serialise data for client-side panel rendering (XSS-safe via JSON.stringify)
  const jsonData = JSON.stringify(data);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TOTO — Paddock Interface</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
  :root {
    --teal: #00D2BE; --silver: #C0C0C0;
    --bg: #0d0d0d; --surf: #121212; --card: #181818; --border: #242424;
    --text: #f0f0f0; --dim: #555; --red: #e03030; --amber: #e09020;
    --mono: 'JetBrains Mono', 'Courier New', monospace;
    --sans: system-ui, -apple-system, sans-serif;
    --panel-w: 420px;
  }
  html, body { height: 100%; background: var(--bg); color: var(--text) }
  body { font-family: var(--sans); font-size: 14px; display: flex; flex-direction: column; min-height: 100vh; overflow-x: hidden }

  /* ── Header ─────────────────────────────────────────────────────────── */
  .header {
    background: var(--surf); border-bottom: 2px solid var(--teal);
    padding: .7rem 1.5rem; display: flex; align-items: center; justify-content: space-between;
    position: sticky; top: 0; z-index: 20;
  }
  .header-left  { display: flex; align-items: center; gap: .75rem }
  .header-logo  { font-family: var(--mono); font-weight: 700; font-size: 1rem; color: var(--teal); letter-spacing: .1em }
  .header-sub   { font-family: var(--mono); font-size: .6rem; color: var(--dim); letter-spacing: .12em; margin-top: 1px }
  .header-badge { background: var(--teal); color: #0d0d0d; font-family: var(--mono); font-size: .58rem; font-weight: 700; padding: 2px 7px; border-radius: 2px; letter-spacing: .1em; animation: badge-blink 3s ease-in-out infinite }
  @keyframes badge-blink { 0%,100%{opacity:1} 50%{opacity:.6} }
  .header-ts    { font-family: var(--mono); font-size: .65rem; color: var(--dim); letter-spacing: .04em; text-align: right }
  .header-ts .val { color: var(--silver) }
  .wcc-badge    { font-family: var(--mono); font-size: .52rem; color: #2a2a2a; letter-spacing: .08em; margin-top: 2px; user-select: none; transition: color .3s; text-align: right }
  .wcc-badge:hover { color: var(--dim) }

  /* ── Main grid ───────────────────────────────────────────────────────── */
  .main {
    flex: 1; padding: 1.25rem 1.5rem;
    display: grid; grid-template-columns: repeat(auto-fill, minmax(272px, 1fr));
    gap: 1rem; align-content: start;
    transition: margin-right .35s cubic-bezier(.4,0,.2,1);
  }
  body.panel-open .main { margin-right: var(--panel-w) }

  /* ── Card ────────────────────────────────────────────────────────────── */
  .card {
    background: var(--card); border: 1px solid var(--border); border-radius: 4px;
    padding: 1rem 1.125rem; display: flex; flex-direction: column; gap: .5rem;
    opacity: 0; transform: translateY(10px);
    transition: opacity .4s ease, transform .4s ease, border-color .2s, box-shadow .2s, background .2s;
    cursor: pointer;
  }
  .card.visible { opacity: 1; transform: translateY(0) }
  .card:hover   { border-color: #2e2e2e; box-shadow: 0 0 0 1px #00D2BE18, 0 4px 24px #00000060 }
  .card.active  { border-color: var(--teal); box-shadow: 0 0 0 1px var(--teal), 0 4px 32px #00D2BE18; background: #1c1f1f }

  /* click ripple */
  .card { position: relative; overflow: hidden }
  .ripple {
    position: absolute; border-radius: 50%; background: #00D2BE22;
    transform: scale(0); animation: ripple-anim .55s ease-out forwards;
    pointer-events: none;
  }
  @keyframes ripple-anim { to { transform: scale(4); opacity: 0 } }

  .card-header  { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: .5rem; margin-bottom: .2rem }
  .card-label   { font-family: var(--mono); font-size: .62rem; color: var(--dim); letter-spacing: .13em; text-transform: uppercase }
  .card-chevron { font-size: .6rem; color: var(--dim); transition: color .2s, transform .2s }
  .card.active .card-chevron { color: var(--teal); transform: rotate(90deg) }
  .sector-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--teal); flex-shrink: 0 }
  .sector-dot.amber { background: var(--amber) }
  .sector-dot.red   { background: var(--red); animation: dot-pulse 1.4s ease-in-out infinite }
  @keyframes dot-pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
  .stat-big  { font-family: var(--mono); font-size: 2.6rem; font-weight: 700; color: var(--teal); line-height: 1; letter-spacing: -.02em }
  .stat-unit { font-family: var(--mono); font-size: .65rem; color: var(--dim); letter-spacing: .1em; text-transform: uppercase; margin-top: .2rem }
  .gauge-card { align-items: center; text-align: center }
  .reversal-frac { font-family: var(--mono); font-size: 1.7rem; font-weight: 700 }
  .reversal-pct  { font-family: var(--mono); font-size: .85rem; margin-top: .15rem }
  .reversal-diag { font-family: var(--mono); font-size: .62rem; color: var(--dim); margin-top: .4rem; letter-spacing: .06em }
  .wide { grid-column: span 2 }
  @media (max-width: 700px) { .wide { grid-column: span 1 } }
  .chart-title { font-family: var(--mono); font-size: .6rem; color: var(--dim); letter-spacing: .1em; text-transform: uppercase; margin-bottom: .6rem }
  .blocked-empty { font-family: var(--mono); font-size: .7rem; color: var(--teal); letter-spacing: .08em; padding: .4rem 0 }
  .blocked-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem; padding: .4rem 0; border-bottom: 1px solid var(--border) }
  .blocked-row:last-child { border-bottom: none }
  .blocked-date   { font-family: var(--mono); font-size: .68rem; color: var(--dim) }
  .blocked-excerpt { color: var(--silver); font-size: .8rem }
  .decision-row { display: grid; grid-template-columns: 4.5rem 6rem 1fr; align-items: baseline; gap: .5rem; padding: .35rem 0; border-bottom: 1px solid var(--border) }
  .decision-row:last-child { border-bottom: none }
  .decision-pill { font-family: var(--mono); font-size: .58rem; font-weight: 700; padding: 2px 5px; border-radius: 2px; letter-spacing: .06em; text-align: center }
  .decision-date { font-family: var(--mono); font-size: .68rem; color: var(--dim) }
  .decision-excerpt { color: var(--silver); font-size: .78rem }
  .sep { border: none; border-top: 1px solid var(--border); margin: .2rem 0 }

  /* ── Detail panel ────────────────────────────────────────────────────── */
  .panel {
    position: fixed; top: 0; right: 0; bottom: 0; width: var(--panel-w);
    background: var(--surf); border-left: 1px solid var(--border);
    display: flex; flex-direction: column;
    transform: translateX(100%);
    transition: transform .35s cubic-bezier(.4,0,.2,1);
    z-index: 30; overflow: hidden;
  }
  .panel.open { transform: translateX(0) }

  /* thin teal top edge on panel */
  .panel::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: var(--teal) }

  .panel-header {
    padding: 1rem 1.25rem .75rem;
    border-bottom: 1px solid var(--border);
    display: flex; align-items: flex-start; justify-content: space-between; gap: .5rem;
    flex-shrink: 0;
  }
  .panel-title { font-family: var(--mono); font-size: .75rem; color: var(--teal); letter-spacing: .12em; text-transform: uppercase; font-weight: 700 }
  .panel-sub   { font-family: var(--mono); font-size: .6rem; color: var(--dim); margin-top: 3px; letter-spacing: .06em }
  .panel-close {
    background: none; border: 1px solid var(--border); color: var(--dim);
    font-family: var(--mono); font-size: .65rem; padding: 3px 8px; border-radius: 2px;
    cursor: pointer; flex-shrink: 0; transition: border-color .15s, color .15s;
    letter-spacing: .08em;
  }
  .panel-close:hover { border-color: var(--teal); color: var(--teal) }
  .panel-close:focus { outline: 2px solid var(--teal); outline-offset: 2px }

  .panel-body { flex: 1; overflow-y: auto; padding: 1rem 1.25rem; scrollbar-width: thin; scrollbar-color: #333 transparent }
  .panel-body::-webkit-scrollbar { width: 4px }
  .panel-body::-webkit-scrollbar-thumb { background: #333 }

  /* panel sections */
  .psec { margin-bottom: 1.25rem }
  .psec-label { font-family: var(--mono); font-size: .58rem; color: var(--dim); letter-spacing: .12em; text-transform: uppercase; margin-bottom: .5rem; padding-bottom: .3rem; border-bottom: 1px solid var(--border) }

  /* stat row inside panel */
  .pstat { display: flex; justify-content: space-between; align-items: baseline; padding: .3rem 0; border-bottom: 1px solid #1c1c1c }
  .pstat:last-child { border-bottom: none }
  .pstat-k { font-family: var(--mono); font-size: .68rem; color: var(--dim) }
  .pstat-v { font-family: var(--mono); font-size: .78rem; color: var(--text); font-weight: 700 }

  /* record rows inside panel */
  .prec {
    padding: .5rem 0; border-bottom: 1px solid #1c1c1c;
    opacity: 0; transform: translateX(12px);
    transition: opacity .3s ease, transform .3s ease;
  }
  .prec.in { opacity: 1; transform: translateX(0) }
  .prec:last-child { border-bottom: none }
  .prec-meta { display: flex; align-items: center; gap: .4rem; margin-bottom: .25rem }
  .prec-date { font-family: var(--mono); font-size: .65rem; color: var(--dim) }
  .prec-text { font-size: .8rem; color: var(--silver); line-height: 1.4 }
  .prec-pill { font-family: var(--mono); font-size: .58rem; font-weight: 700; padding: 1px 5px; border-radius: 2px; letter-spacing: .06em }

  /* panel empty */
  .panel-empty { font-family: var(--mono); font-size: .7rem; color: var(--dim); padding: 1rem 0 }

  /* ── Footer ──────────────────────────────────────────────────────────── */
  .footer { background: var(--surf); border-top: 1px solid var(--border); padding: .5rem 1.5rem; display: flex; align-items: center; justify-content: space-between; transition: margin-right .35s cubic-bezier(.4,0,.2,1) }
  body.panel-open .footer { margin-right: var(--panel-w) }
  .footer-label { font-family: var(--mono); font-size: .6rem; color: var(--dim); letter-spacing: .08em }
  .live-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--teal); margin-right: .4rem; animation: pulse 2s ease-in-out infinite }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.25} }

  /* ── Empty state ─────────────────────────────────────────────────────── */
  .empty-state { grid-column: 1/-1; text-align: center; padding: 4rem 1rem }
  .empty-heading { font-family: var(--mono); font-size: .9rem; color: var(--teal); letter-spacing: .14em; margin-bottom: .6rem }
  .empty-sub     { font-family: var(--mono); font-size: .7rem; color: var(--dim); letter-spacing: .06em }
</style>
</head>
<body>

<header class="header">
  <div class="header-left">
    <div>
      <div class="header-logo">TOTO WOLFF</div>
      <div class="header-sub">PADDOCK INTERFACE &nbsp;·&nbsp; BRACKLEY HQ</div>
    </div>
    <span class="header-badge">LIVE</span>
  </div>
  <div>
    <div class="header-ts">GENERATED &nbsp;<span class="val">${esc(data.generatedAt)}</span></div>
    <div class="wcc-badge" title="Mercedes-AMG F1 Constructor Championships 2014–2021">W${wcc} · ${wcc}×WCC</div>
  </div>
</header>

<main class="main" id="main">
${empty ? `
  <div class="empty-state">
    <div class="empty-heading">PIT LANE CLEAR</div>
    <div class="empty-sub">No sessions recorded — run /council to start</div>
  </div>
` : `
  <div class="card" id="card-velocity" data-panel="velocity" style="--delay:.05s">
    <div class="card-header">
      <span class="card-label">Decision Velocity</span>
      <span style="display:flex;align-items:center;gap:.5rem"><span class="sector-dot"></span><span class="card-chevron">▶</span></span>
    </div>
    <div class="stat-big" data-count="${data.councilSessions.count}">0</div>
    <div class="stat-unit">Council Sessions</div>
    <hr class="sep">
    ${sparkline(data.councilSessions.recent.map((_, i) => i + 1), '#00D2BE', 'spark-council')}
  </div>

  <div class="card" id="card-p10" data-panel="p10" style="--delay:.1s">
    <div class="card-header">
      <span class="card-label">P10 Plans Filed</span>
      <span style="display:flex;align-items:center;gap:.5rem"><span class="sector-dot"></span><span class="card-chevron">▶</span></span>
    </div>
    <div class="stat-big" data-count="${data.p10Plans.count}" style="color:var(--silver)">0</div>
    <div class="stat-unit">Execution Plans</div>
    <hr class="sep">
    ${sparkline(data.p10Plans.recent.map((_, i) => i + 1), '#C0C0C0', 'spark-p10')}
  </div>

  <div class="card gauge-card" id="card-compliance" data-panel="compliance" style="--delay:.15s">
    <div class="card-header">
      <span class="card-label">P10 Compliance</span>
      <span style="display:flex;align-items:center;gap:.5rem"><span class="sector-dot ${compliancePct < 60 ? 'red' : compliancePct < 80 ? 'amber' : ''}"></span><span class="card-chevron">▶</span></span>
    </div>
    ${arcGauge(compliancePct, gaugeColor, 'approved / recent', 'gauge-compliance')}
    <div class="stat-unit">${approved} approved of ${data.p10Plans.recent.length} recent</div>
  </div>

  <div class="card" id="card-reversal" data-panel="reversal" style="--delay:.2s">
    <div class="card-header">
      <span class="card-label">Reversal Rate</span>
      <span style="display:flex;align-items:center;gap:.5rem"><span class="sector-dot ${reversalPct > 30 ? 'red' : reversalPct > 15 ? 'amber' : ''}"></span><span class="card-chevron">▶</span></span>
    </div>
    <div class="reversal-frac" style="color:${reversalColor}">${reversalLabel}</div>
    <div class="reversal-pct" style="color:${reversalColor}" data-count="${reversalPct}" data-suffix="%">0%</div>
    <div class="reversal-diag">${reversalPct === 0 ? 'ALL RULINGS CLEAN' : reversalPct < 15 ? 'HEALTHY SIGNAL' : reversalPct < 30 ? 'WATCH THE TREND' : 'GOVERNANCE PRESSURE'}</div>
  </div>

  <div class="card wide" id="card-history" data-panel="history" style="--delay:.25s">
    <div class="card-header">
      <span class="card-label">Session History</span>
      <span style="display:flex;align-items:center;gap:.5rem"><span class="sector-dot"></span><span class="card-chevron">▶</span></span>
    </div>
    <div class="chart-title">Council sessions by month</div>
    ${sessionBarChart(data.councilSessions.recent)}
  </div>

  <div class="card wide" id="card-blocked" data-panel="blocked" style="--delay:.3s">
    <div class="card-header">
      <span class="card-label">Blocked Items &nbsp;<span style="font-family:var(--mono);font-size:.6rem;color:${data.blockedItems.length > 0 ? 'var(--red)' : 'var(--dim)'}">${data.blockedItems.length > 0 ? data.blockedItems.length + ' FLAG' + (data.blockedItems.length > 1 ? 'S' : '') : 'CLEAR'}</span></span>
      <span style="display:flex;align-items:center;gap:.5rem"><span class="sector-dot ${data.blockedItems.length > 0 ? 'red' : ''}"></span><span class="card-chevron">▶</span></span>
    </div>
    ${blockedRows}
  </div>

  ${data.councilSessions.recent.length > 0 ? `
  <div class="card wide" id="card-rulings" data-panel="rulings" style="--delay:.35s">
    <div class="card-header">
      <span class="card-label">Recent Rulings</span>
      <span style="display:flex;align-items:center;gap:.5rem"><span class="sector-dot"></span><span class="card-chevron">▶</span></span>
    </div>
    ${recentDecisions}
  </div>` : ''}
`}
</main>

<!-- ── Detail panel ─────────────────────────────────────────────────────── -->
<aside class="panel" id="panel" role="dialog" aria-modal="true" aria-label="Detail view">
  <div class="panel-header">
    <div>
      <div class="panel-title" id="panel-title">—</div>
      <div class="panel-sub" id="panel-sub"></div>
    </div>
    <button class="panel-close" id="panel-close" aria-label="Close panel">ESC</button>
  </div>
  <div class="panel-body" id="panel-body"></div>
</aside>

<footer class="footer" id="footer">
  <div class="footer-label"><span class="live-dot"></span>TOTO-WOLFF GOVERNANCE STACK</div>
  <div class="footer-label">BRACKLEY · ${esc(data.generatedAt)}</div>
</footer>

<script>
(function () {
  // ── Data ───────────────────────────────────────────────────────────────
  const D = ${jsonData};

  // ── Helpers ────────────────────────────────────────────────────────────
  function statusColor(s) {
    return s === 'revision-required' ? '#e03030' : s === 'approved' ? '#00D2BE' : s === 'blocked' ? '#e03030' : '#888';
  }
  function statusLabel(s) {
    return s === 'revision-required' ? 'REVISE' : s === 'approved' ? 'CLEAN' : s === 'blocked' ? 'BLOCKED' : 'PENDING';
  }

  // ── Card entrance ──────────────────────────────────────────────────────
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const el = e.target;
      const delay = parseFloat(el.style.getPropertyValue('--delay') || '0') * 1000;
      setTimeout(() => el.classList.add('visible'), delay);
      obs.unobserve(el);
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('.card').forEach((c) => obs.observe(c));

  // ── Number counters ────────────────────────────────────────────────────
  function animateCount(el, target, duration, suffix) {
    if (target === 0) { el.textContent = '0' + (suffix || ''); return; }
    const start = performance.now();
    (function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(ease * target) + (suffix || '');
      if (t < 1) requestAnimationFrame(step);
    })(performance.now());
  }

  // ── Sparklines ─────────────────────────────────────────────────────────
  function animateSpark(id) {
    const el = document.getElementById(id);
    if (!el) return;
    setTimeout(() => {
      el.style.strokeDashoffset = '0';
      const dot = el.nextElementSibling;
      if (dot) { dot.style.transition = 'opacity .3s ease .8s'; dot.style.opacity = '1'; }
    }, 200);
  }

  // ── Arc gauge ──────────────────────────────────────────────────────────
  function animateGauge(id) {
    const svg = document.getElementById(id);
    if (!svg) return;
    const pct = parseFloat(svg.dataset.pct || '0');
    const arcLen = parseFloat(svg.dataset.arclen || '0');
    const fill = svg.querySelector('.gauge-fill');
    const valEl = svg.querySelector('.gauge-val');
    if (!fill || !valEl) return;
    const filled = (pct / 100) * arcLen;
    setTimeout(() => {
      fill.setAttribute('stroke-dasharray', filled.toFixed(2) + ' ' + arcLen.toFixed(2));
      const start = performance.now();
      (function step(now) {
        const t = Math.min(1, (now - start) / 1200);
        const ease = 1 - Math.pow(1 - t, 3);
        valEl.textContent = Math.round(ease * pct) + '%';
        if (t < 1) requestAnimationFrame(step);
      })(performance.now());
    }, 300);
  }

  // ── Bar chart ──────────────────────────────────────────────────────────
  function animateBars() {
    const rects = document.querySelectorAll('.bar-rect');
    const vals  = document.querySelectorAll('.bar-val');
    rects.forEach((rect, i) => {
      const w = rect.dataset.w || '0';
      setTimeout(() => {
        rect.style.width = w + 'px';
        const vEl = vals[i];
        if (vEl) { vEl.style.transition = 'opacity .3s ease'; vEl.style.opacity = '1'; }
      }, i * 60 + 200);
    });
  }

  // fire once
  let animated = false;
  function fireAll() {
    if (animated) return; animated = true;
    document.querySelectorAll('[data-count]').forEach((el) => {
      animateCount(el, parseInt(el.dataset.count || '0', 10), 900, el.dataset.suffix || '');
    });
    animateSpark('spark-council'); animateSpark('spark-p10');
    animateGauge('gauge-compliance');
    animateBars();
  }
  const firstCard = document.querySelector('.card');
  if (firstCard) {
    const trigger = new IntersectionObserver((e) => { if (e[0].isIntersecting) { setTimeout(fireAll, 250); trigger.disconnect(); } });
    trigger.observe(firstCard);
  } else { fireAll(); }

  // ── Ripple on click ────────────────────────────────────────────────────
  function spawnRipple(card, e) {
    const rect = card.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.4;
    const r = document.createElement('span');
    r.className = 'ripple';
    r.style.cssText = 'width:' + size + 'px;height:' + size + 'px;left:' + (e.clientX - rect.left - size / 2) + 'px;top:' + (e.clientY - rect.top - size / 2) + 'px';
    card.appendChild(r);
    r.addEventListener('animationend', () => r.remove());
  }

  // ── Panel ──────────────────────────────────────────────────────────────
  const panel     = document.getElementById('panel');
  const panelTitle = document.getElementById('panel-title');
  const panelSub   = document.getElementById('panel-sub');
  const panelBody  = document.getElementById('panel-body');
  const panelClose = document.getElementById('panel-close');
  let activeCard  = null;

  function buildPanelContent(type) {
    switch (type) {
      case 'velocity': return buildVelocityPanel();
      case 'p10':      return buildP10Panel();
      case 'compliance': return buildCompliancePanel();
      case 'reversal': return buildReversalPanel();
      case 'history':  return buildHistoryPanel();
      case 'blocked':  return buildBlockedPanel();
      case 'rulings':  return buildRulingsPanel();
      default: return '<div class="panel-empty">No data</div>';
    }
  }

  function pill(s) {
    const c = statusColor(s); const l = statusLabel(s);
    return '<span class="prec-pill" style="background:' + c + '20;color:' + c + ';border:1px solid ' + c + '40">' + l + '</span>';
  }

  function buildVelocityPanel() {
    const sessions = D.councilSessions.recent;
    const revisions = sessions.filter((i) => i.status === 'revision-required').length;
    const cleanRate = sessions.length ? Math.round(((sessions.length - revisions) / sessions.length) * 100) : 0;
    let html = '<div class="psec"><div class="psec-label">Telemetry</div>';
    html += '<div class="pstat"><span class="pstat-k">Total sessions</span><span class="pstat-v" style="color:#00D2BE">' + D.councilSessions.count + '</span></div>';
    html += '<div class="pstat"><span class="pstat-k">Recent sessions</span><span class="pstat-v">' + sessions.length + '</span></div>';
    html += '<div class="pstat"><span class="pstat-k">Clean ruling rate</span><span class="pstat-v" style="color:#00D2BE">' + cleanRate + '%</span></div>';
    html += '</div><div class="psec"><div class="psec-label">Session Log</div>';
    if (!sessions.length) { html += '<div class="panel-empty">No sessions yet</div>'; }
    sessions.slice().reverse().forEach((item) => {
      html += '<div class="prec"><div class="prec-meta">' + pill(item.status) + '<span class="prec-date">' + item.date.slice(0, 10) + '</span></div><div class="prec-text">' + escHtml(item.excerpt) + '</div></div>';
    });
    html += '</div>';
    return html;
  }

  function buildP10Panel() {
    const plans = D.p10Plans.recent;
    const approved = plans.filter((i) => i.status === 'approved').length;
    let html = '<div class="psec"><div class="psec-label">Telemetry</div>';
    html += '<div class="pstat"><span class="pstat-k">Total plans</span><span class="pstat-v" style="color:#C0C0C0">' + D.p10Plans.count + '</span></div>';
    html += '<div class="pstat"><span class="pstat-k">Recent plans</span><span class="pstat-v">' + plans.length + '</span></div>';
    html += '<div class="pstat"><span class="pstat-k">Approved (recent)</span><span class="pstat-v" style="color:#00D2BE">' + approved + '</span></div>';
    html += '</div><div class="psec"><div class="psec-label">Plan Log</div>';
    if (!plans.length) { html += '<div class="panel-empty">No plans yet</div>'; }
    plans.slice().reverse().forEach((item) => {
      html += '<div class="prec"><div class="prec-meta">' + pill(item.status) + '<span class="prec-date">' + item.date.slice(0, 10) + '</span></div><div class="prec-text">' + escHtml(item.excerpt) + '</div></div>';
    });
    html += '</div>';
    return html;
  }

  function buildCompliancePanel() {
    const plans = D.p10Plans.recent;
    const approved = plans.filter((i) => i.status === 'approved').length;
    const blocked  = plans.filter((i) => i.status === 'blocked').length;
    const pending  = plans.filter((i) => i.status === 'pending').length;
    const pct = plans.length ? Math.round((approved / plans.length) * 100) : 0;
    let html = '<div class="psec"><div class="psec-label">Compliance Breakdown</div>';
    html += '<div class="pstat"><span class="pstat-k">Approved</span><span class="pstat-v" style="color:#00D2BE">' + approved + '</span></div>';
    html += '<div class="pstat"><span class="pstat-k">Pending</span><span class="pstat-v" style="color:#888">' + pending + '</span></div>';
    html += '<div class="pstat"><span class="pstat-k">Blocked</span><span class="pstat-v" style="color:#e03030">' + blocked + '</span></div>';
    html += '<div class="pstat"><span class="pstat-k">Compliance rate</span><span class="pstat-v" style="color:' + (pct >= 80 ? '#00D2BE' : pct >= 60 ? '#e09020' : '#e03030') + '">' + pct + '%</span></div>';
    html += '</div><div class="psec"><div class="psec-label">Target: &gt;80% Approved</div>';
    const thresholds = [
      { label: 'OPTIMAL', min: 80, color: '#00D2BE' },
      { label: 'WATCH', min: 60, color: '#e09020' },
      { label: 'PRESSURE', min: 0, color: '#e03030' },
    ];
    const zone = thresholds.find((t) => pct >= t.min) || thresholds[2];
    html += '<div class="pstat"><span class="pstat-k">Zone</span><span class="pstat-v" style="color:' + zone.color + '">' + zone.label + '</span></div>';
    html += '</div>';
    return html;
  }

  function buildReversalPanel() {
    const sessions = D.councilSessions.recent;
    const revisions = sessions.filter((i) => i.status === 'revision-required').length;
    const pct = sessions.length ? Math.round((revisions / sessions.length) * 100) : 0;
    let html = '<div class="psec"><div class="psec-label">Reversal Breakdown</div>';
    html += '<div class="pstat"><span class="pstat-k">Revision-required</span><span class="pstat-v" style="color:#e03030">' + revisions + '</span></div>';
    html += '<div class="pstat"><span class="pstat-k">Total sessions</span><span class="pstat-v">' + sessions.length + '</span></div>';
    html += '<div class="pstat"><span class="pstat-k">Reversal rate</span><span class="pstat-v" style="color:' + (pct > 30 ? '#e03030' : pct > 15 ? '#e09020' : '#00D2BE') + '">' + pct + '%</span></div>';
    html += '</div><div class="psec"><div class="psec-label">Revisions</div>';
    const revItems = sessions.filter((i) => i.status === 'revision-required');
    if (!revItems.length) { html += '<div class="panel-empty" style="color:#00D2BE">No reversals — all rulings clean</div>'; }
    revItems.forEach((item) => {
      html += '<div class="prec"><div class="prec-meta"><span class="prec-pill" style="background:#e0303020;color:#e03030;border:1px solid #e0303040">REVISE</span><span class="prec-date">' + item.date.slice(0, 10) + '</span></div><div class="prec-text">' + escHtml(item.excerpt) + '</div></div>';
    });
    html += '</div>';
    return html;
  }

  function buildHistoryPanel() {
    const sessions = D.councilSessions.recent;
    const groups = {};
    sessions.forEach((s) => { const k = s.date.slice(0, 7) || 'unknown'; groups[k] = (groups[k] || 0) + 1; });
    const entries = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
    const total = sessions.length;
    let html = '<div class="psec"><div class="psec-label">Monthly Breakdown</div>';
    if (!entries.length) { html += '<div class="panel-empty">No data</div>'; }
    entries.forEach(([month, count]) => {
      const pct = total ? Math.round((count / total) * 100) : 0;
      html += '<div class="pstat"><span class="pstat-k" style="font-family:var(--mono);color:#888">' + month + '</span><span class="pstat-v" style="color:#00D2BE">' + count + '<span style="color:#555;font-weight:400;font-size:.65rem"> &nbsp;' + pct + '%</span></span></div>';
    });
    html += '</div><div class="psec"><div class="psec-label">All Sessions (' + total + ')</div>';
    sessions.slice().reverse().forEach((item) => {
      html += '<div class="prec"><div class="prec-meta">' + pill(item.status) + '<span class="prec-date">' + item.date.slice(0, 10) + '</span></div><div class="prec-text">' + escHtml(item.excerpt) + '</div></div>';
    });
    html += '</div>';
    return html;
  }

  function buildBlockedPanel() {
    const items = D.blockedItems;
    let html = '<div class="psec"><div class="psec-label">Blocked Items (' + items.length + ')</div>';
    if (!items.length) {
      html += '<div class="panel-empty" style="color:#00D2BE">PIT LANE CLEAR — no blocked items</div>';
    } else {
      items.forEach((b) => {
        const c = b.type === 'council' ? '#00D2BE' : '#C0C0C0';
        html += '<div class="prec"><div class="prec-meta"><span class="prec-pill" style="background:' + c + '20;color:' + c + ';border:1px solid ' + c + '40">' + b.type.toUpperCase() + '</span><span class="prec-date">' + b.date + '</span></div><div class="prec-text">' + escHtml(b.excerpt) + '</div></div>';
      });
    }
    html += '</div><div class="psec"><div class="psec-label">Resolution</div>';
    html += '<div class="pstat"><span class="pstat-k">Council blocks</span><span class="pstat-v" style="color:#e03030">' + items.filter((b) => b.type === 'council').length + '</span></div>';
    html += '<div class="pstat"><span class="pstat-k">P10 blocks</span><span class="pstat-v" style="color:#e03030">' + items.filter((b) => b.type === 'p10').length + '</span></div>';
    html += '</div>';
    return html;
  }

  function buildRulingsPanel() {
    const sessions = D.councilSessions.recent;
    const clean    = sessions.filter((s) => s.status === 'approved').length;
    const revisions = sessions.filter((s) => s.status === 'revision-required').length;
    let html = '<div class="psec"><div class="psec-label">Summary</div>';
    html += '<div class="pstat"><span class="pstat-k">Clean</span><span class="pstat-v" style="color:#00D2BE">' + clean + '</span></div>';
    html += '<div class="pstat"><span class="pstat-k">Revision-required</span><span class="pstat-v" style="color:#e03030">' + revisions + '</span></div>';
    html += '<div class="pstat"><span class="pstat-k">Other</span><span class="pstat-v" style="color:#888">' + (sessions.length - clean - revisions) + '</span></div>';
    html += '</div><div class="psec"><div class="psec-label">All Rulings</div>';
    sessions.slice().reverse().forEach((item) => {
      html += '<div class="prec"><div class="prec-meta">' + pill(item.status) + '<span class="prec-date">' + item.date.slice(0, 10) + '</span></div><div class="prec-text">' + escHtml(item.excerpt) + '</div></div>';
    });
    html += '</div>';
    return html;
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const PANEL_LABELS = {
    velocity:   ['DECISION VELOCITY',   'Council session log'],
    p10:        ['P10 PLANS',           'Execution plan log'],
    compliance: ['P10 COMPLIANCE',      'Approval breakdown'],
    reversal:   ['REVERSAL RATE',       'Revision-required analysis'],
    history:    ['SESSION HISTORY',     'Monthly distribution'],
    blocked:    ['BLOCKED ITEMS',       'Active blockers'],
    rulings:    ['RECENT RULINGS',      'Full ruling log'],
  };

  function openPanel(type, card) {
    // Deactivate old card
    if (activeCard) activeCard.classList.remove('active');
    activeCard = card;
    card.classList.add('active');

    const [title, sub] = PANEL_LABELS[type] || ['DETAIL', ''];
    panelTitle.textContent = title;
    panelSub.textContent   = sub;
    panelBody.innerHTML    = buildPanelContent(type);

    // Stagger record rows in
    panel.classList.add('open');
    document.body.classList.add('panel-open');

    requestAnimationFrame(() => {
      const recs = panelBody.querySelectorAll('.prec');
      recs.forEach((r, i) => setTimeout(() => r.classList.add('in'), i * 40 + 80));
    });

    panelClose.focus();
  }

  function closePanel() {
    panel.classList.remove('open');
    document.body.classList.remove('panel-open');
    if (activeCard) { activeCard.classList.remove('active'); activeCard = null; }
  }

  // ── Card click → open panel ────────────────────────────────────────────
  document.querySelectorAll('.card[data-panel]').forEach((card) => {
    card.addEventListener('click', (e) => {
      spawnRipple(card, e);
      const type = card.dataset.panel;
      if (activeCard === card && panel.classList.contains('open')) {
        closePanel();
      } else {
        openPanel(type, card);
      }
    });
    card.setAttribute('tabindex', '0');
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); }
    });
  });

  // ── Close button + Escape ──────────────────────────────────────────────
  panelClose.addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
})();
</script>

</body>
</html>`;
}
