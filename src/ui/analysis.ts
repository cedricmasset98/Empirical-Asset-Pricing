/**
 * Orchestration des calculs pour l'interface (sans DOM, testable sous Node).
 */

import type { Dataset } from '../data/types.ts';
import { ols, InsufficientDataError, type CovType, type OLSResult } from '../engine/ols.ts';
import {
  assertColumns,
  buildSample,
  coherence,
  commonDates,
  DataUnavailableError,
  minObservations,
  MODEL_IDS,
  requiredColumns,
  specLabel,
  UNIVERSES,
  type Coherence,
  type DateRange,
  type ModelId,
  type Sample,
  type Universe,
  type AssetId,
  ASSET_INFO,
  MODEL_SHORT,
} from '../engine/models.ts';
import { rollingOLS, type RollingResult } from '../engine/rolling.ts';
import { acf, breuschPagan, defaultLjungBoxLags, jarqueBera, ljungBox, qqPoints, type TestResult } from '../engine/diagnostics.ts';
import { SingularMatrixError } from '../engine/linalg.ts';

export interface Settings {
  asset: AssetId;
  range: DateRange;
  model: ModelId;
  universe: Universe;
  cov: CovType;
  hacLags: number | null; // null = automatique
  window: number;
}

export interface FitOk {
  ok: true;
  asset: AssetId;
  model: ModelId;
  universe: Universe;
  label: string;
  coherence: Coherence;
  sample: Sample;
  result: OLSResult;
  warnings: string[];
}
export interface FitErr {
  ok: false;
  asset: AssetId;
  model: ModelId;
  universe: Universe;
  label: string;
  error: string;
}
export type Fit = FitOk | FitErr;

function describeError(e: unknown): string {
  if (e instanceof DataUnavailableError || e instanceof InsufficientDataError || e instanceof SingularMatrixError) return e.message;
  return `Erreur de calcul : ${(e as Error).message}`;
}

export function sampleWarnings(s: Sample): string[] {
  const w: string[] = [];
  if (s.droppedMonths > 0) w.push(`${s.droppedMonths} mois de la plage exclus faute de données complètes (aucune interpolation).`);
  if (s.gaps.length) {
    const list = s.gaps.slice(0, 4).map((g) => `${g.after} → ${g.before} (${g.missing} mois)`).join(', ');
    w.push(
      `Échantillon non contigu : ${s.gaps.length} rupture(s) ${list}${s.gaps.length > 4 ? ' …' : ''}. ` +
        'Les tests d’autocorrélation, Newey-West et les fenêtres mobiles traitent les observations comme consécutives.',
    );
  }
  return w;
}

export function fitModel(ds: Dataset, model: ModelId, universe: Universe, st: Settings, restrictTo?: Set<string>, asset: AssetId = st.asset): Fit {
  const label = specLabel(model, universe);
  try {
    const sample = buildSample(ds, model, universe, st.range, restrictTo, asset);
    const k = sample.names.length;
    const minN = minObservations(k);
    if (sample.y.length < minN) {
      throw new InsufficientDataError(
        `Observations insuffisantes : ${sample.y.length} mois disponibles sur la période, minimum requis ${minN} pour ${k} paramètres.`,
      );
    }
    const result = ols(sample.y, sample.x, sample.names, { cov: st.cov, hacLags: st.cov === 'HAC' ? st.hacLags : null });
    return { ok: true, asset, model, universe, label, coherence: coherence(model, universe), sample, result, warnings: sampleWarnings(sample) };
  } catch (e) {
    return { ok: false, asset, model, universe, label, error: describeError(e) };
  }
}

export interface Diagnostics {
  acf: number[];
  acfBand: number;
  tests: TestResult[];
  qq: { theoretical: number[]; sample: number[] };
  skewness: number;
  kurtosis: number;
}

export function diagnose(fit: FitOk): Diagnostics {
  const e = fit.result.resid;
  const n = e.length;
  const jb = jarqueBera(e);
  return {
    acf: acf(e, Math.min(24, n - 1)),
    acfBand: 1.959963984540054 / Math.sqrt(n),
    tests: [ljungBox(e, defaultLjungBoxLags(n)), breuschPagan(e, fit.sample.x), jb],
    qq: qqPoints(e, fit.result.sigma),
    skewness: jb.skewness,
    kurtosis: jb.kurtosis,
  };
}

export function rolling(fit: FitOk, st: Settings): RollingResult | string {
  try {
    return rollingOLS(fit.sample.dates, fit.sample.y, fit.sample.x, fit.sample.names, st.window, {
      cov: st.cov,
      hacLags: st.cov === 'HAC' ? st.hacLags : null,
    });
  } catch (e) {
    return (e as Error).message;
  }
}

export interface Comparison {
  fits: Fit[];
  commonN: number;
  period: [string, string] | null;
  excluded: string[];
}

/** Compare les 4 modèles × 2 univers sur un échantillon commun identique. */
export function compareModels(ds: Dataset, st: Settings): Comparison {
  const specs: { model: ModelId; universe: Universe; asset: AssetId }[] = [];
  const excluded: string[] = [];
  for (const universe of UNIVERSES) {
    for (const model of MODEL_IDS) {
      try {
        assertColumns(ds, requiredColumns(model, universe, st.asset));
        specs.push({ model, universe, asset: st.asset });
      } catch (e) {
        excluded.push(`${specLabel(model, universe)} : ${(e as Error).message}`);
      }
    }
  }
  const common = commonDates(ds, specs, st.range);
  const dates = [...common].sort();
  const fits: Fit[] = [];
  for (const universe of UNIVERSES) {
    for (const model of MODEL_IDS) {
      if (specs.some((s) => s.model === model && s.universe === universe)) fits.push(fitModel(ds, model, universe, st, common));
      else fits.push({ ok: false, asset: st.asset, model, universe, label: specLabel(model, universe), error: 'Séries indisponibles.' });
    }
  }
  return { fits, commonN: common.size, period: dates.length ? [dates[0], dates[dates.length - 1]] : null, excluded };
}

// ------------------------------------------------------------------ action vs fonds

export interface PerfStats {
  key: string;
  label: string;
  /** Valeur de 100 CHF à chaque date (première valeur = 100 au mois précédant la 1re date). */
  path: number[];
  annReturn: number;
  annVol: number;
  maxDrawdown: number;
}

export interface AssetComparison {
  ok: boolean;
  error?: string;
  universe: Universe;
  dates: string[];
  perf: PerfStats[];
  /** Ajustements par modèle : action, fonds et différence (action − fonds). */
  models: { model: ModelId; bcv: Fit; fund: Fit; diff: Fit }[];
}

function perfStats(key: string, label: string, r: number[]): PerfStats {
  const path = [100];
  for (const x of r) path.push(path[path.length - 1] * (1 + x));
  const n = r.length;
  const mean = r.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(r.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  let peak = path[0];
  let mdd = 0;
  for (const v of path) {
    peak = Math.max(peak, v);
    mdd = Math.min(mdd, v / peak - 1);
  }
  return { key, label, path, annReturn: Math.pow(path[n] / 100, 12 / n) - 1, annVol: sd * Math.sqrt(12), maxDrawdown: mdd };
}

/**
 * Action BCV contre fonds BCV Swiss Equity A sur un échantillon STRICTEMENT
 * identique : mois où l'action, le fonds, le SPI, le SARON et tous les facteurs
 * des quatre modèles de l'univers choisi sont disponibles.
 */
export function compareAssets(ds: Dataset, st: Settings): AssetComparison {
  const universe = st.universe;
  const empty = (error: string): AssetComparison => ({ ok: false, error, universe, dates: [], perf: [], models: [] });
  const specs: { model: ModelId; universe: Universe; asset: AssetId }[] = [];
  for (const model of MODEL_IDS) {
    for (const asset of ['BCV', 'FUND'] as AssetId[]) {
      try {
        assertColumns(ds, requiredColumns(model, universe, asset));
        specs.push({ model, universe, asset });
      } catch (e) {
        return empty(`${ASSET_INFO[asset].label}, ${MODEL_SHORT[model]} : ${(e as Error).message}`);
      }
    }
  }
  specs.push({ model: 'CAPM', universe: 'SPI', asset: 'BCV' }, { model: 'CAPM', universe: 'SPI', asset: 'FUND' });
  const common = commonDates(ds, specs, st.range);
  const dates = [...common].sort();
  if (dates.length < minObservations(6)) return empty(`Seulement ${dates.length} mois communs à l'action, au fonds et aux facteurs sur la période choisie.`);
  const idx = dates.map((d) => ds.dates.indexOf(d));
  const col = (k: 'bcv_ret' | 'fund_ret' | 'spi_ret' | 'rf_saron') => idx.map((i) => ds.data[k]![i] as number);
  const perf = [
    perfStats('bcv', 'Action BCV', col('bcv_ret')),
    perfStats('fund', 'Fonds BCV Swiss Equity A', col('fund_ret')),
    perfStats('spi', 'SPI Total Return', col('spi_ret')),
    perfStats('rf', 'Placement au SARON', col('rf_saron')),
  ];
  const models = MODEL_IDS.map((model) => ({
    model,
    bcv: fitModel(ds, model, universe, st, common, 'BCV'),
    fund: fitModel(ds, model, universe, st, common, 'FUND'),
    diff: fitModel(ds, model, universe, st, common, 'DIFF'),
  }));
  return { ok: true, universe, dates, perf, models };
}

/** Single Index (SPI) des deux actifs sur l'échantillon de la comparaison. */
export function singleIndexPair(ds: Dataset, st: Settings, cmp: AssetComparison): { bcv: Fit; fund: Fit } {
  const set = new Set(cmp.dates);
  return { bcv: fitModel(ds, 'CAPM', 'SPI', st, set, 'BCV'), fund: fitModel(ds, 'CAPM', 'SPI', st, set, 'FUND') };
}
