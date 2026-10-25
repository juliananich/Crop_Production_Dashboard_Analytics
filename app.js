/* Harvest Ledger — India crop production dashboard (vanilla JS + Plotly.js) */
'use strict';


const PAL = ['#2f7d4f', '#d9962b', '#2b7a9b', '#c4572f', '#7a4e8c', '#6b8e23', '#b5651d', '#4d6a7a', '#a05195', '#8c8c3d'];
const PAGES = [
  ['Planner view', [['overview', 'Scorecard'], ['trends', 'Trends'], ['crops', 'Crops'], ['regions', 'Regions'], ['seasons', 'Seasons']]],
  ['Advanced model', [['predict', 'Predict yield'], ['reco', 'Recommend']]],
  ['Reference', [['notes', 'Data notes']]],
];
let RAW = [], CLEAN = [], RAW_NULLS = {}, YEAR_MIN = 1997, YEAR_MAX = 2015;
const S = {
  dataset: 'Cleaned', y0: 1997, y1: 2015, topN: 10, noCoco: false, page: 'overview',
  sel: { s: new Set(), se: new Set(), c: new Set() }, recoState: '',
};
let F = [], FP = [], Q = [], seq = 0, debounce;

/* ------------------------------------------------------------ small helpers */
const $ = (id) => document.getElementById(id);
const sum = (a) => { let t = 0; for (const v of a) t += v; return t; };
const minOf = (a) => { let m = Infinity; for (const v of a) if (v != null && v < m) m = v; return m; };
const maxOf = (a) => { let m = -Infinity; for (const v of a) if (v != null && v > m) m = v; return m; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
const num = (x, d = 2) => (x == null || !isFinite(x) ? '–' : Number(x).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));
const int = (x) => Number(x).toLocaleString();
function fmt(n) {
  const a = Math.abs(n);
  for (const [u, d] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]]) if (a >= d) return (n / d).toFixed(2) + u;
  return n.toFixed(2);
}
const yieldOf = (r) => (r.a > 0 && r.p != null ? r.p / r.a : null);
const groupSum = (rows, key, val) => { const m = new Map(); for (const r of rows) m.set(r[key], (m.get(r[key]) || 0) + r[val]); return m; };
const entries = (m, desc = true) => [...m.entries()].sort((a, b) => (desc ? b[1] - a[1] : a[1] - b[1]));
const share = (part, whole) => (whole > 0 ? part / whole : 0);

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/* ------------------------------------------------------------ rendering building blocks */
function layoutOf(extra = {}) {
  const cs = getComputedStyle(document.documentElement), g = (k) => cs.getPropertyValue(k).trim();
  const L = {
    margin: { t: 14, r: 16, b: 52, l: 64 }, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: g('--ink'), family: 'Segoe UI, system-ui, sans-serif', size: 12 }, colorway: PAL,
    xaxis: { gridcolor: g('--grid'), zerolinecolor: g('--grid'), automargin: true }, yaxis: { gridcolor: g('--grid'), zerolinecolor: g('--grid'), automargin: true },
    legend: { orientation: 'h', y: -0.2 },
  };
  for (const [k, v] of Object.entries(extra)) L[k] = (v && typeof v === 'object' && !Array.isArray(v) && L[k]) ? { ...L[k], ...v } : v;
  return L;
}
function table(headers, rows) {
  return `<div class="tablewrap"><table class="data"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
/* A card: optional chart (+ Chart|Table toggle) and a plain-language "what it shows / what it means" note. */
function card({ title, sub = '', plot, tbl, how = '', insight = '', caution = '', height = 330, html = '' }) {
  const id = 'c' + seq++;
  if (plot) Q.push([id, plot.traces, plot.layout || {}]);
  const toggle = plot && tbl ? `<div class="vt" data-id="${id}"><button class="on" data-m="chart">Chart</button><button data-m="table">Table</button></div>` : '';
  const body = plot ? `<div class="cv" id="${id}" style="height:${height}px"></div>${tbl ? `<div class="tv" id="${id}t" hidden>${table(tbl.headers, tbl.rows)}</div>` : ''}` : html;
  const note = how || insight || caution ? `<div class="note">${how ? `<p><b>How to read it</b>${how}</p>` : ''}${insight ? `<p><b>What it means now</b>${insight}</p>` : ''}${caution ? `<p class="caution"><b>Keep in mind</b>${caution}</p>` : ''}</div>` : '';
  return `<article class="card"><header><div><h3>${title}</h3>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${toggle}</header>${body}${note}</article>`;
}
const grid = (cls, ...cards) => `<div class="grid ${cls}">${cards.join('')}</div>`;
const head = (title, desc) => `<div class="page-head"><h2>${title}</h2><p>${desc}</p></div>`;
const takeaways = (items) => `<div class="takeaways"><h4>Key takeaways for the current selection</h4><ul>${items.filter(Boolean).map((i) => `<li>${i}</li>`).join('')}</ul></div>`;
const sparkline = (vals, color = 'var(--forest-2)') => {
  if (vals.length < 2) return '';
  const lo = minOf(vals), hi = maxOf(vals), span = hi - lo || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * 100},${28 - ((v - lo) / span) * 24}`).join(' ');
  return `<svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
};
const kpi = (label, value, small = '', spark = '', tg = '') => `<div class="kpi"><span class="l">${label}</span><b>${value}</b>${tg}<small>${small}</small>${spark}</div>`;
const hbar = (list, color = PAL[0]) => ({
  type: 'bar', orientation: 'h', x: list.map((e) => e[1]), y: list.map((e) => e[0]), text: list.map((e) => fmt(e[1])), textposition: 'outside', cliponaxis: false,
  marker: { color }, hovertemplate: '%{y}<br>%{x:,.0f}<extra></extra>',
});
const hbarLayout = (extra = {}) => ({ yaxis: { autorange: 'reversed', automargin: true }, xaxis: { automargin: true }, margin: { l: 10, r: 70, t: 8, b: 36 }, ...extra });
const rowsOf = (list, total) => list.map(([k, v]) => [esc(k), fmt(v), total ? pct(v / total) : '']);
const hh = (n) => Math.max(240, 70 + n * 28);

const yearSeries = (rows) => {
  const P_ = groupSum(rows, 'y', 'p'), A = groupSum(rows, 'y', 'a'), yrs = [...P_.keys()].sort((a, b) => a - b);
  return { yrs, prod: yrs.map((y) => P_.get(y)), area: yrs.map((y) => A.get(y) || 0) };
};

/* ------------------------------------------------------------ pages */
const P = {};

/* The first and last crop years are sparsely reported, so growth and stability skip them when there are enough years. */
const trimYears = (n) => (n >= 5 ? [1, n - 2] : [0, n - 1]);
const cagrOf = (v, a0, a1) => (a1 > a0 && v[a0] > 0 ? Math.pow(v[a1] / v[a0], 1 / (a1 - a0)) - 1 : NaN);
const cvOf = (v) => { if (v.length < 3) return NaN; const mu = sum(v) / v.length; return mu > 0 ? Math.sqrt(sum(v.map((x) => (x - mu) ** 2)) / (v.length - 1)) / mu : NaN; };
const tag = (cls, text) => `<em class="tag ${cls}">${text}</em>`;

P.overview = () => {
  const total = sum(FP.map((r) => r.p)), ys = yearSeries(FP), n = ys.yrs.length, N = S.topN;
  const crops = entries(groupSum(FP, 'c', 'p')), states = entries(groupSum(FP, 's', 'p'));
  const [a0, a1] = trimYears(n), cagr = cagrOf(ys.prod, a0, a1), cv = cvOf(ys.prod.slice(a0, a1 + 1));
  const topCrop = share(crops[0][1], total), top3 = share(sum(states.slice(0, 3).map((e) => e[1])), total);
  let c80 = 0, acc = 0; for (const e of crops) { acc += e[1]; c80++; if (acc / total >= 0.8) break; }
  const iMax = ys.prod.indexOf(maxOf(ys.prod));
  const gT = isNaN(cagr) ? '' : cagr >= 0.02 ? tag('good', 'Growing') : cagr > -0.02 ? tag('warn', 'Flat') : tag('bad', 'Declining');
  const cT = topCrop > .5 ? tag('bad', 'High dependence') : topCrop > .3 ? tag('warn', 'Moderate') : tag('good', 'Diversified');
  const sT = top3 > .75 ? tag('bad', 'Highly concentrated') : top3 > .5 ? tag('warn', 'Concentrated') : tag('good', 'Spread out');
  const kT = c80 <= 3 ? tag('bad', 'Very narrow') : c80 <= 10 ? tag('warn', 'Narrow') : tag('good', 'Broad');
  const vT = isNaN(cv) ? '' : cv < .15 ? tag('good', 'Steady') : cv < .3 ? tag('warn', 'Variable') : tag('bad', 'Volatile');
  return head('Scorecard', 'For agriculture planners: how much is produced, how fast it is changing, and how exposed supply is to one crop, a few states or a bad year.') +
    (!S.noCoco && FP.some((r) => r.c === 'Coconut') ? '<div class="alert"><b>Coconut is dominating the totals.</b> It is recorded in nuts, not tonnes, so it dwarfs every other crop. Switch on <b>Exclude coconut</b> in the filter bar for a fairer comparison.</div>' : '') +
    `<div class="kpis">${kpi('Total production', fmt(total), `recorded volume, ${ys.yrs[0]}–${ys.yrs[n - 1]}`, sparkline(ys.prod))}` +
    `${kpi('Annual growth', isNaN(cagr) ? '–' : (cagr >= 0 ? '+' : '') + pct(cagr), `compound, ${ys.yrs[a0]}–${ys.yrs[a1]}`, '', gT)}` +
    `${kpi('Top-crop share', pct(topCrop), esc(crops[0][0]) + ' of all production', '', cT)}` +
    `${kpi('Top-3 state share', pct(top3), esc(states.slice(0, 3).map((e) => e[0]).join(', ')), '', sT)}` +
    `${kpi('Crops for 80% of output', int(c80), `out of ${int(crops.length)} crops`, '', kT)}` +
    `${kpi('Output stability', isNaN(cv) ? '–' : cv.toFixed(2), 'variation of yearly totals (lower = steadier)', '', vT)}</div>` +
    '<p class="legend">Ratings are rules of thumb. Dependence: top crop over 50% is high, 30–50% moderate. Concentration: top 3 states over 75% is high, 50–75% concentrated. Stability: variation under 0.15 is steady, 0.15–0.30 variable, above 0.30 volatile. Growth: within ±2% a year counts as flat.</p>' +
    takeaways([`<b>Crop risk:</b> ${esc(crops[0][0])} supplies ${pct(topCrop)} of recorded production and ${c80} crop${c80 > 1 ? 's' : ''} cover 80%. ${topCrop > .5 ? 'A shock to this one crop would move the whole total, so it is the first thing to monitor.' : 'No single crop overwhelms the total.'}`,
      `<b>Regional risk:</b> ${esc(states[0][0])} leads with ${pct(share(states[0][1], total))}; the top 3 states hold ${pct(top3)}. ${top3 > .75 ? 'Supply is geographically concentrated, so a regional drought or flood matters nationally.' : 'Supply is reasonably spread across states.'}`,
      n > 1 ? `<b>Momentum:</b> production ${isNaN(cagr) ? 'changed' : cagr >= 0 ? 'grew' : 'shrank'} ${isNaN(cagr) ? '' : 'about ' + pct(Math.abs(cagr)) + ' a year '}between ${ys.yrs[a0]} and ${ys.yrs[a1]}, and peaked in ${ys.yrs[iMax]}.` : '',
      isNaN(cv) ? '' : `<b>Reliability:</b> yearly output varies by ${cv.toFixed(2)} (${cv < .15 ? 'steady' : cv < .3 ? 'variable' : 'volatile'}), so plan buffers ${cv < .15 ? 'modestly' : 'generously'}.`]) +
    grid('one', card({ title: 'Production through time', sub: 'Sum of recorded production per crop year', height: 320,
      plot: { traces: [{ type: 'scatter', mode: 'lines+markers', x: ys.yrs, y: ys.prod, fill: 'tozeroy', fillcolor: 'rgba(47,125,79,.12)', line: { color: PAL[0], width: 2.5 }, hovertemplate: '%{x}: %{y:,.0f}<extra></extra>' }], layout: { yaxis: { title: 'Production' } } },
      tbl: { headers: ['Year', 'Production', 'Area (ha)'], rows: ys.yrs.map((y, i) => [y, fmt(ys.prod[i]), fmt(ys.area[i])]) },
      how: 'Each point adds up every record reported for that crop year. A rising line means more recorded output.',
      insight: n > 1 ? `Output peaked in <b>${ys.yrs[iMax]}</b> at ${fmt(ys.prod[iMax])}, ${num(ys.prod[iMax] / (total / n), 1)}× the average year (${fmt(total / n)}).` : '',
      caution: 'The first and last crop years have far fewer records, so the line drops at both edges. That is incomplete reporting, not a real collapse.' })) +
    grid('', card({ title: `Top ${N} crops`, sub: 'By total recorded production', height: hh(N),
        plot: { traces: [hbar(crops.slice(0, N), PAL[0])], layout: hbarLayout() }, tbl: { headers: ['Crop', 'Production', 'Share'], rows: rowsOf(crops.slice(0, N), total) },
        how: 'Each bar is one crop’s total recorded production. Longer means more volume.',
        insight: `<b>${esc(crops[0][0])}</b> holds ${pct(topCrop)}${crops[1] ? `, ${num(share(crops[0][1], crops[1][1]), 1)}× the next crop (${esc(crops[1][0])})` : ''}.`,
        caution: 'Crops are recorded in different units (coconut in nuts, most others in tonnes), so this compares recorded volume, not weight or value.' }),
      card({ title: `Top ${N} states`, sub: 'By total recorded production', height: hh(N),
        plot: { traces: [hbar(states.slice(0, N), PAL[1])], layout: hbarLayout() }, tbl: { headers: ['State', 'Production', 'Share'], rows: rowsOf(states.slice(0, N), total) },
        how: 'Each bar is a state’s total recorded production.',
        insight: `<b>${esc(states[0][0])}</b> contributes ${pct(share(states[0][1], total))}${states[1] ? `, ahead of ${esc(states[1][0])} (${pct(share(states[1][1], total))})` : ''}.`,
        caution: 'A state ranks high either because it grows a lot or because it grows a high-volume crop such as coconut.' }));
};

P.trends = () => {
  const ys = yearSeries(FP), n = ys.yrs.length;
  const yld = ys.prod.map((p, i) => (ys.area[i] > 0 ? p / ys.area[i] : null));
  const yoy = ys.prod.map((v, i) => (i && ys.prod[i - 1] > 0 ? (v / ys.prod[i - 1] - 1) * 100 : null));
  const [a0, a1] = trimYears(n), cagr = cagrOf(ys.prod, a0, a1);
  return head('Trends', 'Is output rising, and is it coming from more land or from better yield?') +
    takeaways([n > 1 ? `Compound annual growth in production from ${ys.yrs[a0]} to ${ys.yrs[a1]} was about <b>${isNaN(cagr) ? '–' : pct(cagr)}</b> per year${n >= 5 ? ' (the sparsely reported first and last years are skipped)' : ''}.` : '',
      a1 > a0 ? `Between ${ys.yrs[a0]} and ${ys.yrs[a1]} yield moved from ${num(yld[a0])} to ${num(yld[a1])} production per hectare; area went from ${fmt(ys.area[a0])} to ${fmt(ys.area[a1])} ha.` : '']) +
    grid('one', card({ title: 'Total production by year', height: 340,
      plot: { traces: [{ type: 'scatter', mode: 'lines+markers', x: ys.yrs, y: ys.prod, line: { color: PAL[0], width: 2.5 } }], layout: { yaxis: { title: 'Production' } } },
      tbl: { headers: ['Year', 'Production', 'YoY %'], rows: ys.yrs.map((y, i) => [y, fmt(ys.prod[i]), yoy[i] == null ? '–' : yoy[i].toFixed(1) + '%']) },
      how: 'Each point is the total production recorded in that crop year. Read the overall direction first, then look for years that break the pattern. The Table view adds year-over-year percentages.',
      insight: n > 1 ? `Of ${n - 1} year-to-year changes, ${yoy.filter((v) => v > 0).length} were increases and ${yoy.filter((v) => v != null && v < 0).length} were decreases. ${isNaN(cagr) ? '' : `Output ${cagr >= 0 ? 'grew' : 'shrank'} at a compound ${pct(Math.abs(cagr))} per year from ${ys.yrs[a0]} to ${ys.yrs[a1]}. `}The best year (${ys.yrs[ys.prod.indexOf(maxOf(ys.prod))]}) was ${num(maxOf(ys.prod) / Math.max(minOf(ys.prod), 1), 1)}× the weakest (${ys.yrs[ys.prod.indexOf(minOf(ys.prod))]}).` : '',
      caution: 'Reporting coverage is uneven: the first and last years have few records, which exaggerates growth at the start and decline at the end. Judge the trend from the middle years.' })) +
    grid('one', card({ title: 'Yield and area', sub: 'Production per hectare (left) and cultivated area (right)', height: 340,
      plot: { traces: [{ type: 'scatter', mode: 'lines+markers', name: 'Yield', x: ys.yrs, y: yld, line: { color: PAL[1] } }, { type: 'scatter', mode: 'lines', name: 'Area (ha)', x: ys.yrs, y: ys.area, yaxis: 'y2', line: { color: PAL[2], dash: 'dot' } }],
        layout: { yaxis: { title: 'Yield' }, yaxis2: { overlaying: 'y', side: 'right', title: 'Area (ha)', showgrid: false } } },
      how: 'The solid line is yield (production per hectare, left axis) and the dotted line is total cultivated area (right axis). If production rises faster than area, the gain comes from higher yield rather than from planting more land.',
      insight: a1 > a0 && ys.area[a0] > 0 && ys.prod[a0] > 0 ? `From ${ys.yrs[a0]} to ${ys.yrs[a1]} recorded area changed by ${num((ys.area[a1] / ys.area[a0] - 1) * 100, 0)}% while production changed by ${num((ys.prod[a1] / ys.prod[a0] - 1) * 100, 0)}%. ${ys.prod[a1] / ys.prod[a0] > ys.area[a1] / ys.area[a0] ? 'Production grew faster than area, pointing to yield gains.' : 'Area grew at least as fast as production, so yields did not improve much.'}` : '',
      caution: 'Yield here is total production divided by total area across crops measured in different units, so treat it as a broad indicator. For a like-for-like view, filter to a single crop.' }));
};

P.crops = () => {
  const cp = entries(groupSum(FP, 'c', 'p')), total = sum(cp.map((e) => e[1])), N = S.topN, top = cp.slice(0, N);
  let cum = 0; const cumPct = top.map((e) => ((cum += e[1]) / total) * 100);
  const A = groupSum(FP.filter((r) => r.a > 0), 'c', 'a'), PP = groupSum(FP.filter((r) => r.a > 0), 'c', 'p');
  const yl = [...A.keys()].map((c) => [c, PP.get(c) / A.get(c)]).sort((a, b) => b[1] - a[1]).slice(0, N);
  let c80 = 0, acc80 = 0; for (const e of cp) { acc80 += e[1]; c80++; if (acc80 / total >= 0.8) break; }
  return head('Crops', 'Which crops carry the supply, and how dependent is it on a few of them?') +
    takeaways([`Top crop <b>${esc(top[0][0])}</b> holds ${pct(share(top[0][1], total))}; the top ${N} hold <b>${cumPct[cumPct.length - 1].toFixed(1)}%</b> of production.`,
      yl.length ? `Highest yield: <b>${esc(yl[0][0])}</b> at ${num(yl[0][1])} per hectare — rankings by yield and by volume differ.` : '']) +
    grid('', card({ title: `Top ${N} crops by production`, height: hh(N), plot: { traces: [hbar(top, PAL[0])], layout: hbarLayout() }, tbl: { headers: ['Crop', 'Production', 'Share'], rows: rowsOf(top, total) },
        how: 'Each bar is a crop’s summed production for the current selection, ranked from largest to smallest. Use the Table view for exact totals and shares.',
        insight: `Only <b>${c80}</b> of ${cp.length} crops are needed to reach 80% of all recorded production, and the single largest (${esc(top[0][0])}) supplies ${pct(share(top[0][1], total))}. Production is therefore highly concentrated in a few crops.`,
        caution: 'Different units mean this ranks recorded volume, not nutritional or economic importance.' }),
      card({ title: 'Concentration (Pareto)', height: hh(N), plot: { traces: [{ type: 'scatter', mode: 'lines+markers', x: top.map((e) => e[0]), y: cumPct, line: { color: PAL[3], width: 2.5 } }], layout: { yaxis: { title: 'Cumulative % of production', range: [0, 105] }, xaxis: { tickangle: -35 } } },
        how: 'Crops are added one at a time from largest to smallest, and the line shows the running percentage of total production. A line that shoots up and flattens means a few crops dominate; a gentle slope means output is spread evenly.',
        insight: `The #1 crop alone gives ${cumPct[0].toFixed(0)}%, the top ${Math.min(3, cumPct.length)} give ${cumPct[Math.min(3, cumPct.length) - 1].toFixed(0)}% and the top ${cumPct.length} give ${cumPct[cumPct.length - 1].toFixed(0)}%. The curve ${cumPct[0] > 50 ? 'is extremely steep: one crop is more than half of everything.' : 'rises steadily: no single crop overwhelms the rest.'}`,
        caution: 'The Pareto view hides the many small crops beyond the top N; they are still part of the remaining share.' })) +
    grid('', card({ title: `Top ${N} crops by yield`, sub: 'Production per hectare', height: 330, plot: { traces: [hbar(yl, PAL[1])], layout: hbarLayout() }, tbl: { headers: ['Crop', 'Yield'], rows: yl.map((e) => [esc(e[0]), num(e[1])]) },
        how: 'Yield is a crop’s total production divided by its total cultivated area, i.e. output per hectare. It measures how productive each hectare is, regardless of how much land the crop occupies.',
      insight: yl.length > 2 ? `The highest yields belong to <b>${esc(yl[0][0])}</b> (${num(yl[0][1])}), <b>${esc(yl[1][0])}</b> (${num(yl[1][1])}) and <b>${esc(yl[2][0])}</b> (${num(yl[2][1])}). Compare with the volume ranking: high yield and high volume are different things, because small-area crops can be very productive per hectare.` : '',
      caution: 'Units differ by crop (for example coconut counts nuts), so yield is only comparable between crops measured in the same unit.' }));
};

P.regions = () => {
  const sp = entries(groupSum(FP, 's', 'p')), total = sum(sp.map((e) => e[1])), N = S.topN, top = sp.slice(0, N);
  const sy = new Map(); for (const r of FP) { if (!sy.has(r.s)) sy.set(r.s, new Map()); const m = sy.get(r.s); m.set(r.y, (m.get(r.y) || 0) + r.p); }
  const cv = [...sy.entries()].map(([s, m]) => { const v = [...m.keys()].sort((a, b) => a - b).map((y) => m.get(y)); return [s, cvOf(v)]; }).filter((e) => !isNaN(e[1])).sort((a, b) => a[1] - b[1]);
  const A = groupSum(FP, 's', 'a'), nrec = new Map(); for (const r of FP) nrec.set(r.s, (nrec.get(r.s) || 0) + 1);
  let k80 = 0, a80 = 0; for (const e of sp) { a80 += e[1]; k80++; if (a80 / total >= 0.8) break; }
  return head('Regions', 'Which states carry the supply, and which of them can be relied on year after year?') +
    takeaways([`<b>${esc(sp[0][0])}</b> leads with ${pct(share(sp[0][1], total))}; the top 3 states hold ${pct(share(sum(sp.slice(0, 3).map((e) => e[1])), total))}. ${k80} of ${sp.length} states supply 80% of production.`,
      cv.length > 1 ? `Steadiest state year to year: <b>${esc(cv[0][0])}</b> (variation ${cv[0][1].toFixed(2)}); most volatile: <b>${esc(cv[cv.length - 1][0])}</b> (${cv[cv.length - 1][1].toFixed(2)}).` : '']) +
    grid('', card({ title: `Top ${N} states`, height: hh(N), plot: { traces: [hbar(top, PAL[0])], layout: hbarLayout() },
        tbl: { headers: ['State', 'Production', 'Share', 'Area (ha)', 'Yield', 'Records'], rows: top.map(([s, v]) => [esc(s), fmt(v), pct(share(v, total)), fmt(A.get(s) || 0), num(share(v, A.get(s) || 0)), int(nrec.get(s))]) },
        how: 'States ranked by total production. The Table view adds each state’s share, cultivated area, yield and number of records, so you can tell whether a high rank comes from land, productivity or simply more reporting.',
        insight: `<b>${esc(sp[0][0])}</b> leads with ${pct(share(sp[0][1], total))}, and ${k80} of ${sp.length} states supply 80% of production.`,
        caution: 'State totals combine very different crops; a state’s lead often reflects a single high-volume crop.' }),
      card({ title: `Output stability: ${Math.min(N, cv.length)} steadiest states`, sub: 'Variation of yearly production (lower = steadier)', height: hh(Math.min(N, cv.length)),
        plot: { traces: [hbar(cv.slice(0, N).map((e) => [e[0], e[1]]), PAL[5])], layout: hbarLayout({ xaxis: { title: 'Variation' } }) },
        tbl: { headers: ['State', 'Variation'], rows: cv.map((e) => [esc(e[0]), e[1].toFixed(2)]) },
        how: 'Variation (coefficient of variation) is the standard deviation of a state’s yearly totals divided by their mean. A shorter bar means a more dependable state.',
        insight: cv.length ? `Below about 0.3 a state is steady, above 1 it swings wildly. ${cv.filter((e) => e[1] > 1).length} of ${cv.length} states exceed 1, and ${cv.filter((e) => e[1] < 0.3).length} are below 0.3. The steadiest is <b>${esc(cv[0][0])}</b> (${cv[0][1].toFixed(2)}).` : 'Select at least three years to compute stability.',
        caution: 'High variation often comes from reporting gaps in some years rather than genuinely unstable harvests.' }));
};

P.seasons = () => {
  const se = entries(groupSum(FP, 'se', 'p')), total = sum(se.map((e) => e[1])), names = se.map((e) => e[0]);
  const topC = entries(groupSum(FP, 'c', 'p')).slice(0, S.topN).map((e) => e[0]), sc = new Map(), seT = groupSum(FP, 'se', 'p');
  for (const r of FP) if (topC.includes(r.c)) { const k = r.se + '|' + r.c; sc.set(k, (sc.get(k) || 0) + r.p); }
  const zc = names.map((s) => topC.map((c) => share(sc.get(s + '|' + c) || 0, seT.get(s)) * 100));
  return head('Seasons', 'When is the supply harvested, and which crops fill each season?') +
    takeaways([`<b>${esc(se[0][0])}</b> is the biggest season (${pct(share(se[0][1], total))}).`, se.length > 1 ? `Smallest: <b>${esc(se[se.length - 1][0])}</b> (${pct(share(se[se.length - 1][1], total), 2)}).` : '',
      'A big “Whole Year” slice almost always means perennial crops (coconut and sugarcane), not a year-round harvest.']) +
    grid('', card({ title: 'Production by season', plot: { traces: [{ type: 'bar', x: names, y: se.map((e) => e[1]), marker: { color: PAL }, hovertemplate: '%{x}: %{y:,.0f}<extra></extra>' }], layout: { yaxis: { title: 'Production' } } }, tbl: { headers: ['Season', 'Production', 'Share'], rows: rowsOf(se, total) },
        how: 'Each bar is one season’s total production for the selection; the Table view gives exact shares.',
        insight: `<b>${esc(se[0][0])}</b> is ${pct(share(se[0][1], total))} of the total${se[1] ? ` and ${num(share(se[0][1], se[1][1]), 1)}× the next season (${esc(se[1][0])})` : ''}.`,
        caution: 'Seasons differ in how many crops are grown and recorded, so a small season is not necessarily an unimportant one.' }),
      card({ title: 'Which crops fill each season', sub: `Share of the season’s production, top ${S.topN} crops (%)`, plot: { traces: [{ type: 'heatmap', x: topC, y: names, z: zc, colorscale: [[0, '#f3f1df'], [1, '#2f7d4f']], text: zc.map((r) => r.map((v) => v.toFixed(0))), texttemplate: '%{text}', colorbar: { title: '%' } }], layout: { yaxis: { autorange: 'reversed' }, xaxis: { tickangle: -35 }, margin: { l: 90, b: 90, t: 10, r: 10 } } },
        how: 'Each row shows what percent of that season’s production each crop supplies (other crops make up the rest).', insight: names.slice(0, 3).map((s, i) => { const row = zc[i], m = Math.max(...row); return `In ${esc(s)}, ${esc(topC[row.indexOf(m)])} supplies ${m.toFixed(0)}% of production`; }).join('; ') + '.',
        caution: `Percentages cover only the top ${S.topN} crops, so a row can sum to less than 100%.` }));
};

P.notes = () => {
  const removed = RAW.length - CLEAN.length;
  const seen = new Set(); let dups = 0;
  for (const r of RAW) { const k = `${r.s}|${r.d}|${r.y}|${r.se}|${r.c}|${r.a}|${r.p}`; if (seen.has(k)) dups++; else seen.add(k); }
  const nulls = Object.entries(RAW_NULLS), zeros = CLEAN.reduce((c, r) => c + (r.p === 0 ? 1 : 0), 0);
  const cols = [['State_Name', 'Text', 'Indian state where the crop is grown'], ['District_Name', 'Text', 'District within the state'], ['Crop_Year', 'Integer', 'Year of the agricultural record'],
    ['Season', 'Text', 'Kharif, Rabi, Summer, Autumn, Winter or Whole Year'], ['Crop', 'Text', 'Crop cultivated (124 types)'], ['Area', 'Number', 'Cultivated land area in hectares'], ['Production', 'Number', 'Quantity produced (unit depends on the crop)']];
  return head('Data notes', 'How the numbers were prepared, and how far they can be trusted.') +
    `<div class="kpis">${kpi('Raw rows', int(RAW.length))}${kpi('Cleaned rows', int(CLEAN.length))}${kpi('Rows removed', int(removed), 'missing Production')}${kpi('Duplicate rows', int(dups), 'in raw data')}${kpi('Zero-production rows', int(zeros), 'kept as valid values')}</div>` +
    grid('', card({ title: 'Completeness by column', height: 300, plot: { traces: [{ type: 'bar', orientation: 'h', x: nulls.map(([, n]) => (1 - n / RAW.length) * 100), y: nulls.map((e) => e[0]), text: nulls.map(([, n]) => ((1 - n / RAW.length) * 100).toFixed(2) + '%'), textposition: 'outside', cliponaxis: false, marker: { color: PAL[0] } }], layout: { xaxis: { range: [90, 101], title: '% complete' }, yaxis: { autorange: 'reversed' }, margin: { l: 110, r: 50, t: 8, b: 40 } } },
        tbl: { headers: ['Column', 'Missing', '% missing'], rows: nulls.map(([c, n]) => [c, int(n), pct(n / RAW.length, 2)]) }, how: 'Share of rows with a value, per column (axis starts at 90%).',
        insight: `${int(RAW_NULLS.Production)} rows (${pct(RAW_NULLS.Production / RAW.length, 2)}) lack a Production value; every other column is 100% complete. Those rows cannot contribute to production totals, so the cleaned file drops them. Raw therefore always has more rows than Cleaned.`,
        caution: 'Dropping these rows also removes their area, so area totals on the cleaned data are slightly lower than on the raw data.' }),
      card({ title: 'Fields', html: table(['Column', 'Type', 'Description'], cols) })) +
    grid('', card({ title: 'How measures are calculated', html: '<dl class="dict"><dt>Yield</dt><dd>Production ÷ Area; for a group, total production ÷ total area.</dd><dt>Annual growth</dt><dd>Compound annual growth rate of yearly totals. The sparsely reported first and last years are skipped.</dd><dt>Variation (CV)</dt><dd>Standard deviation ÷ mean of the yearly totals. Lower means steadier.</dd><dt>Crops for 80% of output</dt><dd>How many crops, largest first, are needed to reach 80% of production.</dd><dt>Ratings</dt><dd>Rules of thumb, listed under the scorecard.</dd></dl>' }),
      card({ title: 'Cleaning & limitations', html: '<dl class="dict"><dt>Cleaning</dt><dd>Column names and text trimmed, types fixed, rows with missing Production removed.</dd><dt>Kept</dt><dd>Zero values and outliers (large districts and perennial crops are legitimate).</dd><dt>Units</dt><dd>Production is not in one common unit: coconut is counted in nuts. Totals across crops describe recorded volume only.</dd><dt>Scope</dt><dd>No rainfall, soil, irrigation, input, price or farmer data.</dd><dt>Coverage</dt><dd>Reporting is uneven across states and years, so trends at the edges can mislead.</dd></dl>' }));
};

/* ------------------------------------------------------------ advanced model (computed in the notebook, Sections 15–16; stored in model.js) */
const MODEL_PAGES = new Set(['predict', 'reco']);
const missingModel = (t) => head(t, '') + '<div class="alert">model.js is missing — keep it in the same folder as index.html.</div>';
const FEATURE_NAME = { State_Name: 'State', Crop: 'Crop', Season: 'Season', Crop_Year: 'Crop year', log_area: 'Area planted' };

P.predict = () => {
  const m = window.MODEL; if (!m) return missingModel('Predict yield');
  const { model: a, baseline: b } = m.metrics, sp = m.split, gain = 1 - a.mae_log / b.mae_log;
  const apes = m.crop_error.map((e) => e.median_ape), imp = m.importance.slice().sort((x, y) => y.importance - x.importance);
  return head('Predict yield', 'A Gradient Boosting model predicts the yield (production per hectare) of a crop in a state and season. It was trained on earlier years and tested on later years it had never seen.') +
    `<div class="kpis">${kpi('Accuracy (R²)', a.r2.toFixed(2), `crop-average baseline: ${b.r2.toFixed(2)}`)}${kpi('Error reduction', pct(gain, 0), 'lower average error than the baseline')}` +
    `${kpi('Typical error', `${pct(minOf(apes), 0)}–${pct(maxOf(apes), 0)}`, 'median error for the main crops')}${kpi('Tested on', int(sp.test_rows), `records from ${sp.test_years}`)}${kpi('Trained on', int(sp.train_rows), `records from ${sp.train_years}`)}</div>` +
    takeaways([`<b>It works:</b> on years it had never seen, the model explains R² = ${a.r2.toFixed(2)} of the variation in yield and cuts the average error by <b>${pct(gain, 0)}</b> compared with simply using each crop's average.`,
      `<b>What drives yield:</b> ${esc(FEATURE_NAME[imp[0].feature])} matters most, then ${esc(FEATURE_NAME[imp[1].feature].toLowerCase())}. Season and area add little, and crop year adds nothing, so the data shows no steady yield trend over time.`,
      `<b>How to use it:</b> predictions are accurate to roughly ${pct(minOf(apes), 0)}–${pct(maxOf(apes), 0)} for the main crops, so use them to <b>rank and compare</b> states and crops, not as exact forecasts.`]) +
    grid('', card({ title: 'Model vs baseline', sub: 'Error on the test years (lower is better)', height: 320,
        plot: { traces: [{ type: 'bar', name: 'Baseline (crop average)', x: ['MAE', 'RMSE'], y: [b.mae_log, b.rmse_log], marker: { color: PAL[7] } }, { type: 'bar', name: 'Gradient Boosting', x: ['MAE', 'RMSE'], y: [a.mae_log, a.rmse_log], marker: { color: PAL[0] } }], layout: { barmode: 'group', yaxis: { title: 'Error (log scale of yield)' } } },
        tbl: { headers: ['Measure', 'Baseline', 'Gradient Boosting'], rows: [['R²', b.r2.toFixed(3), a.r2.toFixed(3)], ['MAE (log)', b.mae_log.toFixed(3), a.mae_log.toFixed(3)], ['RMSE (log)', b.rmse_log.toFixed(3), a.rmse_log.toFixed(3)]] },
        how: 'The baseline guesses each crop’s average yield. The model also uses state, season, area and year. MAE is the average miss and RMSE punishes big misses more; shorter bars are better.',
        insight: `The model's average miss is ${a.mae_log.toFixed(2)} against ${b.mae_log.toFixed(2)} for the baseline, a ${pct(gain, 0)} improvement. R² rises from ${b.r2.toFixed(2)} to ${a.r2.toFixed(2)}.`,
        caution: 'Most of the variation in yield is explained just by knowing which crop it is, so the baseline is already strong. The model’s extra value comes from the state.' }),
      card({ title: 'Actual vs predicted yield', sub: 'A sample of test records (log scale)', height: 320,
        plot: { traces: [{ type: 'scattergl', mode: 'markers', x: m.scatter.actual, y: m.scatter.pred, text: m.scatter.crop, marker: { size: 4, opacity: .45, color: PAL[2] }, name: 'Records', hovertemplate: '%{text}<br>actual %{x:.2f}, predicted %{y:.2f}<extra></extra>' },
          { type: 'scatter', mode: 'lines', x: [0, maxOf(m.scatter.actual)], y: [0, maxOf(m.scatter.actual)], line: { color: PAL[3], dash: 'dash' }, name: 'Perfect prediction' }], layout: { xaxis: { title: 'Actual log(1 + yield)' }, yaxis: { title: 'Predicted log(1 + yield)' } } },
        how: 'Each dot is one district record from 2011–2014. A dot on the dashed line is a perfect prediction; the further away, the bigger the miss.',
        insight: 'The cloud follows the dashed line closely, with more scatter where yields are very low or very high. The model tracks the level of yield well, but not every year’s ups and downs.',
        caution: 'Weather, irrigation and inputs are not in the data, so the model cannot explain a bad or a bumper year.' })) +
    grid('', card({ title: 'What drives yield', sub: 'Drop in accuracy when the feature is shuffled', height: 300,
        plot: { traces: [hbar(imp.map((e) => [FEATURE_NAME[e.feature], e.importance]), PAL[1])], layout: hbarLayout() },
        tbl: { headers: ['Feature', 'Importance'], rows: imp.map((e) => [FEATURE_NAME[e.feature], e.importance.toFixed(3)]) },
        how: 'Each feature is scrambled in turn and the fall in R² is recorded. A longer bar means the model leans on that feature more.',
        insight: `${esc(FEATURE_NAME[imp[0].feature])} dominates, followed by ${esc(FEATURE_NAME[imp[1].feature].toLowerCase())}. Crop year is about zero, so there is no clear improvement or decline in yield across 1997–2014.`,
        caution: 'Crop dominates partly because crops use different units (coconut is counted in nuts). State is the feature a planner can act on.' }),
      card({ title: 'Typical error by crop', sub: 'Median absolute percentage error, test years', height: 300,
        plot: { traces: [hbar(m.crop_error.slice().sort((x, y) => x.median_ape - y.median_ape).map((e) => [e.crop, e.median_ape * 100]), PAL[5])], layout: hbarLayout({ xaxis: { title: '% error' } }) },
        tbl: { headers: ['Crop', 'Test records', 'Median error'], rows: m.crop_error.map((e) => [esc(e.crop), int(e.n), pct(e.median_ape, 1)]) },
        how: 'For each main crop, the typical (median) gap between predicted and actual yield, as a percentage of the actual yield.',
        insight: (() => { const ce = m.crop_error.slice().sort((x, y) => x.median_ape - y.median_ape), w = ce[ce.length - 1]; return `${esc(ce[0].crop)} and ${esc(ce[1].crop)} are predicted best (about ${pct(ce[0].median_ape, 0)}–${pct(ce[1].median_ape, 0)} off). ${esc(w.crop)} is hardest at about ${pct(w.median_ape, 0)}.`; })(),
        caution: 'These errors are for individual district records; they were not measured on state totals.' }));
};

P.reco = () => {
  const m = window.MODEL; if (!m) return missingModel('Recommend');
  const all = m.reco, states = [...new Set(all.map((r) => r.state))].sort();
  const sel = states.includes(S.recoState) ? S.recoState : '';
  const exp = all.filter((r) => r.action === 'Expand').length, red = all.filter((r) => r.action === 'Reduce').length;
  const gains = m.state_gain, g = sel ? gains.find((e) => e.state === sel) : gains[0];
  const rows = sel ? all.filter((r) => r.state === sel).sort((x, y) => y.change - x.change || y.index - x.index)
    : all.filter((r) => r.action === 'Expand').sort((x, y) => y.index - x.index).slice(0, 12);
  const aTag = (a) => (a === 'Expand' ? tag('good', a) : a === 'Reduce' ? tag('warn', a) : tag('', a));
  const tbl = table([...(sel ? [] : ['State']), 'Season', 'Crop', 'Action', 'Area now (ha/yr)', 'Recommended', 'Change', 'Yield index', 'Yield variation'],
    rows.map((r) => [...(sel ? [] : [esc(r.state)]), esc(r.season), esc(r.crop), aTag(r.action), fmt(r.area_now), fmt(r.area_new), (r.change > 0 ? '+' : '') + pct(r.change, 0), num(r.index), r.cv == null ? '–' : num(r.cv)]));
  const moved = rows.filter((r) => r.action !== 'Hold');
  const chart = sel && !moved.length
    ? card({ title: `Recommended change in area: ${esc(sel)}`, html: '<p class="sub" style="padding:6px 2px">No crop in this state differs enough from the typical state (yield index 1.10 or above, or 0.90 or below) to justify moving land, so every crop is held.</p>' })
    : sel ? card({ title: `Recommended change in area: ${esc(sel)}`, sub: 'Crops that move (at most ±25% each)', height: Math.max(240, 70 + moved.length * 26),
      plot: { traces: [{ type: 'bar', orientation: 'h', x: moved.map((r) => r.change * 100), y: moved.map((r) => `${r.crop} (${r.season})`), marker: { color: moved.map((r) => (r.action === 'Expand' ? PAL[0] : PAL[3])) }, hovertemplate: '%{y}: %{x:.0f}%<extra></extra>' }], layout: { yaxis: { autorange: 'reversed', automargin: true }, xaxis: { title: '% change in area' }, margin: { l: 10, r: 20, t: 8, b: 40 } } },
      how: 'Green bars are crops where the state is expected to out-yield the typical state, so the plan adds area. Rust bars are crops where it is expected to under-perform, so the plan trims area.',
      insight: `${esc(sel)} would gain about <b>${pct(g.gain, 1)}</b> in area-weighted yield index by following these shifts, with the total area unchanged.`,
      caution: 'The ±25% and 10% limits are assumptions that keep the plan realistic; they are not measured agronomic limits.' })
    : card({ title: 'Where reallocation helps most', sub: 'Estimated gain in area-weighted yield index', height: hh(10),
      plot: { traces: [hbar(gains.slice(0, 10).map((e) => [e.state, e.gain * 100]), PAL[0])], layout: hbarLayout({ xaxis: { title: '% gain' } }) },
      tbl: { headers: ['State', 'Estimated gain'], rows: gains.map((e) => [esc(e.state), pct(e.gain, 1)]) },
      how: 'For each state, area is shifted between crops of the same season towards those with a higher yield index. The bar shows how much the area-weighted index rises.',
      insight: `<b>${esc(gains[0].state)}</b> has the most room (${pct(gains[0].gain, 1)}), followed by ${esc(gains[1].state)} (${pct(gains[1].gain, 1)}) and ${esc(gains[2].state)} (${pct(gains[2].gain, 1)}). Choose a state above to see its crop-by-crop plan.`,
      caution: 'A bigger gain means more mismatch between current crops and where the state yields best. It does not mean the state is performing badly.' });
  return head('Recommend', 'Within each state and season, which crops should get more land and which less? Built from the predicted yields on the previous page.') +
    '<div class="alert"><b>Decision support, not an instruction.</b> The data has no prices, costs, soil, water or climate information, so “better” means a higher predicted yield than other states get for the same crop, not higher profit.</div>' +
    `<div class="kpis">${kpi('States covered', int(states.length), 'with enough history')}${kpi('Crops to expand', int(exp), 'state-season-crop combinations', '', tag('good', 'Expand'))}${kpi('Crops to reduce', int(red), 'state-season-crop combinations', '', tag('warn', 'Reduce'))}${kpi('Biggest gain', pct(gains[0].gain, 1), esc(gains[0].state))}</div>` +
    takeaways(['<b>Yield index</b> = predicted 2015 yield ÷ the typical (median) yield of the same crop across states. Above 1 means the state is expected to out-yield the typical state, and the index makes crops with different units comparable.',
      '<b>Method:</b> a linear program per state and season keeps total area fixed, moves at most 10% of the land, lets each crop change by at most ±25%, and maximizes the area-weighted yield index. Only crops clearly above (index 1.10 or more) or below (0.90 or less) the typical state are moved; the rest are held.',
      '<b>Check stability first:</b> before expanding a crop, look at its yield variation. Above about 0.3 means the yield has swung a lot from year to year.',
      'Coconut is left out because it is a perennial crop whose area cannot be shifted from year to year.']) +
    `<div class="ctrls"><label>State <select id="recoState"><option value="">All states: top opportunities</option>${states.map((s) => `<option ${s === sel ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label></div>` +
    grid('one', chart) + grid('one', card({ title: sel ? `Crop plan: ${esc(sel)}` : 'Strongest expansion opportunities', sub: sel ? 'Every crop in the state, largest increase first' : 'Highest yield index across all states', html: `<div style="max-height:460px;overflow:auto">${tbl}</div>`,
      how: 'Area now is the 2010–2014 yearly average. Recommended is the planned area. Yield index above 1 means better than the typical state for that crop; yield variation is the coefficient of variation of the yearly yield.',
      caution: 'Reducing a crop is a prompt to review support (seed, irrigation, extension), not necessarily to stop growing it.' }));
};

/* ------------------------------------------------------------ filters & state */
function options(key) {
  const base = S.dataset === 'Raw' ? RAW : CLEAN;
  return [...new Set(base.map((r) => r[key]))].sort();
}
const MS_LABEL = { s: 'states', se: 'seasons', c: 'crops' };
function renderMS(key) {
  const host = $('ms-' + key), sel = S.sel[key], opts = options(key); for (const v of [...sel]) if (!opts.includes(v)) sel.delete(v);
  const wasOpen = host.classList.contains('open');
  host.innerHTML = `<button type="button" class="ms-btn" aria-haspopup="listbox"><span>${sel.size ? sel.size + ' selected' : 'All ' + MS_LABEL[key]}</span><span aria-hidden="true">▾</span></button>
    <div class="ms-panel"><input class="ms-search" placeholder="Search…" aria-label="Search ${MS_LABEL[key]}"><div class="ms-list">${opts.map((o) => `<label data-o="${esc(o.toLowerCase())}"><input type="checkbox" value="${esc(o)}" ${sel.has(o) ? 'checked' : ''}> ${esc(o)}</label>`).join('')}</div>
    <div class="ms-actions"><a class="clr">Clear</a><a class="cls">Done</a></div></div>`;
  if (wasOpen) host.classList.add('open');
  host.querySelector('.ms-btn').onclick = () => host.classList.toggle('open');
  host.querySelector('.cls').onclick = () => host.classList.remove('open');
  host.querySelector('.clr').onclick = () => { sel.clear(); changed(); };
  host.querySelector('.ms-search').oninput = (e) => { const q = e.target.value.toLowerCase(); host.querySelectorAll('.ms-list label').forEach((l) => (l.style.display = l.dataset.o.includes(q) ? '' : 'none')); };
  host.querySelectorAll('.ms-list input').forEach((cb) => (cb.onchange = () => { cb.checked ? sel.add(cb.value) : sel.delete(cb.value); changed(); }));
}
const renderAllMS = () => ['s', 'se', 'c'].forEach(renderMS);
function changed() { clearTimeout(debounce); debounce = setTimeout(() => { renderAllMS(); refresh(); }, 120); }

function paintChips() {
  const chips = [];
  for (const [k, set] of Object.entries(S.sel)) if (set.size) chips.push([k, `${MS_LABEL[k][0].toUpperCase() + MS_LABEL[k].slice(1)}: ${set.size <= 2 ? [...set].map(esc).join(', ') : set.size + ' selected'}`]);
  if (S.noCoco) chips.push(['coco', 'Excluding coconut']);
  if (S.y0 !== YEAR_MIN || S.y1 !== YEAR_MAX) chips.push(['years', `${S.y0}–${S.y1}`]);
  $('chips').innerHTML = chips.map(([k, l]) => `<span class="chip">${l}<button data-k="${k}" aria-label="Remove filter">×</button></span>`).join('');
  $('reset').hidden = !chips.length;
}
function resetAll() {
  Object.values(S.sel).forEach((s) => s.clear()); S.noCoco = false; $('nococo').checked = false; S.y0 = YEAR_MIN; S.y1 = YEAR_MAX; $('y0').value = S.y0; $('y1').value = S.y1; renderAllMS(); refresh();
}
function applyFilters() {
  const base = S.dataset === 'Raw' ? RAW : CLEAN, { sel } = S;
  F = base.filter((r) => (r.y == null || (r.y >= S.y0 && r.y <= S.y1)) && (!sel.s.size || sel.s.has(r.s)) && (!sel.se.size || sel.se.has(r.se)) && (!sel.c.size || sel.c.has(r.c)) && !(S.noCoco && r.c === 'Coconut'));
  FP = F.filter((r) => r.p != null);
  $('count').textContent = `${int(F.length)} of ${int(base.length)} records`; $('datasetPill').textContent = S.dataset + ' data';
  paintChips();
}
function refresh() { applyFilters(); render(); }

/* ------------------------------------------------------------ render + wiring */
function render() {
  seq = 0; Q = [];
  const el = $('view');
  if (!F.length && !MODEL_PAGES.has(S.page)) { el.innerHTML = '<div class="alert">No records match the current filters. Clear a filter to continue.</div>'; return; }
  if (!FP.length && !['notes', 'predict', 'reco'].includes(S.page)) { el.innerHTML = '<div class="alert">None of the selected records has a production value.</div>'; return; }
  el.innerHTML = P[S.page]();
  for (const [id, traces, layout] of Q) { const n = $(id); if (n) Plotly.newPlot(n, traces, layoutOf(layout), { responsive: true, displaylogo: false }); }
  const rs = $('recoState');
  if (rs) rs.onchange = () => { S.recoState = rs.value; render(); };
}
const TOPN_PAGES = new Set(['overview', 'crops', 'regions', 'seasons']);
function updateTopN() {
  const on = TOPN_PAGES.has(S.page), el = $('topn');
  el.disabled = !on; el.title = on ? 'How many items the top-N charts on this page show' : 'Not used on this page';
}
function setPage(p) {
  S.page = p; updateTopN();
  $('filterbar').style.display = MODEL_PAGES.has(p) ? 'none' : '';   /* model results are computed on the full cleaned data */
  document.querySelectorAll('#nav button').forEach((b) => (b.dataset.p === p ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  render(); window.scrollTo({ top: 0 });
}
function initTheme() {
  let t = 'light';
  try { t = localStorage.getItem('hl-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch (e) { /* storage blocked */ }
  document.documentElement.dataset.theme = t;
  $('themeBtn').onclick = () => {
    const n = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = n;
    try { localStorage.setItem('hl-theme', n); } catch (e) { /* ignore */ }
    render();
  };
}
function initUI() {
  $('nav').innerHTML = PAGES.map(([g, items]) => `<span class="grp">${g}</span>${items.map(([k, l]) => `<button data-p="${k}" ${k === S.page ? 'aria-current="page"' : ''}>${l}</button>`).join('')}`).join('');
  $('nav').onclick = (e) => { const b = e.target.closest('button'); if (b) setPage(b.dataset.p); };
  const yrs = []; for (let y = YEAR_MIN; y <= YEAR_MAX; y++) yrs.push(y);
  for (const id of ['y0', 'y1']) $(id).innerHTML = yrs.map((y) => `<option>${y}</option>`).join('');
  $('y0').value = S.y0; $('y1').value = S.y1;
  $('y0').onchange = () => { S.y0 = +$('y0').value; if (S.y0 > S.y1) { S.y1 = S.y0; $('y1').value = S.y1; } refresh(); };
  $('y1').onchange = () => { S.y1 = +$('y1').value; if (S.y1 < S.y0) { S.y0 = S.y1; $('y0').value = S.y0; } refresh(); };
  $('topn').onchange = () => { S.topN = +$('topn').value; render(); };
  $('nococo').onchange = () => { S.noCoco = $('nococo').checked; refresh(); };
  $('dataset-seg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.dataset = b.dataset.v; document.querySelectorAll('#dataset-seg button').forEach((x) => x.classList.toggle('on', x === b)); renderAllMS(); refresh(); };
  $('reset').onclick = resetAll;
  $('chips').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const k = b.dataset.k;
    if (k === 'coco') { S.noCoco = false; $('nococo').checked = false; }
    else if (k === 'years') { S.y0 = YEAR_MIN; S.y1 = YEAR_MAX; $('y0').value = S.y0; $('y1').value = S.y1; }
    else S.sel[k].clear();
    renderAllMS(); refresh();
  };
  document.addEventListener('click', (e) => { document.querySelectorAll('.ms.open').forEach((m) => { if (!m.contains(e.target)) m.classList.remove('open'); }); });
  $('view').addEventListener('click', (e) => {   /* Chart | Table toggle */
    const b = e.target.closest('.vt button'); if (!b) return;
    const id = b.parentElement.dataset.id, showTable = b.dataset.m === 'table';
    b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    $(id).hidden = showTable; $(id + 't').hidden = !showTable; if (!showTable) Plotly.Plots.resize($(id));
  });
  renderAllMS(); updateTopN();
}

/* ------------------------------------------------------------ boot */
/* Data is embedded in data.js (columnar + lookup tables), so no file fetch or picker is needed. */
function ingest() {
  const D = window.CROP_DATA, n = D.y.length;
  RAW = new Array(n);
  for (let i = 0; i < n; i++) RAW[i] = { s: D.states[D.s[i]], d: D.districts[D.d[i]], y: D.y[i], se: D.seasons[D.se[i]], c: D.crops[D.c[i]], a: D.a[i], p: D.p[i] };
  window.CROP_DATA = null;
  CLEAN = RAW.filter((r) => r.p != null);
  RAW_NULLS = { State_Name: 0, District_Name: 0, Crop_Year: 0, Season: 0, Crop: 0, Area: 0, Production: 0 };
  for (const r of RAW) {
    if (!r.s) RAW_NULLS.State_Name++; if (!r.d) RAW_NULLS.District_Name++; if (r.y == null) RAW_NULLS.Crop_Year++;
    if (!r.se) RAW_NULLS.Season++; if (!r.c) RAW_NULLS.Crop++; if (r.a == null) RAW_NULLS.Area++; if (r.p == null) RAW_NULLS.Production++;
  }
  const ys = RAW.map((r) => r.y); YEAR_MIN = S.y0 = minOf(ys); YEAR_MAX = S.y1 = maxOf(ys);
  $('loader').classList.add('hide'); initTheme(); initUI(); refresh();
}
if (window.CROP_DATA) ingest();
else $('loader-msg').textContent = 'data.js is missing — keep it in the same folder as index.html.';