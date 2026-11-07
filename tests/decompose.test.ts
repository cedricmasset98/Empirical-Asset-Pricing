/** Contributions factorielles et régressions partielles (Frisch-Waugh-Lovell). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { fitModel, type FitOk, type Settings } from '../src/ui/analysis.ts';
import { decompose, partialRegression, partialRegressions } from '../src/engine/decompose.ts';
import type { Dataset } from '../src/data/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ds = JSON.parse(readFileSync(join(here, 'fixtures', 'synthetic_dataset.json'), 'utf8')) as Dataset;
const st: Settings = { asset: 'BCV', range: { start: ds.dates[0], end: ds.dates.at(-1)! }, model: 'FF5', universe: 'SWISS', cov: 'HAC', hacLags: null, window: 60 };

function fit(model: Settings['model'], universe: Settings['universe'], cov: Settings['cov'] = 'HAC', asset: Settings['asset'] = 'BCV'): FitOk {
  const f = fitModel(ds, model, universe, { ...st, cov, asset });
  if (!f.ok) throw new Error(f.error);
  return f;
}

const close = (a: number, b: number, tol = 1e-10) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

test('rendement moyen = α + Σ β_j x̄_j, variance expliquée Σ = R²', () => {
  for (const [model, universe] of [['FF5', 'SWISS'], ['CARHART', 'EUROPE'], ['FF3', 'SWISS'], ['CAPM', 'EUROPE']] as const) {
    for (const asset of ['BCV', 'FUND', 'RAIF'] as const) {
      const f = fit(model, universe, 'HAC', asset);
      const d = decompose(f.sample.y, f.sample.x, f.result);
      close(d.mean.reduce((s, c) => s + c.value, 0), d.meanY);
      close(d.mean[0].value, f.result.beta[0]);
      close(d.variance.reduce((s, c) => s + c.value, 0), f.result.r2);
      assert.equal(d.variance.length, f.sample.factors.length);
    }
  }
});

test('régression partielle : pente = β_j, résidus = résidus du modèle complet', () => {
  const f = fit('FF5', 'SWISS');
  const parts = partialRegressions(f.sample.y, f.sample.x, f.result);
  assert.deepEqual(parts.map((p) => p.name), ['MKT', 'SMB', 'HML', 'RMW', 'CMA']);
  parts.forEach((p, i) => {
    close(p.slope, f.result.beta[i + 1]);
    close(p.se, f.result.se[i + 1]);
    p.ey.forEach((e, t) => close(e - p.slope * p.ex[t], f.result.resid[t], 1e-9));
    // résidus centrés (la constante fait partie des autres régresseurs)
    close(p.ex.reduce((s, a) => s + a, 0), 0, 1e-9);
    assert.ok(p.partialR2 >= 0 && p.partialR2 <= 1);
  });
});

test('régression partielle : erreurs standards de la méthode choisie', () => {
  const a = fit('CARHART', 'SWISS', 'classical');
  const b = fit('CARHART', 'SWISS', 'HC3');
  const pa = partialRegression(a.sample.y, a.sample.x, a.result, 2);
  const pb = partialRegression(b.sample.y, b.sample.x, b.result, 2);
  close(pa.slope, pb.slope);
  close(pa.se, a.result.se[2]);
  close(pb.se, b.result.se[2]);
  assert.notEqual(pa.crit, pb.crit);
  assert.throws(() => partialRegression(a.sample.y, a.sample.x, a.result, 0), RangeError);
});
