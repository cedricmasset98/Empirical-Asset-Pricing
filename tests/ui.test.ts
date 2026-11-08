/** Tests de la couche d'orchestration (sans DOM) et de l'import CSV. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { compareAssets, compareModels, diagnose, fitModel, rolling, type Settings } from '../src/ui/analysis.ts';
import { parseCsvDataset, datasetToCsv, validateDataset, DatasetError } from '../src/data/loader.ts';
import type { Dataset } from '../src/data/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ds = JSON.parse(readFileSync(join(here, 'fixtures', 'synthetic_dataset.json'), 'utf8')) as Dataset;
const st: Settings = { asset: 'BCV', range: { start: ds.dates[0], end: ds.dates.at(-1)! }, model: 'CAPM', universe: 'SPI', cov: 'HAC', hacLags: null, window: 60 };

test('modèle hybride identifié comme tel', () => {
  const f = fitModel(ds, 'FF3', 'SPI', st);
  if (!f.ok) throw new Error(f.error);
  assert.equal(f.coherence, 'hybrid');
  assert.match(f.label, /hybrid/);
  const g = fitModel(ds, 'FF3', 'EUROPE', st);
  assert.ok(g.ok && g.coherence === 'european');
  const c = fitModel(ds, 'CAPM', 'SPI', st);
  assert.ok(c.ok && c.coherence === 'swiss');
});

test('période trop courte : erreur explicite, aucun résultat', () => {
  const f = fitModel(ds, 'FF5', 'EUROPE', { ...st, range: { start: '2010-01', end: '2011-06' } });
  assert.equal(f.ok, false);
  assert.match((f as { error: string }).error, /Insufficient/);
});

test('série absente : erreur explicite', () => {
  const partial: Dataset = { ...ds, data: { ...ds.data, wml_chf: ds.dates.map(() => null) } };
  const f = fitModel(partial, 'CARHART', 'EUROPE', st);
  assert.equal(f.ok, false);
  assert.match((f as { error: string }).error, /wml_chf/);
  const cmp = compareModels(partial, st);
  assert.equal(cmp.excluded.length, 1); // Carhart européen (l'univers suisse a son propre momentum)
  assert.ok(cmp.fits.filter((x) => x.ok).every((x) => x.ok && x.result.n === cmp.commonN));
});

test('comparaison : 8 spécifications (univers suisse et européen) sur le même échantillon', () => {
  const cmp = compareModels(ds, st);
  assert.equal(cmp.fits.length, 8);
  assert.deepEqual([...new Set(cmp.fits.map((f) => f.universe))], ['SWISS', 'EUROPE']);
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
  // colonnes d'actifs hors liste fixe (fonds du pipeline ou personnalisés) : conservées à l'export
  const custom = parseCsvDataset('date,myfund_ret,rf_saron,spi_ret\n2020-01,0.01,0.0001,0.02\n2020-02,-0.005,0.0001,-0.01\n', 'c.csv');
  const out = datasetToCsv(custom);
  assert.equal(out.split('\n')[0], 'date,spi_ret,rf_saron,myfund_ret');
  assert.deepEqual(parseCsvDataset(out, 'c2.csv').data.myfund_ret, [0.01, -0.005]);
  const withFunds = { ...ds, data: { ...ds.data, swc_ret: ds.data.raif_ret } };
  assert.deepEqual(parseCsvDataset(datasetToCsv(withFunds), 'f.csv').data.swc_ret, ds.data.raif_ret);
  assert.throws(() => parseCsvDataset('date,bcv_ret,rf_saron\n2020-01,1.5,0.001\n', 'p.csv'), DatasetError);
  assert.throws(() => parseCsvDataset('date,bcv_ret\n2020-01,0.01\n', 'p.csv'), /rf_saron/);
  assert.throws(() => parseCsvDataset('date,bcv_ret,rf_saron,foo\n2020-01,0.01,0,1\n', 'p.csv'), /Unknown columns/);
  const semi = parseCsvDataset('date;bcv_ret;rf_saron\n2020-02-29;0,0125;0,0001\n2020-01-31;-0,02;\n', 's.csv');
  assert.deepEqual(semi.dates, ['2020-01', '2020-02']);
  assert.equal(semi.data.bcv_ret![1], 0.0125);
  assert.equal(semi.data.rf_saron![0], null);
});

test('validation du schéma', () => {
  assert.throws(() => validateDataset({ ...ds, dates: ['2020-02', '2020-01'], data: {} }), /strictly increasing/);
  assert.throws(() => validateDataset({ ...ds, schema: 'x' }), /schema/);
});

test('action vs fonds : échantillon identique et écart d’alpha cohérent', async () => {
  const { compareAssets, singleIndexPair } = await import('../src/ui/analysis.ts');
  const cmp = compareAssets(ds, { ...st, universe: 'EUROPE' });
  assert.ok(cmp.ok, cmp.error);
  assert.equal(cmp.perf.length, 4);
  assert.ok(cmp.perf.every((p) => p.path.length === cmp.dates.length + 1));
  for (const m of cmp.models) {
    if (!m.a.ok || !m.b.ok || !m.diff.ok) throw new Error('ajustement manquant');
    assert.equal(m.a.result.n, cmp.dates.length);
    assert.equal(m.b.result.n, cmp.dates.length);
    assert.deepEqual(m.a.sample.dates, m.b.sample.dates);
    assert.ok(Math.abs(m.diff.result.beta[0] - (m.a.result.beta[0] - m.b.result.beta[0])) < 1e-12);
  }
  const pair = singleIndexPair(ds, st, cmp);
  if (!pair.a.ok || !pair.b.ok) throw new Error('Single Index indisponible');
  assert.deepEqual(pair.a.sample.dates, cmp.dates);
  // fonds synthétique : bêta proche de 0,95, risque résiduel bien plus faible que l'action
  assert.ok(pair.b.result.beta[1] > 0.85 && pair.b.result.sigma < pair.a.result.sigma / 2);
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

test('univers suisse : facteurs JKP, modèle cohérent, échantillon limité à leur publication', () => {
  const f = fitModel(ds, 'FF5', 'SWISS', st);
  if (!f.ok) throw new Error(f.error);
  assert.equal(f.coherence, 'swiss');
  assert.match(f.label, /Swiss universe/);
  const cols = ['bcv_ret', 'rf_saron', 'spi_ret', 'smb_ch', 'hml_ch', 'rmw_ch', 'cma_ch'] as const;
  const idx = ds.dates.map((_, i) => i).filter((i) => cols.every((c) => ds.data[c]![i] != null));
  assert.equal(f.result.n, idx.length);
  assert.equal(f.sample.dates.at(-1), ds.dates[idx.at(-1)!]);
  // la 2e colonne de facteurs est SMB suisse, non transformée
  assert.equal(f.sample.x[0][2], ds.data.smb_ch![idx[0]]);
  const c = fitModel(ds, 'CAPM', 'SWISS', st);
  const s = fitModel(ds, 'CAPM', 'SPI', st);
  assert.ok(c.ok && s.ok && c.result.beta[1] === s.result.beta[1]); // CAPM suisse = Single Index
});

test('comparaison de deux fonds quelconques : différence = α_A − α_B', () => {
  const cmp = compareAssets(ds, { ...st, universe: 'SWISS' }, ['FUND', 'RAIF']);
  assert.ok(cmp.ok, cmp.error);
  assert.deepEqual(cmp.pair, ['FUND', 'RAIF']);
  assert.equal(cmp.perf[1].label, 'Raiffeisen Futura - Swiss Stock A fund');
  for (const m of cmp.models) {
    if (!m.a.ok || !m.b.ok || !m.diff.ok) throw new Error('ajustement manquant');
    assert.ok(Math.abs(m.diff.result.beta[0] - (m.a.result.beta[0] - m.b.result.beta[0])) < 1e-12);
  }
  // y de la différence = R_fonds − R_Raiffeisen (sans taux sans risque)
  const d = cmp.models[0].diff;
  if (!d.ok) throw new Error(d.error);
  const i = ds.dates.indexOf(d.sample.dates[0]);
  assert.ok(Math.abs(d.sample.y[0] - ((ds.data.fund_ret![i] as number) - (ds.data.raif_ret![i] as number))) < 1e-15);
  assert.equal(compareAssets(ds, st, ['RAIF', 'RAIF']).ok, false);
});

test('alpha brut = alpha d’une régression sur R + TER/12 (pentes et erreurs standards inchangées)', async () => {
  const { grossAlpha, feeInfo } = await import('../src/ui/analysis.ts');
  const { ols } = await import('../src/engine/ols.ts');
  const withFee: Dataset = { ...ds, fund_info: { ter: 0.0111, ter_date: '2026-03-31' } };
  assert.equal(feeInfo(withFee, 'BCV'), null);
  for (const cov of ['classical', 'HAC'] as const) {
    const f = fitModel(withFee, 'FF3', 'SWISS', { ...st, asset: 'FUND', cov });
    if (!f.ok) throw new Error(f.error);
    const g = grossAlpha(f, feeInfo(withFee, 'FUND')!);
    const r2 = ols(f.sample.y.map((v) => v + 0.0111 / 12), f.sample.x, f.sample.names, { cov, hacLags: null });
    assert.ok(Math.abs(g.gross - r2.beta[0]) < 1e-14);
    assert.ok(Math.abs(g.stat - r2.stat[0]) < 1e-9);
    assert.ok(Math.abs(g.pvalue - r2.pvalue[0]) < 1e-12);
    assert.ok(Math.abs(g.ciLow - r2.ciLow[0]) < 1e-14);
    assert.ok(Math.abs(r2.beta[1] - f.result.beta[1]) < 1e-12 && Math.abs(r2.se[0] - f.result.se[0]) < 1e-14);
  }
});

test('registre des actifs : liste « assets » du jeu de données, menus et frais', async () => {
  const { registerAssets, ASSET_INFO, ASSET_IDS } = await import('../src/engine/models.ts');
  const { feeInfo } = await import('../src/ui/analysis.ts');
  const extra: Dataset = {
    ...ds,
    data: { ...ds.data, swc_ret: ds.data.raif_ret, zzz_ret: ds.data.fund_ret },
    assets: [
      { id: 'BCV', column: 'bcv_ret', label: 'BCV stock', short: 'BCV stock', sub: 'BCV', kind: 'stock', detail: 'x', fees: null },
      { id: 'SWC', column: 'swc_ret', label: 'Swisscanto fund', short: 'Swisscanto fund', sub: 'Swisscanto', kind: 'fund', detail: 'ISIN CH0011792451', passive: false, fees: { ter: 0.014, ter_date: '2025-09-30' } },
      { id: 'IDX', column: 'idx_ret', label: 'Index fund', short: 'index fund', sub: 'idx', kind: 'fund', detail: 'y', passive: true, fees: null },
    ],
  };
  try {
    const ids = registerAssets(extra);
    // IDX sans données exclu ; colonne zzz_ret non décrite ajoutée comme actif générique
    assert.deepEqual(ids, ['BCV', 'SWC', 'ZZZ']);
    assert.deepEqual(ASSET_IDS, ids);
    assert.equal(ASSET_INFO.SWC.column, 'swc_ret');
    assert.equal(ASSET_INFO.IDX.passive, true);
    assert.equal(feeInfo(extra, 'SWC')!.ter, 0.014);
    assert.equal(feeInfo(extra, 'BCV'), null);
    const f = fitModel(extra, 'CAPM', 'SPI', { ...st, asset: 'SWC' });
    const g = fitModel(ds, 'CAPM', 'SPI', { ...st, asset: 'RAIF' });
    if (!f.ok || !g.ok) throw new Error('fit');
    assert.deepEqual(f.result.beta, g.result.beta);
    const cmp = compareAssets(extra, st, ['SWC', 'BCV']);
    assert.ok(cmp.ok);
  } finally {
    registerAssets(ds);
  }
  assert.deepEqual(ASSET_IDS, ['BCV', 'FUND', 'RAIF']);
  assert.equal(ASSET_INFO.SWC, undefined);
});
