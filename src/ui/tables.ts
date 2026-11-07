/** Rendu HTML des cartes, tableaux économétriques et tableaux de tests. */

import type { FitOk, Comparison, Diagnostics, GrossAlpha } from './analysis.ts';
import { shiftAlpha } from './analysis.ts';
import type { FeeInfo } from '../data/types.ts';
import type { Dataset } from '../data/types.ts';
import { ASSET_INFO, FACTOR_COEF, MODEL_IDS, MODEL_SHORT, type FactorId } from '../engine/models.ts';
import type { AssetComparison, Fit } from './analysis.ts';
import { escapeHtml as h, num, pct, pval, stars } from './format.ts';
import { coefLabel } from './charts.ts';

export const COV_LABELS = {
  classical: 'Classical OLS (Student)',
  HC3: 'Robust HC3 (asymptotic normal)',
  HAC: 'Newey-West HAC (asymptotic normal)',
} as const;

export function tip(text: string): string {
  return `<span class="tip" tabindex="0" role="note" aria-label="${h(text)}" data-tip="${h(text)}">?</span>`;
}

export function statCards(fit: FitOk, gross: GrossAlpha | null = null): string {
  const r = fit.result;
  const who = { BCV: 'of BCV', FUND: 'of the fund', RAIF: 'of the Raiffeisen fund', DIFF: 'of the difference' }[fit.asset];
  const z = r.distribution === 't' ? 't' : 'z';
  const mktIdx = r.names.indexOf('MKT');
  const card = (label: string, value: string, sub: string, help: string, cls = '') =>
    `<div class="card ${cls}"><div class="card-label">${label} ${tip(help)}</div><div class="card-value">${value}</div><div class="card-sub">${sub}</div></div>`;
  const sig = r.pvalue[0] < 0.05 ? 'sig' : '';
  return [
    card('Monthly α', pct(r.beta[0], 3), `95% CI [${pct(r.ciLow[0], 3)}; ${pct(r.ciHigh[0], 3)}]`,
      'Constant of the regression of monthly excess returns: average return not explained by the factors, in % per month.', sig),
    card(gross ? 'Annualised net α' : 'Annualised α', pct(12 * r.beta[0], 2), `= 12 × monthly α · CI [${pct(12 * r.ciLow[0], 2)}; ${pct(12 * r.ciHigh[0], 2)}]`,
      gross
        ? 'Alpha after management fees: fund returns are net of the fees embedded in the NAV. Arithmetic annualisation: 12 × monthly α.'
        : 'Arithmetic annualisation: 12 × monthly α (test statistics are unchanged).', sig),
    ...(gross
      ? [card('Annualised gross α', pct(12 * gross.gross, 2), `≈ net α + TER ${pct(gross.ter, 2)} · ${z} = ${num(gross.stat, 2)} · p = ${pval(gross.pvalue)} ${stars(gross.pvalue)}`,
          `Alpha before management fees: net α + published TER (${gross.terDate}). Adding TER/12 to each monthly return shifts the constant without changing the slopes or the standard error. Approximation: current TER assumed constant over the period; transaction costs, not included in the TER, remain deducted.`,
          gross.pvalue < 0.05 ? 'sig' : '')]
      : []),
    card(`${z}-stat (α)`, num(r.stat[0], 2), `two-sided p-value ${pval(r.pvalue[0])} ${stars(r.pvalue[0])}`,
      r.distribution === 't' ? `Student statistic with ${r.dfResid} degrees of freedom.` : 'z statistic (asymptotic normal inference, robust standard errors).', sig),
    card('Market β', mktIdx >= 0 ? num(r.beta[mktIdx], 3) : '—', mktIdx >= 0 ? `se ${num(r.se[mktIdx], 3)} · CI [${num(r.ciLow[mktIdx], 3)}; ${num(r.ciHigh[mktIdx], 3)}]` : '',
      `Sensitivity of the excess return ${who} to the market excess return.`),
    card('R² / adjusted R²', `${num(r.r2, 3)}`, `adjusted ${num(r.r2adj, 3)}`, `Share of the variance of excess returns ${who} explained by the model.`),
    card('Observations', String(r.n), `${fit.sample.dates[0]} → ${fit.sample.dates.at(-1)}`, 'Number of complete months used (all series available).'),
    card('Residual σ', pct(r.sigma, 2), `per month · ${pct(r.sigma * Math.sqrt(12), 1)} annualised (×√12)`,
      'Residual standard deviation s = √(SSR/(n−k)): monthly variability not explained by the factors.'),
  ].join('');
}

export function regressionTable(fit: FitOk): string {
  const r = fit.result;
  const z = r.distribution === 't' ? 't-stat' : 'z-stat';
  const lvl = Math.round(r.level * 100);
  const rows = r.names.map((name, i) => {
    const isConst = name === 'const';
    const f = (x: number) => (isConst ? num(x * 100, 4) : num(x, 4));
    const label = isConst ? 'α — constant (% per month)' : `${FACTOR_COEF[name as FactorId]} — ${coefLabel(name)}`;
    return `<tr${isConst ? ' class="row-alpha"' : ''}><th scope="row">${label}</th><td>${f(r.beta[i])}<sup>${stars(r.pvalue[i])}</sup></td><td>${f(r.se[i])}</td><td>${num(r.stat[i], 3)}</td><td>${pval(r.pvalue[i])}</td><td>[${f(r.ciLow[i])}; ${f(r.ciHigh[i])}]</td></tr>`;
  });
  const j = r.joint;
  const jointRow = j
    ? `<tr><th>${j.kind === 'F' ? 'F statistic' : 'Wald test (robust)'} ${tip(j.kind === 'F' ? 'Classical test that all slopes are jointly zero, F(k−1, n−k) distribution.' : 'Test that the slopes are jointly zero with the chosen robust covariance: W = b′V⁻¹b ~ χ²(k−1). A classical F statistic would not be valid under heteroskedasticity/autocorrelation.')}</th><td>${j.label} = ${num(j.stat, 3)}</td><th>p-value</th><td>${pval(j.pvalue)}</td></tr>`
    : '';
  const method = `${COV_LABELS[r.cov]}${r.cov === 'HAC' ? ` · ${r.hacLags} lags (Bartlett kernel)` : ''}`;
  return `
  <table class="reg">
    <caption>${h(ASSET_INFO[fit.asset].label)} · ${h(fit.label)} — dependent variable: R<sub>${ASSET_INFO[fit.asset].sub}</sub> − R<sub>f</sub> (SARON), monthly</caption>
    <thead><tr><th scope="col">Variable</th><th scope="col">Coefficient</th><th scope="col">Std. Error</th><th scope="col">${z}</th><th scope="col">p-value</th><th scope="col">${lvl}% CI</th></tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>
  <table class="reg-stats">
    <tbody>
      <tr><th>R²</th><td>${num(r.r2, 4)}</td><th>Adjusted R²</th><td>${num(r.r2adj, 4)}</td></tr>
      ${jointRow}
      <tr><th>N</th><td>${r.n}</td><th>Residual degrees of freedom</th><td>${r.dfResid}</td></tr>
      <tr><th>Residual standard deviation</th><td>${num(r.sigma * 100, 4)}% / month</td><th>Inference</th><td>${h(method)}</td></tr>
      <tr><th>Period</th><td>${fit.sample.dates[0]} → ${fit.sample.dates.at(-1)}</td><th>Critical value (${lvl}%)</th><td>${num(r.crit, 4)} (${r.distribution === 't' ? `Student, ${r.dfResid} df` : 'normal'})</td></tr>
    </tbody>
  </table>
  <p class="table-note">*** p &lt; 0.01 · ** p &lt; 0.05 · * p &lt; 0.1. The constant and its bounds are in % per month; annualised α = 12 × monthly α. Coefficients are identical whatever the inference method.</p>`;
}

export function testsTable(d: Diagnostics): string {
  const rows = d.tests
    .map((t) => {
      const reject = t.pvalue < 0.05;
      return `<tr><th scope="row">${h(t.name)}</th><td>${num(t.stat, 3)}</td><td>χ²(${t.df})</td><td>${pval(t.pvalue)}</td><td>${h(t.h0)}</td><td class="${reject ? 'reject' : 'accept'}">${reject ? 'H₀ rejected at 5%' : 'H₀ not rejected at 5%'}</td></tr>`;
    })
    .join('');
  return `<table class="reg"><thead><tr><th>Test</th><th>Statistic</th><th>Distribution under H₀</th><th>p-value</th><th>H₀</th><th>Conclusion</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="table-note">Skewness ${num(d.skewness, 3)} · kurtosis ${num(d.kurtosis, 3)} (normal: 0 and 3). Breusch-Pagan: Koenker’s studentised version (n·R² of the regression of e² on the regressors). The tests use the OLS residuals and do not depend on the chosen inference method.</p>`;
}

export function comparisonTable(cmp: Comparison): string {
  const rows: string[] = [];
  const groups = { SWISS: 'Swiss universe: SPI TR and Swiss JKP factors (CHF)', EUROPE: 'European Fama-French universe, converted to CHF (comparison)' } as const;
  for (const u of ['SWISS', 'EUROPE'] as const) {
    rows.push(`<tr class="group"><th colspan="9">${groups[u]}</th></tr>`);
    for (const m of MODEL_IDS) {
      const f = cmp.fits.find((x) => x.model === m && x.universe === u)!;
      const tag = u === 'SWISS' && m === 'CAPM' ? ' <span class="muted small">(Single Index)</span>' : '';
      if (!f.ok) {
        rows.push(`<tr><th scope="row">${MODEL_SHORT[m]}${tag}</th><td colspan="8" class="err">${h(f.error)}</td></tr>`);
        continue;
      }
      const r = f.result;
      rows.push(
        `<tr><th scope="row">${MODEL_SHORT[m]}${tag}</th><td>${pct(r.beta[0], 3)}<sup>${stars(r.pvalue[0])}</sup></td><td>${pct(12 * r.beta[0], 2)}</td><td>${num(r.stat[0], 2)}</td><td>${pval(r.pvalue[0])}</td><td>${num(r.beta[1], 3)}</td><td>${num(r.r2, 3)}</td><td>${num(r.r2adj, 3)}</td><td>${r.n}</td></tr>`,
      );
    }
  }
  return `<table class="reg"><thead><tr><th>Model</th><th>Monthly α</th><th>Annualised α</th><th>stat(α)</th><th>p(α)</th><th>Market β</th><th>R²</th><th>Adjusted R²</th><th>N</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

export function sourcesTable(ds: Dataset): string {
  const st = { ok: 'OK', error: 'ERROR', manual: 'manual' } as const;
  const rows = ds.sources
    .map(
      (s) =>
        `<tr><th scope="row">${h(s.name)}<div class="muted small">${h(s.provider)}${s.url ? ` · <a href="${h(s.url)}" target="_blank" rel="noopener">source</a>` : ''}</div></th>` +
        `<td><span class="status status-${s.status}">${st[s.status]}</span></td><td>${s.coverage ? h(s.coverage.join(' → ')) : '—'}</td>` +
        `<td class="small">${h(s.message ?? '')}${s.license ? `<div class="muted">${h(s.license)}</div>` : ''}</td></tr>`,
    )
    .join('');
  const checks = ds.checks
    .map((c) => `<li class="check check-${c.status}"><span class="status status-${c.status}">${c.status}</span> ${h(c.message)}</li>`)
    .join('');
  return `<table class="reg sources"><thead><tr><th>Series</th><th>Status</th><th>Coverage</th><th>Details and licence</th></tr></thead><tbody>${rows}</tbody></table>
  ${checks ? `<h3>Automatic pipeline checks</h3><ul class="checks">${checks}</ul>` : ''}
  ${(ds.notes ?? []).map((n) => `<p class="muted small">${h(n)}</p>`).join('')}`;
}

// ------------------------------------------------------------------ comparer deux actifs

export function perfTable(cmp: AssetComparison): string {
  const rows = cmp.perf
    .map(
      (p) =>
        `<tr><th scope="row">${h(p.label)}</th><td>${num(p.path[p.path.length - 1], 0)} CHF</td><td>${pct(p.annReturn, 2)}</td><td>${p.key === 'rf' ? '—' : pct(p.annVol, 1)}</td><td>${p.key === 'rf' ? '—' : pct(p.maxDrawdown, 1)}</td></tr>`,
    )
    .join('');
  return `<table class="reg"><thead><tr><th>Series (total return)</th><th>Final value of CHF 100</th><th>Annualised return</th><th>Annualised volatility</th><th>Maximum drawdown (month-end)</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="table-note">Same ${cmp.dates.length} months for all series (${cmp.dates[0]} → ${cmp.dates[cmp.dates.length - 1]}). Geometric annualised return; volatility = monthly standard deviation × √12; maximum drawdown measured on month-end values (intra-month losses can be larger).</p>`;
}

function cell(f: Fit, fn: (r: FitOk['result']) => string): string {
  return f.ok ? fn(f.result) : `<span class="err">${h(f.error)}</span>`;
}

export function alphaPairTable(m: AssetComparison['models'][number], pair: AssetComparison['pair'], fees: [FeeInfo | null, FeeInfo | null] = [null, null]): string {
  const { a, b, diff } = m;
  const terA = fees[0]?.ter ?? 0;
  const terB = fees[1]?.ter ?? 0;
  const grossCell = (f: Fit, ter: number, fee: FeeInfo | null) => {
    if (!f.ok) return '';
    if (!fee) return '<span class="muted small">no management fee</span>';
    const g = shiftAlpha(f, ter / 12);
    return `${pct(12 * g.alpha, 2)}<sup>${stars(g.pvalue)}</sup><br><span class="muted small">TER ${pct(ter, 2)} · p = ${pval(g.pvalue)}</span>`;
  };
  let grossRow = '';
  if (fees[0] || fees[1]) {
    const gd = diff.ok ? shiftAlpha(diff, (terA - terB) / 12) : null;
    grossRow = `<tr class="row-alpha"><th scope="row">Annualised gross α (≈ net + TER) ${tip('Alpha before management fees: net alpha + current published TER, assumed constant over the period. Slopes and standard errors do not change; transaction costs remain deducted. For the gap, the shift is the difference in TERs.')}</th><td>${grossCell(a, terA, fees[0])}</td><td>${grossCell(b, terB, fees[1])}</td><td>${gd ? `${pct(12 * gd.alpha, 2)}<br><span class="muted small">p = ${pval(gd.pvalue)}</span>` : ''}</td></tr>`;
  }
  const [na, nb] = [ASSET_INFO[pair[0]].short, ASSET_INFO[pair[1]].short];
  const z = a.ok && a.result.distribution === 't' ? 't' : 'z';
  const row = (label: string, fn: (r: FitOk['result']) => string, d?: string) =>
    `<tr><th scope="row">${label}</th><td>${cell(a, fn)}</td><td>${cell(b, fn)}</td><td>${d ?? ''}</td></tr>`;
  const dRow = diff.ok
    ? `${pct(12 * diff.result.beta[0], 2)}<br><span class="muted small">${z} = ${num(diff.result.stat[0], 2)} · p = ${pval(diff.result.pvalue[0])}</span>`
    : '';
  return `<table class="reg pair"><thead><tr><th>Indicator — ${h(MODEL_SHORT[m.model])}</th><th>${h(na)}</th><th>${h(nb)}</th><th>Gap (A − B) ${tip("Regression of the return of A minus that of B on the same factors: its alpha is exactly α_A − α_B, and its standard error accounts for the correlation between the two assets.")}</th></tr></thead><tbody>
    ${row(fees[0] || fees[1] ? 'Annualised net α (12 × monthly)' : 'Annualised α (12 × monthly)', (r) => `${pct(12 * r.beta[0], 2)}<sup>${stars(r.pvalue[0])}</sup>`, dRow)}
    ${grossRow}
    ${row('95% CI of annualised α', (r) => `[${pct(12 * r.ciLow[0], 1)}; ${pct(12 * r.ciHigh[0], 1)}]`, diff.ok ? `[${pct(12 * diff.result.ciLow[0], 1)}; ${pct(12 * diff.result.ciHigh[0], 1)}]` : '')}
    ${row(`${z}-stat of α`, (r) => num(r.stat[0], 2))}
    ${row('p-value of α', (r) => pval(r.pvalue[0]))}
    ${row('Market β', (r) => `${num(r.beta[1], 3)} <span class="muted small">[${num(r.ciLow[1], 2)}; ${num(r.ciHigh[1], 2)}]</span>`, diff.ok ? num(diff.result.beta[1], 3) : '')}
    ${row('R²', (r) => num(r.r2, 3))}
    ${row('Annualised residual volatility', (r) => pct(r.sigma * Math.sqrt(12), 1))}
    ${row('N (months)', (r) => String(r.n))}
  </tbody></table>`;
}

export function multiFactorPairTable(cmp: AssetComparison): string {
  const [na, nb] = [ASSET_INFO[cmp.pair[0]].short, ASSET_INFO[cmp.pair[1]].short];
  const rows = cmp.models
    .map(({ model, a: bcv, b: fund, diff }) => {
      const a = (f: Fit) => (f.ok ? `${pct(12 * f.result.beta[0], 2)}<sup>${stars(f.result.pvalue[0])}</sup> <span class="muted small">p = ${pval(f.result.pvalue[0])}</span>` : `<span class="err">${h(f.error)}</span>`);
      return `<tr><th scope="row">${h(MODEL_SHORT[model])}</th><td>${a(bcv)}</td><td>${a(fund)}</td><td>${a(diff)}</td><td>${bcv.ok ? num(bcv.result.r2, 3) : '—'} / ${fund.ok ? num(fund.result.r2, 3) : '—'}</td></tr>`;
    })
    .join('');
  return `<table class="reg"><thead><tr><th>Model</th><th>α ${h(na)}</th><th>α ${h(nb)}</th><th>Gap (A − B)</th><th>R² A / B</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="table-note">Annualised α (12 × monthly). *** p &lt; 0.01 · ** p &lt; 0.05 · * p &lt; 0.1. All estimates use exactly the same months.</p>`;
}

/** Encadré « Frais » sous le tableau de régression d'un fonds. */
export function feesBlock(fit: FitOk, gross: GrossAlpha): string {
  const r = fit.result;
  const z = r.distribution === 't' ? 't' : 'z';
  const verdict = (p: number) => (p < 0.05 ? 'significant at 5%' : 'not significant at 5%');
  return `<div class="fees">
    <h3>Fees: net alpha and gross alpha</h3>
    <table class="reg"><thead><tr><th></th><th>Annualised α</th><th>95% CI</th><th>${z}-stat</th><th>p-value</th></tr></thead><tbody>
      <tr><th scope="row">Net α (after management fees)</th><td>${pct(12 * r.beta[0], 2)}<sup>${stars(r.pvalue[0])}</sup></td><td>[${pct(12 * r.ciLow[0], 2)}; ${pct(12 * r.ciHigh[0], 2)}]</td><td>${num(r.stat[0], 2)}</td><td>${pval(r.pvalue[0])}</td></tr>
      <tr><th scope="row">+ published TER (${h(gross.terDate)})</th><td>${pct(gross.ter, 2)}</td><td colspan="3" class="muted small">${h(gross.source)}</td></tr>
      <tr class="row-alpha"><th scope="row">≈ gross α (before management fees)</th><td>${pct(12 * gross.gross, 2)}<sup>${stars(gross.pvalue)}</sup></td><td>[${pct(12 * gross.ciLow, 2)}; ${pct(12 * gross.ciHigh, 2)}]</td><td>${num(gross.stat, 2)}</td><td>${pval(gross.pvalue)}</td></tr>
    </tbody></table>
    <p class="table-note">The net α measures what unitholders earned beyond the factors; the gross α, ${verdict(gross.pvalue)}, approximates what the management produced before its fees. Adding TER/12 to each monthly return shifts the constant by TER/12 without changing the slopes or the standard error: testing the gross α amounts to testing α<sub>net</sub> = −TER/12. Limits: only the current TER is known (fees assumed constant over the period); transaction costs are not part of the TER and remain deducted.</p>
  </div>`;
}
