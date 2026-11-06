/** Point d'entrée : chargement des données, paramètres, rendu. */

import './styles.css';
import type { Dataset } from './data/types.ts';
import { loadDataset, parseCsvDataset, datasetToCsv, DatasetError } from './data/loader.ts';
import { compareModels, diagnose, fitModel, rolling, type Fit, type FitOk, type Settings, type Comparison } from './ui/analysis.ts';
import { plotComparison, plotDiagnostics, plotFitted, plotFittedScatter, plotRolling, plotScatter, readTheme, resizeAll } from './ui/charts.ts';
import { comparisonTable, regressionTable, sourcesTable, statCards, testsTable, COV_LABELS } from './ui/tables.ts';
import { comparisonCsv, download, regressionCsv, sampleCsv } from './ui/export.ts';
import { escapeHtml as h, monthLabel, num, pct, pval } from './ui/format.ts';
import { neweyWestAutoLags, type CovType } from './engine/ols.ts';
import { MODEL_IDS, UNIVERSES, specLabel, type ModelId, type Universe } from './engine/models.ts';

type Tab = 'scatter' | 'fitted' | 'diagnostics' | 'rolling' | 'comparison' | 'data';

interface UIState extends Settings {
  tab: Tab;
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

const DATA_URL = `${import.meta.env.BASE_URL}data/dataset.json`;

// ------------------------------------------------------------------ alertes

type Level = 'error' | 'warn' | 'info';
function alertHtml(level: Level, title: string, text: string): string {
  return `<div class="alert alert-${level}" role="${level === 'error' ? 'alert' : 'status'}"><strong>${h(title)}</strong>${text}</div>`;
}

// ------------------------------------------------------------------ état / URL

/** Plage utile : du premier au dernier mois où le rendement BCV existe. */
function bounds(ds: Dataset): [string, string] {
  const months = ds.dates.filter((_, i) => ds.data.bcv_ret?.[i] != null);
  return months.length ? [months[0], months[months.length - 1]] : [ds.dates[0], ds.dates[ds.dates.length - 1]];
}

function clampRange(s: UIState, ds: Dataset): void {
  const [lo, hi] = bounds(ds);
  if (s.range.start < lo || s.range.start > hi) s.range.start = lo;
  if (s.range.end > hi || s.range.end < lo) s.range.end = hi;
  if (s.range.start > s.range.end) [s.range.start, s.range.end] = [lo, hi];
}

function defaultState(ds: Dataset): UIState {
  const first = ds.dates.find((_, i) => ds.data.bcv_ret?.[i] != null && ds.data.rf_saron?.[i] != null) ?? ds.dates[0];
  return {
    range: { start: first, end: ds.dates[ds.dates.length - 1] },
    model: 'CAPM',
    universe: 'SPI',
    cov: 'classical',
    hacLags: null,
    window: 60,
    tab: 'scatter',
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
  if (MODEL_IDS.includes(p.get('model') as ModelId)) s.model = p.get('model') as ModelId;
  if (UNIVERSES.includes(p.get('market') as Universe)) s.universe = p.get('market') as Universe;
  if (['classical', 'HC3', 'HAC'].includes(p.get('se') ?? '')) s.cov = p.get('se') as CovType;
  const lags = p.get('lags');
  if (lags && /^\d+$/.test(lags)) s.hacLags = Number(lags);
  if (['36', '60', '120'].includes(p.get('window') ?? '')) s.window = Number(p.get('window'));
  if (['scatter', 'fitted', 'diagnostics', 'rolling', 'comparison', 'data'].includes(p.get('tab') ?? '')) s.tab = p.get('tab') as Tab;
  if (p.get('band') === '0') s.band = false;
  if (p.get('year') === '1') s.byYear = true;
  return s;
}

function writeHash(): void {
  const p = new URLSearchParams({
    start: state.range.start,
    end: state.range.end,
    model: state.model,
    market: state.universe,
    se: state.cov,
    window: String(state.window),
    tab: state.tab,
  });
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
}

// ------------------------------------------------------------------ rendu

function renderHeader(): void {
  const ds = data!;
  const errors = ds.sources.filter((s) => s.status === 'error');
  const when = new Date(ds.generated_at);
  const date = Number.isNaN(when.getTime()) ? ds.generated_at : when.toLocaleString('fr-CH', { dateStyle: 'long', timeStyle: 'short' });
  const origin = ds.origin === 'manual-csv' ? 'Import manuel CSV' : 'Yahoo Finance (BCV, SPI TR) · BNS (SARON, USD/CHF) · K. French (facteurs Europe)';
  const bcv = ds.dates.filter((_, i) => ds.data.bcv_ret?.[i] != null);
  const span = bcv.length ? `BCV ${monthLabel(bcv[0])} → ${monthLabel(bcv[bcv.length - 1])}` : 'aucun rendement BCV';
  $('data-meta').innerHTML =
    `<div><b>Sources :</b> ${h(origin)}</div><div><b>Actualisé :</b> ${h(date)} · ${h(span)}</div>` +
    (errors.length ? `<div style="color:var(--err)"><b>${errors.length} source(s) en erreur</b> (voir « Données & méthodologie »)</div>` : '');
}

function renderAlerts(): void {
  const ds = data!;
  const out: string[] = [];
  if (ds.origin === 'manual-csv') {
    out.push(alertHtml('warn', 'Données importées manuellement.', ' Elles n’ont pas été contrôlées par le pipeline ; la provenance et les conventions relèvent de l’utilisateur.'));
  }
  for (const s of ds.sources.filter((x) => x.status === 'error')) {
    out.push(alertHtml('error', `Source indisponible : ${s.name}.`, ` ${h(s.message ?? '')} Les modèles qui en dépendent ne sont pas estimés.`));
  }
  for (const c of ds.checks.filter((x) => x.status === 'fail')) out.push(alertHtml('error', 'Contrôle de données échoué.', ` ${h(c.message)}`));
  if (main && !main.ok) out.push(alertHtml('error', `${main.label} : estimation impossible.`, ` ${h(main.error)}`));
  if (main?.ok) {
    if (main.coherence === 'hybrid') {
      out.push(alertHtml('warn', 'Variante hybride.', ' Le marché est le SPI TR (Suisse) tandis que SMB, HML, MOM, RMW, CMA sont des facteurs européens Fama-French convertis en CHF : l’univers de facteurs n’est pas homogène. Pour un univers cohérent, choisissez « Europe Fama-French ».'));
    }
    const s = main.sample;
    const eff = `${s.dates[0]} → ${s.dates[s.dates.length - 1]}, ${s.y.length} mois`;
    if (s.droppedMonths > 0) {
      out.push(alertHtml('info', 'Échantillon effectif :', ` ${eff}. ${s.droppedMonths} mois de la plage choisie n’ont pas toutes les séries requises et sont exclus (aucune interpolation).`));
    }
    for (const w of main.warnings.filter((x) => !x.includes('exclus faute'))) out.push(alertHtml('warn', 'Échantillon.', ` ${h(w)}`));
    if (main.result.cov !== 'classical') {
      out.push(alertHtml('info', 'Inférence robuste.', ` ${COV_LABELS[main.result.cov]} : statistiques z, p-values et intervalles fondés sur la loi normale ; le test global est un test de Wald χ² (une statistique F classique ne serait pas robuste).`));
    }
  }
  $('alerts').innerHTML = out.join('');
}

function renderMain(): void {
  $('reg-title').textContent = main ? `Régression — ${main.label}` : 'Régression';
  if (!main || !main.ok) {
    $('cards').innerHTML = '';
    $('reg-table').innerHTML = `<div class="empty">Aucun résultat : ${h(main && !main.ok ? main.error : 'données indisponibles')}</div>`;
    return;
  }
  $('cards').innerHTML = statCards(main);
  $('reg-table').innerHTML = regressionTable(main);
}

function needFit(el: HTMLElement, fit: Fit | null): fit is FitOk {
  if (fit?.ok) return true;
  el.innerHTML = `<div class="empty">${h(fit && !fit.ok ? `${fit.label} : ${fit.error}` : 'Données indisponibles.')}</div>`;
  return false;
}

function renderTab(): void {
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  document.querySelectorAll<HTMLElement>('.tab-panel').forEach((p) => (p.hidden = p.id !== `tab-${state.tab}`));
  if (!data) return;
  const t = readTheme();
  switch (state.tab) {
    case 'scatter': {
      const el = $('chart-scatter');
      const note =
        state.model !== 'CAPM' || state.universe !== 'SPI'
          ? alertHtml('info', 'Graphique du Single Index Model.', ` Le nuage de points et la droite représentent toujours la régression sur le SPI TR ; le tableau ci-dessus correspond au modèle sélectionné (${h(specLabel(state.model, state.universe))}).`)
          : '';
      $('scatter-note').innerHTML = note;
      if (!needFit(el, sim)) {
        $('scatter-stats').innerHTML = '';
        return;
      }
      const r = sim.result;
      const z = r.distribution === 't' ? 't' : 'z';
      $('scatter-stats').innerHTML =
        `<span>α = <b>${pct(r.beta[0], 3)}</b> / mois (${pct(12 * r.beta[0], 2)} / an)</span><span>β = <b>${num(r.beta[1], 3)}</b></span>` +
        `<span>R² = <b>${num(r.r2, 3)}</b></span><span>${z}(α) = <b>${num(r.stat[0], 2)}</b></span><span>p(α) = <b>${pval(r.pvalue[0])}</b></span>` +
        `<span>N = <b>${r.n}</b></span><span class="muted">${COV_LABELS[r.cov]}${r.cov === 'HAC' ? `, L = ${r.hacLags}` : ''}</span>`;
      plotScatter(el, sim, t, { band: state.band, colorByYear: state.byYear, marketLabel: 'SPI TR' });
      break;
    }
    case 'fitted': {
      $('fitted-lead').textContent = main?.ok ? `${main.label} : rendements excédentaires mensuels observés de BCV et valeurs ajustées ŷ = Xb.` : '';
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
      $('diag-lead').textContent = `${main.label} — résidus OLS (N = ${main.result.n}, écart-type s = ${pct(main.result.sigma, 2)} par mois).`;
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
        `${main.label} — fenêtre de ${roll.window} mois glissant d’un mois, ${roll.dates.length} estimations, ` +
        `${COV_LABELS[state.cov]}${state.cov === 'HAC' ? ` (L = ${roll.hacLags[0]})` : ''}${state.band ? ', intervalles de confiance à 95 %' : ''}. Date = fin de fenêtre.`;
      plotRolling(c, roll, t, state.band);
      break;
    }
    case 'comparison': {
      const key = JSON.stringify([state.range, state.cov, state.hacLags, data!.generated_at]);
      if (comparisonCache?.key !== key) comparisonCache = { key, cmp: compareModels(data!, state) };
      const cmp = comparisonCache.cmp;
      $('comparison-lead').innerHTML =
        cmp.period
          ? `Les 8 spécifications sont estimées sur le <b>même échantillon</b> : ${cmp.commonN} mois, ${cmp.period[0]} → ${cmp.period[1]} (intersection des disponibilités). ${h(COV_LABELS[state.cov])}. Les variantes « SPI » multifactorielles sont hybrides.`
          : 'Aucun mois commun à toutes les spécifications disponibles.';
      if (cmp.excluded.length) $('comparison-lead').innerHTML += `<br><span class="muted small">Exclues : ${h(cmp.excluded.join(' · '))}</span>`;
      plotComparison($('chart-comparison'), cmp, t);
      $('comparison-table').innerHTML = comparisonTable(cmp);
      break;
    }
    case 'data':
      $('sources').innerHTML = sourcesTable(data!);
      $('reset-data').hidden = data === pipelineData || !pipelineData;
      break;
  }
}

function compute(): void {
  const ds = data!;
  main = fitModel(ds, state.model, state.universe, state);
  sim = state.model === 'CAPM' && state.universe === 'SPI' ? main : fitModel(ds, 'CAPM', 'SPI', state);
}

function renderAll(): void {
  clampRange(state, data!);
  compute();
  syncControls();
  renderHeader();
  renderAlerts();
  renderMain();
  renderTab();
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
  on('model', (el) => (state.model = el.value as ModelId));
  on('universe', (el) => (state.universe = el.value as Universe));
  on('cov', (el) => (state.cov = el.value as CovType));
  on('hac-lags', (el) => (state.hacLags = el.value === 'auto' ? null : Number(el.value)));
  on('window', (el) => (state.window = Number(el.value)));
  on('band', (el) => (state.band = el.checked));
  on('by-year', (el) => (state.byYear = el.checked));

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
    if (data) renderTab();
  });

  $('export-table').addEventListener('click', () => main?.ok && download(`regression_${state.model}_${state.universe}_${state.cov}.csv`, regressionCsv(main)));
  $('export-sample').addEventListener('click', () => main?.ok && download(`echantillon_${state.model}_${state.universe}.csv`, sampleCsv(main)));
  $('export-comparison').addEventListener('click', () => {
    if (!data) return;
    const cmp = comparisonCache?.cmp ?? compareModels(data, state);
    download(`comparaison_modeles_${state.cov}.csv`, comparisonCsv(cmp));
  });
  $('export-dataset').addEventListener('click', () => data && download('eap_dataset_mensuel.csv', datasetToCsv(data)));

  $<HTMLInputElement>('csv-input').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const ds = parseCsvDataset(await file.text(), file.name);
      setData(ds, false);
    } catch (err) {
      $('alerts').innerHTML = alertHtml('error', 'Import CSV refusé.', ` ${h((err as Error).message)}`) + $('alerts').innerHTML;
    }
    input.value = '';
  });
  $('reset-data').addEventListener('click', () => pipelineData && setData(pipelineData, false));

  let timer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => resizeAll(document.body), 150);
  });
}

function setData(ds: Dataset, fromHash: boolean): void {
  data = ds;
  comparisonCache = null;
  const base = defaultState(ds);
  const prevTab = state?.tab;
  state = fromHash ? readHash(base) : { ...base, tab: prevTab ?? base.tab };
  renderAll();
}

async function init(): Promise<void> {
  bind();
  try {
    pipelineData = await loadDataset(DATA_URL);
    setData(pipelineData, true);
  } catch (e) {
    const msg = e instanceof DatasetError ? e.message : `Erreur inattendue : ${(e as Error).message}`;
    $('data-meta').textContent = 'Aucune donnée chargée';
    $('alerts').innerHTML = alertHtml('error', 'Données indisponibles.', ` ${h(msg)}`);
    $('reg-table').innerHTML = '<div class="empty">Aucune estimation : importez un CSV dans l’onglet « Données &amp; méthodologie ».</div>';
    state = { ...(defaultState({ dates: ['2000-01'], data: {} } as unknown as Dataset)), tab: 'data' };
    document.querySelectorAll<HTMLElement>('.tab-panel').forEach((p) => (p.hidden = p.id !== 'tab-data'));
    document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === 'data')));
  }
}

void init();
