/** Tests de la couche d'orchestration (sans DOM) et de l'import CSV. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { compareModels, diagnose, fitModel, rolling, type Settings } from '../src/ui/analysis.ts';
import { parseCsvDataset, datasetToCsv, validateDataset, DatasetError } from '../src/data/loader.ts';
import type { Dataset } from '../src/data/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ds = JSON.parse(readFileSync(join(here, 'fixtures', 'synthetic_dataset.json'), 'utf8')) as Dataset;
const st: Settings = { asset: 'BCV', range: { start: ds.dates[0], end: ds.dates.at(-1)! }, model: 'CAPM', universe: 'SPI', cov: 'HAC', hacLags: null, window: 60 };

test('modèle hybride identifié comme tel', () => {
  const f = fitModel(ds, 'FF3', 'SPI', st);
  if (!f.ok) throw new Error(f.error);
  assert.equal(f.coherence, 'hybrid');
  assert.match(f.label, /hybride/);
  const g = fitModel(ds, 'FF3', 'EUROPE', st);
  assert.ok(g.ok && g.coherence === 'european');
  const c = fitModel(ds, 'CAPM', 'SPI', st);
  assert.ok(c.ok && c.coherence === 'swiss');
});

test('période trop courte : erreur explicite, aucun résultat', () => {
  const f = fitModel(ds, 'FF5', 'EUROPE', { ...st, range: { start: '2010-01', end: '2011-06' } });
  assert.equal(f.ok, false);
  assert.match((f as { error: string }).error, /insuffisantes/);
});

test('série absente : erreur explicite', () => {
  const partial: Dataset = { ...ds, data: { ...ds.data, wml_chf: ds.dates.map(() => null) } };
  const f = fitModel(partial, 'CARHART', 'EUROPE', st);
  assert.equal(f.ok, false);
  assert.match((f as { error: string }).error, /wml_chf/);
  const cmp = compareModels(partial, st);
  assert.equal(cmp.excluded.length, 2);
  assert.ok(cmp.fits.filter((x) => x.ok).every((x) => x.ok && x.result.n === cmp.commonN));
});

test('comparaison : 8 spécifications sur le même échantillon', () => {
  const cmp = compareModels(ds, st);
  assert.equal(cmp.fits.length, 8);
  const ns = cmp.fits.map((f) => (f.ok ? f.result.n : -1));
  assert.ok(ns.every((n) => n === cmp.commonN), JSON.stringify(ns));
});

test('diagnostics et rolling calculés', () => {
  const f = fitModel(ds, 'CARHART', 'EUROPE', st);
  if (!f.ok) throw new Error(f.error);
  const d = diagnose(f);
  assert.equal(d.tests.length, 3);
  assert.equal(d.qq.sample.length, f.result.n);
  const r = rolling(f, st);
  if (typeof r === 'string') throw new Error(r);
  assert.equal(r.names.length, 5);
  assert.ok(f.warnings.some((w) => /non contigu/.test(w)));
});

test('import CSV : aller-retour et refus des pourcentages', () => {
  const csv = datasetToCsv(ds);
  const back = parseCsvDataset(csv, 'x.csv');
  assert.equal(back.origin, 'manual-csv');
  assert.deepEqual(back.dates, ds.dates);
  assert.deepEqual(back.data.bcv_ret, ds.data.bcv_ret);
  assert.deepEqual(back.data.smb5_chf, ds.data.smb5_chf);
  assert.throws(() => parseCsvDataset('date,bcv_ret,rf_saron\n2020-01,1.5,0.001\n', 'p.csv'), DatasetError);
  assert.throws(() => parseCsvDataset('date,bcv_ret\n2020-01,0.01\n', 'p.csv'), /rf_saron/);
  assert.throws(() => parseCsvDataset('date,bcv_ret,rf_saron,foo\n2020-01,0.01,0,1\n', 'p.csv'), /inconnues/);
  const semi = parseCsvDataset('date;bcv_ret;rf_saron\n2020-02-29;0,0125;0,0001\n2020-01-31;-0,02;\n', 's.csv');
  assert.deepEqual(semi.dates, ['2020-01', '2020-02']);
  assert.equal(semi.data.bcv_ret![1], 0.0125);
  assert.equal(semi.data.rf_saron![0], null);
});

test('validation du schéma', () => {
  assert.throws(() => validateDataset({ ...ds, dates: ['2020-02', '2020-01'], data: {} }), /croissantes/);
  assert.throws(() => validateDataset({ ...ds, schema: 'x' }), /Schéma/);
});

test('action vs fonds : échantillon identique et écart d’alpha cohérent', async () => {
  const { compareAssets, singleIndexPair } = await import('../src/ui/analysis.ts');
  const cmp = compareAssets(ds, { ...st, universe: 'EUROPE' });
  assert.ok(cmp.ok, cmp.error);
  assert.equal(cmp.perf.length, 4);
  assert.ok(cmp.perf.every((p) => p.path.length === cmp.dates.length + 1));
  for (const m of cmp.models) {
    if (!m.bcv.ok || !m.fund.ok || !m.diff.ok) throw new Error('ajustement manquant');
    assert.equal(m.bcv.result.n, cmp.dates.length);
    assert.equal(m.fund.result.n, cmp.dates.length);
    assert.deepEqual(m.bcv.sample.dates, m.fund.sample.dates);
    assert.ok(Math.abs(m.diff.result.beta[0] - (m.bcv.result.beta[0] - m.fund.result.beta[0])) < 1e-12);
  }
  const pair = singleIndexPair(ds, st, cmp);
  if (!pair.bcv.ok || !pair.fund.ok) throw new Error('Single Index indisponible');
  assert.deepEqual(pair.bcv.sample.dates, cmp.dates);
  // fonds synthétique : bêta proche de 0,95, risque résiduel bien plus faible que l'action
  assert.ok(pair.fund.result.beta[1] > 0.85 && pair.fund.result.sigma < pair.bcv.result.sigma / 2);
});

test('action vs fonds : erreur explicite si le fonds est absent', async () => {
  const { compareAssets } = await import('../src/ui/analysis.ts');
  const noFund: Dataset = { ...ds, data: { ...ds.data, fund_ret: ds.dates.map(() => null) } };
  const cmp = compareAssets(noFund, st);
  assert.equal(cmp.ok, false);
  assert.match(cmp.error!, /fund_ret/);
});

test('fonds Raiffeisen : variable dépendante R_Raiffeisen − Rf, échantillon propre', () => {
  const f = fitModel(ds, 'CAPM', 'SPI', { ...st, asset: 'RAIF' });
  if (!f.ok) throw new Error(f.error);
  const idx = ds.dates.map((_, i) => i).filter((i) => ds.data.raif_ret![i] != null && ds.data.spi_ret![i] != null && ds.data.rf_saron![i] != null);
  assert.equal(f.result.n, idx.length);
  assert.ok(Math.abs(f.sample.y[0] - ((ds.data.raif_ret![idx[0]] as number) - (ds.data.rf_saron![idx[0]] as number))) < 1e-15);
  assert.ok(f.result.beta[1] > 0.8 && f.result.beta[1] < 1.0); // fixture : bêta 0,9
});
