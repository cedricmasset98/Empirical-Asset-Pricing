/** Chargement et validation du jeu de données ; import manuel CSV. */

import type { Dataset, SeriesKey } from './types.ts';

export const KNOWN_KEYS: SeriesKey[] = [
  'bcv_ret', 'fund_ret', 'spi_ret', 'rf_saron', 'mkt_eu_chf', 'smb3_chf', 'hml3_chf', 'wml_chf', 'smb5_chf', 'hml5_chf', 'rmw5_chf',
  'cma5_chf', 'fx_usdchf_ret', 'rf_us', 'mkt_rf_usd', 'smb3_usd', 'hml3_usd', 'wml_usd', 'smb5_usd', 'hml5_usd', 'rmw5_usd', 'cma5_usd',
];

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export class DatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasetError';
  }
}

/** Contrôles structurels : dates AAAA-MM uniques et croissantes, séries de même longueur, valeurs finies ou null. */
export function validateDataset(raw: unknown): Dataset {
  const ds = raw as Dataset;
  if (!ds || typeof ds !== 'object') throw new DatasetError('Fichier de données illisible.');
  if (ds.schema !== 'eap-dataset/v1') throw new DatasetError(`Schéma de données inattendu : ${String((ds as { schema?: unknown }).schema)}.`);
  if (!Array.isArray(ds.dates) || ds.dates.length === 0) throw new DatasetError('Le jeu de données ne contient aucune date.');
  for (let i = 0; i < ds.dates.length; i++) {
    if (!MONTH_RE.test(ds.dates[i])) throw new DatasetError(`Date invalide : ${ds.dates[i]} (format AAAA-MM attendu).`);
    if (i && ds.dates[i] <= ds.dates[i - 1]) throw new DatasetError(`Dates non strictement croissantes autour de ${ds.dates[i]}.`);
  }
  for (const [k, v] of Object.entries(ds.data ?? {})) {
    if (!Array.isArray(v) || v.length !== ds.dates.length) throw new DatasetError(`Série ${k} : longueur incohérente.`);
    for (const x of v) if (x !== null && !(typeof x === 'number' && Number.isFinite(x))) throw new DatasetError(`Série ${k} : valeur non numérique.`);
  }
  ds.sources ??= [];
  ds.checks ??= [];
  ds.columns ??= {};
  return ds;
}

export async function loadDataset(url: string): Promise<Dataset> {
  let resp: Response;
  try {
    resp = await fetch(url, { cache: 'no-cache' });
  } catch (e) {
    throw new DatasetError(`Impossible de charger ${url} : ${(e as Error).message}`);
  }
  if (!resp.ok) {
    throw new DatasetError(
      `Jeu de données introuvable (${resp.status}). Les données sont produites par le pipeline Python (python -m pipeline.build) ` +
        'ou par le workflow GitHub Actions. Vous pouvez aussi importer un fichier CSV.',
    );
  }
  return validateDataset(await resp.json());
}

/** Découpe une ligne CSV (séparateur , ou ;) en respectant les guillemets. */
function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === sep && !q) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Import manuel. Format : en-tête `date` + colonnes du schéma (ex. bcv_ret,
 * spi_ret, rf_saron), rendements MENSUELS en décimal (0.012 = 1,2 %), date
 * AAAA-MM ou AAAA-MM-JJ, cellules vides = manquant. Aucune interpolation.
 */
export function parseCsvDataset(text: string, fileName: string): Dataset {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) throw new DatasetError('CSV vide.');
  const sep = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const header = splitCsvLine(lines[0], sep).map((h) => h.toLowerCase());
  if (header[0] !== 'date') throw new DatasetError('La première colonne doit s’appeler « date ».');
  const unknown = header.slice(1).filter((h) => !KNOWN_KEYS.includes(h as SeriesKey));
  if (unknown.length) throw new DatasetError(`Colonnes inconnues : ${unknown.join(', ')}. Colonnes acceptées : ${KNOWN_KEYS.join(', ')}.`);
  const keys = header.slice(1) as SeriesKey[];
  if (!keys.includes('rf_saron')) throw new DatasetError('Colonne obligatoire manquante : rf_saron.');
  if (!keys.includes('bcv_ret') && !keys.includes('fund_ret')) {
    throw new DatasetError('Colonne obligatoire manquante : bcv_ret (action) ou fund_ret (fonds).');
  }
  const rows: { date: string; vals: (number | null)[] }[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = splitCsvLine(lines[li], sep);
    const d = cells[0].slice(0, 7);
    if (!MONTH_RE.test(d)) throw new DatasetError(`Ligne ${li + 1} : date invalide « ${cells[0]} ».`);
    const vals = keys.map((k, j) => {
      const c = (cells[j + 1] ?? '').replace(',', sep === ';' ? '.' : ',');
      if (c === '' || c.toLowerCase() === 'na' || c.toLowerCase() === 'nan') return null;
      const v = Number(c);
      if (!Number.isFinite(v)) throw new DatasetError(`Ligne ${li + 1}, ${k} : valeur non numérique « ${cells[j + 1]} ».`);
      if (Math.abs(v) >= 1) {
        throw new DatasetError(`Ligne ${li + 1}, ${k} = ${v} : les rendements doivent être des décimaux mensuels (0.012 pour 1,2 %), pas des pourcentages.`);
      }
      return v;
    });
    rows.push({ date: d, vals });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].date === rows[i - 1].date) throw new DatasetError(`Mois en double : ${rows[i].date}.`);
  }
  const data: Dataset['data'] = {};
  keys.forEach((k, j) => (data[k] = rows.map((r) => r.vals[j])));
  return validateDataset({
    schema: 'eap-dataset/v1',
    frequency: 'monthly',
    generated_at: new Date().toISOString(),
    origin: 'manual-csv',
    asset: { name: 'Banque Cantonale Vaudoise', ticker: 'BCVN', yahoo: 'BCVN.SW', isin: 'CH0531751755', currency: 'CHF' },
    columns: {},
    dates: rows.map((r) => r.date),
    data,
    sources: [
      {
        id: 'manual',
        name: `Import manuel : ${fileName}`,
        provider: 'Fichier CSV fourni par l’utilisateur',
        url: '',
        status: 'manual',
        message: 'Données non vérifiées par le pipeline (provenance, ajustements et conventions sous la responsabilité de l’utilisateur).',
        columns: keys,
      },
    ],
    checks: [],
  });
}

/** Export du jeu de données au format CSV d'import. */
export function datasetToCsv(ds: Dataset): string {
  const keys = KNOWN_KEYS.filter((k) => ds.data[k]);
  const lines = [['date', ...keys].join(',')];
  ds.dates.forEach((d, i) => lines.push([d, ...keys.map((k) => (ds.data[k]![i] ?? '').toString())].join(',')));
  return lines.join('\n') + '\n';
}
