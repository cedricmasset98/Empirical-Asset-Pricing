/** Graphiques Plotly. Toutes les valeurs proviennent des résultats calculés. */

import Plotly from 'plotly.js-dist-min';
import type { FitOk, Diagnostics, Comparison } from './analysis.ts';
import type { RollingResult } from '../engine/rolling.ts';
import { meanPredictionInterval } from '../engine/ols.ts';
import { normPdf } from '../engine/distributions.ts';
import { FACTOR_LABELS, MODEL_IDS, MODEL_SHORT, UNIVERSE_LABELS, type FactorId } from '../engine/models.ts';
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

// ------------------------------------------------------------------ A. Scatter

export function plotScatter(el: HTMLElement, fit: FitOk, t: Theme, opts: { band: boolean; colorByYear: boolean; marketLabel: string }): void {
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
        hoverinfo: 'skip', name: `IC ${Math.round(r.level * 100)} % de la droite`,
      },
    );
  }
  traces.push({
    x: xs.map(P),
    y: ys.map(P),
    customdata: custom,
    mode: 'markers',
    type: 'scatter',
    name: 'Observations mensuelles',
    marker: opts.colorByYear
      ? { size: 7, color: years, colorscale: 'Viridis', showscale: true, colorbar: { title: { text: 'Année' }, thickness: 12, tickfont: { color: t.muted } }, opacity: 0.85, line: { width: 0.5, color: t.halo } }
      : { size: 7, color: t.points, opacity: 0.7, line: { width: 0.5, color: t.halo } },
    hovertemplate:
      '<b>%{customdata[0]}</b><br>Rendement excédentaire BCV : %{customdata[1]:.2f} %<br>' +
      `Rendement excédentaire ${opts.marketLabel} : %{customdata[2]:.2f} %<br>` +
      'Rendement prédit : %{customdata[3]:.2f} %<br>Résidu : %{customdata[4]:.2f} %<extra></extra>',
  });
  // halo puis droite : la droite reste lisible au-dessus des points dans les deux thèmes
  traces.push(
    { x: grid.map(P), y: pred.map((p) => P(p.fit)), mode: 'lines', line: { color: t.halo, width: 7 }, hoverinfo: 'skip', showlegend: false },
    {
      x: grid.map(P), y: pred.map((p) => P(p.fit)), mode: 'lines', line: { color: t.line, width: 3.5 }, name: 'Droite OLS',
      hovertemplate: 'Droite OLS<br>x = %{x:.2f} %<br>ŷ = %{y:.2f} %<extra></extra>',
    },
  );
  const a = r.beta[0];
  const b = r.beta[1];
  const eq = `R̂ᵉ<sub>BCV</sub> = ${num(P(a), 3)} % ${b >= 0 ? '+' : '−'} ${num(Math.abs(b), 3)} · Rᵉ<sub>M</sub>`;
  const statLabel = r.distribution === 't' ? 't' : 'z';
  const box = `${eq}<br>α = ${num(P(a), 3)} %/mois · ${statLabel}(α) = ${num(r.stat[0], 2)} · p(α) = ${pval(r.pvalue[0])}<br>β = ${num(b, 3)} · R² = ${num(r.r2, 3)} · N = ${r.n}`;
  Plotly.react(
    el,
    traces,
    layout(t, {
      xaxis: { title: { text: `Rendement excédentaire ${opts.marketLabel} (%, mensuel)` }, ticksuffix: ' %' },
      yaxis: { title: { text: 'Rendement excédentaire BCV (%, mensuel)' }, ticksuffix: ' %' },
      annotations: [
        {
          xref: 'paper', yref: 'paper', x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top', align: 'left', showarrow: false,
          text: box, font: { size: 12, color: t.fg }, bgcolor: t.panel, bordercolor: t.grid, borderwidth: 1, borderpad: 6, opacity: 0.95,
        },
      ],
      margin: { l: 70, r: opts.colorByYear ? 10 : 20, t: 20, b: 60 },
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
      { x: d, y: fit.sample.y.map(P), mode: 'lines', name: 'Observé (BCV − Rf)', line: { color: t.points, width: 1.5 }, hovertemplate: '%{x|%Y-%m} : %{y:.2f} %<extra>Observé</extra>' },
      { x: d, y: fit.result.fitted.map(P), mode: 'lines', name: 'Prédit par le modèle', line: { color: t.line, width: 2 }, hovertemplate: '%{x|%Y-%m} : %{y:.2f} %<extra>Prédit</extra>' },
    ],
    layout(t, { yaxis: { title: { text: 'Rendement excédentaire (%, mensuel)' }, ticksuffix: ' %' }, xaxis: { type: 'date' } }),
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
      { x: f, y, text: fit.sample.dates, mode: 'markers', marker: { color: t.points, size: 6, opacity: 0.7 }, name: 'Observations', hovertemplate: '%{text}<br>prédit %{x:.2f} % · observé %{y:.2f} %<extra></extra>' },
      { x: [lo, hi], y: [lo, hi], mode: 'lines', line: { color: t.muted, dash: 'dash', width: 1.5 }, name: '45°', hoverinfo: 'skip' },
    ],
    layout(t, { xaxis: { title: { text: 'Prédit (%)' } }, yaxis: { title: { text: 'Observé (%)' } }, showlegend: false }),
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
      { x: fit.sample.dates, y: e, type: 'bar', marker: { color: t.points }, name: 'Résidu', hovertemplate: '%{x|%Y-%m} : %{y:.2f} %<extra></extra>' },
      { x: [fit.sample.dates[0], fit.sample.dates.at(-1)], y: [2 * s, 2 * s], mode: 'lines', line: { color: t.muted, dash: 'dot' }, name: '±2σ̂', hoverinfo: 'skip' },
      { x: [fit.sample.dates[0], fit.sample.dates.at(-1)], y: [-2 * s, -2 * s], mode: 'lines', line: { color: t.muted, dash: 'dot' }, showlegend: false, hoverinfo: 'skip' },
    ],
    layout(t, { title: { text: 'Résidus dans le temps', font: { size: 13 } }, yaxis: { ticksuffix: ' %' }, xaxis: { type: 'date' }, showlegend: false, margin: { l: 55, r: 10, t: 36, b: 40 } }),
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
      { x: e, type: 'histogram', xbins: { start: lo, end: hi + 1e-9, size: width }, marker: { color: t.points, opacity: 0.75 }, name: 'Résidus' },
      { x: gx, y: gx.map((v) => (e.length * width * normPdf(v / s)) / s), mode: 'lines', line: { color: t.line, width: 2 }, name: 'Densité normale N(0, σ̂²)' },
    ],
    layout(t, { title: { text: 'Histogramme des résidus', font: { size: 13 } }, xaxis: { ticksuffix: ' %' }, bargap: 0.04, showlegend: false, margin: { l: 45, r: 10, t: 36, b: 40 } }),
    CONFIG,
  );
  const q = d.qq;
  const qlo = Math.min(q.theoretical[0], q.sample[0]);
  const qhi = Math.max(q.theoretical.at(-1)!, q.sample.at(-1)!);
  Plotly.react(
    els.qq,
    [
      { x: q.theoretical, y: q.sample, mode: 'markers', marker: { color: t.points, size: 5 }, name: 'Résidus standardisés', hovertemplate: 'théorique %{x:.2f} · empirique %{y:.2f}<extra></extra>' },
      { x: [qlo, qhi], y: [qlo, qhi], mode: 'lines', line: { color: t.line, width: 2 }, name: 'Loi normale', hoverinfo: 'skip' },
    ],
    layout(t, { title: { text: 'Q-Q plot normal', font: { size: 13 } }, xaxis: { title: { text: 'Quantiles théoriques' } }, yaxis: { title: { text: 'Résidus / σ̂' } }, showlegend: false, margin: { l: 55, r: 10, t: 36, b: 45 } }),
    CONFIG,
  );
  const lags = d.acf.map((_, i) => i + 1);
  Plotly.react(
    els.acf,
    [
      { x: lags, y: d.acf, type: 'bar', marker: { color: t.points }, name: 'ACF', hovertemplate: 'retard %{x} : %{y:.3f}<extra></extra>', width: 0.4 },
      { x: [0.5, lags.length + 0.5], y: [d.acfBand, d.acfBand], mode: 'lines', line: { color: t.line, dash: 'dash', width: 1.5 }, name: '±1,96/√n', hoverinfo: 'skip' },
      { x: [0.5, lags.length + 0.5], y: [-d.acfBand, -d.acfBand], mode: 'lines', line: { color: t.line, dash: 'dash', width: 1.5 }, showlegend: false, hoverinfo: 'skip' },
    ],
    layout(t, { title: { text: 'Autocorrélation des résidus (ACF)', font: { size: 13 } }, xaxis: { title: { text: 'Retard (mois)' }, dtick: 2 }, showlegend: false, margin: { l: 45, r: 10, t: 36, b: 45 } }),
    CONFIG,
  );
}

// ------------------------------------------------------------------ D. Rolling

export function coefLabel(name: string): string {
  if (name === 'const') return 'α (% par mois)';
  return FACTOR_LABELS[name as FactorId] ?? name;
}

export function plotRolling(container: HTMLElement, roll: RollingResult, t: Theme, showBand: boolean): void {
  container.innerHTML = '';
  roll.names.forEach((name, j) => {
    const div = document.createElement('div');
    div.className = 'chart chart-sm';
    container.appendChild(div);
    const scale = name === 'const' ? P : (x: number) => x;
    const traces: unknown[] = [];
    if (showBand) {
      traces.push(
        { x: roll.dates, y: roll.low[j].map(scale), mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false },
        { x: roll.dates, y: roll.high[j].map(scale), mode: 'lines', line: { width: 0 }, fill: 'tonexty', fillcolor: t.band, name: 'IC 95 %', hoverinfo: 'skip' },
      );
    }
    traces.push({
      x: roll.dates,
      y: roll.beta[j].map(scale),
      mode: 'lines',
      line: { color: j === 0 ? t.line : t.series[(j - 1) % t.series.length], width: 2 },
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
        title: { text: `${coefLabel(name)} — fenêtre glissante de ${roll.window} mois`, font: { size: 13 } },
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
  (['SPI', 'EUROPE'] as const).forEach((u, ui) => {
    const fits = MODEL_IDS.map((m) => cmp.fits.find((f) => f.model === m && f.universe === u)!);
    const ok = fits.map((f) => (f.ok ? f : null));
    traces.push({
      x: MODEL_IDS.map((m) => MODEL_SHORT[m]),
      y: ok.map((f) => (f ? P(f.result.beta[0]) : null)),
      error_y: {
        type: 'data',
        symmetric: false,
        array: ok.map((f) => (f ? P(f.result.ciHigh[0] - f.result.beta[0]) : null)),
        arrayminus: ok.map((f) => (f ? P(f.result.beta[0] - f.result.ciLow[0]) : null)),
        color: ui === 0 ? t.series[0] : t.series[1],
        thickness: 1.5,
        width: 6,
      },
      customdata: ok.map((f) => (f ? [f.result.stat[0], f.result.pvalue[0], f.result.r2, f.result.n] : [null, null, null, null])),
      mode: 'markers',
      type: 'scatter',
      marker: { size: 11, color: ui === 0 ? t.series[0] : t.series[1], symbol: ui === 0 ? 'circle' : 'diamond' },
      name: u === 'SPI' ? 'Marché SPI TR (CAPM suisse ; FF3/Carhart/FF5 = hybrides)' : UNIVERSE_LABELS.EUROPE,
      offsetgroup: u,
      hovertemplate: 'α = %{y:.3f} %/mois<br>stat(α) = %{customdata[0]:.2f} · p = %{customdata[1]:.4f}<br>R² = %{customdata[2]:.3f} · N = %{customdata[3]}<extra>%{fullData.name}</extra>',
    });
  });
  Plotly.react(
    el,
    traces,
    layout(t, {
      scattermode: 'group',
      yaxis: { title: { text: 'α estimé (% par mois) et IC 95 %' }, ticksuffix: ' %', zeroline: true, zerolinewidth: 2 },
      xaxis: { title: { text: 'Modèle' } },
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
