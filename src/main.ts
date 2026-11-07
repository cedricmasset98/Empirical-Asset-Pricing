/** Point d'entrée : chargement des données, paramètres, rendu. */

import './styles.css';
import type { Dataset, FeeInfo } from './data/types.ts';
import { loadDataset, parseCsvDataset, datasetToCsv, DatasetError } from './data/loader.ts';
import { compareAssets, compareModels, diagnose, feeInfo, fitModel, grossAlpha, rolling, shiftAlpha, singleIndexPair, type AssetComparison, type Fit, type FitOk, type Settings, type Comparison } from './ui/analysis.ts';
import { commonRanges, plotAlphaPair, plotComparison, plotDiagnostics, plotFitted, plotFittedScatter, plotPerformance, plotRolling, plotScatter, readTheme, resizeAll } from './ui/charts.ts';
import { alphaPairTable, comparisonTable, feesBlock, multiFactorPairTable, perfTable, regressionTable, sourcesTable, statCards, testsTable, COV_LABELS } from './ui/tables.ts';
import { assetComparisonCsv, comparisonCsv, download, regressionCsv, sampleCsv } from './ui/export.ts';
import { escapeHtml as h, monthLabel, num, pct, pval } from './ui/format.ts';
import { neweyWestAutoLags, type CovType } from './engine/ols.ts';
import { ASSET_IDS, ASSET_INFO, MODEL_IDS, MODEL_SHORT, UI_UNIVERSES, specLabel, type ModelId, type Pair, type SingleAsset, type Universe } from './engine/models.ts';

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

function clampRange(s: UIState, ds: Dataset): void {
  const [lo, hi] = bounds(ds, activeAssets(s));
  if (s.range.start < lo || s.range.start > hi) s.range.start = lo;
  if (s.range.end > hi || s.range.end < lo) s.range.end = hi;
  if (s.range.start > s.range.end) [s.range.start, s.range.end] = [lo, hi];
}

function defaultState(ds: Dataset, asset: SingleAsset = 'BCV'): UIState {
  const col = ASSET_INFO[asset].column;
  const first = ds.dates.find((_, i) => ds.data[col]?.[i] != null && ds.data.rf_saron?.[i] != null) ?? ds.dates[0];
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
    pair: ['BCV', 'FUND'],
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
  const lagTxt = state.cov === 'HAC' ? (state.hacLags === null ? ', retards auto' : `, ${state.hacLags} retards`) : '';
  $('adv-summary').textContent = `· ${COV_LABELS[state.cov].split(' (')[0]}${lagTxt} · fenêtre ${state.window} mois`;
}

// ------------------------------------------------------------------ rendu

const SUBTITLES: Record<SingleAsset, string> = {
  BCV: 'Action <b>Banque Cantonale Vaudoise</b> <span class="mono">(BCVN · SIX)</span> · ISIN CH0531751755 · CHF',
  FUND: 'Fonds <b>BCV Swiss Equity A</b> <span class="mono">(BCV Asset Management)</span> · ISIN CH0006018706 · CHF',
  RAIF: 'Fonds <b>Raiffeisen Futura - Swiss Stock A</b> <span class="mono">(Vontobel Asset Management)</span> · ISIN CH0011980981 · CHF',
};

function renderHeader(): void {
  const ds = data!;
  const errors = ds.sources.filter((s) => s.status === 'error');
  const when = new Date(ds.generated_at);
  const date = Number.isNaN(when.getTime()) ? ds.generated_at : when.toLocaleString('fr-CH', { dateStyle: 'long', timeStyle: 'short' });
  const origin = ds.origin === 'manual-csv' ? 'import manuel CSV' : 'données publiques mises à jour automatiquement';
  document.querySelectorAll<HTMLButtonElement>('.views button').forEach((b) => {
    if (b.dataset.view === state.view) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  $('subtitle').innerHTML = {
    analyze: SUBTITLES[state.asset],
    compare: `Comparaison : <b>${h(ASSET_INFO[state.pair[0]].label)}</b> et <b>${h(ASSET_INFO[state.pair[1]].label)}</b> · CHF`,
    reports: 'Rapports et notes vulgarisés (PDF)',
    data: 'Sources, contrôles et méthodologie',
  }[state.view];
  const assets = activeAssets(state);
  const [lo, hi] = bounds(ds, assets);
  const span = state.view === 'analyze' || state.view === 'compare' ? ` · données disponibles ${monthLabel(lo)} → ${monthLabel(hi)}` : '';
  $('data-meta').innerHTML =
    `<span>Actualisé le ${h(date)} (${h(origin)})${h(span)}</span>` +
    `<button type="button" class="linklike" data-goto="data">Sources et méthode</button>` +
    (errors.length ? `<span class="err-count">${errors.length} source(s) en erreur</span>` : '');
}

function renderAlerts(): void {
  const ds = data!;
  const errors: string[] = [];
  const notes: string[] = [];
  if (ds.origin === 'manual-csv') {
    notes.push(alertHtml('warn', 'Données importées manuellement.', ' Elles n’ont pas été contrôlées par le pipeline ; la provenance et les conventions relèvent de l’utilisateur.'));
  }
  for (const s of ds.sources.filter((x) => x.status === 'error')) {
    errors.push(alertHtml('error', `Source indisponible : ${s.name}.`, ` ${h(s.message ?? '')} Les modèles qui en dépendent ne sont pas estimés.`));
  }
  for (const c of ds.checks.filter((x) => x.status === 'fail')) errors.push(alertHtml('error', 'Contrôle de données échoué.', ` ${h(c.message)}`));
  if (state.view === 'analyze') {
    if (main && !main.ok) errors.push(alertHtml('error', `${main.label} : estimation impossible.`, ` ${h(main.error)}`));
    if (main?.ok) {
      if (main.universe === 'SWISS' && main.model !== 'CAPM') {
        notes.push(alertHtml('info', 'Facteurs suisses JKP.', ' SMB, HML, RMW, CMA et MOM viennent de Global Factor Data (Jensen, Kelly et Pedersen, 2023) : portefeuilles par terciles de la caractéristique, pondérés par la capitalisation plafonnée, et non les tris 2×3 de Fama-French. Ils sont publiés une fois par an : les derniers mois peuvent manquer.'));
      }
      if (main.universe === 'EUROPE') {
        notes.push(alertHtml('warn', 'Univers de comparaison.', ' Le marché et les facteurs sont européens : ce n’est pas la référence naturelle d’un actif suisse. Un alpha obtenu ici peut n’être qu’un effet du mauvais marché de référence ; comparez avec les facteurs suisses.'));
      }
      const s = main.sample;
      if (s.droppedMonths > 0) {
        notes.push(alertHtml('info', 'Échantillon effectif :', ` ${s.dates[0]} → ${s.dates[s.dates.length - 1]}, ${s.y.length} mois. ${s.droppedMonths} mois de la plage choisie n’ont pas toutes les séries requises et sont exclus (aucune interpolation).`));
      }
      for (const w of main.warnings.filter((x) => !x.includes('exclus faute'))) notes.push(alertHtml('warn', 'Échantillon.', ` ${h(w)}`));
      if (main.result.cov !== 'classical') {
        notes.push(alertHtml('info', 'Inférence robuste.', ` ${COV_LABELS[main.result.cov]} : statistiques z, p-values et intervalles fondés sur la loi normale ; le test global est un test de Wald χ² (une statistique F classique ne serait pas robuste).`));
      }
    }
  }
  const showNotes = (state.view === 'analyze' || state.view === 'compare') && notes.length > 0;
  const wasOpen = ($('alerts').querySelector('details.notes') as HTMLDetailsElement | null)?.open ?? false;
  $('alerts').innerHTML =
    errors.join('') +
    (showNotes
      ? `<details class="notes"${wasOpen ? ' open' : ''}><summary>${notes.length} remarque${notes.length > 1 ? 's' : ''} sur cette estimation</summary>${notes.join('')}</details>`
      : '');
}

function renderMain(): void {
  $('reg-title').textContent = main ? `Régression — ${main.label}` : 'Régression';
  if (!main || !main.ok) {
    $('cards').innerHTML = '';
    $('reg-table').innerHTML = `<div class="empty">Aucun résultat : ${h(main && !main.ok ? main.error : 'données indisponibles')}</div>`;
    return;
  }
  const fee = feeInfo(data!, main.asset);
  const gross = fee ? grossAlpha(main, fee) : null;
  $('cards').innerHTML = statCards(main, gross);
  $('reg-table').innerHTML = regressionTable(main);
  $('fees').innerHTML = gross ? feesBlock(main, gross) : '';
}

function needFit(el: HTMLElement, fit: Fit | null): fit is FitOk {
  if (fit?.ok) return true;
  el.innerHTML = `<div class="empty">${h(fit && !fit.ok ? `${fit.label} : ${fit.error}` : 'Données indisponibles.')}</div>`;
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
      $('scatter-title').textContent = `Relation avec le marché : ${ASSET_INFO[state.asset].label} contre le SPI Total Return (Single Index)`;
      $('scatter-lead').innerHTML = `R<sub>${who},t</sub> − R<sub>f,t</sub> = α + β<sub>M</sub>(R<sub>SPI,t</sub> − R<sub>f,t</sub>) + ε<sub>t</sub>, rendements mensuels en CHF${ASSET_INFO[state.asset].fund ? ' (nets des frais du fonds, distributions réinvesties)' : ' (dividendes réinvestis)'}, R<sub>f</sub> = SARON capitalisé.`;
      const note =
        state.model !== 'CAPM' || state.universe !== 'SWISS'
          ? `<p class="muted small">Le graphique montre toujours le Single Index sur le SPI TR ; le tableau ci-dessus correspond au modèle choisi (${h(specLabel(state.model, state.universe))}).</p>`
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
          ? `Toutes les spécifications sont estimées sur le <b>même échantillon</b> : ${cmp.commonN} mois, ${cmp.period[0]} → ${cmp.period[1]} (intersection des disponibilités). ${h(COV_LABELS[state.cov])}. Dans l’univers suisse, le CAPM est le Single Index sur le SPI TR ; l’univers européen sert de comparaison.`
          : 'Aucun mois commun à toutes les spécifications disponibles.';
      if (cmp.excluded.length) $('comparison-lead').innerHTML += `<br><span class="muted small">Exclues : ${h(cmp.excluded.join(' · '))}</span>`;
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
      question: '<strong>La banque a-t-elle généré davantage de rendement ajusté des facteurs pour ses propres actionnaires que pour les investisseurs de son fonds actions suisses&nbsp;?</strong>',
      method:
        '<p>Les deux alphas ne mesurent pas la même chose. L’<b>alpha de l’action BCV</b> est la part du rendement excédentaire historique de l’action que les facteurs retenus n’expliquent pas : il reflète l’ensemble des activités de la banque (crédit, gestion de fortune, gestion d’actifs…) et la façon dont le marché les a valorisées. L’<b>alpha du fonds BCV Swiss Equity A</b> est la part du rendement excédentaire du fonds, <em>net des frais incorporés dans sa VNI</em> et distributions réinvesties, que ces mêmes facteurs n’expliquent pas : il reflète le travail de sélection d’actions de BCV Asset Management pour le compte des porteurs de parts. Les revenus de gestion du fonds font partie des revenus de la banque ; la comparaison ne permet toutefois pas d’établir de lien de cause à effet entre les deux.</p>',
    };
  }
  if (a.fund && b.fund) {
    return {
      question: `<strong>Lequel des deux fonds a dégagé le meilleur rendement ajusté des facteurs, après frais&nbsp;?</strong>`,
      method: `<p>Les deux alphas sont <b>nets des frais</b> incorporés dans la VNI, distributions réinvesties : ils mesurent ce que les porteurs de parts ont obtenu au-delà de l’exposition aux facteurs. Un écart d’alpha peut venir de la sélection de titres, de l’allocation, ou simplement de frais différents. Les deux fonds ont le SPI pour indice de référence, mais pas forcément les mêmes contraintes de risque : comparez aussi leurs R² et leurs volatilités résiduelles.</p>`,
    };
  }
  return {
    question: `<strong>${h(a.label)} et ${h(b.label)} ont-ils dégagé un rendement ajusté des facteurs différent&nbsp;?</strong>`,
    method: `<p>Un alpha de fonds est net de frais et porte sur un portefeuille diversifié ; un alpha d’action reflète la performance d’une seule entreprise, avec un risque propre beaucoup plus élevé. L’écart est estimé directement, mais les deux alphas ne mesurent pas la même chose.</p>`,
  };
}

function renderCompare(): void {
  const t = readTheme();
  const key = JSON.stringify([state.pair, state.range, state.cov, state.hacLags, state.universe, data!.generated_at]);
  if (versusCache?.key !== key) versusCache = { key, cmp: compareAssets(data!, state, state.pair) };
  const cmp = versusCache.cmp;
  const [na, nb] = state.pair.map((x) => ASSET_INFO[x].label);
  $('vs-title').textContent = `${na} et ${nb}`;
  const intro = compareIntro(state.pair);
  $('vs-question').innerHTML = intro.question;
  $('vs-method').innerHTML = intro.method;
  $<HTMLAnchorElement>('vs-report').hidden = !(state.pair.includes('BCV') && state.pair.includes('FUND'));
  const blocks = ['vs-perf-table', 'vs-alpha-table', 'vs-mf-table', 'vs-reading'];
  if (!cmp.ok) {
    $('vs-sample').innerHTML = alertHtml('error', 'Comparaison impossible.', ` ${h(cmp.error ?? '')}`);
    blocks.forEach((b) => ($(b).innerHTML = ''));
    ['chart-vs-perf', 'chart-vs-alpha', 'chart-vs-sim-a', 'chart-vs-sim-b'].forEach((c) => ($(c).innerHTML = ''));
    return;
  }
  $('vs-sample').innerHTML = `<div class="strip"><span><b>Échantillon identique</b> pour les deux actifs : ${cmp.dates.length} mois, ${cmp.dates[0]} → ${cmp.dates[cmp.dates.length - 1]}</span><span>Facteurs : ${{ SPI: 'SPI TR', EUROPE: 'européens Fama-French (CHF)', SWISS: 'SPI TR et facteurs suisses JKP (CHF)' }[state.universe]}</span><span>${h(COV_LABELS[state.cov])}</span></div>`;
  plotPerformance($('chart-vs-perf'), cmp, t);
  $('vs-perf-table').innerHTML = perfTable(cmp);
  const sel = cmp.models.find((m) => m.model === state.model)!;
  $('vs-alpha-title').textContent = `B. Alphas comparés — ${MODEL_SHORT[state.model]}`;
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
  const name: Record<SingleAsset, string> = { BCV: 'l’action BCV', FUND: 'le fonds BCV', RAIF: 'le fonds Raiffeisen' };
  const [na, nb] = cmp.pair.map((x) => name[x]);
  out.push(
    `Sur ces ${cmp.dates.length} mois, ${na} a rapporté ${pct(pa.annReturn, 1)} par an et ${nb} ${pct(pb.annReturn, 1)}, ` +
      `avec une volatilité de ${pct(pa.annVol, 1)} contre ${pct(pb.annVol, 1)}.`,
  );
  if (m.a.ok && m.b.ok && m.diff.ok) {
    const [ra, rb, rd] = [m.a.result, m.b.result, m.diff.result];
    const sig = (p: number) => (p < 0.05 ? 'significatif au seuil de 5 %' : 'non significatif au seuil de 5 %');
    out.push(
      `Avec le modèle ${MODEL_SHORT[m.model]}, l’alpha annualisé est de ${pct(12 * ra.beta[0], 1)} pour ${na} (${sig(ra.pvalue[0])}) ` +
        `et de ${pct(12 * rb.beta[0], 1)} pour ${nb} (${sig(rb.pvalue[0])}). ` +
        `L’écart de ${pct(12 * rd.beta[0], 1)} par an est ${sig(rd.pvalue[0])} (régression de la différence de rendement, p = ${pval(rd.pvalue[0])}).`,
    );
    if (fees[0] || fees[1]) {
      const ta = fees[0]?.ter ?? 0;
      const tb = fees[1]?.ter ?? 0;
      const g = shiftAlpha(m.diff, (ta - tb) / 12);
      out.push(
        `Avant frais de gestion (α net + TER), l’alpha serait d’environ ${pct(12 * ra.beta[0] + ta, 1)} pour ${na} et ${pct(12 * rb.beta[0] + tb, 1)} pour ${nb} ; ` +
          `l’écart brut de ${pct(12 * g.alpha, 1)} par an est ${sig(g.pvalue)}. ` +
          (Math.abs(ta - tb) < 0.002 ? 'Les frais étant proches, l’écart d’alpha ne vient guère des frais.' : `La différence de frais (${pct(ta - tb, 2)} par an) explique une partie de l’écart net.`),
      );
    }
    out.push(
      `Bêtas de ${num(ra.beta[1], 2)} et ${num(rb.beta[1], 2)} ; volatilités résiduelles de ${pct(ra.sigma * Math.sqrt(12), 1)} et ${pct(rb.sigma * Math.sqrt(12), 1)} par an. ` +
        `Plus la volatilité résiduelle est faible, plus l’alpha est estimé précisément.`,
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
  });
  on('asset-a', (el) => (state.pair = [el.value as SingleAsset, state.pair[1]]));
  on('asset-b', (el) => (state.pair = [state.pair[0], el.value as SingleAsset]));
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
  state = fromHash ? readHash(base) : { ...base, view: state?.view ?? base.view, tab: state?.tab ?? base.tab };
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
    $('reg-table').innerHTML = '<div class="empty">Aucune estimation : importez un CSV dans « Données et méthode ».</div>';
    state = { ...defaultState({ dates: ['2000-01'], data: {} } as unknown as Dataset), view: 'data' };
    document.querySelectorAll<HTMLElement>('main > .view').forEach((v) => (v.hidden = v.id !== 'view-data'));
  }
}

void init();
