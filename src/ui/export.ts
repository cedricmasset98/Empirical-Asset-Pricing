/** Exports CSV (séparateur virgule, point décimal, valeurs non arrondies). */

import type { FitOk, Comparison } from './analysis.ts';
import { MODEL_SHORT } from '../engine/models.ts';

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

export function download(filename: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob(['﻿' + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function regressionCsv(fit: FitOk): string {
  const r = fit.result;
  const rows: unknown[][] = [
    ['# modele', fit.label],
    ['# variable dependante', fit.asset === 'FUND' ? 'R_fonds - R_f (SARON), rendements mensuels decimaux' : 'R_BCV - R_f (SARON), rendements mensuels decimaux'],
    ['# inference', r.cov + (r.cov === 'HAC' ? ` (lags=${r.hacLags})` : ''), 'loi', r.distribution],
    ['# periode', fit.sample.dates[0], fit.sample.dates.at(-1)],
    ['variable', 'coefficient', 'std_error', r.distribution === 't' ? 't_stat' : 'z_stat', 'p_value', `ci${Math.round(r.level * 100)}_low`, `ci${Math.round(r.level * 100)}_high`],
    ...r.names.map((n, i) => [n, r.beta[i], r.se[i], r.stat[i], r.pvalue[i], r.ciLow[i], r.ciHigh[i]]),
    [],
    ['alpha_annualise_x12', 12 * r.beta[0]],
    ['r2', r.r2],
    ['r2_ajuste', r.r2adj],
    [r.joint?.kind === 'F' ? 'f_stat' : 'wald_chi2', r.joint?.stat, 'p_value', r.joint?.pvalue, 'df', r.joint?.df1, r.joint?.df2 ?? ''],
    ['n', r.n],
    ['sigma_residus', r.sigma],
  ];
  return toCsv(rows);
}

export function sampleCsv(fit: FitOk): string {
  const r = fit.result;
  const header = ['date', fit.asset === 'FUND' ? 'y_excess_fund' : 'y_excess_bcv', ...r.names.slice(1).map((n) => `x_${n}`), 'fitted', 'residual'];
  return toCsv([header, ...fit.sample.dates.map((d, t) => [d, fit.sample.y[t], ...fit.sample.x[t].slice(1), r.fitted[t], r.resid[t]])]);
}

export function comparisonCsv(cmp: Comparison): string {
  const rows: unknown[][] = [
    ['# echantillon commun', cmp.commonN, cmp.period?.[0] ?? '', cmp.period?.[1] ?? ''],
    ['marche', 'modele', 'coherence', 'alpha_mensuel', 'alpha_annualise_x12', 'stat_alpha', 'p_alpha', 'beta_marche', 'r2', 'r2_ajuste', 'n', 'erreur'],
  ];
  for (const f of cmp.fits) {
    if (f.ok) {
      const r = f.result;
      rows.push([f.universe, MODEL_SHORT[f.model], f.coherence, r.beta[0], 12 * r.beta[0], r.stat[0], r.pvalue[0], r.beta[1], r.r2, r.r2adj, r.n, '']);
    } else rows.push([f.universe, MODEL_SHORT[f.model], '', '', '', '', '', '', '', '', '', f.error]);
  }
  return toCsv(rows);
}

export function assetComparisonCsv(cmp: import('./analysis.ts').AssetComparison): string {
  const rows: unknown[][] = [['# echantillon commun action/fonds', cmp.dates.length, cmp.dates[0], cmp.dates[cmp.dates.length - 1], 'marche', cmp.universe]];
  rows.push(['serie', 'valeur_finale_100', 'rendement_annualise', 'volatilite_annualisee', 'perte_maximale']);
  for (const p of cmp.perf) rows.push([p.label, p.path[p.path.length - 1], p.annReturn, p.annVol, p.maxDrawdown]);
  rows.push([]);
  rows.push(['modele', 'actif', 'alpha_mensuel', 'alpha_annualise_x12', 'ci_low_mensuel', 'ci_high_mensuel', 'stat_alpha', 'p_alpha', 'beta_marche', 'r2', 'sigma_residus_mensuel', 'n', 'erreur']);
  for (const m of cmp.models) {
    for (const [k, f] of [['action', m.bcv], ['fonds', m.fund], ['action_moins_fonds', m.diff]] as const) {
      if (f.ok) {
        const r = f.result;
        rows.push([m.model, k, r.beta[0], 12 * r.beta[0], r.ciLow[0], r.ciHigh[0], r.stat[0], r.pvalue[0], r.beta[1], r.r2, r.sigma, r.n, '']);
      } else rows.push([m.model, k, '', '', '', '', '', '', '', '', '', '', f.error]);
    }
  }
  return toCsv(rows);
}
