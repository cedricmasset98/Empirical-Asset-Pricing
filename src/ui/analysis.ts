/**
 * Orchestration des calculs pour l'interface (sans DOM, testable sous Node).
 */

import type { Dataset, FeeInfo, SeriesKey } from '../data/types.ts';
import { normSf, tTwoSidedP } from '../engine/distributions.ts';
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
  UI_UNIVERSES,
  DEFAULT_PAIR,
  type Pair,
  type SingleAsset,
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
  asset: SingleAsset;
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
  return `Calculation error: ${(e as Error).message}`;
}

export function sampleWarnings(s: Sample): string[] {
  const w: string[] = [];
  if (s.droppedMonths > 0) w.push(`${s.droppedMonths} month(s) of the range excluded for lack of complete data (no interpolation).`);
  if (s.gaps.length) {
    const list = s.gaps.slice(0, 4).map((g) => `${g.after} → ${g.before} (${g.missing} months)`).join(', ');
    w.push(
      `Échantillon non contigu : ${s.gaps.length} rupture(s) ${list}${s.gaps.length > 4 ? ' …' : ''}. ` +
        'Autocorrelation tests, Newey-West and rolling windows treat the observations as consecutive.',
    );
  }
  return w;
}

export function fitModel(
  ds: Dataset,
  model: ModelId,
  universe: Universe,
  st: Settings,
  restrictTo?: Set<string>,
  asset: AssetId = st.asset,
  pair: Pair = DEFAULT_PAIR,
): Fit {
  const label = specLabel(model, universe);
  try {
    const sample = buildSample(ds, model, universe, st.range, restrictTo, asset, pair);
    const k = sample.names.length;
    const minN = minObservations(k);
    if (sample.y.length < minN) {
      throw new InsufficientDataError(
        `Insufficient observations: ${sample.y.length} months available over the period, minimum required ${minN} for ${k} parameters.`,
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

/** Compare les 4 modèles × 2 univers proposés (Suisse, Europe) sur un échantillon commun identique. */
export function compareModels(ds: Dataset, st: Settings): Comparison {
  const specs: { model: ModelId; universe: Universe; asset: AssetId }[] = [];
  const excluded: string[] = [];
  for (const universe of UI_UNIVERSES) {
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
  for (const universe of UI_UNIVERSES) {
    for (const model of MODEL_IDS) {
      if (specs.some((s) => s.model === model && s.universe === universe)) fits.push(fitModel(ds, model, universe, st, common));
      else fits.push({ ok: false, asset: st.asset, model, universe, label: specLabel(model, universe), error: 'Series unavailable.' });
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
  /** Actifs comparés : [A, B]. */
  pair: Pair;
  dates: string[];
  perf: PerfStats[];
  /** Ajustements par modèle : A, B et différence (A − B). */
  models: { model: ModelId; a: Fit; b: Fit; diff: Fit }[];
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
 * Deux actifs sur un échantillon STRICTEMENT identique : mois où les deux
 * actifs, le SPI, le SARON et tous les facteurs des quatre modèles de l'univers
 * choisi sont disponibles.
 */
export function compareAssets(ds: Dataset, st: Settings, pair: Pair = DEFAULT_PAIR): AssetComparison {
  const universe = st.universe;
  const empty = (error: string): AssetComparison => ({ ok: false, error, universe, pair, dates: [], perf: [], models: [] });
  if (pair[0] === pair[1]) return empty('Choose two different assets.');
  const specs: { model: ModelId; universe: Universe; asset: AssetId }[] = [];
  for (const model of MODEL_IDS) {
    for (const asset of pair) {
      try {
        assertColumns(ds, requiredColumns(model, universe, asset));
        specs.push({ model, universe, asset });
      } catch (e) {
        return empty(`${ASSET_INFO[asset].label}, ${MODEL_SHORT[model]} : ${(e as Error).message}`);
      }
    }
  }
  for (const asset of pair) specs.push({ model: 'CAPM', universe: 'SPI', asset });
  const common = commonDates(ds, specs, st.range);
  const dates = [...common].sort();
  if (dates.length < minObservations(6)) return empty(`Only ${dates.length} months common to both assets and the factors over the selected period.`);
  const idx = dates.map((d) => ds.dates.indexOf(d));
  const col = (k: SeriesKey) => idx.map((i) => ds.data[k]![i] as number);
  const perf = [
    perfStats('a', ASSET_INFO[pair[0]].label, col(ASSET_INFO[pair[0]].column)),
    perfStats('b', ASSET_INFO[pair[1]].label, col(ASSET_INFO[pair[1]].column)),
    perfStats('spi', 'SPI Total Return', col('spi_ret')),
    perfStats('rf', 'Risk-free deposit (SARON)', col('rf_saron')),
  ];
  const models = MODEL_IDS.map((model) => ({
    model,
    a: fitModel(ds, model, universe, st, common, pair[0]),
    b: fitModel(ds, model, universe, st, common, pair[1]),
    diff: fitModel(ds, model, universe, st, common, 'DIFF', pair),
  }));
  return { ok: true, universe, pair, dates, perf, models };
}

/** Single Index (SPI) des deux actifs sur l'échantillon de la comparaison. */
export function singleIndexPair(ds: Dataset, st: Settings, cmp: AssetComparison): { a: Fit; b: Fit } {
  const set = new Set(cmp.dates);
  return { a: fitModel(ds, 'CAPM', 'SPI', st, set, cmp.pair[0]), b: fitModel(ds, 'CAPM', 'SPI', st, set, cmp.pair[1]) };
}

// ------------------------------------------------------------------ alpha brut des fonds

/** TER publié d'un fonds (null pour l'action ou si le pipeline ne l'a pas lu). */
export function feeInfo(ds: Dataset, asset: AssetId): FeeInfo | null {
  const entry = ds.assets?.find((a) => a.id === asset);
  const f = entry ? entry.fees ?? undefined : asset === 'FUND' ? ds.fund_info : asset === 'RAIF' ? ds.raif_info : undefined;
  return f && Number.isFinite(f.ter) && f.ter >= 0 && f.ter < 0.1 ? f : null;
}

export interface GrossAlpha {
  ter: number;
  terDate: string;
  source: string;
  /** Alphas mensuels. */
  net: number;
  gross: number;
  ciLow: number;
  ciHigh: number;
  stat: number;
  pvalue: number;
}

/**
 * Alpha avant frais de gestion : ajouter TER/12 à chaque rendement mensuel
 * décale la constante de TER/12 sans changer les pentes ni les erreurs
 * standards (régresseurs inchangés, résidus identiques). Le test de l'alpha
 * brut est donc celui de H0 : α_net = −TER/12, avec la même loi que le modèle.
 * Approximation : TER actuel supposé constant ; frais de transaction non inclus.
 */
export function shiftAlpha(fit: FitOk, shiftMonthly: number): { alpha: number; ciLow: number; ciHigh: number; stat: number; pvalue: number } {
  const r = fit.result;
  const alpha = r.beta[0] + shiftMonthly;
  const stat = alpha / r.se[0];
  const pvalue = r.distribution === 't' ? tTwoSidedP(stat, r.dfResid) : 2 * normSf(Math.abs(stat));
  return { alpha, ciLow: r.ciLow[0] + shiftMonthly, ciHigh: r.ciHigh[0] + shiftMonthly, stat, pvalue };
}

export function grossAlpha(fit: FitOk, fee: FeeInfo): GrossAlpha {
  const s = shiftAlpha(fit, fee.ter / 12);
  return { ter: fee.ter, terDate: fee.ter_date, source: fee.ter_source ?? '', net: fit.result.beta[0], gross: s.alpha, ciLow: s.ciLow, ciHigh: s.ciHigh, stat: s.stat, pvalue: s.pvalue };
}
