/**
 * Définition des modèles d'évaluation et construction des échantillons
 * (variable dépendante, matrice X) à partir du jeu de données.
 */

import type { Dataset, SeriesKey } from '../data/types.ts';
import type { Matrix, Vector } from './linalg.ts';

export type ModelId = 'CAPM' | 'FF3' | 'CARHART' | 'FF5';

/**
 * Actif étudié. 'DIFF' est le portefeuille long A / court B d'une paire (par
 * défaut action BCV / fonds BCV) : sa régression donne exactement α_A − α_B
 * (mêmes dates, mêmes régresseurs), avec une erreur standard qui tient compte
 * de la corrélation des deux actifs.
 */
export type SingleAsset = 'BCV' | 'FUND' | 'RAIF';
export type AssetId = SingleAsset | 'DIFF';
export const ASSET_IDS: SingleAsset[] = ['BCV', 'FUND', 'RAIF'];
/** Paire comparée : [A, B] ; DIFF = R_A − R_B. */
export type Pair = [SingleAsset, SingleAsset];
export const DEFAULT_PAIR: Pair = ['BCV', 'FUND'];

/** sub : indice de R dans les formules ; fund : fonds de placement (rendements nets de frais, distributions réinvesties). */
export const ASSET_INFO: Record<AssetId, { label: string; short: string; detail: string; sub: string; fund: boolean; column: SeriesKey }> = {
  BCV: { label: 'BCV stock', short: 'BCV stock', detail: 'BCVN.SW · ISIN CH0531751755', sub: 'BCV', fund: false, column: 'bcv_ret' },
  FUND: { label: 'BCV Swiss Equity A fund', short: 'BCV fund', detail: 'ISIN CH0006018706 · active management · BCV Asset Management', sub: 'fund', fund: true, column: 'fund_ret' },
  RAIF: { label: 'Raiffeisen Futura - Swiss Stock A fund', short: 'Raiffeisen fund', detail: 'ISIN CH0011980981 · active management · Vontobel Asset Management for Raiffeisen', sub: 'Raiffeisen', fund: true, column: 'raif_ret' },
  DIFF: { label: 'Difference A − B', short: 'Difference', detail: 'Long A, short B portfolio', sub: 'A − B', fund: false, column: 'bcv_ret' },
};

function assetColumns(asset: AssetId, pair: Pair = DEFAULT_PAIR): SeriesKey[] {
  if (asset === 'DIFF') return [ASSET_INFO[pair[0]].column, ASSET_INFO[pair[1]].column];
  return [ASSET_INFO[asset].column];
}
/** SWISS : marché SPI TR et facteurs long-short suisses de Global Factor Data (JKP). */
export type Universe = 'SPI' | 'EUROPE' | 'SWISS';
/**
 * Univers proposés dans l'interface. Le CAPM de l'univers suisse est le Single
 * Index Model (SPI TR) ; la variante hybride « SPI + facteurs européens » reste
 * dans le moteur et la validation, mais n'est plus proposée.
 */
export const UI_UNIVERSES: Universe[] = ['SWISS', 'EUROPE'];

export const MODEL_IDS: ModelId[] = ['CAPM', 'FF3', 'CARHART', 'FF5'];
export const UNIVERSES: Universe[] = ['SPI', 'EUROPE', 'SWISS'];

export type FactorId = 'MKT' | 'SMB' | 'HML' | 'MOM' | 'RMW' | 'CMA';

export const MODEL_FACTORS: Record<ModelId, FactorId[]> = {
  CAPM: ['MKT'],
  FF3: ['MKT', 'SMB', 'HML'],
  CARHART: ['MKT', 'SMB', 'HML', 'MOM'],
  FF5: ['MKT', 'SMB', 'HML', 'RMW', 'CMA'],
};

export const MODEL_LABELS: Record<ModelId, string> = {
  CAPM: 'CAPM / Single Index',
  FF3: 'Fama-French 3-factor',
  CARHART: 'Carhart 4-factor',
  FF5: 'Fama-French 5-factor',
};

export const MODEL_SHORT: Record<ModelId, string> = { CAPM: 'CAPM', FF3: 'FF3', CARHART: 'Carhart', FF5: 'FF5' };

export const UNIVERSE_LABELS: Record<Universe, string> = {
  SPI: 'Swiss market: SPI TR (CHF)',
  EUROPE: 'European Fama-French market (converted to CHF)',
  SWISS: 'Swiss market: SPI TR and Swiss JKP factors (CHF)',
};

export const FACTOR_LABELS: Record<FactorId, string> = {
  MKT: 'MKT (market − Rf)',
  SMB: 'SMB (size)',
  HML: 'HML (value)',
  MOM: 'MOM / WML (momentum)',
  RMW: 'RMW (profitability)',
  CMA: 'CMA (investment)',
};

/** Coefficient associé à chaque facteur dans les équations. */
export const FACTOR_COEF: Record<FactorId, string> = { MKT: 'β_M', SMB: 's', HML: 'h', MOM: 'm', RMW: 'r', CMA: 'c' };

/** Colonnes des facteurs long-short selon le modèle (les SMB/HML diffèrent entre FF3 et FF5). */
function factorColumn(model: ModelId, factor: Exclude<FactorId, 'MKT'>, universe: Universe): SeriesKey {
  if (universe === 'SWISS') {
    // mêmes SMB et HML pour FF3 et FF5 (portefeuilles JKP par caractéristique)
    return ({ SMB: 'smb_ch', HML: 'hml_ch', MOM: 'mom_ch', RMW: 'rmw_ch', CMA: 'cma_ch' } as const)[factor];
  }
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
  return universe === 'EUROPE' ? 'mkt_eu_chf' : 'spi_ret';
}

/** Colonnes nécessaires pour estimer un modèle dans un univers. */
export function requiredColumns(model: ModelId, universe: Universe, asset: AssetId = 'BCV', pair: Pair = DEFAULT_PAIR): SeriesKey[] {
  const cols: SeriesKey[] = [...assetColumns(asset, pair), 'rf_saron', marketColumn(universe)];
  for (const f of MODEL_FACTORS[model]) if (f !== 'MKT') cols.push(factorColumn(model, f, universe));
  return cols;
}

export type Coherence = 'swiss' | 'european' | 'hybrid';

/**
 * Cohérence de l'univers de facteurs :
 *  - CAPM + SPI : modèle suisse cohérent (Single Index Model) ;
 *  - tout modèle + marché européen : univers Fama-French européen cohérent ;
 *  - modèle multifactoriel + SPI : variante HYBRIDE (marché suisse, facteurs européens) ;
 *  - tout modèle + SWISS : univers suisse cohérent (SPI et facteurs suisses JKP).
 */
export function coherence(model: ModelId, universe: Universe): Coherence {
  if (universe === 'EUROPE') return 'european';
  if (universe === 'SWISS') return 'swiss';
  return model === 'CAPM' ? 'swiss' : 'hybrid';
}

export function specLabel(model: ModelId, universe: Universe): string {
  const c = coherence(model, universe);
  if (universe === 'SWISS' && model !== 'CAPM') return `${MODEL_LABELS[model]} — Swiss universe (SPI + JKP factors)`;
  if (c === 'swiss') return 'Single Index Model (SPI TR)';
  if (c === 'european') return `${MODEL_LABELS[model]} — European universe`;
  return `${MODEL_LABELS[model]} — hybrid variant (SPI + European factors)`;
}

export interface DateRange {
  start: string; // AAAA-MM inclus
  end: string; // AAAA-MM inclus
}

export interface Sample {
  asset: AssetId;
  /** Paire de la différence (asset = 'DIFF'). */
  pair?: Pair;
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
      `Series unavailable in the dataset: ${missing.join(', ')}. No estimate is produced for this model.`,
      missing,
    );
  }
}

/**
 * Construit l'échantillon du modèle. Si `restrictTo` est fourni, seules ces
 * dates (intersection commune entre modèles) sont utilisées.
 */
export function buildSample(
  ds: Dataset,
  model: ModelId,
  universe: Universe,
  range: DateRange,
  restrictTo?: Set<string>,
  asset: AssetId = 'BCV',
  pair: Pair = DEFAULT_PAIR,
): Sample {
  const columns = requiredColumns(model, universe, asset, pair);
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
    // rendement excédentaire ; pour la différence, (R_A − Rf) − (R_B − Rf) = R_A − R_B
    if (asset === 'DIFF') y.push(get(ASSET_INFO[pair[0]].column, i) - get(ASSET_INFO[pair[1]].column, i));
    else y.push(get(ASSET_INFO[asset].column, i) - rf);
    const row = [1];
    for (const f of factors) {
      if (f === 'MKT') row.push(get(mcol, i) - rf);
      else row.push(get(factorColumn(model, f, universe), i));
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
    asset,
    ...(asset === 'DIFF' ? { pair } : {}),
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
export function commonDates(
  ds: Dataset,
  specs: { model: ModelId; universe: Universe; asset?: AssetId; pair?: Pair }[],
  range: DateRange,
): Set<string> {
  const cols = new Set<SeriesKey>();
  for (const s of specs) for (const c of requiredColumns(s.model, s.universe, s.asset ?? 'BCV', s.pair)) cols.add(c);
  const { idx } = availableIndices(ds, [...cols], range);
  return new Set(idx.map((i) => ds.dates[i]));
}

/** Nombre minimal d'observations exigé pour afficher une régression. */
export function minObservations(k: number): number {
  return Math.max(24, k + 10);
}
