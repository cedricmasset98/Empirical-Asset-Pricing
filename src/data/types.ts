/** Schéma des données statiques produites par le pipeline Python (eap-dataset/v1). */

export type SeriesKey =
  | 'bcv_ret'
  | 'fund_ret'
  | 'spi_ret'
  | 'rf_saron'
  | 'mkt_eu_chf'
  | 'smb3_chf'
  | 'hml3_chf'
  | 'wml_chf'
  | 'smb5_chf'
  | 'hml5_chf'
  | 'rmw5_chf'
  | 'cma5_chf'
  | 'fx_usdchf_ret'
  | 'rf_us'
  | 'mkt_rf_usd'
  | 'smb3_usd'
  | 'hml3_usd'
  | 'wml_usd'
  | 'smb5_usd'
  | 'hml5_usd'
  | 'rmw5_usd'
  | 'cma5_usd';

export const REQUIRED_BASE_KEYS: SeriesKey[] = ['bcv_ret', 'spi_ret', 'rf_saron'];

export interface SourceInfo {
  id: string;
  name: string;
  provider: string;
  url: string;
  status: 'ok' | 'error' | 'manual';
  message?: string;
  retrieved_at?: string;
  coverage?: [string, string] | null;
  license?: string;
  columns?: string[];
}

export interface CheckInfo {
  id: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

export interface ColumnInfo {
  label: string;
  unit: string;
  description?: string;
  source?: string;
}

export interface Dataset {
  schema: 'eap-dataset/v1';
  frequency: 'monthly';
  generated_at: string;
  origin: 'pipeline' | 'manual-csv';
  asset: {
    name: string;
    ticker: string;
    yahoo: string;
    isin: string;
    currency: string;
  };
  columns: Partial<Record<SeriesKey, ColumnInfo>>;
  /** Mois au format AAAA-MM, strictement croissants et uniques. */
  dates: string[];
  data: Partial<Record<SeriesKey, (number | null)[]>>;
  sources: SourceInfo[];
  checks: CheckInfo[];
  notes?: string[];
}
