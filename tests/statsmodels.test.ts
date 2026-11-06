/**
 * Validation numérique du moteur TypeScript contre statsmodels.
 * Les références sont produites par `python -m pipeline.validate`.
 * Avec STRICT_REFERENCE=1 (CI), l'absence de référence fait échouer les tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ols, type CovType } from '../src/engine/ols.ts';
import { acf, breuschPagan, defaultLjungBoxLags, jarqueBera, ljungBox } from '../src/engine/diagnostics.ts';
import { buildSample, commonDates, assertColumns, requiredColumns, MODEL_IDS, UNIVERSES, type AssetId, type ModelId, type Universe } from '../src/engine/models.ts';
import type { Dataset } from '../src/data/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.env.STRICT_REFERENCE === '1';
const FULL = { start: '0000-01', end: '9999-12' };

function close(actual: number, expected: number, rel: number, abs: number, msg: string) {
  const tol = Math.max(abs, rel * Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= tol, `${msg} : statsmodels ${expected}, moteur ${actual}`);
}
function closeVec(a: number[], b: number[], rel: number, abs: number, msg: string) {
  assert.equal(a.length, b.length, `${msg} longueur`);
  a.forEach((v, i) => close(v, b[i], rel, abs, `${msg}[${i}]`));
}

function availableSpecs(ds: Dataset, asset: AssetId) {
  const out: { model: ModelId; universe: Universe; asset: AssetId }[] = [];
  for (const model of MODEL_IDS) for (const universe of UNIVERSES) {
    try {
      assertColumns(ds, requiredColumns(model, universe, asset));
      out.push({ model, universe, asset });
    } catch {
      /* indisponible */
    }
  }
  return out;
}

const COV: Record<string, [CovType, boolean]> = {
  classical: ['classical', false],
  HC3: ['HC3', false],
  HAC: ['HAC', false],
  HAC_corrected: ['HAC', true],
};

for (const name of ['statsmodels_synthetic.json', 'statsmodels_dataset.json']) {
  const refPath = join(root, 'tests', 'reference', name);
  if (!existsSync(refPath)) {
    test(`référence ${name}`, { skip: !(strict && name === 'statsmodels_synthetic.json') }, () => {
      assert.fail(`${name} absent : exécuter python -m pipeline.validate`);
    });
    continue;
  }
  const ref = JSON.parse(readFileSync(refPath, 'utf8'));
  const dsPath = join(root, ref.dataset_path);
  if (!existsSync(dsPath)) continue;
  const ds = JSON.parse(readFileSync(dsPath, 'utf8')) as Dataset;
  if (ref.dataset_generated_at !== ds.generated_at) {
    test(`référence ${name} à jour`, () => assert.fail('Référence statsmodels obsolète : relancer python -m pipeline.validate'));
    continue;
  }
  const common: Record<string, Set<string>> = {};
  for (const a of ['BCV', 'FUND'] as AssetId[]) {
    const sp = availableSpecs(ds, a);
    if (sp.length) common[a] = commonDates(ds, sp, FULL);
  }
  const both = availableSpecs(ds, 'BCV').filter((x) => availableSpecs(ds, 'FUND').some((y) => y.model === x.model && y.universe === x.universe));
  const pair = commonDates(ds, [...both, ...both.map((x) => ({ ...x, asset: 'FUND' as AssetId }))], FULL);
  const restrict = (c: { asset?: AssetId; sample: string }) =>
    c.sample === 'common' ? common[c.asset ?? 'BCV'] : c.sample === 'pair' ? pair : undefined;

  const noCase = ref.cases.length === 0 ? 'aucune spécification estimable dans ce jeu (sources en erreur ?)' : false;
  test(`${ref.label} : ${ref.cases.length} régressions identiques à statsmodels ${ref.statsmodels_version}`, { skip: noCase }, () => {
    for (const [a, n] of Object.entries(ref.common_n as Record<string, number>)) assert.equal(common[a].size, n, `échantillon commun ${a}`);
    if (ref.pair_n) assert.equal(pair.size, ref.pair_n, 'échantillon de la paire action/fonds');
    for (const c of ref.cases) {
      const tag = `${c.asset ?? 'BCV'}/${c.model}/${c.universe}/${c.sample}/${c.cov}`;
      const s = buildSample(ds, c.model, c.universe, FULL, restrict(c), c.asset ?? 'BCV');
      assert.equal(s.y.length, c.n, `${tag} n`);
      assert.equal(s.dates[0], c.first_date, `${tag} début`);
      assert.equal(s.dates.at(-1), c.last_date, `${tag} fin`);
      const [cov, corr] = COV[c.cov];
      const r = ols(s.y, s.x, s.names, { cov, hacLags: c.hac_lags, hacSmallSampleCorrection: corr });
      closeVec(r.beta, c.params, 1e-9, 1e-14, `${tag} coef`);
      closeVec(r.se, c.bse, 1e-8, 1e-15, `${tag} se`);
      closeVec(r.stat, c.tvalues, 1e-8, 1e-10, `${tag} t`);
      closeVec(r.pvalue, c.pvalues, 1e-7, 1e-14, `${tag} p`);
      closeVec(r.ciLow, c.ci_low, 1e-8, 1e-14, `${tag} IC bas`);
      closeVec(r.ciHigh, c.ci_high, 1e-8, 1e-14, `${tag} IC haut`);
      close(r.r2, c.rsquared, 1e-10, 1e-14, `${tag} R²`);
      close(r.r2adj, c.rsquared_adj, 1e-10, 1e-14, `${tag} R² ajusté`);
      close(r.sigma, c.sigma, 1e-10, 1e-15, `${tag} sigma`);
      close(r.joint!.stat, c.joint_stat, 1e-8, 1e-12, `${tag} test global`);
      close(r.joint!.pvalue, c.joint_pvalue, 1e-7, 1e-14, `${tag} p test global`);
    }
  });

  test(`${ref.label} : diagnostics identiques à statsmodels`, () => {
    for (const d of ref.diagnostics) {
      const tag = `${d.asset ?? 'BCV'}/${d.model}/${d.universe}`;
      const s = buildSample(ds, d.model, d.universe, FULL, undefined, d.asset ?? 'BCV');
      const r = ols(s.y, s.x, s.names, { cov: 'classical' });
      assert.equal(defaultLjungBoxLags(s.y.length), d.lb_lags);
      closeVec(acf(r.resid, 12), d.acf, 1e-8, 1e-12, `${tag} ACF`);
      const lb = ljungBox(r.resid, d.lb_lags);
      close(lb.stat, d.lb_stat, 1e-8, 1e-12, `${tag} Ljung-Box`);
      close(lb.pvalue, d.lb_pvalue, 1e-7, 1e-14, `${tag} p Ljung-Box`);
      const bp = breuschPagan(r.resid, s.x);
      close(bp.stat, d.bp_stat, 1e-8, 1e-12, `${tag} Breusch-Pagan`);
      close(bp.pvalue, d.bp_pvalue, 1e-7, 1e-14, `${tag} p Breusch-Pagan`);
      const jb = jarqueBera(r.resid);
      close(jb.stat, d.jb_stat, 1e-8, 1e-12, `${tag} Jarque-Bera`);
      close(jb.pvalue, d.jb_pvalue, 1e-7, 1e-14, `${tag} p Jarque-Bera`);
      close(jb.skewness, d.skewness, 1e-8, 1e-12, `${tag} asymétrie`);
      close(jb.kurtosis, d.kurtosis, 1e-9, 1e-12, `${tag} kurtosis`);
    }
  });

  test(`${ref.label} : régressions mobiles identiques à statsmodels`, () => {
    for (const roll of ref.rolling) {
      const s = buildSample(ds, roll.model, roll.universe, FULL, undefined, roll.asset ?? 'BCV');
      for (const pt of roll.points) {
        const end = s.dates.indexOf(pt.end_date) + 1;
        assert.ok(end >= roll.window);
        for (const [covName, f] of Object.entries(pt.fits) as [string, { params: number[]; ci_low: number[]; ci_high: number[] }][]) {
          const [cov] = COV[covName];
          const r = ols(s.y.slice(end - roll.window, end), s.x.slice(end - roll.window, end), s.names, { cov });
          const tag = `rolling ${roll.asset ?? 'BCV'}/${roll.model}/${roll.universe}/${pt.end_date}/${covName}`;
          closeVec(r.beta, f.params, 1e-9, 1e-14, tag);
          closeVec(r.ciLow, f.ci_low, 1e-8, 1e-14, `${tag} IC bas`);
          closeVec(r.ciHigh, f.ci_high, 1e-8, 1e-14, `${tag} IC haut`);
        }
      }
    }
  });
}
