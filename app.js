/* Harvest Ledger — India crop production dashboard (vanilla JS + Plotly.js + PapaParse) */
'use strict';


const PAL = ['#2f7d4f', '#d9962b', '#2b7a9b', '#c4572f', '#7a4e8c', '#6b8e23', '#b5651d', '#4d6a7a', '#a05195', '#8c8c3d'];
const PAGES = [
  ['Explore', [['overview', 'Overview'], ['trends', 'Trends'], ['crops', 'Crops'], ['regions', 'Regions'], ['seasons', 'Seasons']]],
  ['Statistics', [['central', 'Central tendency'], ['spread', 'Spread & shape'], ['relations', 'Relationships']]],
  ['Data', [['quality', 'Data quality'], ['records', 'Records'], ['dictionary', 'Dictionary']]],
];
const VARS = { p: 'Production', a: 'Area (ha)', yl: 'Yield (prod/ha)' };
const GROUPS = { se: 'Season', c: 'Crop', s: 'State' };

let RAW = [], CLEAN = [], RAW_NULLS = {}, YEAR_MIN = 1997, YEAR_MAX = 2015;
const S = {
  dataset: 'Cleaned', y0: 1997, y1: 2015, topN: 10, noCoco: false, page: 'overview',
  sel: { s: new Set(), d: new Set(), se: new Set(), c: new Set() },
  cropFocus: null, scatterBy: 'se', log: true, variable: 'p', group: 'se', recView: 'filtered', recSearch: '', recPage: 0,
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
const valueOf = (r, v) => (v === 'yl' ? yieldOf(r) : r[v]);
const groupSum = (rows, key, val) => { const m = new Map(); for (const r of rows) m.set(r[key], (m.get(r[key]) || 0) + r[val]); return m; };
const entries = (m, desc = true) => [...m.entries()].sort((a, b) => (desc ? b[1] - a[1] : a[1] - b[1]));
const share = (part, whole) => (whole > 0 ? part / whole : 0);

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function describe(values) {
  const v = Float64Array.from(values).sort(), n = v.length;
  const mean = sum(v) / n;
  let m2 = 0;
  for (const x of v) m2 += (x - mean) ** 2;
  const variance = n > 1 ? m2 / (n - 1) : NaN, sd = Math.sqrt(variance);
  let skew = NaN, kurt = NaN;
  if (n > 3 && sd > 0) {
    let s3 = 0, s4 = 0;
    for (const x of v) { const z = (x - mean) / sd; s3 += z ** 3; s4 += z ** 4; }
    skew = (n / ((n - 1) * (n - 2))) * s3;
    kurt = ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * s4 - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
  }
  const counts = new Map(); let mode = v[0], best = 0;
  for (const x of v) { const c = (counts.get(x) || 0) + 1; counts.set(x, c); if (c > best) { best = c; mode = x; } }
  const q1 = quantile(v, 0.25), q3 = quantile(v, 0.75), iqr = q3 - q1, lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
  let out = 0, wl = v[n - 1], wh = v[0];
  for (const x of v) { if (x < lo || x > hi) out++; else { if (x < wl) wl = x; if (x > wh) wh = x; } }
  return { n, mean, median: quantile(v, 0.5), mode, sd, variance, cv: mean ? sd / Math.abs(mean) : NaN, min: v[0], max: v[n - 1],
    range: v[n - 1] - v[0], q1, q3, iqr, p90: quantile(v, 0.9), p99: quantile(v, 0.99), skew, kurt, outliers: out, wl, wh };
}
function pearson(x, y) {
  const n = x.length; if (n < 3) return NaN;
  const mx = sum(x) / n, my = sum(y) / n; let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxy / Math.sqrt(sxx * syy);
}
function ranks(a) {
  const idx = Array.from(a.keys()).sort((i, j) => a[i] - a[j]), r = new Float64Array(a.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && a[idx[j + 1]] === a[idx[i]]) j++;
    const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k]] = avg; i = j + 1;
  }
  return r;
}
const spearman = (x, y) => pearson(ranks(x), ranks(y));
const strength = (r) => { const a = Math.abs(r); return a < .2 ? 'very weak' : a < .4 ? 'weak' : a < .6 ? 'moderate' : a < .8 ? 'strong' : 'very strong'; };
const shapeWord = (s) => (s > 1 ? 'strongly right-skewed' : s > .5 ? 'moderately right-skewed' : s < -.5 ? 'left-skewed' : 'roughly symmetric');

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
const kpi = (label, value, small = '', spark = '') => `<div class="kpi"><span class="l">${label}</span><b>${value}</b><small>${small}</small>${spark}</div>`;
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

/* group a variable by a key, keeping the groups with the most records */
function groupedStats(variable, key, limit = 12) {
  const m = new Map();
  for (const r of F) { const v = valueOf(r, variable); if (v == null || isNaN(v)) continue; (m.get(r[key]) || m.set(r[key], []).get(r[key])).push(v); }
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, limit).map(([k, vals]) => ({ name: k, d: describe(vals) }));
}

/* ------------------------------------------------------------ pages */
const P = {};

P.overview = () => {
  const total = sum(FP.map((r) => r.p)), area = sum(FP.map((r) => r.a || 0));
  const ys = yearSeries(FP), n = ys.yrs.length;
  const crops = entries(groupSum(FP, 'c', 'p')), states = entries(groupSum(FP, 's', 'p')), seasons = entries(groupSum(FP, 'se', 'p'));
  const yields = FP.map(yieldOf).filter((v) => v != null).sort((a, b) => a - b);
  const uniq = (k) => new Set(F.map((r) => r[k])).size;
  const ok = FP.filter((r) => r.a != null);
  const sp = ok.length > 3 ? spearman(ok.map((r) => r.a), ok.map((r) => r.p)) : NaN;
  const iMax = ys.prod.indexOf(maxOf(ys.prod)), N = S.topN;
  return head('Overview', 'A one-screen summary of what was grown, where, when and how much — for whatever the filters above select.') +
    (!S.noCoco && FP.some((r) => r.c === 'Coconut') ? '<div class="alert"><b>Coconut is dominating the totals.</b> It is recorded in nuts, not tonnes, so it dwarfs every other crop. Switch on <b>Exclude coconut</b> in the filter bar for a fairer comparison.</div>' : '') +
    takeaways([
      `<b>${esc(crops[0][0])}</b> is the largest crop (${pct(share(crops[0][1], total))} of recorded production); the top 3 crops hold ${pct(share(sum(crops.slice(0, 3).map((e) => e[1])), total))}.`,
      `<b>${esc(states[0][0])}</b> leads the states with ${pct(share(states[0][1], total))}; the top 3 states hold ${pct(share(sum(states.slice(0, 3).map((e) => e[1])), total))}.`,
      `<b>${esc(seasons[0][0])}</b> is the biggest season (${pct(share(seasons[0][1], total))}).`,
      n > 1 ? `Production peaked in <b>${ys.yrs[iMax]}</b> at ${fmt(ys.prod[iMax])}.` : '',
      isNaN(sp) ? '' : `Area and production are <b>${strength(sp)}</b>ly related by rank (Spearman ρ = ${sp.toFixed(2)}).`,
    ]) +
    `<div class="kpis">${kpi('Total production', fmt(total), 'recorded volume', sparkline(ys.prod))}${kpi('Cultivated area', fmt(area) + ' ha', 'summed over records', sparkline(ys.area, 'var(--amber)'))}
      ${kpi('Median yield', num(quantile(yields, .5)), 'production per hectare, typical record')}${kpi('Records', int(F.length), `${int(F.length - FP.length)} without production`)}
      ${kpi('Coverage', `${uniq('s')} · ${uniq('d')} · ${uniq('c')}`, 'states · districts · crops')}${kpi('Period', `${minOf(FP.map((r) => r.y))}–${maxOf(FP.map((r) => r.y))}`, `${n} crop years`)}</div>` +
    grid('wide',
      card({ title: 'Production through time', sub: 'Sum of recorded production per crop year',
        plot: { traces: [{ type: 'scatter', mode: 'lines+markers', x: ys.yrs, y: ys.prod, fill: 'tozeroy', fillcolor: 'rgba(47,125,79,.12)', line: { color: PAL[0], width: 2.5 }, hovertemplate: '%{x}: %{y:,.0f}<extra></extra>' }], layout: { yaxis: { title: 'Production' } } },
        tbl: { headers: ['Year', 'Production', 'Area (ha)'], rows: ys.yrs.map((y, i) => [y, fmt(ys.prod[i]), fmt(ys.area[i])]) },
        how: 'Each point adds up every crop-district-season record reported for that crop year, so the line is the total recorded production for your current selection. A rising line means more recorded output; the shaded area under it makes the overall scale easy to compare from year to year.',
        insight: n > 1 ? `Output peaked in <b>${ys.yrs[iMax]}</b> at ${fmt(ys.prod[iMax])}, which is ${num(ys.prod[iMax] / (total / n), 1)}× the average year (${fmt(total / n)}). It moved from ${fmt(ys.prod[0])} in ${ys.yrs[0]} to ${fmt(ys.prod[n - 1])} in ${ys.yrs[n - 1]}, and the lowest year was ${ys.yrs[ys.prod.indexOf(minOf(ys.prod))]} at ${fmt(minOf(ys.prod))}.` : '',
        caution: 'In this dataset the first and last crop years have far fewer records than the middle years, so the line drops sharply at both edges. That reflects incomplete reporting, not a real collapse in farming.' }),
      card({ title: 'Season share', sub: 'Share of production by season',
        plot: { traces: [{ type: 'pie', hole: .55, labels: seasons.map((e) => e[0]), values: seasons.map((e) => e[1]), marker: { colors: PAL }, textinfo: 'label+percent', sort: false }], layout: { margin: { t: 6, b: 6, l: 6, r: 6 }, showlegend: false } },
        tbl: { headers: ['Season', 'Production', 'Share'], rows: rowsOf(seasons, total) },
        how: 'Each slice is a season’s share of total production. Kharif is the monsoon-sown season, Rabi the winter-sown season, and “Whole Year” holds perennial crops such as coconut and sugarcane that are harvested through the year.',
        insight: `<b>${esc(seasons[0][0])}</b> accounts for ${pct(share(seasons[0][1], total))}${seasons[1] ? `, followed by ${esc(seasons[1][0])} at ${pct(share(seasons[1][1], total))}` : ''}. ${seasons.filter((e) => share(e[1], total) < 0.01).length} of ${seasons.length} seasons each contribute under 1%.`,
        caution: 'A very large “Whole Year” slice is usually driven by coconut. Switch on Exclude coconut in the filter bar to see how Kharif and Rabi, the true cropping seasons, compare.' })) +
    grid('', card({ title: `Top ${N} crops`, sub: 'By total recorded production', height: hh(N),
        plot: { traces: [hbar(crops.slice(0, N), PAL[0])], layout: hbarLayout() }, tbl: { headers: ['Crop', 'Production', 'Share'], rows: rowsOf(crops.slice(0, N), total) },
        how: 'Each bar is one crop’s total recorded production across the selected years, states and seasons; the label at the end of the bar is the exact total. Longer bars mean more recorded volume.',
        insight: `<b>${esc(crops[0][0])}</b> holds ${pct(share(crops[0][1], total))}${crops[1] ? `, which is ${num(share(crops[0][1], crops[1][1]), 1)}× the next crop (${esc(crops[1][0])})` : ''}. The top ${N} crops together hold ${pct(share(sum(crops.slice(0, N).map((e) => e[1])), total))}, leaving ${Math.max(0, crops.length - N)} other crops to share the remaining ${pct(1 - share(sum(crops.slice(0, N).map((e) => e[1])), total))}.`,
        caution: 'Crops are recorded in different units (coconut in nuts, most others in tonnes), so this compares recorded volume, not weight or economic value.' }),
      card({ title: `Top ${N} states`, sub: 'By total recorded production', height: hh(N),
        plot: { traces: [hbar(states.slice(0, N), PAL[1])], layout: hbarLayout() }, tbl: { headers: ['State', 'Production', 'Share'], rows: rowsOf(states.slice(0, N), total) },
        how: 'Each bar is a state’s total recorded production. A state ranks high either because it grows a lot or because it grows a high-volume crop.',
        insight: `<b>${esc(states[0][0])}</b> contributes ${pct(share(states[0][1], total))}${states[1] ? `, ahead of ${esc(states[1][0])} (${pct(share(states[1][1], total))})` : ''}. The top 3 states hold ${pct(share(sum(states.slice(0, 3).map((e) => e[1])), total))}; at rank ${Math.min(N, states.length)}, ${esc(states[Math.min(N, states.length) - 1][0])} contributes only ${pct(share(states[Math.min(N, states.length) - 1][1], total), 2)}.`,
        caution: 'Rank mirrors crop mix: a state growing coconut or sugarcane outranks states growing cereals even with less land. Use the Crops page to separate crop effects from land effects.' }));
};

P.trends = () => {
  const ys = yearSeries(FP), n = ys.yrs.length, N = Math.min(S.topN, 10);
  const yld = ys.prod.map((p, i) => (ys.area[i] > 0 ? p / ys.area[i] : null));
  const yoy = ys.prod.map((v, i) => (i && ys.prod[i - 1] > 0 ? (v / ys.prod[i - 1] - 1) * 100 : null));
  const a0 = n >= 5 ? 1 : 0, a1 = n >= 5 ? n - 2 : n - 1;   /* skip the sparse first/last years when there are enough */
  const cagr = a1 > a0 && ys.prod[a0] > 0 ? Math.pow(ys.prod[a1] / ys.prod[a0], 1 / (a1 - a0)) - 1 : NaN;
  const swing = yoy.map((v, i) => [ys.yrs[i], v]).filter((e) => e[1] != null).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  const top = entries(groupSum(FP, 'c', 'p')).slice(0, N).map((e) => e[0]);
  const cy = new Map(); for (const r of FP) if (top.includes(r.c)) { const k = r.c + '|' + r.y; cy.set(k, (cy.get(k) || 0) + r.p); }
  const idx = top.map((c, i) => {
    const series = ys.yrs.map((y) => cy.get(c + '|' + y) || 0), base = series.find((v) => v > 0) || 1;
    return { type: 'scatter', mode: 'lines', name: c, x: ys.yrs, y: series.map((v) => (v / base) * 100), line: { color: PAL[i % 10], width: 2 } };
  });
  return head('Trends', 'How recorded production, area and yield moved from year to year.') +
    takeaways([n > 1 ? `Compound annual growth in production from ${ys.yrs[a0]} to ${ys.yrs[a1]} was about <b>${isNaN(cagr) ? '–' : pct(cagr)}</b> per year${n >= 5 ? ' (the sparsely reported first and last years are skipped)' : ''}.` : '',
      swing ? `The largest single-year swing was <b>${swing[0]}</b> (${swing[1] > 0 ? '+' : ''}${swing[1].toFixed(1)}%)${swing[0] === ys.yrs[n - 1] || swing[0] === ys.yrs[0] ? ' — an edge effect from sparse reporting in the first/last year, not a real collapse' : ''}.` : '',
      a1 > a0 ? `Between ${ys.yrs[a0]} and ${ys.yrs[a1]} yield moved from ${num(yld[a0])} to ${num(yld[a1])} production per hectare; area went from ${fmt(ys.area[a0])} to ${fmt(ys.area[a1])} ha.` : '']) +
    grid('one', card({ title: 'Total production by year', height: 340,
      plot: { traces: [{ type: 'scatter', mode: 'lines+markers', x: ys.yrs, y: ys.prod, line: { color: PAL[0], width: 2.5 } }], layout: { yaxis: { title: 'Production' } } },
      tbl: { headers: ['Year', 'Production', 'YoY %'], rows: ys.yrs.map((y, i) => [y, fmt(ys.prod[i]), yoy[i] == null ? '–' : yoy[i].toFixed(1) + '%']) },
      how: 'Each point is the total production recorded in that crop year. Read the overall direction first (up, flat or down), then look for individual years that break the pattern. Use the Table view for exact figures and year-over-year percentages.',
      insight: n > 1 ? `Of ${n - 1} year-to-year changes, ${yoy.filter((v) => v > 0).length} were increases and ${yoy.filter((v) => v != null && v < 0).length} were decreases. ${isNaN(cagr) ? '' : `Output ${cagr >= 0 ? 'grew' : 'shrank'} at a compound ${pct(Math.abs(cagr))} per year from ${ys.yrs[a0]} to ${ys.yrs[a1]}. `}The best year (${ys.yrs[ys.prod.indexOf(maxOf(ys.prod))]}, ${fmt(maxOf(ys.prod))}) was ${num(maxOf(ys.prod) / Math.max(minOf(ys.prod), 1), 1)}× the weakest (${ys.yrs[ys.prod.indexOf(minOf(ys.prod))]}, ${fmt(minOf(ys.prod))}).` : '',
      caution: 'Reporting coverage is uneven: the first and last years have few records, which exaggerates growth at the start and decline at the end. Judge the trend from the middle years.' })) +
    grid('', card({ title: 'Year-over-year change', sub: 'Percent change vs previous year',
        plot: { traces: [{ type: 'bar', x: ys.yrs, y: yoy, marker: { color: yoy.map((v) => (v >= 0 ? PAL[0] : PAL[3])) }, hovertemplate: '%{x}: %{y:.1f}%<extra></extra>' }], layout: { yaxis: { title: '%' } } },
        how: 'Each bar compares a year’s total with the year before it. Green means production rose, rust means it fell, and the taller the bar the larger the change.',
        insight: swing ? `${yoy.filter((v) => v > 0).length} growth years against ${yoy.filter((v) => v != null && v < 0).length} declines, averaging ${num(sum(yoy.filter((v) => v != null)) / Math.max(1, yoy.filter((v) => v != null).length), 1)}% a year. The largest move was <b>${swing[0]}</b> at ${swing[1] > 0 ? '+' : ''}${swing[1].toFixed(1)}%${swing[0] === ys.yrs[n - 1] || swing[0] === ys.yrs[0] ? ', which comes from sparse reporting in that edge year' : ''}.` : '',
        caution: 'A percentage change on a total inherits every reporting gap, so a big jump in one year can mean more districts were reported rather than more food was grown.' }),
      card({ title: 'Yield and area', sub: 'Production per hectare (left) and cultivated area (right)',
        plot: { traces: [{ type: 'scatter', mode: 'lines+markers', name: 'Yield', x: ys.yrs, y: yld, line: { color: PAL[1] } }, { type: 'scatter', mode: 'lines', name: 'Area (ha)', x: ys.yrs, y: ys.area, yaxis: 'y2', line: { color: PAL[2], dash: 'dot' } }],
          layout: { yaxis: { title: 'Yield' }, yaxis2: { overlaying: 'y', side: 'right', title: 'Area (ha)', showgrid: false } } },
        how: 'The solid line is yield (production per hectare, left axis) and the dotted line is total cultivated area (right axis). If production rises faster than area, the gain comes from higher yield rather than from planting more land.',
      insight: a1 > a0 && ys.area[a0] > 0 && ys.prod[a0] > 0 ? `From ${ys.yrs[a0]} to ${ys.yrs[a1]} recorded area changed by ${num((ys.area[a1] / ys.area[a0] - 1) * 100, 0)}% while production changed by ${num((ys.prod[a1] / ys.prod[a0] - 1) * 100, 0)}%. ${ys.prod[a1] / ys.prod[a0] > ys.area[a1] / ys.area[a0] ? 'Production grew faster than area, pointing to yield gains.' : 'Area grew at least as fast as production, so yields did not improve much.'}` : '',
      caution: 'Yield here is total production divided by total area across crops measured in different units, so treat it as a broad indicator. For a like-for-like view, filter to a single crop.' })) +
    grid('one', card({ title: `Growth of the top ${N} crops (first year = 100)`, sub: S.topN > 10 ? 'Capped at 10 lines to stay readable' : '', height: 360,
      plot: { traces: idx, layout: { yaxis: { title: 'Index', type: 'log' } } },
      how: 'Each line is a crop’s yearly production divided by its first year in the selection, so crops of any size can be compared on growth alone (log scale).',
      insight: idx.length ? (() => { const g = idx.map((t) => [t.name, t.y[t.y.length - 1]]).sort((a, b) => b[1] - a[1]); return `Lines above 100 grew over the period. The fastest riser is <b>${esc(g[0][0])}</b> (index ${num(g[0][1], 0)}, meaning ${num(g[0][1] / 100, 1)}× its starting output); the weakest is <b>${esc(g[g.length - 1][0])}</b> (index ${num(g[g.length - 1][1], 0)}).`; })() : '',
      caution: 'The index starts from each crop’s first year in the selection; a crop that began with very small recorded output can show a dramatic index without being large in absolute terms.' }));
};

P.crops = () => {
  const cp = entries(groupSum(FP, 'c', 'p')), total = sum(cp.map((e) => e[1])), N = S.topN, top = cp.slice(0, N);
  let cum = 0; const cumPct = top.map((e) => ((cum += e[1]) / total) * 100);
  const A = groupSum(FP.filter((r) => r.a > 0), 'c', 'a'), PP = groupSum(FP.filter((r) => r.a > 0), 'c', 'p');
  const yl = [...A.keys()].map((c) => [c, PP.get(c) / A.get(c)]).sort((a, b) => b[1] - a[1]).slice(0, N);
  if (!S.cropFocus || !cp.some((e) => e[0] === S.cropFocus)) S.cropFocus = cp[0][0];
  const cf = FP.filter((r) => r.c === S.cropFocus), cys = yearSeries(cf), cTotal = sum(cf.map((r) => r.p));
  const cst = entries(groupSum(cf, 's', 'p')).slice(0, 8), cse = entries(groupSum(cf, 'se', 'p'));
  const t30 = cp.slice(0, 30);
  const tm = top.concat(cp.length > N ? [['All other crops', total - sum(top.map((e) => e[1]))]] : []);
  let c80 = 0, acc80 = 0; for (const e of cp) { acc80 += e[1]; c80++; if (acc80 / total >= 0.8) break; }
  return head('Crops', 'Which crops carry the volume, which use land most productively, and a profile for any single crop.') +
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
    grid('', card({ title: `Crop share map (top ${N} + others)`, plot: { traces: [{ type: 'treemap', labels: tm.map((e) => e[0]), parents: tm.map(() => ''), values: tm.map((e) => e[1]), textinfo: 'label+percent root', marker: { colors: PAL.concat(PAL, PAL) } }], layout: { margin: { t: 4, l: 4, r: 4, b: 4 } } },
        how: 'Each rectangle is a crop and its area is proportional to that crop’s share of production, so the biggest blocks are the biggest crops. Hover for exact values.',
        insight: `The ${N} crops shown cover ${pct(share(sum(top.map((e) => e[1])), total))} of production; the other ${Math.max(0, cp.length - N)} crops together make up ${pct(1 - share(sum(top.map((e) => e[1])), total), 2)}.`,
        caution: 'When one crop dwarfs the rest, the smaller blocks become hard to see. Exclude coconut or filter to a state to zoom in.' }),
      card({ title: `Top ${N} crops by yield`, sub: 'Production per hectare', height: 330, plot: { traces: [hbar(yl, PAL[1])], layout: hbarLayout() }, tbl: { headers: ['Crop', 'Yield'], rows: yl.map((e) => [esc(e[0]), num(e[1])]) },
        how: 'Yield is a crop’s total production divided by its total cultivated area, i.e. output per hectare. It measures how productive each hectare is, regardless of how much land the crop occupies.',
      insight: yl.length > 2 ? `The highest yields belong to <b>${esc(yl[0][0])}</b> (${num(yl[0][1])}), <b>${esc(yl[1][0])}</b> (${num(yl[1][1])}) and <b>${esc(yl[2][0])}</b> (${num(yl[2][1])}). Compare with the volume ranking: high yield and high volume are different things, because small-area crops can be very productive per hectare.` : '',
      caution: 'Units differ by crop (for example coconut counts nuts), so yield is only comparable between crops measured in the same unit.' })) +
    `<div class="section-title">Crop profile</div><div class="ctrls"><label>Crop <select id="cropFocus">${cp.map((e) => `<option ${e[0] === S.cropFocus ? 'selected' : ''}>${esc(e[0])}</option>`).join('')}</select></label>
      <span>${esc(S.cropFocus)}: ${fmt(cTotal)} produced, ${pct(share(cTotal, total))} of selection, ${int(cf.length)} records.</span></div>` +
    grid('', card({ title: `${esc(S.cropFocus)} over time`, plot: { traces: [{ type: 'scatter', mode: 'lines+markers', x: cys.yrs, y: cys.prod, line: { color: PAL[2], width: 2.5 } }], layout: { yaxis: { title: 'Production' } } }, tbl: { headers: ['Year', 'Production'], rows: cys.yrs.map((y, i) => [y, fmt(cys.prod[i])]) },
        how: 'The same year-by-year total as the main trend, but for the single crop chosen above. Change the crop in the selector to profile another.',
        insight: cys.yrs.length > 1 ? `${esc(S.cropFocus)} peaked in <b>${cys.yrs[cys.prod.indexOf(maxOf(cys.prod))]}</b> at ${fmt(maxOf(cys.prod))} and was ${fmt(cys.prod[cys.prod.length - 1])} in ${cys.yrs[cys.yrs.length - 1]}, versus ${fmt(cys.prod[0])} in ${cys.yrs[0]}.` : '',
        caution: 'A crop reported in only a few years will look volatile; check the record count above before drawing conclusions.' }),
      card({ title: `Where ${esc(S.cropFocus)} is grown`, height: hh(cst.length), plot: { traces: [hbar(cst, PAL[2])], layout: hbarLayout() }, tbl: { headers: ['State', 'Production', 'Share'], rows: rowsOf(cst, cTotal) },
        how: 'The states that grow the most of the selected crop, ranked by total production. The table adds each state’s share.',
        insight: cst.length ? `<b>${esc(cst[0][0])}</b> produces ${pct(share(cst[0][1], cTotal))} of this crop${cst[1] ? `, followed by ${esc(cst[1][0])} (${pct(share(cst[1][1], cTotal))})` : ''}. The top ${Math.min(3, cst.length)} states account for ${pct(share(sum(cst.slice(0, 3).map((e) => e[1])), cTotal))}. It is grown in ${cse.length} season${cse.length > 1 ? 's' : ''}: ${cse.map((e) => esc(e[0])).join(', ')}.` : '',
        caution: 'This shows where the crop is recorded, which depends on both farming and reporting.' }));
};

P.regions = () => {
  const sp = entries(groupSum(FP, 's', 'p')), total = sum(sp.map((e) => e[1])), N = S.topN, top = sp.slice(0, N), names = top.map((e) => e[0]);
  const yrs = [...new Set(FP.map((r) => r.y))].sort((a, b) => a - b), cell = new Map();
  for (const r of FP) if (names.includes(r.s)) { const k = r.s + '|' + r.y; cell.set(k, (cell.get(k) || 0) + r.p); }
  const z = names.map((s) => yrs.map((y) => { const v = cell.get(s + '|' + y); return v > 0 ? Math.log10(v) : null; }));
  const dm = new Map(); for (const r of FP) { const k = r.d + '||' + r.s; dm.set(k, (dm.get(k) || 0) + r.p); }
  const dt = entries(dm).slice(0, N).map(([k, v]) => { const [d, s] = k.split('||'); return [`${d} (${s})`, v]; });
  const sy = new Map(); for (const r of FP) { if (!sy.has(r.s)) sy.set(r.s, new Map()); const m = sy.get(r.s); m.set(r.y, (m.get(r.y) || 0) + r.p); }
  const cv = [...sy.entries()].map(([s, m]) => { const v = [...m.values()]; if (v.length < 3) return null; const mu = sum(v) / v.length; if (mu <= 0) return null;
    return [s, Math.sqrt(sum(v.map((x) => (x - mu) ** 2)) / (v.length - 1)) / mu]; }).filter(Boolean).sort((a, b) => a[1] - b[1]);
  const A = groupSum(FP, 's', 'a'), nrec = new Map(); for (const r of FP) nrec.set(r.s, (nrec.get(r.s) || 0) + 1);
  return head('Regions', 'Where production comes from — by state and district — and how steady each state’s output is.') +
    takeaways([`<b>${esc(sp[0][0])}</b> leads with ${pct(share(sp[0][1], total))}; the top 3 states hold ${pct(share(sum(sp.slice(0, 3).map((e) => e[1])), total))}.`,
      dt.length ? `Biggest district: <b>${esc(dt[0][0])}</b>.` : '', cv.length > 1 ? `Steadiest state year to year: <b>${esc(cv[0][0])}</b> (CV ${cv[0][1].toFixed(2)}); most volatile: <b>${esc(cv[cv.length - 1][0])}</b> (CV ${cv[cv.length - 1][1].toFixed(2)}).` : '']) +
    grid('', card({ title: `Top ${N} states`, height: hh(N), plot: { traces: [hbar(top, PAL[0])], layout: hbarLayout() },
        tbl: { headers: ['State', 'Production', 'Share', 'Area (ha)', 'Yield', 'Records'], rows: top.map(([s, v]) => [esc(s), fmt(v), pct(share(v, total)), fmt(A.get(s) || 0), num(share(v, A.get(s) || 0)), int(nrec.get(s))]) },
        how: 'States ranked by total production. The Table view adds each state’s share, cultivated area, yield and number of records, so you can tell whether a high rank comes from land, productivity or simply more reporting.',
        insight: `<b>${esc(sp[0][0])}</b> leads with ${pct(share(sp[0][1], total))}. ${(() => { let a = 0, k = 0; for (const e of sp) { a += e[1]; k++; if (a / total >= 0.8) break; } return `${k} of ${sp.length} states supply 80% of production.`; })()}`,
        caution: 'State totals combine very different crops; a state’s lead often reflects a single high-volume crop.' }),
      card({ title: `Top ${N} districts`, height: hh(N), plot: { traces: [hbar(dt, PAL[2])], layout: hbarLayout() },
        how: 'The districts with the highest total production, labelled with their state. Use the State filter to drill into one state’s districts.',
      insight: dt.length ? `<b>${esc(dt[0][0])}</b> is the top district with ${pct(share(dt[0][1], total))} of all recorded production. ${(() => { const c = new Map(); dt.forEach((e) => { const st = e[0].slice(e[0].lastIndexOf('(') + 1, -1); c.set(st, (c.get(st) || 0) + 1); }); const t = [...c.entries()].sort((a, b) => b[1] - a[1])[0]; return `${t[1]} of the top ${dt.length} districts are in ${esc(t[0])}.`; })()}` : '',
      caution: 'There are hundreds of districts, so even the leaders hold a small share unless one crop dominates a district.' })) +
    grid('one', card({ title: 'State × year production', sub: 'Colour = log10 of production', height: hh(N) + 40, plot: { traces: [{ type: 'heatmap', x: yrs, y: names, z, colorscale: [[0, '#f3f1df'], [.5, '#8fc19b'], [1, '#1f4d36']], colorbar: { title: 'log10' }, hovertemplate: '%{y}, %{x}<br>log10: %{z:.2f}<extra></extra>' }], layout: { yaxis: { autorange: 'reversed' }, margin: { l: 130, r: 10, t: 10, b: 40 } } },
      how: 'Darker cells = higher production (a log scale lets small states show). Blank = no recorded production that year.', insight: (() => { const cells = z.length * (z[0] ? z[0].length : 0), blank = z.reduce((c, r) => c + r.filter((v) => v == null).length, 0); return `${blank} of ${cells} state-year cells are blank. Darker rows are consistently large producers; rows that fade in or out mark states whose records start late or stop early.`; })(),
      caution: 'Blank cells usually reflect missing records, not an absence of farming, so avoid reading them as zero activity.' })) +
    (cv.length ? grid('one', card({ title: `Output stability — ${Math.min(N, cv.length)} steadiest states`, sub: 'Coefficient of variation of yearly production (lower = steadier)', height: 300,
      plot: { traces: [{ type: 'bar', x: cv.slice(0, N).map((e) => e[0]), y: cv.slice(0, N).map((e) => e[1]), marker: { color: PAL[5] } }], layout: { yaxis: { title: 'CV' }, xaxis: { tickangle: -35 } } },
      tbl: { headers: ['State', 'CV'], rows: cv.map((e) => [esc(e[0]), e[1].toFixed(2)]) }, how: 'CV = standard deviation ÷ mean of the yearly totals.', insight: `Below about 0.3 a state is steady, above 1 it swings wildly. ${cv.filter((e) => e[1] > 1).length} of ${cv.length} states exceed 1, and ${cv.filter((e) => e[1] < 0.3).length} are below 0.3. The steadiest is <b>${esc(cv[0][0])}</b> (${cv[0][1].toFixed(2)}).`,
      caution: 'High CV often comes from reporting gaps in some years rather than genuinely unstable harvests.' })) : '');
};

P.seasons = () => {
  const se = entries(groupSum(FP, 'se', 'p')), total = sum(se.map((e) => e[1])), names = se.map((e) => e[0]);
  const yrs = [...new Set(FP.map((r) => r.y))].sort((a, b) => a - b), sy = new Map();
  for (const r of FP) { const k = r.se + '|' + r.y; sy.set(k, (sy.get(k) || 0) + r.p); }
  const topS = entries(groupSum(FP, 's', 'p')).slice(0, S.topN).map((e) => e[0]), ss = new Map();
  for (const r of FP) if (topS.includes(r.s)) { const k = r.se + '|' + r.s; ss.set(k, (ss.get(k) || 0) + r.p); }
  const topC = entries(groupSum(FP, 'c', 'p')).slice(0, S.topN).map((e) => e[0]), sc = new Map(), seT = groupSum(FP, 'se', 'p');
  for (const r of FP) if (topC.includes(r.c)) { const k = r.se + '|' + r.c; sc.set(k, (sc.get(k) || 0) + r.p); }
  const zc = names.map((s) => topC.map((c) => share(sc.get(s + '|' + c) || 0, seT.get(s)) * 100));
  return head('Seasons', 'Kharif, Rabi, Summer, Autumn, Winter and Whole-Year production compared.') +
    takeaways([`<b>${esc(se[0][0])}</b> is the biggest season (${pct(share(se[0][1], total))}).`, se.length > 1 ? `Smallest: <b>${esc(se[se.length - 1][0])}</b> (${pct(share(se[se.length - 1][1], total), 2)}).` : '',
      'A big “Whole Year” slice almost always means perennial crops — coconut and sugarcane — not a year-round harvest.']) +
    grid('', card({ title: 'Production by season', plot: { traces: [{ type: 'bar', x: names, y: se.map((e) => e[1]), marker: { color: PAL }, hovertemplate: '%{x}: %{y:,.0f}<extra></extra>' }], layout: { yaxis: { title: 'Production' } } }, tbl: { headers: ['Season', 'Production', 'Share'], rows: rowsOf(se, total) },
        how: 'Each bar is one season’s total production for the selection; the Table view gives exact shares.',
        insight: `<b>${esc(se[0][0])}</b> is ${pct(share(se[0][1], total))} of the total${se[1] ? ` and ${num(share(se[0][1], se[1][1]), 1)}× the next season (${esc(se[1][0])})` : ''}.`,
        caution: 'Seasons differ in how many crops are grown and recorded, so a small season is not necessarily an unimportant one.' }),
      card({ title: 'Season mix over time', plot: { traces: names.map((s, i) => ({ type: 'scatter', mode: 'lines', stackgroup: 'one', name: s, x: yrs, y: yrs.map((y) => sy.get(s + '|' + y) || 0), line: { color: PAL[i % 10] } })), layout: { yaxis: { title: 'Production' } } },
        how: 'Stacked areas: each band is one season’s yearly production.', insight: yrs.length > 1 ? (() => { const f = yrs[0], l = yrs[yrs.length - 1], tot = (y) => sum(names.map((s) => sy.get(s + '|' + y) || 0)); return `${esc(names[0])} made up ${pct(share(sy.get(names[0] + '|' + f) || 0, tot(f)))} of output in ${f} and ${pct(share(sy.get(names[0] + '|' + l) || 0, tot(l)))} in ${l}. Bands that appear or vanish mark years where a season was not reported.`; })() : '',
      caution: 'Total height is the yearly total, so edges are low for the same reporting reasons as elsewhere.' })) +
    grid('', card({ title: `Season mix of the top ${S.topN} states`, plot: { traces: names.map((s, i) => ({ type: 'bar', name: s, x: topS, y: topS.map((st) => ss.get(s + '|' + st) || 0), marker: { color: PAL[i % 10] } })), layout: { barmode: 'stack', yaxis: { title: 'Production' }, xaxis: { tickangle: -35 } } },
        how: 'Each bar is a state, stacked by the seasons that make up its production. A bar of one colour means the state depends on a single season.',
        insight: topS.length ? (() => { const dom = names.map((s) => [s, ss.get(s + '|' + topS[0]) || 0]).sort((a, b) => b[1] - a[1])[0]; const t = sum(names.map((s) => ss.get(s + '|' + topS[0]) || 0)); return `The largest state, <b>${esc(topS[0])}</b>, draws ${pct(share(dom[1], t))} of its output from ${esc(dom[0])}.`; })() : '',
        caution: 'Bars are in absolute volume, so small states look tiny regardless of their mix.' }),
      card({ title: 'Which crops fill each season', sub: `Share of the season’s production, top ${S.topN} crops (%)`, plot: { traces: [{ type: 'heatmap', x: topC, y: names, z: zc, colorscale: [[0, '#f3f1df'], [1, '#2f7d4f']], text: zc.map((r) => r.map((v) => v.toFixed(0))), texttemplate: '%{text}', colorbar: { title: '%' } }], layout: { yaxis: { autorange: 'reversed' }, xaxis: { tickangle: -35 }, margin: { l: 90, b: 90, t: 10, r: 10 } } },
        how: 'Each row shows what percent of that season’s production each crop supplies (other crops make up the rest).', insight: names.slice(0, 3).map((s, i) => { const row = zc[i], m = Math.max(...row); return `In ${esc(s)}, ${esc(topC[row.indexOf(m)])} supplies ${m.toFixed(0)}% of production`; }).join('; ') + '.',
      caution: `Percentages cover only the top ${S.topN} crops, so a row can sum to less than 100%.` }));
};

/* shared control bar for the statistics pages */
const statCtrls = () => `<div class="ctrls"><label>Measure <select id="variable">${Object.entries(VARS).map(([k, v]) => `<option value="${k}" ${k === S.variable ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
  <label>Compare by <select id="group">${Object.entries(GROUPS).map(([k, v]) => `<option value="${k}" ${k === S.group ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
  <label><input type="checkbox" id="log" ${S.log ? 'checked' : ''}> Log scale</label></div>`;

P.central = () => {
  const gs = groupedStats(S.variable, S.group, S.topN), vname = VARS[S.variable];
  if (!gs.length) return head('Central tendency', '') + '<div class="alert">No values for this measure under the current filters.</div>';
  const all = describe(F.map((r) => valueOf(r, S.variable)).filter((v) => v != null && !isNaN(v)));
  const ratio = all.mean / all.median, best = gs.slice().sort((a, b) => b.d.median - a.d.median)[0];
  return head('Central tendency', 'What a “typical” record looks like — the mean, the median and the most common value — overall and by group.') + statCtrls() +
    takeaways([`Across all selected records the mean ${vname.toLowerCase()} is <b>${fmt(all.mean)}</b> but the median is only <b>${fmt(all.median)}</b>${isFinite(ratio) ? ` — the mean is ${num(ratio, 1)}× the median` : ''}.`,
      `Most common value (mode): <b>${fmt(all.mode)}</b>.`, `Highest typical (median) ${vname.toLowerCase()} among the ${GROUPS[S.group].toLowerCase()}s shown: <b>${esc(best.name)}</b> (${fmt(best.d.median)}).`,
      ratio > 1.5 ? 'When the mean sits far above the median, a few huge records pull the average up — describe the typical record with the median.' : '']) +
    grid('one', card({ title: `Mean vs median ${vname.toLowerCase()} by ${GROUPS[S.group].toLowerCase()}`, sub: `The ${S.topN} groups with the most records`, height: 360,
      plot: { traces: [{ type: 'bar', name: 'Mean', x: gs.map((g) => g.name), y: gs.map((g) => g.d.mean), marker: { color: PAL[0] } }, { type: 'bar', name: 'Median', x: gs.map((g) => g.name), y: gs.map((g) => g.d.median), marker: { color: PAL[1] } }],
        layout: { barmode: 'group', yaxis: { type: S.log ? 'log' : 'linear', title: vname }, xaxis: { tickangle: -30 } } },
      tbl: { headers: [GROUPS[S.group], 'Records', 'Mean', 'Median', 'Mode', 'Mean ÷ median'], rows: gs.map((g) => [esc(g.name), int(g.d.n), fmt(g.d.mean), fmt(g.d.median), fmt(g.d.mode), isFinite(g.d.mean / g.d.median) ? num(g.d.mean / g.d.median, 1) : '–']) },
      how: 'For each group, the green bar is the mean (the arithmetic average) and the amber bar is the median (the middle record). When the bars are close the group is balanced; when the mean is far above the median a few very large records are pulling the average up.',
      insight: (() => { const r = gs.filter((g) => isFinite(g.d.mean / g.d.median)).sort((a, b) => b.d.mean / b.d.median - a.d.mean / a.d.median)[0]; return `${r ? `The most skewed group is <b>${esc(r.name)}</b>, whose mean is ${num(r.d.mean / r.d.median, 1)}× its median. ` : ''}The group with the highest typical value is <b>${esc(best.name)}</b> (median ${fmt(best.d.median)}).`; })(),
      caution: 'Crop production data is strongly right-skewed, so the median is the more honest description of a typical record. The log scale keeps both bars visible.' }));
};

P.spread = () => {
  const gs = groupedStats(S.variable, S.group, S.topN), vname = VARS[S.variable];
  if (!gs.length) return head('Spread & shape', '') + '<div class="alert">No values for this measure under the current filters.</div>';
  let vals = F.map((r) => valueOf(r, S.variable)).filter((v) => v != null && !isNaN(v)); if (S.log) vals = vals.filter((v) => v > 0);
  if (vals.length < 5) return head('Spread & shape', '') + statCtrls() + '<div class="alert">Not enough positive values for this measure.</div>';
  const d = describe(vals), plotV = S.log ? vals.map(Math.log10) : vals;
  const mostVar = gs.filter((g) => isFinite(g.d.cv)).sort((a, b) => b.d.cv - a.d.cv)[0];
  const boxes = gs.map((g, i) => ({ type: 'box', name: g.name, q1: [g.d.q1], median: [g.d.median], q3: [g.d.q3], lowerfence: [g.d.wl], upperfence: [g.d.wh], mean: [g.d.mean], boxmean: true, marker: { color: PAL[i % 10] } }));
  return head('Spread & shape', 'How widely records vary, how lopsided the distribution is, and how many extreme values there are.') + statCtrls() +
    takeaways([`Records span ${fmt(d.min)} to ${fmt(d.max)}; the middle 50% sit between <b>${fmt(d.q1)}</b> and <b>${fmt(d.q3)}</b> (IQR ${fmt(d.iqr)}).`,
      `Skewness ${num(d.skew, 1)} — <b>${shapeWord(d.skew)}</b>; excess kurtosis ${num(d.kurt, 1)} (${d.kurt > 3 ? 'heavy tails' : 'light tails'}).`,
      `${int(d.outliers)} records (${pct(share(d.outliers, d.n))}) fall outside the 1.5×IQR fences.`, mostVar ? `Most variable group (CV): <b>${esc(mostVar.name)}</b> at ${num(mostVar.d.cv)}.` : '']) +
    grid('', card({ title: `Distribution of ${vname.toLowerCase()}${S.log ? ' (log10)' : ''}`, plot: { traces: [{ type: 'histogram', x: plotV, nbinsx: 60, marker: { color: PAL[0] } }], layout: { xaxis: { title: S.log ? `log10(${vname})` : vname }, yaxis: { title: 'Records' } } },
        how: 'Bars count records in each value range. On the log axis a bell shape means log-normal data.', insight: `The middle 50% of records lie between ${fmt(d.q1)} and ${fmt(d.q3)}, a spread (IQR) of ${fmt(d.iqr)} against a median of ${fmt(d.median)}. The mean (${fmt(d.mean)}) is ${d.mean > 1.5 * d.median ? 'well above' : 'close to'} the median, and the distribution is ${shapeWord(d.skew)} with ${d.kurt > 3 ? 'heavy tails, meaning extreme values are common' : 'light tails'}.`,
        caution: 'On the log axis zeros are removed because the logarithm of zero cannot be calculated; turn the log scale off to include them.' }),
      card({ title: `Spread by ${GROUPS[S.group].toLowerCase()}`, sub: 'Box = middle 50%, line = median, dashed = mean', plot: { traces: boxes, layout: { yaxis: { type: S.log ? 'log' : 'linear', title: vname }, showlegend: false, xaxis: { tickangle: -30 } } },
        how: 'Each box spans the middle 50% of a group’s records (Q1 to Q3), the line inside is the median, the dashed line is the mean and the whiskers reach 1.5×IQR. A taller box means more variation inside the group.',
      insight: (() => { const w = gs.filter((g) => g.d.median > 0).sort((a, b) => b.d.iqr / b.d.median - a.d.iqr / a.d.median)[0]; return `${w ? `<b>${esc(w.name)}</b> has the widest relative spread (IQR is ${num(w.d.iqr / w.d.median, 1)}× its median). ` : ''}Compare box heights rather than positions to judge variability.`; })(),
      caution: 'Groups with few records give unstable boxes; the table below lists record counts.' })) +
    grid('one', card({ title: 'Dispersion table', html: table([GROUPS[S.group], 'Records', 'Std dev', 'CV', 'IQR', 'Range', 'Skewness', 'Kurtosis', 'Outliers'],
      gs.map((g) => [esc(g.name), int(g.d.n), fmt(g.d.sd), num(g.d.cv), fmt(g.d.iqr), fmt(g.d.range), num(g.d.skew, 1), num(g.d.kurt, 1), `${int(g.d.outliers)} (${pct(share(g.d.outliers, g.d.n))})`])),
      how: 'CV (coefficient of variation) = std dev ÷ mean, so groups of different size can be compared.', insight: (() => { const o = gs.slice().sort((a, b) => b.d.outliers / b.d.n - a.d.outliers / a.d.n)[0]; return `${esc(o.name)} has the highest share of outliers (${pct(share(o.d.outliers, o.d.n))}). A CV above 1 means the standard deviation exceeds the mean, a sign of a very uneven group.`; })(),
      caution: 'Outliers here are mostly large districts or high-volume crops rather than errors, so they were kept in the analysis.' }));
};

P.relations = () => {
  const ok = F.filter((r) => r.a != null && r.p != null);
  if (ok.length < 4) return head('Relationships', '') + '<div class="alert">Not enough records.</div>';
  const pairs = S.log ? ok.filter((r) => r.a > 0 && r.p > 0) : ok;
  const sample = pairs.length > 15000 ? pairs.filter(() => Math.random() < 15000 / pairs.length) : pairs;
  const gmap = new Map(); for (const r of sample) { const k = r[S.scatterBy]; (gmap.get(k) || gmap.set(k, []).get(k)).push(r); }
  const order = [...gmap.entries()].sort((a, b) => b[1].length - a[1].length), keep = order.slice(0, 10), rest = order.slice(10).flatMap((e) => e[1]);
  if (rest.length) keep.push(['Other', rest]);
  const traces = keep.map(([k, rows], i) => ({ type: 'scattergl', mode: 'markers', name: k, x: rows.map((r) => r.a), y: rows.map((r) => r.p), text: rows.map((r) => `${r.c} · ${r.s} · ${r.y}`), marker: { size: 4, opacity: .5, color: PAL[i % 10] } }));
  const ax = ok.map((r) => r.a), py = ok.map((r) => r.p), pr = pearson(ax, py), sp = spearman(ax, py);
  const yr = ok.filter((r) => r.y != null), ay = yr.map((r) => r.y), aa = yr.map((r) => r.a), ap = yr.map((r) => r.p);
  const nm = ['Crop year', 'Area', 'Production'], mat = [[1, pearson(ay, aa), pearson(ay, ap)], [pearson(aa, ay), 1, pr], [pearson(ap, ay), pr, 1]];
  const sa = Float64Array.from(ax).sort(), cuts = [0.25, 0.5, 0.75].map((q) => quantile(sa, q));
  const bands = ['Smallest 25%', '25–50%', '50–75%', 'Largest 25%'].map((l) => ({ l, v: [] }));
  for (const r of ok) bands[r.a <= cuts[0] ? 0 : r.a <= cuts[1] ? 1 : r.a <= cuts[2] ? 2 : 3].v.push(r.p);
  const bm = bands.map((b) => ({ l: b.l, n: b.v.length, med: quantile(Float64Array.from(b.v).sort(), .5) }));
  return head('Relationships', 'Does cultivating more land mean producing more? Two correlation measures, a scatter and a land-size comparison.') +
    `<div class="ctrls"><label>Colour dots by <select id="scatterBy">${Object.entries(GROUPS).map(([k, v]) => `<option value="${k}" ${k === S.scatterBy ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label><input type="checkbox" id="log" ${S.log ? 'checked' : ''}> Log axes</label></div>` +
    takeaways([`Pearson r = <b>${pr.toFixed(2)}</b> (${strength(pr)}); Spearman ρ = <b>${sp.toFixed(2)}</b> (${strength(sp)}).`,
      sp - pr > .3 ? 'Spearman is much higher than Pearson: a few extreme records (often coconut) hide a genuine rank-order link — bigger area generally means more production.' : 'The two measures broadly agree.',
      `Median production climbs from ${fmt(bm[0].med)} (smallest-area quarter) to ${fmt(bm[3].med)} (largest-area quarter).`]) +
    grid('wide', card({ title: 'Area vs production', sub: `Sample of up to 15,000 of ${int(pairs.length)} records`, height: 440, plot: { traces, layout: { xaxis: { title: 'Area (ha)', type: S.log ? 'log' : 'linear' }, yaxis: { title: 'Production', type: S.log ? 'log' : 'linear' }, margin: { b: 100 } } },
        how: 'One dot per crop-district-season-year record. A cloud rising to the right means more land goes with more output.', insight: `The cloud rises to the right, and the rank-based Spearman ρ of ${sp.toFixed(2)} is ${strength(sp)}: larger plots generally produce more. The linear Pearson r of ${pr.toFixed(2)} is ${strength(pr)} because a few very large records distort a straight-line fit. Dots far below the cloud are low-yield records; far above are high-yield.`,
        caution: 'Correlation shows association, not cause. Different crops use different units, which spreads the cloud sideways.' }),
      card({ title: 'Correlation matrix', sub: 'Pearson', height: 300, plot: { traces: [{ type: 'heatmap', x: nm, y: nm, z: mat, zmin: -1, zmax: 1, colorscale: [[0, '#c4572f'], [.5, '#f6f3ea'], [1, '#2f7d4f']], text: mat.map((r) => r.map((v) => v.toFixed(2))), texttemplate: '%{text}' }], layout: { yaxis: { autorange: 'reversed' }, margin: { l: 80, t: 10, b: 40, r: 10 } } },
        how: '+1 / −1 is a perfect straight-line link; 0 is none.', insight: `Area and production: ${pr.toFixed(2)}. Year and production: ${mat[0][2].toFixed(2)}, and year and area: ${mat[0][1].toFixed(2)}. Values this close to zero for year mean the calendar year alone explains almost none of the variation.`,
      caution: 'Pearson only captures straight-line relationships; the Spearman value above is the better guide here.' })) +
    grid('one', card({ title: 'Median production by farm-size band', sub: 'Records split into quarters by cultivated area', height: 300,
      plot: { traces: [{ type: 'bar', x: bm.map((b) => b.l), y: bm.map((b) => b.med), text: bm.map((b) => fmt(b.med)), textposition: 'outside', marker: { color: PAL.slice(0, 4) } }], layout: { yaxis: { title: 'Median production' } } },
      tbl: { headers: ['Area band', 'Records', 'Median production'], rows: bm.map((b) => [b.l, int(b.n), fmt(b.med)]) },
      how: 'A plain-language view of the same relationship: bigger plots, bigger typical output.', insight: `The typical record in the largest-area quarter produces <b>${num(bm[3].med / Math.max(bm[0].med, 1), 1)}×</b> as much as one in the smallest-area quarter (${fmt(bm[3].med)} vs ${fmt(bm[0].med)}). Each step up in land size lifts typical output${bm[0].med < bm[1].med && bm[1].med < bm[2].med && bm[2].med < bm[3].med ? ', and the climb is steady across all four bands.' : ', although not every step is higher.'}`,
      caution: 'Medians are used so outliers cannot distort the comparison, but larger plots also tend to be different crops, so size is not the only driver.' }));
};

P.quality = () => {
  const removed = RAW.length - CLEAN.length, cnt = (rows, f) => { let c = 0; for (const r of rows) if (f(r)) c++; return c; };
  const seen = new Set(); let dups = 0;
  for (const r of RAW) { const k = `${r.s}|${r.d}|${r.y}|${r.se}|${r.c}|${r.a}|${r.p}`; if (seen.has(k)) dups++; else seen.add(k); }
  const nulls = Object.entries(RAW_NULLS);
  const checks = [['Negative area', (r) => r.a < 0], ['Negative production', (r) => r.p < 0], ['Zero area', (r) => r.a === 0], ['Zero production', (r) => r.p === 0]].map(([l, f]) => [l, int(cnt(RAW, f)), int(cnt(CLEAN, f))]);
  const outs = [['Area', (r) => r.a], ['Production', (r) => r.p]].map(([l, g]) => { const d = describe(CLEAN.map(g).filter((v) => v != null)); return [l, num(d.q1 - 1.5 * d.iqr), fmt(d.q3 + 1.5 * d.iqr), `${int(d.outliers)} (${pct(share(d.outliers, d.n), 1)})`]; });
  const yc = new Map(); for (const r of RAW) yc.set(r.y, (yc.get(r.y) || 0) + 1); const ycs = [...yc.entries()].sort((a, b) => a[0] - b[0]);
  return head('Data quality', 'What was checked, what was removed, and what was deliberately kept.') +
    takeaways([`Raw file: <b>${int(RAW.length)}</b> rows. After cleaning: <b>${int(CLEAN.length)}</b> (${int(removed)} removed, ${pct(share(removed, RAW.length), 2)}).`,
      `Only <b>Production</b> had missing values — those rows cannot contribute to production totals, so they were dropped. ${dups ? int(dups) + ' duplicate rows found.' : 'No duplicate rows.'}`, 'Zero-production rows are kept as valid observations (a failed or unreported harvest); say so when reporting.']) +
    `<div class="kpis">${kpi('Raw rows', int(RAW.length))}${kpi('Cleaned rows', int(CLEAN.length))}${kpi('Rows removed', int(removed), 'missing Production')}${kpi('Duplicate rows', int(dups), 'in raw data')}</div>` +
    grid('', card({ title: 'Completeness by column', height: 300, plot: { traces: [{ type: 'bar', orientation: 'h', x: nulls.map(([, n]) => (1 - n / RAW.length) * 100), y: nulls.map((e) => e[0]), text: nulls.map(([, n]) => ((1 - n / RAW.length) * 100).toFixed(2) + '%'), textposition: 'outside', cliponaxis: false, marker: { color: PAL[0] } }], layout: { xaxis: { range: [90, 101], title: '% complete' }, yaxis: { autorange: 'reversed' }, margin: { l: 110, r: 50, t: 8, b: 40 } } },
        tbl: { headers: ['Column', 'Missing', '% missing'], rows: nulls.map(([c, n]) => [c, int(n), pct(n / RAW.length, 2)]) }, how: 'Share of rows with a value, per column (axis starts at 90%).', insight: (() => { const m = new Map(); for (const r of RAW) if (r.p == null) m.set(r.y, (m.get(r.y) || 0) + 1); const t = [...m.entries()].sort((a, b) => b[1] - a[1])[0]; return `${int(RAW_NULLS.Production)} rows (${pct(RAW_NULLS.Production / RAW.length, 2)}) lack a Production value${t ? `, most of them in ${t[0]} (${int(t[1])} rows)` : ''}. Every other column is 100% complete.`; })(),
        caution: 'Dropping these rows removes any chance of counting their area, so area totals on the cleaned data are slightly lower than on the raw data.' }),
      card({ title: 'Records per crop year', height: 300, plot: { traces: [{ type: 'bar', x: ycs.map((e) => e[0]), y: ycs.map((e) => e[1]), marker: { color: PAL[2] } }], layout: { yaxis: { title: 'Records' } } },
        tbl: { headers: ['Year', 'Records'], rows: ycs.map((e) => [e[0], int(e[1])]) }, how: 'Raw record count per year — a proxy for reporting coverage.', insight: `Coverage ranges from ${int(minOf(ycs.map((e) => e[1])))} records in ${ycs.find((e) => e[1] === minOf(ycs.map((x) => x[1])))[0]} to ${int(maxOf(ycs.map((e) => e[1])))} in ${ycs.find((e) => e[1] === maxOf(ycs.map((x) => x[1])))[0]}. Years with far fewer records explain the sharp edges in the trend lines.`,
        caution: 'Record counts measure reporting coverage, not production; a year with fewer records will almost always show lower totals.' })) +
    grid('', card({ title: 'Invalid-value checks', html: table(['Check', 'Raw', 'Cleaned'], checks), how: 'Counts of impossible or questionable values.', insight: `There are ${int(cnt(CLEAN, (r) => r.p === 0))} zero-production rows (${pct(share(cnt(CLEAN, (r) => r.p === 0), CLEAN.length), 2)} of cleaned data) and no negative values. Zero area never occurs, so yield can be calculated for every record.`,
      caution: 'A zero may mean a failed harvest or an unreported one; they are kept and flagged here so the choice is transparent.' }),
      card({ title: 'Outlier fences (cleaned data)', html: table(['Variable', 'Lower fence', 'Upper fence', 'Outliers'], outs), how: 'Fences are Q1 − 1.5×IQR and Q3 + 1.5×IQR.', insight: `${outs.map((o) => `${o[0]}: ${o[3]}`).join('; ')} flagged as outliers. Crop data is strongly skewed, so the IQR rule flags a large share of records.`,
      caution: 'Outliers were retained because large districts and perennial crops such as coconut are legitimate values, not errors.' }));
};

const csvOf = (rows) => 'State_Name,District_Name,Crop_Year,Season,Crop,Area,Production\n' + rows.map((r) => [r.s, r.d, r.y, r.se, r.c, r.a, r.p].map((v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\n');
function recordRows() {
  let rows = { filtered: F, raw: RAW, clean: CLEAN }[S.recView];
  if (S.recSearch) { const t = S.recSearch.toLowerCase(); rows = rows.filter((r) => `${r.s} ${r.d} ${r.y} ${r.se} ${r.c}`.toLowerCase().includes(t)); }
  return rows;
}
P.records = () => {
  const rows = recordRows(), per = 25, pages = Math.max(1, Math.ceil(rows.length / per)); S.recPage = Math.min(S.recPage, pages - 1);
  const slice = rows.slice(S.recPage * per, S.recPage * per + per), rd = (v, l) => `<label><input type="radio" name="rv" value="${v}" ${S.recView === v ? 'checked' : ''}> ${l}</label>`;
  return head('Records', 'The exact rows behind every chart. Switch between the filtered view, the full raw file and the full cleaned file.') +
    `<div class="card"><div class="ctrls">${rd('filtered', 'Filtered selection')}${rd('raw', 'Raw (all)')}${rd('clean', 'Cleaned (all)')}<input type="text" id="recSearch" placeholder="Search state, district, crop, season…" value="${esc(S.recSearch)}"><button class="btn dl" id="dl">⬇ Download CSV</button></div>
    ${table(['State', 'District', 'Year', 'Season', 'Crop', 'Area (ha)', 'Production'], slice.map((r) => [esc(r.s), esc(r.d), r.y, esc(r.se), esc(r.c), r.a == null ? '' : num(r.a), r.p == null ? '–' : num(r.p)]))}
    <div class="pager"><button id="prev" ${S.recPage === 0 ? 'disabled' : ''}>← Prev</button><span>Page ${S.recPage + 1} of ${int(pages)} · ${int(rows.length)} rows</span><button id="next" ${S.recPage >= pages - 1 ? 'disabled' : ''}>Next →</button></div></div>`;
};

P.dictionary = () => {
  const cols = [['State_Name', 'Text', 'Indian state where the crop is grown', 'Andhra Pradesh'], ['District_Name', 'Text', 'District within the state', 'ANANTAPUR'], ['Crop_Year', 'Integer', 'Year of the agricultural record', '2000'],
    ['Season', 'Text', 'Kharif, Rabi, Summer, Autumn, Winter or Whole Year', 'Kharif'], ['Crop', 'Text', 'Crop cultivated (124 types)', 'Rice'], ['Area', 'Number', 'Cultivated land area in hectares', '35,600'], ['Production', 'Number', 'Quantity produced (unit depends on the crop)', '75,400']];
  return head('Dictionary', 'Field definitions, how measures are calculated, and the limits of this dataset.') +
    grid('one', card({ title: 'Fields', html: table(['Column', 'Type', 'Description', 'Example', 'Missing (raw)'], cols.map(([c, t, d, e]) => [c, t, d, e, int(RAW_NULLS[c] ?? 0)])) })) +
    grid('', card({ title: 'How measures are calculated', html: '<dl class="dict"><dt>Yield</dt><dd>Production ÷ Area for a record; for a group, total production ÷ total area.</dd><dt>Median</dt><dd>The middle value — robust to extreme records.</dd><dt>CV</dt><dd>Standard deviation ÷ mean; compares variability between groups of different size.</dd><dt>IQR</dt><dd>Q3 − Q1, the spread of the middle 50%.</dd><dt>Outlier</dt><dd>A value below Q1 − 1.5×IQR or above Q3 + 1.5×IQR.</dd><dt>Pearson / Spearman</dt><dd>Linear vs rank correlation; Spearman resists outliers.</dd></dl>' }),
      card({ title: 'Cleaning & limitations', html: '<dl class="dict"><dt>Cleaning</dt><dd>Column names trimmed, text trimmed, types fixed, rows with missing Production removed.</dd><dt>Kept</dt><dd>Zero values and outliers.</dd><dt>Units</dt><dd>Production is not in one common unit — coconut is counted in nuts. Totals across crops describe recorded volume only.</dd><dt>Scope</dt><dd>No rainfall, soil, irrigation, input, price or farmer data.</dd><dt>Coverage</dt><dd>Reporting is uneven across states and years, so trends at the edges can mislead.</dd></dl>' }));
};

/* ------------------------------------------------------------ filters & state */
function options(key) {
  const base = S.dataset === 'Raw' ? RAW : CLEAN, rows = key === 'd' && S.sel.s.size ? base.filter((r) => S.sel.s.has(r.s)) : base;
  return [...new Set(rows.map((r) => r[key]))].sort();
}
const MS_LABEL = { s: 'states', d: 'districts', se: 'seasons', c: 'crops' };
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
const renderAllMS = () => ['s', 'd', 'se', 'c'].forEach(renderMS);
function changed() { clearTimeout(debounce); debounce = setTimeout(() => { S.recPage = 0; renderAllMS(); refresh(); }, 120); }

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
  F = base.filter((r) => (r.y == null || (r.y >= S.y0 && r.y <= S.y1)) && (!sel.s.size || sel.s.has(r.s)) && (!sel.d.size || sel.d.has(r.d)) && (!sel.se.size || sel.se.has(r.se)) && (!sel.c.size || sel.c.has(r.c)) && !(S.noCoco && r.c === 'Coconut'));
  FP = F.filter((r) => r.p != null);
  $('count').textContent = `${int(F.length)} of ${int(base.length)} records`; $('datasetPill').textContent = S.dataset + ' data';
  paintChips();
}
function refresh() { applyFilters(); render(); }

/* ------------------------------------------------------------ render + wiring */
function render() {
  seq = 0; Q = [];
  const el = $('view');
  if (!F.length) { el.innerHTML = '<div class="alert">No records match the current filters. Clear a filter to continue.</div>'; return; }
  if (!FP.length && !['records', 'quality', 'dictionary'].includes(S.page)) { el.innerHTML = '<div class="alert">None of the selected records has a production value.</div>'; return; }
  el.innerHTML = P[S.page]();
  for (const [id, traces, layout] of Q) { const n = $(id); if (n) Plotly.newPlot(n, traces, layoutOf(layout), { responsive: true, displaylogo: false }); }
  const bind = (id, fn) => { const n = $(id); if (n) n.onchange = fn; };
  bind('cropFocus', (e) => { S.cropFocus = e.target.value; render(); });
  bind('variable', (e) => { S.variable = e.target.value; render(); });
  bind('group', (e) => { S.group = e.target.value; render(); });
  bind('scatterBy', (e) => { S.scatterBy = e.target.value; render(); });
  bind('log', (e) => { S.log = e.target.checked; render(); });
  document.querySelectorAll('input[name=rv]').forEach((i) => (i.onchange = () => { S.recView = i.value; S.recPage = 0; render(); }));
  const sr = $('recSearch');
  if (sr) sr.oninput = () => { S.recSearch = sr.value; S.recPage = 0; clearTimeout(debounce); debounce = setTimeout(() => { render(); const n = $('recSearch'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  const pv = $('prev'), nx = $('next');
  if (pv) pv.onclick = () => { S.recPage--; render(); };
  if (nx) nx.onclick = () => { S.recPage++; render(); };
  const dl = $('dl');
  if (dl) dl.onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csvOf(recordRows())], { type: 'text/csv' })); a.download = 'crop_production_view.csv'; a.click(); };
}
const TOPN_PAGES = new Set(['overview', 'trends', 'crops', 'regions', 'seasons', 'central', 'spread']);
function updateTopN() {
  const on = TOPN_PAGES.has(S.page), el = $('topn');
  el.disabled = !on; el.title = on ? 'How many items the top-N charts on this page show' : 'Not used on this page';
}
function setPage(p) {
  S.page = p; updateTopN();
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
