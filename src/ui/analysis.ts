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
} from '../engine/models.ts';
import { rollingOLS, type RollingResult } from '../engine/rolling.ts';
import { acf, breuschPagan, defaultLjungBoxLags, jarqueBera, ljungBox, qqPoints, type TestResult } from '../engine/diagnostics.ts';
import { SingularMatrixError } from '../engine/linalg.ts';

export interface Settings {
  range: DateRange;
  model: ModelId;
  universe: Universe;
  cov: CovType;
  hacLags: number | null; // null = automatique
  window: number;
}

export interface FitOk {
  ok: true;
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

export function fitModel(ds: Dataset, model: ModelId, universe: Universe, st: Settings, restrictTo?: Set<string>): Fit {
  const label = specLabel(model, universe);
  try {
    const sample = buildSample(ds, model, universe, st.range, restrictTo);
    const k = sample.names.length;
    const minN = minObservations(k);
    if (sample.y.length < minN) {
      throw new InsufficientDataError(
        `Observations insuffisantes : ${sample.y.length} mois disponibles sur la période, minimum requis ${minN} pour ${k} paramètres.`,
      );
    }
    const result = ols(sample.y, sample.x, sample.names, { cov: st.cov, hacLags: st.cov === 'HAC' ? st.hacLags : null });
    return { ok: true, model, universe, label, coherence: coherence(model, universe), sample, result, warnings: sampleWarnings(sample) };
  } catch (e) {
    return { ok: false, model, universe, label, error: describeError(e) };
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
  const specs: { model: ModelId; universe: Universe }[] = [];
  const excluded: string[] = [];
  for (const universe of UNIVERSES) {
    for (const model of MODEL_IDS) {
      try {
        assertColumns(ds, requiredColumns(model, universe));
        specs.push({ model, universe });
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
      else fits.push({ ok: false, model, universe, label: specLabel(model, universe), error: 'Séries indisponibles.' });
    }
  }
  return { fits, commonN: common.size, period: dates.length ? [dates[0], dates[dates.length - 1]] : null, excluded };
}
