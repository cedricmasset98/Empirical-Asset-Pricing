/**
 * Tests du moteur statistique.
 * Exécution : npm test  (node --experimental-strip-types --test tests/)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { chi2Sf, fSf, normCdf, normPpf, tCritTwoSided, tTwoSidedP } from '../src/engine/distributions.ts';
import { ols, neweyWestAutoLags, InsufficientDataError, type CovType } from '../src/engine/ols.ts';
import { SingularMatrixError } from '../src/engine/linalg.ts';
import { acf, breuschPagan, jarqueBera, ljungBox } from '../src/engine/diagnostics.ts';
import { buildSample, commonDates, type AssetId, type ModelId, type Universe } from '../src/engine/models.ts';
import { rollingOLS } from '../src/engine/rolling.ts';
import type { Dataset } from '../src/data/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const load = (p: string) => JSON.parse(readFileSync(join(here, p), 'utf8'));

function close(actual: number, expected: number, rel = 1e-9, abs = 1e-12, msg = '') {
  const tol = Math.max(abs, rel * Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= tol, `${msg} attendu ${expected}, obtenu ${actual} (écart ${Math.abs(actual - expected)})`);
}

// ---------------------------------------------------------------- lois

test('lois de probabilité = scipy.stats', () => {
  const ref = load('fixtures/distributions_reference.json');
  for (const [t, df, p] of ref.t_two_sided) close(tTwoSidedP(t, df), p, 1e-10, 1e-15, `t(${t},${df})`);
  for (const [a, df, c] of ref.t_crit) close(tCritTwoSided(a, df), c, 1e-10, 0, `tcrit(${a},${df})`);
  for (const [x, p] of ref.norm_cdf) close(normCdf(x), p, 1e-10, 1e-16, `Φ(${x})`);
  for (const [p, x] of ref.norm_ppf) close(normPpf(p), x, 1e-10, 1e-14, `Φ⁻¹(${p})`);
  for (const [f, d1, d2, p] of ref.f_sf) close(fSf(f, d1, d2), p, 1e-10, 1e-16, `F(${f},${d1},${d2})`);
  for (const [x, k, p] of ref.chi2_sf) close(chi2Sf(x, k), p, 1e-10, 1e-16, `χ²(${x},${k})`);
});

// ---------------------------------------------------------------- OLS de base

test('ajustement exact : y = 2 + 3x', () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8];
  const y = xs.map((v) => 2 + 3 * v);
  const r = ols(y, xs.map((v) => [1, v]), ['const', 'x'], { cov: 'classical' });
  close(r.beta[0], 2, 1e-12, 1e-12);
  close(r.beta[1], 3, 1e-12, 1e-12);
  close(r.r2, 1, 0, 1e-12);
});

test('colinéarité parfaite détectée', () => {
  const x = [1, 2, 3, 4, 5].map((v) => [1, v, 2 * v]);
  assert.throws(() => ols([1, 2, 3, 4, 6], x, ['c', 'a', 'b'], { cov: 'classical' }), SingularMatrixError);
});

test('observations insuffisantes signalées', () => {
  assert.throws(() => ols([1, 2], [[1, 1], [1, 2]], ['c', 'x'], { cov: 'classical' }), InsufficientDataError);
});

test('valeurs manquantes refusées (pas d’imputation silencieuse)', () => {
  assert.throws(() => ols([1, NaN, 3, 4], [[1, 1], [1, 2], [1, 3], [1, 5]], ['c', 'x'], { cov: 'classical' }));
});

test('règle automatique de Newey-West', () => {
  assert.equal(neweyWestAutoLags(100), 4);
  assert.equal(neweyWestAutoLags(240), 4);
  assert.equal(neweyWestAutoLags(60), 3);
  assert.equal(neweyWestAutoLags(36), 3);
  assert.equal(neweyWestAutoLags(1000), 6);
});

// ---------------------------------------------------------------- jeu synthétique vs numpy

const ds = load('fixtures/synthetic_dataset.json') as Dataset;
const numpyRef = load('fixtures/numpy_reference.json');
const FULL = { start: '0000-01', end: '9999-12' };

const SPECS: Record<string, [ModelId, Universe, AssetId?]> = {
  CAPM_SPI: ['CAPM', 'SPI'],
  FF3_SPI: ['FF3', 'SPI'],
  CARHART_EUROPE: ['CARHART', 'EUROPE'],
  FF5_EUROPE: ['FF5', 'EUROPE'],
  FUND_FF3_SPI: ['FF3', 'SPI', 'FUND'],
};

for (const [key, [model, universe, asset]] of Object.entries(SPECS)) {
  test(`${key} : coefficients, erreurs standards, tests = numpy/scipy`, () => {
    const ref = numpyRef[key];
    const s = buildSample(ds, model, universe, FULL, undefined, asset);
    assert.equal(s.y.length, ref.n);
    assert.equal(s.dates[0], ref.first_date);
    assert.equal(s.dates.at(-1), ref.last_date);
    const variants: [string, CovType, boolean][] = [
      ['classical', 'classical', false],
      ['HC3', 'HC3', false],
      ['HAC', 'HAC', false],
      ['HAC_corrected', 'HAC', true],
    ];
    const betas: number[][] = [];
    for (const [refKey, cov, corr] of variants) {
      const r = ols(s.y, s.x, s.names, { cov, hacLags: cov === 'HAC' ? ref.hac_lags : undefined, hacSmallSampleCorrection: corr });
      const rr = ref[refKey];
      betas.push(r.beta);
      r.beta.forEach((b: number, i: number) => close(b, ref.beta[i], 1e-9, 1e-14, `${refKey} β${i}`));
      r.se.forEach((v: number, i: number) => close(v, rr.se[i], 1e-9, 1e-15, `${refKey} se${i}`));
      r.stat.forEach((v: number, i: number) => close(v, rr.stat[i], 1e-8, 1e-10, `${refKey} t${i}`));
      r.pvalue.forEach((v: number, i: number) => close(v, rr.pvalue[i], 1e-7, 1e-14, `${refKey} p${i}`));
      r.ciLow.forEach((v: number, i: number) => close(v, rr.ci_low[i], 1e-9, 1e-14, `${refKey} ciL${i}`));
      r.ciHigh.forEach((v: number, i: number) => close(v, rr.ci_high[i], 1e-9, 1e-14, `${refKey} ciH${i}`));
      close(r.joint!.stat, rr.joint.stat, 1e-8, 1e-12, `${refKey} joint`);
      close(r.joint!.pvalue, rr.joint.pvalue, 1e-7, 1e-15, `${refKey} joint p`);
      close(r.r2, ref.r2, 1e-10);
      close(r.r2adj, ref.r2adj, 1e-10);
      close(r.sigma, ref.sigma, 1e-10);
    }
    // invariance des coefficients à la méthode d'inférence (égalité stricte)
    for (const b of betas.slice(1)) assert.deepEqual(b, betas[0]);
  });

  test(`${key} : diagnostics des résidus = numpy/scipy`, () => {
    const ref = numpyRef[key].diagnostics;
    const s = buildSample(ds, model, universe, FULL, undefined, asset);
    const r = ols(s.y, s.x, s.names, { cov: 'classical' });
    acf(r.resid, 12).forEach((v, i) => close(v, ref.acf[i], 1e-9, 1e-13, `acf${i + 1}`));
    const lb = ljungBox(r.resid, 12);
    close(lb.stat, ref.ljung_box.stat, 1e-9);
    close(lb.pvalue, ref.ljung_box.pvalue, 1e-7, 1e-15);
    const bp = breuschPagan(r.resid, s.x);
    close(bp.stat, ref.breusch_pagan.stat, 1e-8);
    close(bp.pvalue, ref.breusch_pagan.pvalue, 1e-7, 1e-15);
    const jb = jarqueBera(r.resid);
    close(jb.stat, ref.jarque_bera.stat, 1e-8);
    close(jb.pvalue, ref.jarque_bera.pvalue, 1e-7, 1e-15);
    close(jb.skewness, ref.jarque_bera.skewness, 1e-8);
    close(jb.kurtosis, ref.jarque_bera.kurtosis, 1e-9);
  });
}

// ---------------------------------------------------------------- échantillons

test('différence action − fonds : α_DIFF = α_BCV − α_fonds sur les mêmes dates', () => {
  const specs = [{ model: 'CARHART' as ModelId, universe: 'EUROPE' as Universe, asset: 'BCV' as AssetId }, { model: 'CARHART' as ModelId, universe: 'EUROPE' as Universe, asset: 'FUND' as AssetId }];
  const pair = commonDates(ds, specs, FULL);
  const fit = (a: AssetId) => {
    const s = buildSample(ds, 'CARHART', 'EUROPE', FULL, pair, a);
    return ols(s.y, s.x, s.names, { cov: 'HAC' });
  };
  const b = fit('BCV');
  const f = fit('FUND');
  const d = fit('DIFF');
  assert.equal(b.n, f.n);
  assert.equal(d.n, b.n);
  d.beta.forEach((v, i) => close(v, b.beta[i] - f.beta[i], 1e-10, 1e-14, `coef ${i}`));
});

test('fonds : mois manquants exclus et colonne du fonds utilisée', () => {
  const s = buildSample(ds, 'CAPM', 'SPI', FULL, undefined, 'FUND');
  assert.equal(s.dates[0], ds.dates[6]);
  const rf = ds.data.rf_saron![10]!;
  close(s.y[4], ds.data.fund_ret![10]! - rf, 0, 1e-15);
});

test('échantillon commun : mêmes dates pour tous les modèles', () => {
  const specs = Object.values(SPECS).filter((x) => !x[2]).map(([model, universe]) => ({ model, universe }));
  const common = commonDates(ds, specs, FULL);
  assert.equal(common.size, 240 - 18 - 2);
  const ns = specs.map((s) => buildSample(ds, s.model, s.universe, FULL, common).y.length);
  assert.ok(ns.every((n) => n === common.size));
});

test('les ruptures de continuité sont signalées', () => {
  const s = buildSample(ds, 'CARHART', 'EUROPE', FULL);
  assert.equal(s.gaps.length, 1);
  assert.equal(s.gaps[0].missing, 2);
  assert.equal(s.droppedMonths, 2);
});

test('rendements excédentaires : Rf soustrait à BCV et au marché, pas aux facteurs long-short', () => {
  const s = buildSample(ds, 'FF3', 'SPI', FULL);
  const i = 10;
  const rf = ds.data.rf_saron![i]!;
  close(s.y[i], ds.data.bcv_ret![i]! - rf, 0, 1e-15);
  close(s.x[i][1], ds.data.spi_ret![i]! - rf, 0, 1e-15);
  assert.equal(s.x[i][2], ds.data.smb3_chf![i]);
});

test('plage de dates respectée', () => {
  const s = buildSample(ds, 'CAPM', 'SPI', { start: '2010-01', end: '2012-12' });
  assert.equal(s.dates[0], '2010-01');
  assert.equal(s.dates.at(-1), '2012-12');
  assert.equal(s.y.length, 36);
});

test('régression mobile : dernière fenêtre = régression directe', () => {
  const s = buildSample(ds, 'CAPM', 'SPI', FULL);
  const roll = rollingOLS(s.dates, s.y, s.x, s.names, 60, { cov: 'HAC' });
  assert.equal(roll.dates.length, s.y.length - 60 + 1);
  const direct = ols(s.y.slice(-60), s.x.slice(-60), s.names, { cov: 'HAC' });
  close(roll.beta[1].at(-1)!, direct.beta[1], 1e-12);
  close(roll.low[0].at(-1)!, direct.ciLow[0], 1e-12);
  assert.equal(roll.hacLags.at(-1), neweyWestAutoLags(60));
});
