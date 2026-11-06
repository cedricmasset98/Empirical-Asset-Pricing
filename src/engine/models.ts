/**
 * Définition des modèles d'évaluation et construction des échantillons
 * (variable dépendante, matrice X) à partir du jeu de données.
 */

import type { Dataset, SeriesKey } from '../data/types.ts';
import type { Matrix, Vector } from './linalg.ts';

export type ModelId = 'CAPM' | 'FF3' | 'CARHART' | 'FF5';
export type Universe = 'SPI' | 'EUROPE';

export const MODEL_IDS: ModelId[] = ['CAPM', 'FF3', 'CARHART', 'FF5'];
export const UNIVERSES: Universe[] = ['SPI', 'EUROPE'];

export type FactorId = 'MKT' | 'SMB' | 'HML' | 'MOM' | 'RMW' | 'CMA';

export const MODEL_FACTORS: Record<ModelId, FactorId[]> = {
  CAPM: ['MKT'],
  FF3: ['MKT', 'SMB', 'HML'],
  CARHART: ['MKT', 'SMB', 'HML', 'MOM'],
  FF5: ['MKT', 'SMB', 'HML', 'RMW', 'CMA'],
};

export const MODEL_LABELS: Record<ModelId, string> = {
  CAPM: 'CAPM / Single Index',
  FF3: 'Fama-French 3 facteurs',
  CARHART: 'Carhart 4 facteurs',
  FF5: 'Fama-French 5 facteurs',
};

export const MODEL_SHORT: Record<ModelId, string> = { CAPM: 'CAPM', FF3: 'FF3', CARHART: 'Carhart', FF5: 'FF5' };

export const UNIVERSE_LABELS: Record<Universe, string> = {
  SPI: 'Marché suisse : SPI TR (CHF)',
  EUROPE: 'Marché européen Fama-French (converti en CHF)',
};

export const FACTOR_LABELS: Record<FactorId, string> = {
  MKT: 'MKT (marché − Rf)',
  SMB: 'SMB (taille)',
  HML: 'HML (valeur)',
  MOM: 'MOM / WML (momentum)',
  RMW: 'RMW (rentabilité)',
  CMA: 'CMA (investissement)',
};

/** Coefficient associé à chaque facteur dans les équations. */
export const FACTOR_COEF: Record<FactorId, string> = { MKT: 'β_M', SMB: 's', HML: 'h', MOM: 'm', RMW: 'r', CMA: 'c' };

/** Colonnes des facteurs long-short selon le modèle (les SMB/HML diffèrent entre FF3 et FF5). */
function factorColumn(model: ModelId, factor: Exclude<FactorId, 'MKT'>): SeriesKey {
  const five = model === 'FF5';
  switch (factor) {
    case 'SMB':
      return five ? 'smb5_chf' : 'smb3_chf';
    case 'HML':
      return five ? 'hml5_chf' : 'hml3_chf';
    case 'MOM':
      return 'wml_chf';
    case 'RMW':
      return 'rmw5_chf';
    case 'CMA':
      return 'cma5_chf';
  }
}

export function marketColumn(universe: Universe): SeriesKey {
  return universe === 'SPI' ? 'spi_ret' : 'mkt_eu_chf';
}

/** Colonnes nécessaires pour estimer un modèle dans un univers. */
export function requiredColumns(model: ModelId, universe: Universe): SeriesKey[] {
  const cols: SeriesKey[] = ['bcv_ret', 'rf_saron', marketColumn(universe)];
  for (const f of MODEL_FACTORS[model]) if (f !== 'MKT') cols.push(factorColumn(model, f));
  return cols;
}

export type Coherence = 'swiss' | 'european' | 'hybrid';

/**
 * Cohérence de l'univers de facteurs :
 *  - CAPM + SPI : modèle suisse cohérent (Single Index Model) ;
 *  - tout modèle + marché européen : univers Fama-French européen cohérent ;
 *  - modèle multifactoriel + SPI : variante HYBRIDE (marché suisse, facteurs européens).
 */
export function coherence(model: ModelId, universe: Universe): Coherence {
  if (universe === 'EUROPE') return 'european';
  return model === 'CAPM' ? 'swiss' : 'hybrid';
}

export function specLabel(model: ModelId, universe: Universe): string {
  const c = coherence(model, universe);
  if (c === 'swiss') return 'Single Index Model (SPI TR)';
  if (c === 'european') return `${MODEL_LABELS[model]} — univers européen`;
  return `${MODEL_LABELS[model]} — variante hybride (SPI + facteurs européens)`;
}

export interface DateRange {
  start: string; // AAAA-MM inclus
  end: string; // AAAA-MM inclus
}

export interface Sample {
  model: ModelId;
  universe: Universe;
  dates: string[];
  y: Vector;
  x: Matrix;
  /** Noms des colonnes de X (const, MKT, ...). */
  names: string[];
  factors: FactorId[];
  columns: SeriesKey[];
  /** Mois de la plage sélectionnée exclus faute de données complètes. */
  droppedMonths: number;
  /** Ruptures de continuité (mois manquants entre deux observations retenues). */
  gaps: { after: string; before: string; missing: number }[];
}

export class DataUnavailableError extends Error {
  missing: SeriesKey[];
  constructor(message: string, missing: SeriesKey[]) {
    super(message);
    this.name = 'DataUnavailableError';
    this.missing = missing;
  }
}

/** Nombre de mois entre deux clés AAAA-MM (b − a). */
export function monthDiff(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Indices des dates dans la plage pour lesquelles toutes les colonnes sont disponibles. */
export function availableIndices(ds: Dataset, columns: SeriesKey[], range: DateRange): { idx: number[]; inRange: number } {
  const idx: number[] = [];
  let inRange = 0;
  for (let i = 0; i < ds.dates.length; i++) {
    const d = ds.dates[i];
    if (d < range.start || d > range.end) continue;
    inRange++;
    if (columns.every((c) => isNum(ds.data[c]?.[i]))) idx.push(i);
  }
  return { idx, inRange };
}

/** Vérifie que chaque colonne requise existe et contient au moins une valeur. */
export function assertColumns(ds: Dataset, columns: SeriesKey[]): void {
  const missing = columns.filter((c) => !(ds.data[c] ?? []).some(isNum));
  if (missing.length) {
    throw new DataUnavailableError(
      `Séries indisponibles dans le jeu de données : ${missing.join(', ')}. Aucune estimation n'est produite pour ce modèle.`,
      missing,
    );
  }
}

/**
 * Construit l'échantillon du modèle. Si `restrictTo` est fourni, seules ces
 * dates (intersection commune entre modèles) sont utilisées.
 */
export function buildSample(ds: Dataset, model: ModelId, universe: Universe, range: DateRange, restrictTo?: Set<string>): Sample {
  const columns = requiredColumns(model, universe);
  assertColumns(ds, columns);
  let { idx, inRange } = availableIndices(ds, columns, range);
  if (restrictTo) idx = idx.filter((i) => restrictTo.has(ds.dates[i]));
  const factors = MODEL_FACTORS[model];
  const get = (c: SeriesKey, i: number) => ds.data[c]![i] as number;
  const mcol = marketColumn(universe);
  const y: Vector = [];
  const x: Matrix = [];
  const dates: string[] = [];
  for (const i of idx) {
    const rf = get('rf_saron', i);
    y.push(get('bcv_ret', i) - rf);
    const row = [1];
    for (const f of factors) {
      if (f === 'MKT') row.push(get(mcol, i) - rf);
      else row.push(get(factorColumn(model, f), i));
    }
    x.push(row);
    dates.push(ds.dates[i]);
  }
  const gaps: Sample['gaps'] = [];
  for (let t = 1; t < dates.length; t++) {
    const d = monthDiff(dates[t - 1], dates[t]);
    if (d > 1) gaps.push({ after: dates[t - 1], before: dates[t], missing: d - 1 });
  }
  return {
    model,
    universe,
    dates,
    y,
    x,
    names: ['const', ...factors],
    factors,
    columns,
    droppedMonths: inRange - idx.length,
    gaps,
  };
}

/** Dates communes à tous les modèles et univers demandés (comparaison sur échantillon identique). */
export function commonDates(ds: Dataset, specs: { model: ModelId; universe: Universe }[], range: DateRange): Set<string> {
  const cols = new Set<SeriesKey>();
  for (const s of specs) for (const c of requiredColumns(s.model, s.universe)) cols.add(c);
  const { idx } = availableIndices(ds, [...cols], range);
  return new Set(idx.map((i) => ds.dates[i]));
}

/** Nombre minimal d'observations exigé pour afficher une régression. */
export function minObservations(k: number): number {
  return Math.max(24, k + 10);
}
