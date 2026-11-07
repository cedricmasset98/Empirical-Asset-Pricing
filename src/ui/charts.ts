/** Graphiques Plotly. Toutes les valeurs proviennent des résultats calculés. */

import Plotly from 'plotly.js-dist-min';
import type { FitOk, Diagnostics, Comparison } from './analysis.ts';
import type { RollingResult } from '../engine/rolling.ts';
import { meanPredictionInterval } from '../engine/ols.ts';
import { normPdf } from '../engine/distributions.ts';
import { ASSET_INFO, FACTOR_LABELS, MODEL_IDS, MODEL_SHORT, type FactorId } from '../engine/models.ts';
import type { AssetComparison } from './analysis.ts';
import { num, pval } from './format.ts';

export interface Theme {
  fg: string;
  muted: string;
  grid: string;
  zero: string;
  panel: string;
  points: string;
  line: string;
  halo: string;
  band: string;
  series: string[];
}

export function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    fg: v('--fg'),
    muted: v('--muted'),
    grid: v('--grid'),
    zero: v('--zero'),
    panel: v('--panel'),
    points: v('--points'),
    line: v('--reg-line'),
    halo: v('--bg'),
    band: v('--band'),
    series: [v('--s1'), v('--s2'), v('--s3'), v('--s4'), v('--s5'), v('--s6')],
  };
}

const CONFIG = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d'] };

function layout(t: Theme, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const axis = { gridcolor: t.grid, zerolinecolor: t.zero, linecolor: t.grid, tickfont: { color: t.muted }, title: { font: { color: t.fg } } };
  const base: Record<string, unknown> = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Inter, system-ui, -apple-system, Segoe UI, sans-serif', color: t.fg, size: 12 },
    margin: { l: 60, r: 20, t: 30, b: 50 },
    hoverlabel: { bgcolor: t.panel, bordercolor: t.grid, font: { color: t.fg } },
    legend: { orientation: 'h', y: -0.18, font: { color: t.fg } },
    xaxis: { ...axis },
    yaxis: { ...axis },
  };
  for (const [k, val] of Object.entries(extra)) {
    if ((k.startsWith('xaxis') || k.startsWith('yaxis')) && typeof val === 'object') base[k] = { ...axis, ...(val as object) };
    else base[k] = val;
  }
  return base;
}

const P = (x: number) => x * 100;

/** Couleur hexadécimale (#rrggbb) avec transparence. */
function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`;
}

// ------------------------------------------------------------------ A. Scatter

export function plotScatter(
  el: HTMLElement,
  fit: FitOk,
  t: Theme,
  opts: { band: boolean; colorByYear: boolean; marketLabel: string; ranges?: { x: [number, number]; y: [number, number] }; compact?: boolean },
): void {
  const who = ASSET_INFO[fit.asset].short;
  const r = fit.result;
  const xs = fit.sample.x.map((row) => row[1]);
  const ys = fit.sample.y;
  const years = fit.sample.dates.map((d) => Number(d.slice(0, 4)));
  const custom = fit.sample.dates.map((d, i) => [d, P(ys[i]), P(xs[i]), P(r.fitted[i]), P(r.resid[i])]);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const pad = 0.04 * (xmax - xmin);
  const grid = Array.from({ length: 81 }, (_, i) => xmin - pad + ((xmax - xmin + 2 * pad) * i) / 80);
  const pred = grid.map((x) => meanPredictionInterval(r, [1, x]));
  const traces: unknown[] = [];
  if (opts.band) {
    traces.push(
      { x: grid.map(P), y: pred.map((p) => P(p.low)), mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false },
      {
        x: grid.map(P), y: pred.map((p) => P(p.high)), mode: 'lines', line: { width: 0 }, fill: 'tonexty', fillcolor: t.band,
        hoverinfo: 'skip', name: `${Math.round(r.level * 100)}% CI of the line`,
      },
    );
  }
  traces.push({
    x: xs.map(P),
    y: ys.map(P),
    customdata: custom,
    mode: 'markers',
    type: 'scatter',
    name: 'Monthly observations',
    marker: opts.colorByYear
      ? { size: 7, color: years, colorscale: 'Viridis', showscale: true, colorbar: { title: { text: 'Year' }, thickness: 12, tickfont: { color: t.muted } }, opacity: 0.85, line: { width: 0.5, color: t.halo } }
      : { size: 7, color: t.points, opacity: 0.7, line: { width: 0.5, color: t.halo } },
    hovertemplate:
      `<b>%{customdata[0]}</b><br>Excess return ${who}: %{customdata[1]:.2f}%<br>` +
      `Excess return ${opts.marketLabel}: %{customdata[2]:.2f}%<br>` +
      'Fitted return: %{customdata[3]:.2f}%<br>Residual: %{customdata[4]:.2f}%<extra></extra>',
  });
  // halo puis droite : la droite reste lisible au-dessus des points dans les deux thèmes
  traces.push(
    { x: grid.map(P), y: pred.map((p) => P(p.fit)), mode: 'lines', line: { color: t.halo, width: 7 }, hoverinfo: 'skip', showlegend: false },
    {
      x: grid.map(P), y: pred.map((p) => P(p.fit)), mode: 'lines', line: { color: t.line, width: 3.5 }, name: 'OLS line',
      hovertemplate: 'Droite OLS<br>x = %{x:.2f} %<br>ŷ = %{y:.2f} %<extra></extra>',
    },
  );
  const a = r.beta[0];
  const b = r.beta[1];
  const eq = `R̂ᵉ<sub>${ASSET_INFO[fit.asset].sub}</sub> = ${num(P(a), 3)} % ${b >= 0 ? '+' : '−'} ${num(Math.abs(b), 3)} · Rᵉ<sub>M</sub>`;
  const statLabel = r.distribution === 't' ? 't' : 'z';
  const box = `${eq}<br>α = ${num(P(a), 3)}%/month · ${statLabel}(α) = ${num(r.stat[0], 2)} · p(α) = ${pval(r.pvalue[0])}<br>β = ${num(b, 3)} · R² = ${num(r.r2, 3)} · N = ${r.n}`;
  Plotly.react(
    el,
    traces,
    layout(t, {
      title: opts.compact ? { text: ASSET_INFO[fit.asset].label, font: { size: 14 } } : undefined,
      xaxis: { title: { text: `Excess return ${opts.marketLabel} (%, monthly)` }, ticksuffix: '%', range: opts.ranges?.x },
      yaxis: { title: { text: `Excess return ${who} (%, monthly)` }, ticksuffix: '%', range: opts.ranges?.y },
      annotations: opts.compact ? [] : [
        {
          xref: 'paper', yref: 'paper', x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top', align: 'left', showarrow: false,
          text: box, font: { size: 12, color: t.fg }, bgcolor: t.panel, bordercolor: t.grid, borderwidth: 1, borderpad: 6, opacity: 0.95,
        },
      ],
      margin: { l: 70, r: opts.colorByYear ? 10 : 20, t: opts.compact ? 40 : 20, b: 60 },
    }),
    CONFIG,
  );
}

// ------------------------------------------------------------------ B. Actual vs fitted

export function plotFitted(el: HTMLElement, fit: FitOk, t: Theme): void {
  const d = fit.sample.dates;
  Plotly.react(
    el,
    [
      { x: d, y: fit.sample.y.map(P), mode: 'lines', name: `Observed (${ASSET_INFO[fit.asset].short} − Rf)`, line: { color: t.points, width: 1.5 }, hovertemplate: '%{x|%Y-%m}: %{y:.2f}%<extra>Observed</extra>' },
      { x: d, y: fit.result.fitted.map(P), mode: 'lines', name: 'Fitted by the model', line: { color: t.line, width: 2 }, hovertemplate: '%{x|%Y-%m}: %{y:.2f}%<extra>Fitted</extra>' },
    ],
    layout(t, { yaxis: { title: { text: 'Excess return (%, monthly)' }, ticksuffix: '%' }, xaxis: { type: 'date' } }),
    CONFIG,
  );
}

export function plotFittedScatter(el: HTMLElement, fit: FitOk, t: Theme): void {
  const f = fit.result.fitted.map(P);
  const y = fit.sample.y.map(P);
  const lo = Math.min(...f, ...y);
  const hi = Math.max(...f, ...y);
  Plotly.react(
    el,
    [
      { x: f, y, text: fit.sample.dates, mode: 'markers', marker: { color: t.points, size: 6, opacity: 0.7 }, name: 'Observations', hovertemplate: '%{text}<br>fitted %{x:.2f}% · observed %{y:.2f}%<extra></extra>' },
      { x: [lo, hi], y: [lo, hi], mode: 'lines', line: { color: t.muted, dash: 'dash', width: 1.5 }, name: '45°', hoverinfo: 'skip' },
    ],
    layout(t, { xaxis: { title: { text: 'Fitted (%)' } }, yaxis: { title: { text: 'Observed (%)' } }, showlegend: false }),
    CONFIG,
  );
}

// ------------------------------------------------------------------ C. Diagnostics

export function plotDiagnostics(els: { time: HTMLElement; hist: HTMLElement; qq: HTMLElement; acf: HTMLElement }, fit: FitOk, d: Diagnostics, t: Theme): void {
  const e = fit.result.resid.map(P);
  const s = P(fit.result.sigma);
  Plotly.react(
    els.time,
    [
      { x: fit.sample.dates, y: e, type: 'bar', marker: { color: t.points }, name: 'Residual', hovertemplate: '%{x|%Y-%m}: %{y:.2f}%<extra></extra>' },
      { x: [fit.sample.dates[0], fit.sample.dates.at(-1)], y: [2 * s, 2 * s], mode: 'lines', line: { color: t.muted, dash: 'dot' }, name: '±2s', hoverinfo: 'skip' },
      { x: [fit.sample.dates[0], fit.sample.dates.at(-1)], y: [-2 * s, -2 * s], mode: 'lines', line: { color: t.muted, dash: 'dot' }, showlegend: false, hoverinfo: 'skip' },
    ],
    layout(t, { title: { text: 'Residuals over time', font: { size: 13 } }, yaxis: { ticksuffix: '%' }, xaxis: { type: 'date' }, showlegend: false, margin: { l: 55, r: 10, t: 36, b: 40 } }),
    CONFIG,
  );
  const lo = Math.min(...e);
  const hi = Math.max(...e);
  const nb = Math.max(10, Math.min(40, Math.round(Math.sqrt(e.length) * 1.5)));
  const width = (hi - lo) / nb;
  const gx = Array.from({ length: 121 }, (_, i) => lo + ((hi - lo) * i) / 120);
  Plotly.react(
    els.hist,
    [
      { x: e, type: 'histogram', xbins: { start: lo, end: hi + 1e-9, size: width }, marker: { color: t.points, opacity: 0.75 }, name: 'Residuals' },
      { x: gx, y: gx.map((v) => (e.length * width * normPdf(v / s)) / s), mode: 'lines', line: { color: t.line, width: 2 }, name: 'Normal density N(0, s²)' },
    ],
    layout(t, { title: { text: 'Histogram of residuals', font: { size: 13 } }, xaxis: { ticksuffix: '%' }, bargap: 0.04, showlegend: false, margin: { l: 45, r: 10, t: 36, b: 40 } }),
    CONFIG,
  );
  const q = d.qq;
  const qlo = Math.min(q.theoretical[0], q.sample[0]);
  const qhi = Math.max(q.theoretical.at(-1)!, q.sample.at(-1)!);
  Plotly.react(
    els.qq,
    [
      { x: q.theoretical, y: q.sample, mode: 'markers', marker: { color: t.points, size: 5 }, name: 'Standardised residuals', hovertemplate: 'theoretical %{x:.2f} · empirical %{y:.2f}<extra></extra>' },
      { x: [qlo, qhi], y: [qlo, qhi], mode: 'lines', line: { color: t.line, width: 2 }, name: 'Normal distribution', hoverinfo: 'skip' },
    ],
    layout(t, { title: { text: 'Normal Q-Q plot', font: { size: 13 } }, xaxis: { title: { text: 'Theoretical quantiles' } }, yaxis: { title: { text: 'Standardised residuals (e / s)' } }, showlegend: false, margin: { l: 55, r: 10, t: 36, b: 45 } }),
    CONFIG,
  );
  const lags = d.acf.map((_, i) => i + 1);
  Plotly.react(
    els.acf,
    [
      { x: lags, y: d.acf, type: 'bar', marker: { color: t.points }, name: 'ACF', hovertemplate: 'lag %{x}: %{y:.3f}<extra></extra>', width: 0.4 },
      { x: [0.5, lags.length + 0.5], y: [d.acfBand, d.acfBand], mode: 'lines', line: { color: t.line, dash: 'dash', width: 1.5 }, name: '±1.96/√n', hoverinfo: 'skip' },
      { x: [0.5, lags.length + 0.5], y: [-d.acfBand, -d.acfBand], mode: 'lines', line: { color: t.line, dash: 'dash', width: 1.5 }, showlegend: false, hoverinfo: 'skip' },
    ],
    layout(t, { title: { text: 'Residual autocorrelation (ACF)', font: { size: 13 } }, xaxis: { title: { text: 'Lag (months)' }, dtick: 2 }, showlegend: false, margin: { l: 45, r: 10, t: 36, b: 45 } }),
    CONFIG,
  );
}

// ------------------------------------------------------------------ D. Rolling

export function coefLabel(name: string): string {
  if (name === 'const') return 'α (% per month)';
  return FACTOR_LABELS[name as FactorId] ?? name;
}

export function plotRolling(container: HTMLElement, roll: RollingResult, t: Theme, showBand: boolean): void {
  container.innerHTML = '';
  roll.names.forEach((name, j) => {
    const div = document.createElement('div');
    div.className = 'chart chart-sm';
    container.appendChild(div);
    const scale = name === 'const' ? P : (x: number) => x;
    // α garde la couleur de la droite OLS ; les facteurs évitent cette teinte (s2)
    const palette = t.series.filter((_, i) => i !== 1);
    const color = j === 0 ? t.line : palette[(j - 1) % palette.length];
    const traces: unknown[] = [];
    if (showBand) {
      traces.push(
        { x: roll.dates, y: roll.low[j].map(scale), mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false },
        { x: roll.dates, y: roll.high[j].map(scale), mode: 'lines', line: { width: 0 }, fill: 'tonexty', fillcolor: withAlpha(color, 0.18), name: '95% CI', hoverinfo: 'skip' },
      );
    }
    traces.push({
      x: roll.dates,
      y: roll.beta[j].map(scale),
      mode: 'lines',
      line: { color, width: 2 },
      name: coefLabel(name),
      customdata: roll.low[j].map((lo, i) => [scale(lo), scale(roll.high[j][i])]),
      hovertemplate: `%{x|%Y-%m} : %{y:.3f}${name === 'const' ? ' %' : ''}<br>IC [%{customdata[0]:.3f} ; %{customdata[1]:.3f}]<extra></extra>`,
    });
    const ref = name === 'const' ? 0 : name === 'MKT' ? 1 : 0;
    traces.push({ x: [roll.dates[0], roll.dates.at(-1)], y: [ref, ref], mode: 'lines', line: { color: t.muted, dash: 'dot', width: 1 }, hoverinfo: 'skip', showlegend: false });
    Plotly.react(
      div,
      traces,
      layout(t, {
        title: { text: `${coefLabel(name)} — ${roll.window}-month rolling window`, font: { size: 13 } },
        xaxis: { type: 'date' },
        showlegend: false,
        margin: { l: 55, r: 15, t: 36, b: 35 },
      }),
      CONFIG,
    );
  });
}

// ------------------------------------------------------------------ E. Comparaison

export function plotComparison(el: HTMLElement, cmp: Comparison, t: Theme): void {
  const traces: unknown[] = [];
  (['SWISS', 'EUROPE'] as const).forEach((u, ui) => {
    const fits = MODEL_IDS.map((m) => cmp.fits.find((f) => f.model === m && f.universe === u)!);
    const ok = fits.map((f) => (f && f.ok ? f : null));
    traces.push({
      x: MODEL_IDS.map((m) => MODEL_SHORT[m]),
      y: ok.map((f) => (f ? P(f.result.beta[0]) : null)),
      error_y: {
        type: 'data',
        symmetric: false,
        array: ok.map((f) => (f ? P(f.result.ciHigh[0] - f.result.beta[0]) : null)),
        arrayminus: ok.map((f) => (f ? P(f.result.beta[0] - f.result.ciLow[0]) : null)),
        color: t.series[ui],
        thickness: 1.5,
        width: 6,
      },
      customdata: ok.map((f) => (f ? [f.result.stat[0], f.result.pvalue[0], f.result.r2, f.result.n] : [null, null, null, null])),
      mode: 'markers',
      type: 'scatter',
      marker: { size: 11, color: t.series[ui], symbol: (['circle', 'diamond', 'square'] as const)[ui] },
      name: u === 'SWISS' ? 'Swiss universe (SPI TR, JKP factors; CAPM = Single Index)' : 'European Fama-French universe (comparison)',
      offsetgroup: u,
      hovertemplate: 'α = %{y:.3f}%/month<br>stat(α) = %{customdata[0]:.2f} · p = %{customdata[1]:.4f}<br>R² = %{customdata[2]:.3f} · N = %{customdata[3]}<extra>%{fullData.name}</extra>',
    });
  });
  Plotly.react(
    el,
    traces,
    layout(t, {
      scattermode: 'group',
      yaxis: { title: { text: 'Estimated α (% per month) and 95% CI' }, ticksuffix: '%', zeroline: true, zerolinewidth: 2 },
      xaxis: { title: { text: 'Model' } },
      legend: { orientation: 'h', y: -0.25, font: { color: t.fg } },
      margin: { l: 70, r: 20, t: 20, b: 90 },
    }),
    CONFIG,
  );
}

export function resizeAll(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.js-plotly-plot').forEach((el) => {
    if (el.offsetParent !== null) Plotly.Plots.resize(el);
  });
}

// ------------------------------------------------------------------ Comparer deux actifs

export function plotPerformance(el: HTMLElement, cmp: AssetComparison, t: Theme): void {
  const first = cmp.dates[0];
  const [y, m] = first.split('-').map(Number);
  const start = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const x = [start, ...cmp.dates];
  const style: Record<string, { color: string; dash?: string; width: number }> = {
    a: { color: t.line, width: 2.4 },
    b: { color: t.series[2], width: 2.4 },
    spi: { color: t.series[0], width: 1.8 },
    rf: { color: t.muted, dash: 'dash', width: 1.4 },
  };
  Plotly.react(
    el,
    cmp.perf.map((p) => ({
      x,
      y: p.path,
      mode: 'lines',
      name: p.label,
      line: style[p.key],
      hovertemplate: `%{x|%Y-%m} : %{y:.1f} CHF<extra>${p.label}</extra>`,
    })),
    layout(t, {
      xaxis: { type: 'date' },
      yaxis: { title: { text: 'Value of CHF 100 invested (CHF)' } },
      legend: { orientation: 'h', y: -0.15, font: { color: t.fg } },
    }),
    CONFIG,
  );
}

export function plotAlphaPair(el: HTMLElement, cmp: AssetComparison, t: Theme): void {
  const traces = (['a', 'b'] as const).map((k, i) => {
    const fits = cmp.models.map((m) => m[k]);
    const ok = fits.map((f) => (f.ok ? f : null));
    const color = i === 0 ? t.line : t.series[2];
    return {
      x: cmp.models.map((m) => MODEL_SHORT[m.model]),
      y: ok.map((f) => (f ? 1200 * f.result.beta[0] : null)),
      error_y: {
        type: 'data',
        symmetric: false,
        array: ok.map((f) => (f ? 1200 * (f.result.ciHigh[0] - f.result.beta[0]) : null)),
        arrayminus: ok.map((f) => (f ? 1200 * (f.result.beta[0] - f.result.ciLow[0]) : null)),
        color,
        thickness: 1.6,
        width: 6,
      },
      customdata: ok.map((f) => (f ? [f.result.stat[0], f.result.pvalue[0], f.result.n] : [null, null, null])),
      mode: 'markers',
      type: 'scatter',
      offsetgroup: k,
      marker: { size: 11, color, symbol: i === 0 ? 'circle' : 'diamond' },
      name: ASSET_INFO[cmp.pair[i]].label,
      hovertemplate: 'α = %{y:.2f}% a year<br>stat = %{customdata[0]:.2f} · p = %{customdata[1]:.4f} · N = %{customdata[2]}<extra>%{fullData.name}</extra>',
    };
  });
  Plotly.react(
    el,
    traces,
    layout(t, {
      scattermode: 'group',
      yaxis: { title: { text: 'Annualised α (12 × monthly) and 95% CI' }, ticksuffix: '%', zeroline: true, zerolinewidth: 2.5, zerolinecolor: t.fg },
      xaxis: { title: { text: 'Model' } },
      shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 0, y1: 0, line: { color: t.fg, width: 2 } }],
      annotations: [{ xref: 'paper', x: 1, y: 0, yanchor: 'bottom', xanchor: 'right', text: 'α = 0', showarrow: false, font: { size: 11, color: t.fg } }],
      legend: { orientation: 'h', y: -0.22, font: { color: t.fg } },
      margin: { l: 70, r: 20, t: 20, b: 80 },
    }),
    CONFIG,
  );
}

/** Plages communes (en %) pour comparer deux nuages de points à la même échelle. */
export function commonRanges(fits: FitOk[]): { x: [number, number]; y: [number, number] } {
  const xs = fits.flatMap((f) => f.sample.x.map((r) => 100 * r[1]));
  const ys = fits.flatMap((f) => f.sample.y.map((v) => 100 * v));
  const pad = (a: number[]) => {
    const lo = Math.min(...a);
    const hi = Math.max(...a);
    const p = 0.05 * (hi - lo);
    return [lo - p, hi + p] as [number, number];
  };
  return { x: pad(xs), y: pad(ys) };
}
