/** Rendu HTML des cartes, tableaux économétriques et tableaux de tests. */

import type { FitOk, Comparison, Diagnostics } from './analysis.ts';
import type { Dataset } from '../data/types.ts';
import { FACTOR_COEF, MODEL_IDS, MODEL_SHORT, type FactorId } from '../engine/models.ts';
import { escapeHtml as h, num, pct, pval, stars } from './format.ts';
import { coefLabel } from './charts.ts';

export const COV_LABELS = {
  classical: 'OLS classique (Student)',
  HC3: 'Robuste HC3 (asymptotique normale)',
  HAC: 'Newey-West HAC (asymptotique normale)',
} as const;

export function tip(text: string): string {
  return `<span class="tip" tabindex="0" role="note" aria-label="${h(text)}" data-tip="${h(text)}">?</span>`;
}

export function statCards(fit: FitOk): string {
  const r = fit.result;
  const z = r.distribution === 't' ? 't' : 'z';
  const mktIdx = r.names.indexOf('MKT');
  const card = (label: string, value: string, sub: string, help: string, cls = '') =>
    `<div class="card ${cls}"><div class="card-label">${label} ${tip(help)}</div><div class="card-value">${value}</div><div class="card-sub">${sub}</div></div>`;
  const sig = r.pvalue[0] < 0.05 ? 'sig' : '';
  return [
    card('α mensuel', pct(r.beta[0], 3), `IC 95 % [${pct(r.ciLow[0], 3)} ; ${pct(r.ciHigh[0], 3)}]`,
      'Constante de la régression des rendements excédentaires mensuels : rendement moyen non expliqué par les facteurs, en % par mois.', sig),
    card('α annualisé', pct(12 * r.beta[0], 2), `= 12 × α mensuel · IC [${pct(12 * r.ciLow[0], 2)} ; ${pct(12 * r.ciHigh[0], 2)}]`,
      'Annualisation arithmétique : 12 × α mensuel (les statistiques de test sont inchangées).', sig),
    card(`${z}-stat (α)`, num(r.stat[0], 2), `p-value bilatérale ${pval(r.pvalue[0])} ${stars(r.pvalue[0])}`,
      r.distribution === 't' ? `Statistique de Student à ${r.dfResid} degrés de liberté.` : 'Statistique z (inférence asymptotique normale, erreurs standards robustes).', sig),
    card('β marché', mktIdx >= 0 ? num(r.beta[mktIdx], 3) : '—', mktIdx >= 0 ? `se ${num(r.se[mktIdx], 3)} · IC [${num(r.ciLow[mktIdx], 3)} ; ${num(r.ciHigh[mktIdx], 3)}]` : '',
      'Sensibilité du rendement excédentaire de BCV au rendement excédentaire du marché.'),
    card('R² / R² ajusté', `${num(r.r2, 3)}`, `ajusté ${num(r.r2adj, 3)}`, 'Part de la variance des rendements excédentaires de BCV expliquée par le modèle.'),
    card('Observations', String(r.n), `${fit.sample.dates[0]} → ${fit.sample.dates.at(-1)}`, 'Nombre de mois complets utilisés (toutes séries disponibles).'),
    card('σ résidus', pct(r.sigma, 2), `par mois · ${pct(r.sigma * Math.sqrt(12), 1)} annualisé (×√12)`,
      'Écart-type des résidus s = √(SSR/(n−k)) : risque idiosyncratique mensuel.'),
  ].join('');
}

export function regressionTable(fit: FitOk): string {
  const r = fit.result;
  const z = r.distribution === 't' ? 't-stat' : 'z-stat';
  const lvl = Math.round(r.level * 100);
  const rows = r.names.map((name, i) => {
    const isConst = name === 'const';
    const f = (x: number) => (isConst ? num(x * 100, 4) : num(x, 4));
    const label = isConst ? 'α — constante (% par mois)' : `${FACTOR_COEF[name as FactorId]} — ${coefLabel(name)}`;
    return `<tr${isConst ? ' class="row-alpha"' : ''}><th scope="row">${label}</th><td>${f(r.beta[i])}<sup>${stars(r.pvalue[i])}</sup></td><td>${f(r.se[i])}</td><td>${num(r.stat[i], 3)}</td><td>${pval(r.pvalue[i])}</td><td>[${f(r.ciLow[i])} ; ${f(r.ciHigh[i])}]</td></tr>`;
  });
  const j = r.joint;
  const jointRow = j
    ? `<tr><th>${j.kind === 'F' ? 'Statistique F' : 'Test de Wald (robuste)'} ${tip(j.kind === 'F' ? 'Test classique de nullité jointe de toutes les pentes, loi F(k−1, n−k).' : 'Test de nullité jointe des pentes avec la covariance robuste choisie : W = b′V⁻¹b ~ χ²(k−1). Une statistique F classique ne serait pas valide sous hétéroscédasticité/autocorrélation.')}</th><td>${j.label} = ${num(j.stat, 3)}</td><th>p-value</th><td>${pval(j.pvalue)}</td></tr>`
    : '';
  const method = `${COV_LABELS[r.cov]}${r.cov === 'HAC' ? ` · ${r.hacLags} retards (noyau de Bartlett)` : ''}`;
  return `
  <table class="reg">
    <caption>${h(fit.label)} — variable dépendante : R<sub>BCV</sub> − R<sub>f</sub> (SARON), mensuel</caption>
    <thead><tr><th scope="col">Variable</th><th scope="col">Coefficient</th><th scope="col">Std. Error</th><th scope="col">${z}</th><th scope="col">p-value</th><th scope="col">IC ${lvl} %</th></tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>
  <table class="reg-stats">
    <tbody>
      <tr><th>R²</th><td>${num(r.r2, 4)}</td><th>R² ajusté</th><td>${num(r.r2adj, 4)}</td></tr>
      ${jointRow}
      <tr><th>N</th><td>${r.n}</td><th>Degrés de liberté résiduels</th><td>${r.dfResid}</td></tr>
      <tr><th>Écart-type des résidus</th><td>${num(r.sigma * 100, 4)} % / mois</td><th>Inférence</th><td>${h(method)}</td></tr>
      <tr><th>Période</th><td>${fit.sample.dates[0]} → ${fit.sample.dates.at(-1)}</td><th>Valeur critique (${lvl} %)</th><td>${num(r.crit, 4)} (${r.distribution === 't' ? `Student, ${r.dfResid} ddl` : 'normale'})</td></tr>
    </tbody>
  </table>
  <p class="table-note">*** p &lt; 0,01 · ** p &lt; 0,05 · * p &lt; 0,1. La constante et ses bornes sont exprimées en % par mois ; α annualisé = 12 × α mensuel. Les coefficients sont identiques quelle que soit la méthode d’inférence.</p>`;
}

export function testsTable(d: Diagnostics): string {
  const rows = d.tests
    .map((t) => {
      const reject = t.pvalue < 0.05;
      return `<tr><th scope="row">${h(t.name)}</th><td>${num(t.stat, 3)}</td><td>χ²(${t.df})</td><td>${pval(t.pvalue)}</td><td>${h(t.h0)}</td><td class="${reject ? 'reject' : 'accept'}">${reject ? 'H₀ rejetée à 5 %' : 'H₀ non rejetée à 5 %'}</td></tr>`;
    })
    .join('');
  return `<table class="reg"><thead><tr><th>Test</th><th>Statistique</th><th>Loi sous H₀</th><th>p-value</th><th>H₀</th><th>Conclusion</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="table-note">Asymétrie ${num(d.skewness, 3)} · kurtosis ${num(d.kurtosis, 3)} (normale : 0 et 3). Breusch-Pagan : version studentisée de Koenker (n·R² de la régression de e² sur les régresseurs). Les tests portent sur les résidus OLS et ne dépendent pas de la méthode d’inférence choisie.</p>`;
}

export function comparisonTable(cmp: Comparison): string {
  const rows: string[] = [];
  for (const u of ['SPI', 'EUROPE'] as const) {
    rows.push(`<tr class="group"><th colspan="9">${u === 'SPI' ? 'Marché : SPI Total Return (CHF)' : 'Marché : Europe Fama-French converti en CHF'}</th></tr>`);
    for (const m of MODEL_IDS) {
      const f = cmp.fits.find((x) => x.model === m && x.universe === u)!;
      const tag = f.ok && f.coherence === 'hybrid' ? ' <span class="badge hybrid">hybride</span>' : '';
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
  return `<table class="reg"><thead><tr><th>Modèle</th><th>α mensuel</th><th>α annualisé</th><th>stat(α)</th><th>p(α)</th><th>β marché</th><th>R²</th><th>R² ajusté</th><th>N</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

export function sourcesTable(ds: Dataset): string {
  const st = { ok: 'OK', error: 'ERREUR', manual: 'manuel' } as const;
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
  return `<table class="reg sources"><thead><tr><th>Série</th><th>Statut</th><th>Couverture</th><th>Détails et licence</th></tr></thead><tbody>${rows}</tbody></table>
  ${checks ? `<h3>Contrôles automatiques du pipeline</h3><ul class="checks">${checks}</ul>` : ''}
  ${(ds.notes ?? []).map((n) => `<p class="muted small">${h(n)}</p>`).join('')}`;
}
