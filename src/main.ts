/** Point d'entrée : chargement des données, paramètres, rendu. */

import './styles.css';
import type { Dataset } from './data/types.ts';
import { loadDataset, parseCsvDataset, datasetToCsv, DatasetError } from './data/loader.ts';
import { compareAssets, compareModels, diagnose, fitModel, rolling, singleIndexPair, type AssetComparison, type Fit, type FitOk, type Settings, type Comparison } from './ui/analysis.ts';
import { commonRanges, plotAlphaPair, plotComparison, plotDiagnostics, plotFitted, plotFittedScatter, plotPerformance, plotRolling, plotScatter, readTheme, resizeAll } from './ui/charts.ts';
import { alphaPairTable, comparisonTable, multiFactorPairTable, perfTable, regressionTable, sourcesTable, statCards, testsTable, COV_LABELS } from './ui/tables.ts';
import { assetComparisonCsv, comparisonCsv, download, regressionCsv, sampleCsv } from './ui/export.ts';
import { escapeHtml as h, monthLabel, num, pct, pval } from './ui/format.ts';
import { neweyWestAutoLags, type CovType } from './engine/ols.ts';
import { ASSET_INFO, MODEL_IDS, MODEL_SHORT, UNIVERSES, specLabel, type AssetId, type ModelId, type Universe } from './engine/models.ts';

type Tab = 'scatter' | 'fitted' | 'diagnostics' | 'rolling' | 'comparison' | 'versus' | 'data';

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
let versusCache: { key: string; cmp: AssetComparison } | null = null;

const DATA_URL = `${import.meta.env.BASE_URL}data/dataset.json`;

// ------------------------------------------------------------------ alertes

type Level = 'error' | 'warn' | 'info';
function alertHtml(level: Level, title: string, text: string): string {
  return `<div class="alert alert-${level}" role="${level === 'error' ? 'alert' : 'status'}"><strong>${h(title)}</strong>${text}</div>`;
}

// ------------------------------------------------------------------ état / URL

const ASSET_COL = { BCV: 'bcv_ret', FUND: 'fund_ret', DIFF: 'bcv_ret' } as const;

/** Plage utile : du premier au dernier mois où le rendement de l'actif choisi existe. */
function bounds(ds: Dataset, asset: AssetId = state?.asset ?? 'BCV'): [string, string] {
  const months = ds.dates.filter((_, i) => ds.data[ASSET_COL[asset]]?.[i] != null);
  return months.length ? [months[0], months[months.length - 1]] : [ds.dates[0], ds.dates[ds.dates.length - 1]];
}

function clampRange(s: UIState, ds: Dataset): void {
  const [lo, hi] = bounds(ds, s.asset);
  if (s.range.start < lo || s.range.start > hi) s.range.start = lo;
  if (s.range.end > hi || s.range.end < lo) s.range.end = hi;
  if (s.range.start > s.range.end) [s.range.start, s.range.end] = [lo, hi];
}

function defaultState(ds: Dataset, asset: AssetId = 'BCV'): UIState {
  const col = ASSET_COL[asset];
  const first = ds.dates.find((_, i) => ds.data[col]?.[i] != null && ds.data.rf_saron?.[i] != null) ?? ds.dates[0];
  return {
    asset,
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
  if (p.get('asset') === 'FUND' || p.get('asset') === 'BCV') s.asset = p.get('asset') as AssetId;
  if (MODEL_IDS.includes(p.get('model') as ModelId)) s.model = p.get('model') as ModelId;
  if (UNIVERSES.includes(p.get('market') as Universe)) s.universe = p.get('market') as Universe;
  if (['classical', 'HC3', 'HAC'].includes(p.get('se') ?? '')) s.cov = p.get('se') as CovType;
  const lags = p.get('lags');
  if (lags && /^\d+$/.test(lags)) s.hacLags = Number(lags);
  if (['36', '60', '120'].includes(p.get('window') ?? '')) s.window = Number(p.get('window'));
  if (['scatter', 'fitted', 'diagnostics', 'rolling', 'comparison', 'versus', 'data'].includes(p.get('tab') ?? '')) s.tab = p.get('tab') as Tab;
  if (p.get('band') === '0') s.band = false;
  if (p.get('year') === '1') s.byYear = true;
  return s;
}

function writeHash(): void {
  const p = new URLSearchParams({
    asset: state.asset,
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
  $<HTMLSelectElement>('asset').value = state.asset;
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
  const origin = ds.origin === 'manual-csv' ? 'Import manuel CSV' : 'Yahoo Finance (BCV, SPI TR) · Gérifonds (fonds) · BNS (SARON, USD/CHF) · K. French (facteurs Europe)';
  const months = ds.dates.filter((_, i) => ds.data[ASSET_COL[state.asset]]?.[i] != null);
  const span = months.length ? `${ASSET_INFO[state.asset].short} ${monthLabel(months[0])} → ${monthLabel(months[months.length - 1])}` : `aucun rendement pour ${ASSET_INFO[state.asset].label}`;
  $<HTMLAnchorElement>('report-link').href = state.asset === 'FUND' ? './report/rapport_fonds.pdf' : './report/rapport_bcv.pdf';
  $<HTMLAnchorElement>('presentation-link').hidden = state.asset !== 'FUND';
  $('subtitle').innerHTML = state.asset === 'FUND'
    ? 'Fonds <b>BCV Swiss Equity A</b> <span class="mono">(BCV Asset Management)</span> · ISIN CH0006018706 · CHF'
    : 'Action <b>Banque Cantonale Vaudoise</b> <span class="mono">(BCVN · SIX)</span> · ISIN CH0531751755 · CHF';
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
      const who = state.asset === 'FUND' ? 'fonds' : 'BCV';
      $('scatter-title').textContent = `Single Index Model : ${ASSET_INFO[state.asset].label} contre le SPI Total Return`;
      $('scatter-lead').innerHTML = `R<sub>${who},t</sub> − R<sub>f,t</sub> = α + β<sub>M</sub>(R<sub>SPI,t</sub> − R<sub>f,t</sub>) + ε<sub>t</sub>, rendements mensuels en CHF${state.asset === 'FUND' ? ' (nets des frais du fonds, distributions réinvesties)' : ' (dividendes réinvestis)'}, R<sub>f</sub> = SARON capitalisé.`;
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
      $('fitted-lead').textContent = main?.ok ? `${ASSET_INFO[main.asset].label} · ${main.label} : rendements excédentaires mensuels observés et valeurs ajustées ŷ = Xb.` : '';
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
      const key = JSON.stringify([state.asset, state.range, state.cov, state.hacLags, data!.generated_at]);
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
    case 'versus': {
      const key = JSON.stringify([state.range, state.cov, state.hacLags, state.universe, data!.generated_at]);
      if (versusCache?.key !== key) versusCache = { key, cmp: compareAssets(data!, state) };
      const cmp = versusCache.cmp;
      const blocks = ['vs-perf-table', 'vs-alpha-table', 'vs-mf-table', 'vs-reading'];
      if (!cmp.ok) {
        $('vs-sample').innerHTML = alertHtml('error', 'Comparaison impossible.', ` ${h(cmp.error ?? '')}`);
        blocks.forEach((b) => ($(b).innerHTML = ''));
        ['chart-vs-perf', 'chart-vs-alpha', 'chart-vs-sim-bcv', 'chart-vs-sim-fund'].forEach((c) => ($(c).innerHTML = ''));
        return;
      }
      $('vs-sample').innerHTML = `<div class="strip"><span><b>Échantillon identique</b> pour les deux actifs : ${cmp.dates.length} mois, ${cmp.dates[0]} → ${cmp.dates[cmp.dates.length - 1]}</span><span>Marché des modèles : ${state.universe === 'SPI' ? 'SPI TR (FF3/Carhart/FF5 hybrides)' : 'Europe FF (CHF)'}</span><span>${h(COV_LABELS[state.cov])}</span></div>`;
      plotPerformance($('chart-vs-perf'), cmp, t);
      $('vs-perf-table').innerHTML = perfTable(cmp);
      const sel = cmp.models.find((m) => m.model === state.model)!;
      $('vs-alpha-title').textContent = `B. Alphas comparés — ${MODEL_SHORT[state.model]}`;
      $('vs-alpha-table').innerHTML = alphaPairTable(sel);
      plotAlphaPair($('chart-vs-alpha'), cmp, t);
      const pair = singleIndexPair(data!, state, cmp);
      if (pair.bcv.ok && pair.fund.ok) {
        const ranges = commonRanges([pair.bcv, pair.fund]);
        plotScatter($('chart-vs-sim-bcv'), pair.bcv, t, { band: state.band, colorByYear: false, marketLabel: 'SPI TR', ranges, compact: true });
        plotScatter($('chart-vs-sim-fund'), pair.fund, t, { band: state.band, colorByYear: false, marketLabel: 'SPI TR', ranges, compact: true });
      }
      $('vs-mf-table').innerHTML = multiFactorPairTable(cmp);
      $('vs-reading').innerHTML = versusReading(cmp, sel);
      break;
    }
    case 'data':
      $('sources').innerHTML = sourcesTable(data!);
      $('reset-data').hidden = data === pipelineData || !pipelineData;
      break;
  }
}

/** Lecture descriptive des résultats de la comparaison (aucune conclusion causale). */
function versusReading(cmp: AssetComparison, m: AssetComparison['models'][number]): string {
  const out: string[] = [];
  const [b, f] = [cmp.perf[0], cmp.perf[1]];
  out.push(
    `Sur ces ${cmp.dates.length} mois, l’action a rapporté ${pct(b.annReturn, 1)} par an et le fonds ${pct(f.annReturn, 1)}, ` +
      `avec une volatilité de ${pct(b.annVol, 1)} contre ${pct(f.annVol, 1)}.`,
  );
  if (m.bcv.ok && m.fund.ok && m.diff.ok) {
    const [rb, rf, rd] = [m.bcv.result, m.fund.result, m.diff.result];
    const sig = (p: number) => (p < 0.05 ? 'significatif au seuil de 5 %' : 'non significatif au seuil de 5 %');
    out.push(
      `Avec le modèle ${MODEL_SHORT[m.model]}, l’alpha annualisé est de ${pct(12 * rb.beta[0], 1)} pour l’action (${sig(rb.pvalue[0])}) ` +
        `et de ${pct(12 * rf.beta[0], 1)} pour le fonds (${sig(rf.pvalue[0])}). ` +
        `L’écart de ${pct(12 * rd.beta[0], 1)} par an est ${sig(rd.pvalue[0])} (régression de la différence de rendement, p = ${pval(rd.pvalue[0])}).`,
    );
    out.push(
      `Le fonds a un bêta de ${num(rf.beta[1], 2)} et une volatilité résiduelle de ${pct(rf.sigma * Math.sqrt(12), 1)} par an, ` +
        `contre ${num(rb.beta[1], 2)} et ${pct(rb.sigma * Math.sqrt(12), 1)} pour l’action : ${rf.sigma < rb.sigma ? 'il est beaucoup plus diversifié, et son alpha est donc estimé plus précisément' : 'son risque propre n’est pas plus faible que celui de l’action'}.`,
    );
  }
  return out.map((p) => `<p>${p}</p>`).join('');
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
  on('asset', (el) => {
    state.asset = el.value as AssetId;
    comparisonCache = null;
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

  $('export-table').addEventListener('click', () => main?.ok && download(`regression_${state.asset}_${state.model}_${state.universe}_${state.cov}.csv`, regressionCsv(main)));
  $('export-sample').addEventListener('click', () => main?.ok && download(`echantillon_${state.asset}_${state.model}_${state.universe}.csv`, sampleCsv(main)));
  $('export-comparison').addEventListener('click', () => {
    if (!data) return;
    const cmp = comparisonCache?.cmp ?? compareModels(data, state);
    download(`comparaison_modeles_${state.cov}.csv`, comparisonCsv(cmp));
  });
  $('export-versus').addEventListener('click', () => {
    if (!data) return;
    const cmp = versusCache?.cmp ?? compareAssets(data, state);
    if (cmp.ok) download(`action_vs_fonds_${state.universe}_${state.cov}.csv`, assetComparisonCsv(cmp));
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
  comparisonCache = null;
  versusCache = null;
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
