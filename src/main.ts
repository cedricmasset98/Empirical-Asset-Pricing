/** Point d'entrée : chargement des données, paramètres, rendu. */

import './styles.css';
import type { Dataset, FeeInfo } from './data/types.ts';
import { loadDataset, parseCsvDataset, datasetToCsv, DatasetError } from './data/loader.ts';
import { compareAssets, compareModels, diagnose, feeInfo, fitModel, grossAlpha, rolling, shiftAlpha, singleIndexPair, type AssetComparison, type Fit, type FitOk, type Settings, type Comparison } from './ui/analysis.ts';
import { commonRanges, plotAlphaPair, plotComparison, plotDiagnostics, plotFitted, plotFittedScatter, plotMeanContributions, plotPartialRegressions, plotPerformance, plotRolling, plotScatter, plotVarianceContributions, readTheme, resizeAll, type Theme } from './ui/charts.ts';
import { decompose, partialRegressions } from './engine/decompose.ts';
import { alphaPairTable, comparisonTable, feesBlock, multiFactorPairTable, perfTable, regressionTable, sourcesTable, statCards, testsTable, COV_LABELS } from './ui/tables.ts';
import { assetComparisonCsv, comparisonCsv, download, regressionCsv, sampleCsv } from './ui/export.ts';
import { escapeHtml as h, monthLabel, num, pct, pval } from './ui/format.ts';
import { neweyWestAutoLags, type CovType } from './engine/ols.ts';
import { ASSET_IDS, ASSET_INFO, FACTOR_COEF, registerAssets, MODEL_IDS, MODEL_SHORT, UI_UNIVERSES, specLabel, type ModelId, type Pair, type SingleAsset, type Universe } from './engine/models.ts';

type View = 'analyze' | 'compare' | 'reports' | 'data';
type Tab = 'results' | 'fitted' | 'diagnostics' | 'rolling' | 'comparison';
const VIEWS: View[] = ['analyze', 'compare', 'reports', 'data'];
const TABS: Tab[] = ['results', 'fitted', 'diagnostics', 'rolling', 'comparison'];

interface UIState extends Settings {
  view: View;
  tab: Tab;
  /** Actifs comparés dans « Comparer » : [A, B]. */
  pair: Pair;
  band: boolean;
  byYear: boolean;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let pipelineData: Dataset | null = null;
let data: Dataset | null = null;
let state: UIState;
let main: Fit | null = null;
let sim: Fit | null = null;
let comparisonCache: { key: string; cmp: Comparison } | null = null;
let versusCache: { key: string; cmp: AssetComparison } | null = null;

const DATA_URL = `${import.meta.env.BASE_URL}data/dataset.json`;

// ------------------------------------------------------------------ alertes

type Level = 'error' | 'warn' | 'info';
function alertHtml(level: Level, title: string, text: string): string {
  return `<div class="alert alert-${level}" role="${level === 'error' ? 'alert' : 'status'}"><strong>${h(title)}</strong>${text}</div>`;
}

// ------------------------------------------------------------------ état / URL


/** Actifs concernés par la rubrique courante. */
function activeAssets(s: UIState): SingleAsset[] {
  return s.view === 'compare' ? [...s.pair] : [s.asset];
}

/** Plage utile : mois où le rendement de tous les actifs concernés existe. */
function bounds(ds: Dataset, assets: SingleAsset[] = state ? activeAssets(state) : ['BCV']): [string, string] {
  const months = ds.dates.filter((_, i) => assets.every((a) => ds.data[ASSET_INFO[a].column]?.[i] != null));
  return months.length ? [months[0], months[months.length - 1]] : [ds.dates[0], ds.dates[ds.dates.length - 1]];
}

/** Premier mois estimable : rendements de tous les actifs concernés et taux sans risque disponibles. */
function firstStart(ds: Dataset, assets: SingleAsset[]): string {
  const i = ds.dates.findIndex((_, k) => ds.data.rf_saron?.[k] != null && assets.every((a) => ds.data[ASSET_INFO[a].column]?.[k] != null));
  return i >= 0 ? ds.dates[i] : bounds(ds, assets)[0];
}

/** Changement d'actif : la période repart du premier mois disponible ; la fin est conservée si elle reste valide. */
function resetStart(): void {
  const ds = data!;
  state.range.start = firstStart(ds, activeAssets(state));
  const hi = bounds(ds, activeAssets(state))[1];
  if (state.range.end > hi || state.range.end < state.range.start) state.range.end = hi;
}

function clampRange(s: UIState, ds: Dataset): void {
  const [lo, hi] = bounds(ds, activeAssets(s));
  if (s.range.start < lo || s.range.start > hi) s.range.start = lo;
  if (s.range.end > hi || s.range.end < lo) s.range.end = hi;
  if (s.range.start > s.range.end) [s.range.start, s.range.end] = [lo, hi];
}

function defaultState(ds: Dataset, asset: SingleAsset = ASSET_IDS.includes('BCV') ? 'BCV' : (ASSET_IDS[0] ?? 'BCV')): UIState {
  const first = firstStart(ds, [asset]);
  return {
    asset,
    range: { start: first, end: ds.dates[ds.dates.length - 1] },
    model: 'CAPM',
    universe: 'SWISS',
    cov: 'classical',
    hacLags: null,
    window: 60,
    view: 'analyze',
    tab: 'results',
    pair: ASSET_IDS.includes('BCV') && ASSET_IDS.includes('FUND') ? ['BCV', 'FUND'] : [ASSET_IDS[0] ?? 'BCV', ASSET_IDS[1] ?? ASSET_IDS[0] ?? 'FUND'],
    band: true,
    byYear: false,
  };
}

function readHash(base: UIState): UIState {
  const p = new URLSearchParams(location.hash.slice(1));
  const s = { ...base, range: { ...base.range } };
  const m = /^\d{4}-\d{2}$/;
  if (m.test(p.get('start') ?? '')) s.range.start = p.get('start')!;
  if (m.test(p.get('end') ?? '')) s.range.end = p.get('end')!;
  const isAsset = (v: string | null): v is SingleAsset => ASSET_IDS.includes(v as SingleAsset);
  if (isAsset(p.get('asset'))) s.asset = p.get('asset') as SingleAsset;
  if (isAsset(p.get('a')) && isAsset(p.get('b'))) s.pair = [p.get('a') as SingleAsset, p.get('b') as SingleAsset];
  if (MODEL_IDS.includes(p.get('model') as ModelId)) s.model = p.get('model') as ModelId;
  // anciens liens : market=SPI (Single Index ou variante hybride) -> univers suisse
  const market = p.get('market');
  if (UI_UNIVERSES.includes(market as Universe)) s.universe = market as Universe;
  else if (market === 'SPI') s.universe = 'SWISS';
  if (['classical', 'HC3', 'HAC'].includes(p.get('se') ?? '')) s.cov = p.get('se') as CovType;
  const lags = p.get('lags');
  if (lags && /^\d+$/.test(lags)) s.hacLags = Number(lags);
  if (['36', '60', '120'].includes(p.get('window') ?? '')) s.window = Number(p.get('window'));
  if (VIEWS.includes(p.get('view') as View)) s.view = p.get('view') as View;
  const tab = p.get('tab') ?? '';
  if (TABS.includes(tab as Tab)) s.tab = tab as Tab;
  // anciens onglets
  else if (tab === 'scatter') s.tab = 'results';
  else if (tab === 'versus') s.view = 'compare';
  else if (tab === 'data') s.view = 'data';
  if (p.get('band') === '0') s.band = false;
  if (p.get('year') === '1') s.byYear = true;
  return s;
}

function writeHash(): void {
  const p = new URLSearchParams({ view: state.view });
  if (state.view === 'analyze' || state.view === 'compare') {
    if (state.view === 'analyze') p.set('asset', state.asset);
    else {
      p.set('a', state.pair[0]);
      p.set('b', state.pair[1]);
    }
    p.set('start', state.range.start);
    p.set('end', state.range.end);
    p.set('model', state.model);
    p.set('market', state.universe);
    p.set('se', state.cov);
    p.set('window', String(state.window));
    if (state.view === 'analyze') p.set('tab', state.tab);
  }
  if (state.hacLags !== null) p.set('lags', String(state.hacLags));
  if (!state.band) p.set('band', '0');
  if (state.byYear) p.set('year', '1');
  history.replaceState(null, '', `#${p.toString()}`);
}

function syncControls(): void {
  const ds = data!;
  const start = $<HTMLInputElement>('start');
  const end = $<HTMLInputElement>('end');
  [start.min, start.max] = bounds(ds);
  [end.min, end.max] = bounds(ds);
  start.value = state.range.start;
  end.value = state.range.end;
  $<HTMLSelectElement>('asset').value = state.asset;
  $<HTMLSelectElement>('asset-a').value = state.pair[0];
  $<HTMLSelectElement>('asset-b').value = state.pair[1];
  const cmpView = state.view === 'compare';
  $('asset-wrap').hidden = cmpView;
  $('pair-a-wrap').hidden = !cmpView;
  $('pair-b-wrap').hidden = !cmpView;
  $('controls').hidden = state.view === 'reports' || state.view === 'data';
  $<HTMLSelectElement>('model').value = state.model;
  $<HTMLSelectElement>('universe').value = state.universe;
  $<HTMLSelectElement>('cov').value = state.cov;
  $<HTMLSelectElement>('window').value = String(state.window);
  $<HTMLInputElement>('band').checked = state.band;
  $<HTMLInputElement>('by-year').checked = state.byYear;
  $('hac-wrap').hidden = state.cov !== 'HAC';
  const lags = $<HTMLSelectElement>('hac-lags');
  const nAuto = main?.ok ? neweyWestAutoLags(main.result.n) : null;
  lags.innerHTML =
    `<option value="auto">Auto${nAuto !== null ? ` (${nAuto})` : ''}</option>` +
    Array.from({ length: 25 }, (_, i) => `<option value="${i}">${i}</option>`).join('');
  lags.value = state.hacLags === null ? 'auto' : String(state.hacLags);
  const lagTxt = state.cov === 'HAC' ? (state.hacLags === null ? ', auto lags' : `, ${state.hacLags} lags`) : '';
  $('adv-summary').textContent = `· ${COV_LABELS[state.cov].split(' (')[0]}${lagTxt} · ${state.window}-month window`;
}

// ------------------------------------------------------------------ rendu

function subtitle(id: SingleAsset): string {
  const a = ASSET_INFO[id];
  const kind = a.fund ? (a.passive ? 'Index fund' : 'Fund') : 'Stock';
  return `${kind} <b>${h(a.label.replace(/ fund$/, ''))}</b> · ${h(a.detail)} · CHF`;
}

/** Menus des actifs, générés à partir du registre (liste « assets » du jeu de données). */
function fillAssetMenus(): void {
  const groups: [string, (id: SingleAsset) => boolean][] = [
    ['Stock', (id) => !ASSET_INFO[id].fund],
    ['Active funds', (id) => ASSET_INFO[id].fund && !ASSET_INFO[id].passive],
    ['Index funds', (id) => ASSET_INFO[id].fund && !!ASSET_INFO[id].passive],
  ];
  const html = groups
    .map(([g, keep]) => {
      const ids = ASSET_IDS.filter(keep);
      if (!ids.length) return '';
      const isin = (id: SingleAsset) => /ISIN (\w+)/.exec(ASSET_INFO[id].detail)?.[1] ?? '';
      return `<optgroup label="${g}">${ids.map((id) => `<option value="${id}">${h(ASSET_INFO[id].label)}${isin(id) ? ` — ${isin(id)}` : ''}</option>`).join('')}</optgroup>`;
    })
    .join('');
  for (const sel of ['asset', 'asset-a', 'asset-b']) $(sel).innerHTML = html;
}

function renderHeader(): void {
  const ds = data!;
  const errors = ds.sources.filter((s) => s.status === 'error');
  const when = new Date(ds.generated_at);
  const date = Number.isNaN(when.getTime()) ? ds.generated_at : when.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
  const origin = ds.origin === 'manual-csv' ? 'manual CSV import' : 'public data, updated automatically';
  document.querySelectorAll<HTMLButtonElement>('.views button').forEach((b) => {
    if (b.dataset.view === state.view) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  $('subtitle').innerHTML = {
    analyze: subtitle(state.asset),
    compare: `Comparison: <b>${h(ASSET_INFO[state.pair[0]].label)}</b> and <b>${h(ASSET_INFO[state.pair[1]].label)}</b> · CHF`,
    reports: 'Plain-language reports and notes (PDF)',
    data: 'Sources, checks and methodology',
  }[state.view];
  const assets = activeAssets(state);
  const [lo, hi] = bounds(ds, assets);
  const span = state.view === 'analyze' || state.view === 'compare' ? ` · data available ${monthLabel(lo)} → ${monthLabel(hi)}` : '';
  $('data-meta').innerHTML =
    `<span>Updated ${h(date)} (${h(origin)})${h(span)}</span>` +
    `<button type="button" class="linklike" data-goto="data">Sources and method</button>` +
    (errors.length ? `<span class="err-count">${errors.length} source(s) in error</span>` : '');
}

function renderAlerts(): void {
  const ds = data!;
  const errors: string[] = [];
  const notes: string[] = [];
  if (ds.origin === 'manual-csv') {
    notes.push(alertHtml('warn', 'Manually imported data.', ' They have not been checked by the pipeline; their origin and conventions are the user’s responsibility.'));
  }
  for (const s of ds.sources.filter((x) => x.status === 'error')) {
    errors.push(alertHtml('error', `Source unavailable: ${s.name}.`, ` ${h(s.message ?? '')} Models that depend on it are not estimated.`));
  }
  for (const c of ds.checks.filter((x) => x.status === 'fail')) errors.push(alertHtml('error', 'Data check failed.', ` ${h(c.message)}`));
  if (state.view === 'analyze') {
    if (main && !main.ok) errors.push(alertHtml('error', `${main.label}: estimation not possible.`, ` ${h(main.error)}`));
    if (main?.ok) {
      if (main.universe === 'SWISS' && main.model !== 'CAPM') {
        notes.push(alertHtml('info', 'Swiss JKP factors.', ' SMB, HML, RMW, CMA and MOM come from Global Factor Data (Jensen, Kelly and Pedersen, 2023): tercile portfolios on the characteristic, weighted by capped market capitalisation, not the Fama-French 2×3 sorts. They are published once a year: the latest months may be missing.'));
      }
      if (main.universe === 'EUROPE') {
        notes.push(alertHtml('warn', 'Comparison universe.', ' The market and the factors are European: this is not the natural benchmark for a Swiss asset. An alpha obtained here may simply reflect the wrong benchmark; compare with the Swiss factors.'));
      }
      const s = main.sample;
      if (s.droppedMonths > 0) {
        notes.push(alertHtml('info', 'Effective sample:', ` ${s.dates[0]} → ${s.dates[s.dates.length - 1]}, ${s.y.length} months. ${s.droppedMonths} month(s) of the selected range lack some required series and are excluded (no interpolation).`));
      }
      for (const w of main.warnings.filter((x) => !x.includes('excluded for lack'))) notes.push(alertHtml('warn', 'Sample.', ` ${h(w)}`));
      if (main.result.cov !== 'classical') {
        notes.push(alertHtml('info', 'Robust inference.', ` ${COV_LABELS[main.result.cov]}: z statistics, p-values and intervals based on the normal distribution; the global test is a Wald χ² test (a classical F statistic would not be robust).`));
      }
    }
  }
  const showNotes = (state.view === 'analyze' || state.view === 'compare') && notes.length > 0;
  const wasOpen = ($('alerts').querySelector('details.notes') as HTMLDetailsElement | null)?.open ?? false;
  $('alerts').innerHTML =
    errors.join('') +
    (showNotes
      ? `<details class="notes"${wasOpen ? ' open' : ''}><summary>${notes.length} note${notes.length > 1 ? 's' : ''} on this estimation</summary>${notes.join('')}</details>`
      : '');
}

function renderMain(): void {
  $('reg-title').textContent = main ? `Regression — ${main.label}` : 'Regression';
  if (!main || !main.ok) {
    $('cards').innerHTML = '';
    $('reg-table').innerHTML = `<div class="empty">No result: ${h(main && !main.ok ? main.error : 'data unavailable')}</div>`;
    return;
  }
  const fee = feeInfo(data!, main.asset);
  const gross = fee ? grossAlpha(main, fee) : null;
  $('cards').innerHTML = statCards(main, gross);
  $('reg-table').innerHTML = regressionTable(main);
  $('fees').innerHTML = gross ? feesBlock(main, gross) : '';
}

/** Contributions factorielles et régressions partielles du modèle choisi (masqué pour le Single Index). */
function renderModelView(fit: Fit | null, t: Theme): void {
  const box = $('model-view');
  box.hidden = !fit?.ok;
  if (!fit?.ok) return;
  const s = fit.sample;
  const who = ASSET_INFO[fit.asset].sub;
  const mkt = fit.universe === 'EUROPE' ? 'EU' : 'SPI';
  const terms = s.factors.map((f) => `${FACTOR_COEF[f].replace(/_(\w+)/, '<sub>$1</sub>')}·${f}<sub>${f === 'MKT' ? `${mkt},` : ''}t</sub>`);
  $('model-title').textContent = `Reading the selected model: ${fit.label}`;
  $('model-lead').innerHTML =
    `R<sub>${who},t</sub> − R<sub>f,t</sub> = α + ${terms.join(' + ')} + ε<sub>t</sub>, estimated on ${fit.result.n} months (${s.dates[0]} → ${s.dates[s.dates.length - 1]}), ${h(COV_LABELS[fit.result.cov])}.`;
  const dec = decompose(s.y, s.x, fit.result);
  plotMeanContributions($('chart-contrib-mean'), fit, dec, t);
  plotVarianceContributions($('chart-contrib-var'), fit, dec, t);
  plotPartialRegressions($('chart-partial'), fit, partialRegressions(s.y, s.x, fit.result), t, state.band);
}

function needFit(el: HTMLElement, fit: Fit | null): fit is FitOk {
  if (fit?.ok) return true;
  el.innerHTML = `<div class="empty">${h(fit && !fit.ok ? `${fit.label}: ${fit.error}` : 'Data unavailable.')}</div>`;
  return false;
}

function renderView(): void {
  document.querySelectorAll<HTMLElement>('main > .view').forEach((v) => (v.hidden = v.id !== `view-${state.view}`));
  if (!data) return;
  if (state.view === 'analyze') renderTab();
  else if (state.view === 'compare') renderCompare();
  else if (state.view === 'data') {
    $('sources').innerHTML = sourcesTable(data);
    $('reset-data').hidden = data === pipelineData || !pipelineData;
  }
}

function renderTab(): void {
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  document.querySelectorAll<HTMLElement>('.tab-panel').forEach((p) => (p.hidden = p.id !== `tab-${state.tab}`));
  if (!data) return;
  const t = readTheme();
  switch (state.tab) {
    case 'results': {
      const el = $('chart-scatter');
      const who = ASSET_INFO[state.asset].sub;
      const isSim = state.model === 'CAPM' && state.universe === 'SWISS';
      renderModelView(isSim ? null : main, t);
      $('scatter-title').textContent = isSim
        ? `Relation with the market: ${ASSET_INFO[state.asset].label} against the SPI Total Return (Single Index)`
        : `For reference: the Single Index of the ${ASSET_INFO[state.asset].label} against the SPI Total Return`;
      $('scatter-lead').innerHTML = `R<sub>${who},t</sub> − R<sub>f,t</sub> = α + β<sub>M</sub>(R<sub>SPI,t</sub> − R<sub>f,t</sub>) + ε<sub>t</sub>, monthly returns in CHF${ASSET_INFO[state.asset].fund ? ' (net of fund fees, distributions reinvested)' : ' (dividends reinvested)'}, R<sub>f</sub> = Swiss risk-free rate (SARON; money market rates before September 2009).`;
      $('scatter-note').innerHTML = isSim
        ? ''
        : `<p class="muted small">This chart is not the selected model: it is the one-factor benchmark, kept for comparison. The table and the charts above belong to the selected model (${h(specLabel(state.model, state.universe))}).</p>`;
      if (!needFit(el, sim)) {
        $('scatter-stats').innerHTML = '';
        return;
      }
      const r = sim.result;
      const z = r.distribution === 't' ? 't' : 'z';
      $('scatter-stats').innerHTML =
        `<span>α = <b>${pct(r.beta[0], 3)}</b> / month (${pct(12 * r.beta[0], 2)} / year)</span><span>β = <b>${num(r.beta[1], 3)}</b></span>` +
        `<span>R² = <b>${num(r.r2, 3)}</b></span><span>${z}(α) = <b>${num(r.stat[0], 2)}</b></span><span>p(α) = <b>${pval(r.pvalue[0])}</b></span>` +
        `<span>N = <b>${r.n}</b></span><span class="muted">${COV_LABELS[r.cov]}${r.cov === 'HAC' ? `, L = ${r.hacLags}` : ''}</span>`;
      plotScatter(el, sim, t, { band: state.band, colorByYear: state.byYear, marketLabel: 'SPI TR' });
      break;
    }
    case 'fitted': {
      $('fitted-lead').textContent = main?.ok ? `${ASSET_INFO[main.asset].label} · ${main.label}: observed monthly excess returns and fitted values ŷ = Xb.` : '';
      if (!needFit($('chart-fitted'), main)) {
        $('chart-fitted-scatter').innerHTML = '';
        return;
      }
      plotFitted($('chart-fitted'), main, t);
      plotFittedScatter($('chart-fitted-scatter'), main, t);
      break;
    }
    case 'diagnostics': {
      if (!needFit($('tests-table'), main)) return;
      const d = diagnose(main);
      $('diag-lead').textContent = `${main.label} — OLS residuals (N = ${main.result.n}, standard deviation s = ${pct(main.result.sigma, 2)} per month).`;
      plotDiagnostics({ time: $('chart-resid'), hist: $('chart-hist'), qq: $('chart-qq'), acf: $('chart-acf') }, main, d, t);
      $('tests-table').innerHTML = testsTable(d);
      break;
    }
    case 'rolling': {
      const c = $('rolling-charts');
      if (!needFit(c, main)) return;
      const roll = rolling(main, state);
      if (typeof roll === 'string') {
        c.innerHTML = `<div class="empty">${h(roll)}</div>`;
        $('rolling-lead').textContent = '';
        return;
      }
      $('rolling-lead').textContent =
        `${main.label} — ${roll.window}-month window moved one month at a time, ${roll.dates.length} estimates, ` +
        `${COV_LABELS[state.cov]}${state.cov === 'HAC' ? ` (L = ${roll.hacLags[0]})` : ''}${state.band ? ', 95% confidence intervals' : ''}. Date = end of window.`;
      plotRolling(c, roll, t, state.band);
      break;
    }
    case 'comparison': {
      const key = JSON.stringify([state.asset, state.range, state.cov, state.hacLags, data!.generated_at]);
      if (comparisonCache?.key !== key) comparisonCache = { key, cmp: compareModels(data!, state) };
      const cmp = comparisonCache.cmp;
      $('comparison-lead').innerHTML =
        cmp.period
          ? `All specifications are estimated on the <b>same sample</b>: ${cmp.commonN} months, ${cmp.period[0]} → ${cmp.period[1]} (intersection of availabilities). ${h(COV_LABELS[state.cov])}. In the Swiss universe, the CAPM is the Single Index on the SPI TR; the European universe serves as a comparison.`
          : 'No month common to all available specifications.';
      if (cmp.excluded.length) $('comparison-lead').innerHTML += `<br><span class="muted small">Excluded: ${h(cmp.excluded.join(' · '))}</span>`;
      plotComparison($('chart-comparison'), cmp, t);
      $('comparison-table').innerHTML = comparisonTable(cmp);
      break;
    }
  }
}

function compareIntro(pair: Pair): { question: string; method: string } {
  const [a, b] = pair.map((x) => ASSET_INFO[x]);
  const bcvFund = pair.includes('BCV') && pair.includes('FUND');
  if (bcvFund) {
    return {
      question: '<strong>Did the bank generate more factor-adjusted return for its own shareholders than for the investors in its Swiss equity fund?</strong>',
      method:
        '<p>The two alphas do not measure the same thing. The <b>BCV stock alpha</b> is the part of the stock’s historical excess return that the chosen factors do not explain: it reflects all of the bank’s activities (lending, wealth management, asset management…) and how the market valued them. The <b>BCV Swiss Equity A fund alpha</b> is the part of the fund’s excess return, <em>net of the fees embedded in its NAV</em> with distributions reinvested, that the same factors do not explain: it reflects BCV Asset Management’s stock selection on behalf of unitholders. The fund’s management fees are part of the bank’s revenue; the comparison does not, however, establish any causal link between the two.</p>',
    };
  }
  if (a.fund && b.fund) {
    return {
      question: `<strong>Which of the two funds delivered the better factor-adjusted return, after fees?</strong>`,
      method: `<p>Both alphas are <b>net of the fees</b> embedded in the NAV, distributions reinvested: they measure what unitholders earned beyond their factor exposure. An alpha gap can come from stock selection, allocation, or simply different fees. Both funds use the SPI as their benchmark, but not necessarily with the same risk constraints: compare their R² and residual volatilities too.</p>`,
    };
  }
  return {
    question: `<strong>Did ${h(a.label)} and ${h(b.label)} deliver different factor-adjusted returns?</strong>`,
    method: `<p>A fund alpha is net of fees and relates to a diversified portfolio; a stock alpha reflects the performance of a single company, with much higher specific risk. The gap is estimated directly, but the two alphas do not measure the same thing.</p>`,
  };
}

function renderCompare(): void {
  const t = readTheme();
  const key = JSON.stringify([state.pair, state.range, state.cov, state.hacLags, state.universe, data!.generated_at]);
  if (versusCache?.key !== key) versusCache = { key, cmp: compareAssets(data!, state, state.pair) };
  const cmp = versusCache.cmp;
  const [na, nb] = state.pair.map((x) => ASSET_INFO[x].label);
  $('vs-title').textContent = `${na} and ${nb}`;
  const intro = compareIntro(state.pair);
  $('vs-question').innerHTML = intro.question;
  $('vs-method').innerHTML = intro.method;
  $<HTMLAnchorElement>('vs-report').hidden = !(state.pair.includes('BCV') && state.pair.includes('FUND'));
  const blocks = ['vs-perf-table', 'vs-alpha-table', 'vs-mf-table', 'vs-reading'];
  if (!cmp.ok) {
    $('vs-sample').innerHTML = alertHtml('error', 'Comparison not possible.', ` ${h(cmp.error ?? '')}`);
    blocks.forEach((b) => ($(b).innerHTML = ''));
    ['chart-vs-perf', 'chart-vs-alpha', 'chart-vs-sim-a', 'chart-vs-sim-b'].forEach((c) => ($(c).innerHTML = ''));
    return;
  }
  $('vs-sample').innerHTML = `<div class="strip"><span><b>Identical sample</b> for both assets: ${cmp.dates.length} months, ${cmp.dates[0]} → ${cmp.dates[cmp.dates.length - 1]}</span><span>Factors: ${{ SPI: 'SPI TR', EUROPE: 'European Fama-French (CHF)', SWISS: 'SPI TR and Swiss JKP factors (CHF)' }[state.universe]}</span><span>${h(COV_LABELS[state.cov])}</span></div>`;
  plotPerformance($('chart-vs-perf'), cmp, t);
  $('vs-perf-table').innerHTML = perfTable(cmp);
  const sel = cmp.models.find((m) => m.model === state.model)!;
  $('vs-alpha-title').textContent = `B. Alphas compared — ${MODEL_SHORT[state.model]}`;
  $('vs-alpha-table').innerHTML = alphaPairTable(sel, cmp.pair, [feeInfo(data!, cmp.pair[0]), feeInfo(data!, cmp.pair[1])]);
  plotAlphaPair($('chart-vs-alpha'), cmp, t);
  const pair = singleIndexPair(data!, state, cmp);
  if (pair.a.ok && pair.b.ok) {
    const ranges = commonRanges([pair.a, pair.b]);
    plotScatter($('chart-vs-sim-a'), pair.a, t, { band: state.band, colorByYear: false, marketLabel: 'SPI TR', ranges, compact: true });
    plotScatter($('chart-vs-sim-b'), pair.b, t, { band: state.band, colorByYear: false, marketLabel: 'SPI TR', ranges, compact: true });
  }
  $('vs-mf-table').innerHTML = multiFactorPairTable(cmp);
  $('vs-reading').innerHTML = versusReading(cmp, sel, [feeInfo(data!, cmp.pair[0]), feeInfo(data!, cmp.pair[1])]);
}

/** Lecture descriptive des résultats de la comparaison (aucune conclusion causale). */
function versusReading(cmp: AssetComparison, m: AssetComparison['models'][number], fees: [FeeInfo | null, FeeInfo | null]): string {
  const out: string[] = [];
  const [pa, pb] = [cmp.perf[0], cmp.perf[1]];
  const name = (id: SingleAsset) => `the ${ASSET_INFO[id].short}`;
  const [na, nb] = cmp.pair.map(name);
  out.push(
    `Over these ${cmp.dates.length} months, ${na} returned ${pct(pa.annReturn, 1)} a year and ${nb} ${pct(pb.annReturn, 1)}, ` +
      `with volatility of ${pct(pa.annVol, 1)} versus ${pct(pb.annVol, 1)}.`,
  );
  if (m.a.ok && m.b.ok && m.diff.ok) {
    const [ra, rb, rd] = [m.a.result, m.b.result, m.diff.result];
    const sig = (p: number) => (p < 0.05 ? 'significant at the 5% level' : 'not significant at the 5% level');
    out.push(
      `With the ${MODEL_SHORT[m.model]} model, the annualised alpha is ${pct(12 * ra.beta[0], 1)} for ${na} (${sig(ra.pvalue[0])}) ` +
        `and ${pct(12 * rb.beta[0], 1)} for ${nb} (${sig(rb.pvalue[0])}). ` +
        `The gap of ${pct(12 * rd.beta[0], 1)} a year is ${sig(rd.pvalue[0])} (regression of the return difference, p = ${pval(rd.pvalue[0])}).`,
    );
    if (fees[0] || fees[1]) {
      const ta = fees[0]?.ter ?? 0;
      const tb = fees[1]?.ter ?? 0;
      const g = shiftAlpha(m.diff, (ta - tb) / 12);
      out.push(
        `Before management fees (net α + TER), the alpha would be about ${pct(12 * ra.beta[0] + ta, 1)} for ${na} and ${pct(12 * rb.beta[0] + tb, 1)} for ${nb}; ` +
          `the gross gap of ${pct(12 * g.alpha, 1)} a year is ${sig(g.pvalue)}. ` +
          (Math.abs(ta - tb) < 0.002 ? 'As the fees are close, the alpha gap hardly comes from fees.' : `The fee difference (${pct(ta - tb, 2)} a year) explains part of the net gap.`),
      );
    }
    out.push(
      `Betas of ${num(ra.beta[1], 2)} and ${num(rb.beta[1], 2)}; residual volatilities of ${pct(ra.sigma * Math.sqrt(12), 1)} and ${pct(rb.sigma * Math.sqrt(12), 1)} a year. ` +
        `The lower the residual volatility, the more precisely the alpha is estimated.`,
    );
  }
  return out.map((p) => `<p>${p}</p>`).join('');
}

function compute(): void {
  const ds = data!;
  main = fitModel(ds, state.model, state.universe, state);
  sim = state.model === 'CAPM' && state.universe === 'SWISS' ? main : fitModel(ds, 'CAPM', 'SPI', state);
}

function renderAll(): void {
  clampRange(state, data!);
  compute();
  syncControls();
  renderHeader();
  renderAlerts();
  renderMain();
  renderView();
  writeHash();
}

// ------------------------------------------------------------------ événements

function bind(): void {
  const on = (id: string, fn: (el: HTMLInputElement & HTMLSelectElement) => void) =>
    $(id).addEventListener('change', (e) => {
      fn(e.target as HTMLInputElement & HTMLSelectElement);
      renderAll();
    });
  on('start', (el) => {
    if (el.value) state.range.start = el.value;
    if (state.range.start > state.range.end) state.range.end = state.range.start;
  });
  on('end', (el) => {
    if (el.value) state.range.end = el.value;
    if (state.range.end < state.range.start) state.range.start = state.range.end;
  });
  on('asset', (el) => {
    state.asset = el.value as SingleAsset;
    comparisonCache = null;
    resetStart();
  });
  on('asset-a', (el) => {
    state.pair = [el.value as SingleAsset, state.pair[1]];
    resetStart();
  });
  on('asset-b', (el) => {
    state.pair = [state.pair[0], el.value as SingleAsset];
    resetStart();
  });
  on('model', (el) => (state.model = el.value as ModelId));
  on('universe', (el) => (state.universe = el.value as Universe));
  on('cov', (el) => (state.cov = el.value as CovType));
  on('hac-lags', (el) => (state.hacLags = el.value === 'auto' ? null : Number(el.value)));
  on('window', (el) => (state.window = Number(el.value)));
  on('band', (el) => (state.band = el.checked));
  on('by-year', (el) => (state.byYear = el.checked));

  const goto = (v: View) => {
    state.view = v;
    renderAll();
    window.scrollTo({ top: 0 });
  };
  document.querySelectorAll<HTMLButtonElement>('.views button').forEach((b) => b.addEventListener('click', () => goto(b.dataset.view as View)));
  $('data-meta').addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-goto]');
    if (t) goto(t.dataset.goto as View);
  });

  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      state.tab = b.dataset.tab as Tab;
      renderTab();
      writeHash();
    }),
  );

  $('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('eap-theme', next);
    } catch {
      /* stockage indisponible */
    }
    if (data) renderView();
  });

  $('export-table').addEventListener('click', () => main?.ok && download(`regression_${state.asset}_${state.model}_${state.universe}_${state.cov}.csv`, regressionCsv(main)));
  $('export-sample').addEventListener('click', () => main?.ok && download(`echantillon_${state.asset}_${state.model}_${state.universe}.csv`, sampleCsv(main)));
  $('export-comparison').addEventListener('click', () => {
    if (!data) return;
    const cmp = comparisonCache?.cmp ?? compareModels(data, state);
    download(`comparaison_modeles_${state.cov}.csv`, comparisonCsv(cmp));
  });
  $('export-versus').addEventListener('click', () => {
    if (!data) return;
    const cmp = versusCache?.cmp ?? compareAssets(data, state, state.pair);
    if (cmp.ok) download(`comparaison_${state.pair[0]}_${state.pair[1]}_${state.universe}_${state.cov}.csv`, assetComparisonCsv(cmp));
  });
  $('export-dataset').addEventListener('click', () => data && download('eap_dataset_mensuel.csv', datasetToCsv(data)));

  $<HTMLInputElement>('csv-input').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const ds = parseCsvDataset(await file.text(), file.name);
      // descriptions des actifs connus (libellés, TER) reprises du jeu de données public
      const known = pipelineData?.assets?.filter((a) => ds.data[a.column]);
      if (known?.length) ds.assets = known;
      setData(ds, false);
    } catch (err) {
      $('alerts').innerHTML = alertHtml('error', 'CSV import rejected.', ` ${h((err as Error).message)}`) + $('alerts').innerHTML;
    }
    input.value = '';
  });
  $('reset-data').addEventListener('click', () => pipelineData && setData(pipelineData, false));

  // lien partagé ou navigation vers une autre ancre : relire les paramètres
  window.addEventListener('hashchange', () => {
    if (!data) return;
    state = readHash(defaultState(data));
    comparisonCache = null;
    versusCache = null;
    renderAll();
  });

  let timer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => resizeAll(document.body), 150);
  });
}

function setData(ds: Dataset, fromHash: boolean): void {
  data = ds;
  registerAssets(ds);
  fillAssetMenus();
  comparisonCache = null;
  versusCache = null;
  const base = defaultState(ds);
  state = fromHash ? readHash(base) : { ...base, view: state?.view ?? base.view, tab: state?.tab ?? base.tab };
  renderAll();
}

async function init(): Promise<void> {
  bind();
  try {
    pipelineData = await loadDataset(DATA_URL);
    setData(pipelineData, true);
  } catch (e) {
    const msg = e instanceof DatasetError ? e.message : `Unexpected error: ${(e as Error).message}`;
    $('data-meta').textContent = 'No data loaded';
    $('alerts').innerHTML = alertHtml('error', 'Data unavailable.', ` ${h(msg)}`);
    $('reg-table').innerHTML = '<div class="empty">No estimation: import a CSV in “Data & method”.</div>';
    state = { ...defaultState({ dates: ['2000-01'], data: {} } as unknown as Dataset), view: 'data' };
    document.querySelectorAll<HTMLElement>('main > .view').forEach((v) => (v.hidden = v.id !== 'view-data'));
  }
}

void init();
