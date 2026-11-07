# Empirical Asset Pricing — Factor Regression Explorer

Ce site interactif estime des modèles d'évaluation d'actifs pour l'action **Banque Cantonale Vaudoise** (BCVN · SIX, ISIN CH0531751755, Yahoo `BCVN.SW`) et pour le fonds **BCV Swiss Equity A** (ISIN CH0006018706, gestion active, BCV Asset Management), puis compare leurs alphas. Les rendements sont mensuels en CHF, le marché de référence est le **SPI Total Return** et le taux sans risque est le **SARON** capitalisé.

| Section | Contenu |
|---|---|
| Sélecteur d'actif | Action BCV ou fonds BCV Swiss Equity A : toutes les analyses suivent l'actif choisi, avec le même moteur |
| A. Single Index | Nuage de points interactif, droite OLS, intervalle de confiance, équation et statistiques |
| Modèles | CAPM / Single Index, **Fama-French 3**, **Carhart 4**, **Fama-French 5** ; facteurs européens convertis en CHF |
| Inférence | OLS classique (Student), **HC3**, **Newey-West HAC** (retards automatiques ou choisis) |
| B. Observé vs prédit | Séries temporelles et graphique à 45° |
| C. Diagnostics | Résidus, histogramme, Q-Q plot, ACF ; tests Ljung-Box, Breusch-Pagan et Jarque-Bera |
| D. Régression mobile | Fenêtres de 36, 60 ou 120 mois, avec intervalles de confiance |
| E. Comparaison des modèles | 4 modèles × 2 marchés sur un échantillon strictement identique |
| F. Action BCV vs Fonds BCV | Performances (100 CHF, rendement, volatilité, perte maximale), alphas comparés et écart testé, Single Index côte à côte à la même échelle, modèles multifactoriels, lecture pédagogique |
| Exports et import | Exports CSV ; import manuel d'un CSV ; mode clair et sombre ; paramètres conservés dans l'URL |
| Rapports | **Rapports vulgarisés en LaTeX** (PDF et sources) : action BCV, fonds BCV Swiss Equity A, comparaison des alphas, processus de gestion du fonds (multiples, modèle EBO) |

Toutes les statistiques sont **recalculées dans le navigateur** à partir de fichiers statiques. Aucun coefficient n'est codé en dur, il n'y a pas de backend, et aucune clé d'API n'est utilisée.

## Architecture

```
pipeline/            Python : récupération, transformation, contrôles, références statsmodels
  sources.py         Yahoo Finance (BCV, SPI), Gérifonds (fonds), BNS (SARON, USD/CHF), K. French (Europe)
  fund.py            lecture de la série officielle du fonds et contrôles (VNI + distributions, YTD)
  transform.py       fins de mois, rendements, capitalisation SARON ACT/360, conversion CHF
  build.py           -> public/data/dataset.json, data/processed/monthly.csv, build_report.md
  validate.py        -> tests/reference/statsmodels_*.json
  olsref.py          OLS et diagnostics numpy/scipy (même conventions, testés contre statsmodels)
  report.py          -> public/report/rapport_{bcv,fonds,comparaison}.pdf et sources .zip
  report_pair.py     rapport comparatif action / fonds
  report_valuation.py note sur le processus de gestion (multiples, EBO) -> rapport_valorisation.pdf
  presentation.py    -> public/report/presentation_fonds.pdf (Beamer vulgarisé, fonds vs SPI, lien avec Fama-French 2010)
report/*.tex         gabarits LaTeX (texte seul ; chiffres injectés par macros)
  tests/             tests unitaires et test de bout en bout hors ligne
src/
  engine/            moteur statistique TypeScript (sans dépendance)
    linalg.ts        Cholesky, inverses, formes quadratiques
    distributions.ts lois normale, t, F et χ² (fonctions bêta et gamma incomplètes)
    ols.ts           OLS, covariances classique, HC3 et Newey-West, tests de Wald et F
    diagnostics.ts   ACF, Ljung-Box, Breusch-Pagan, Jarque-Bera, Q-Q
    rolling.ts       régressions mobiles
    models.ts        définitions des modèles, univers de facteurs, échantillons
  data/              schéma, chargement, validation, import CSV
  ui/                orchestration (analysis.ts), graphiques Plotly, tableaux, exports
tests/               tests Node (node:test) : moteur, comparaison statsmodels, couche UI
.github/workflows/   données -> tests -> build -> GitHub Pages (push, mensuel, manuel)
```

La préparation des données, le moteur statistique et l'interface sont séparés. Le moteur ne connaît pas le DOM, et l'interface ne fait aucun calcul économétrique.

## Installation locale

Prérequis : Node.js ≥ 22.6 et Python ≥ 3.11.

```bash
npm install
python -m pip install -r pipeline/requirements.txt

npm run data        # télécharge les données et calcule les références statsmodels
npm test            # tests du moteur, comparaison à statsmodels, couche UI
npm run dev         # http://localhost:5173
npm run build       # site statique dans dist/
```

Pour lancer les tests Python :

```bash
python -m unittest discover -s pipeline/tests -t .
```

Pour régénérer les jeux de test synthétiques : `npm run fixtures`. Ces jeux servent uniquement aux tests et ne sont jamais publiés dans `public/`.

## Rapports de synthèse (LaTeX)

Le bouton **Rapport PDF** ouvre le rapport de l'actif choisi. L'onglet F donne accès au rapport comparatif « Action BCV vs Fonds BCV — Comparaison des alphas ». Quand le fonds est sélectionné, le bouton **Processus de gestion** ouvre une note vulgarisée sur la démarche de sélection des titres décrite par la BCV (filtrage par multiples, modèle Edwards-Bell-Ohlson, écart prix/valeur) et la confronte à la performance mesurée du fonds ; les exemples d'entreprises y sont fictifs, et l'alpha avant frais est approché par alpha net + TER publié. Le rapport sur l'action contient :

- l'essentiel en cinq points ;
- la question posée et un lexique ;
- les résultats : performance, bêta, alpha et sa décomposition, robustesse de l'inférence, modèles multifactoriels, fenêtres glissantes, diagnostics ;
- les **limites de l'exercice** : une seule action, sélection a posteriori et tests multiples, alpha ex post, facteurs omis (low-vol, taux), facteurs européens, période courte, significativité statistique contre économique ;
- des pistes, la méthodologie et les sources.

`report/rapport.tex` ne contient que le texte. Tous les nombres, tableaux et figures sont produits par `pipeline/report.py` à partir des données, sous forme de macros (`\AlphaA`, `\BetaM`…). Les phrases qui dépendent des résultats (significativité, robustesse…) sont elles aussi générées : le texte reste exact quand les données changent. Le rapport porte sur la spécification de référence : Single Index, échantillon maximal, Newey-West.

```bash
npm run report      # nécessite XeLaTeX, latexmk, polyglossia et la police TeX Gyre Pagella
```

Le workflow installe LaTeX et régénère le rapport à chaque exécution. L'archive `rapport_bcv_latex.zip` contient le gabarit, les macros, les tableaux et les figures : on peut la recompiler avec `latexmk -xelatex rapport.tex`.

## Données

| Série | Source | Remarque |
|---|---|---|
| BCV | Yahoo Finance `BCVN.SW`, `Adj Close` | Dividendes et splits ajustés ; split 10:1 de mai 2020 contrôlé |
| SPI TR | Yahoo Finance `^SSHI` (SPI, SXGE) | Indice de performance ; jamais remplacé par un indice de prix. Historique Yahoo disponible depuis mars 2013 seulement ; prolongé jusqu'en 1988 par `data/history/spi_tr_history.csv`, après contrôle de concordance (cf. `data/history/README.md`) |
| SARON | BNS data.snb.ch, cube `snbgwdzid` | Fixing quotidien depuis août 2009, capitalisé ACT/360 |
| Facteurs Europe | Kenneth R. French Data Library | 3F, 5F, Momentum ; USD, RF US |
| Fonds BCV Swiss Equity A | Gérifonds, page publique du fonds : graphique « Évolution de la performance (dividendes réinvestis) », quotidien depuis 1997 | Série officielle, distributions brutes réinvesties, nette de frais. Contrôles automatiques : rendements quotidiens recalculés à partir des VNI et des distributions publiées, chaque distribution retrouvée une seule fois, performance YTD = publiée |
| USD/CHF | BNS, cube `devkum` (cours de fin de mois) ; replis : FRED `DEXSZUS`, Yahoo `CHF=X` | Fin de mois |

Si une source échoue, elle est marquée « ERREUR » et ses colonnes restent vides. L'interface affiche alors une erreur explicite pour les modèles concernés, sans aucun résultat de substitution. Pour contourner une source inaccessible, vous pouvez déposer des fichiers dans `data/manual/` (voir son README) ou importer un CSV mensuel directement dans le navigateur.

La méthodologie complète est décrite dans [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md). Elle couvre les conventions SARON, la conversion des facteurs en CHF, l'inférence, les diagnostics et les limites.

## Publication sur GitHub Pages

1. Dans le dépôt GitHub, ouvrez **Settings → Pages → Build and deployment → Source** et choisissez **GitHub Actions**. Cette étape n'a lieu qu'une fois.
2. Chaque `push` sur `main` lance le workflow `.github/workflows/deploy.yml`, qui :
   1. exécute les tests du pipeline ;
   2. télécharge les données et construit `dataset.json` ;
   3. calcule les références statsmodels ;
   4. vérifie les types et lance les tests du moteur. Avec `STRICT_REFERENCE=1`, une divergence avec statsmodels bloque le déploiement ;
   5. compile le site avec Vite ;
   6. archive les données dans le dépôt si elles ont changé (commit `[skip ci]`) ;
   7. déploie sur Pages.
3. Le workflow s'exécute aussi chaque mois, le 4, et manuellement depuis **Actions → Run workflow**.
4. Adresse du site : `https://cedricmasset98.github.io/Empirical-Asset-Pricing/`. Avec le domaine personnalisé du site utilisateur, c'est `https://cedricmasset.ch/Empirical-Asset-Pricing/`.

Vite est configuré avec `base: './'` et les données sont chargées par un chemin relatif. Le site fonctionne donc sous n'importe quel sous-chemin, sans réglage supplémentaire.

## Licences des données — à vérifier avant diffusion publique

- **Yahoo Finance** : les conditions d'utilisation limitent la redistribution. Le dépôt ne publie que des **rendements mensuels dérivés**, jamais les cours bruts, car `data/raw/` est ignoré par git.
- **SIX** (SPI, SARON) : les données d'indices sont la propriété de SIX Index AG, et leur diffusion publique peut nécessiter une licence.
- **BNS** et **FRED** (repli pour USD/CHF) : données publiques ; la source doit être citée.
- **Kenneth R. French** : usage libre avec citation.
- **Gérifonds** (filiale de la BCV) : page publique du fonds ; seuls des rendements mensuels dérivés sont publiés. Il n'existe pas d'API documentée : la page est lue une fois par exécution et tout changement de structure produit une erreur explicite (repli : `data/manual/fund_tr_daily.csv`).

Si la publication des rendements SPI ou SARON n'est pas autorisée dans votre contexte, deux options :

- rendre le dépôt privé et servir le site uniquement en interne ;
- ne pas versionner `public/data/` et distribuer les données par import CSV.

## Feuille de route

| Phase | Contenu | Statut |
|---|---|---|
| 1 | Single Index Model (SPI TR, SARON), droite OLS interactive, statistiques complètes | ✔ |
| 2 | Facteurs Fama-French européens harmonisés en CHF ; FF3, Carhart, FF5 | ✔ |
| 3 | Diagnostics, régressions mobiles, comparateur de modèles | ✔ |
| 4 | Design responsive, exports CSV, déploiement Pages | ✔ |
| Suite | Fréquences hebdomadaire et journalière ; facteurs suisses (p. ex. SMB/HML construits sur le marché suisse) ; autres titres | à faire |
