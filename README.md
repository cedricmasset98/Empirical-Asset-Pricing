# Empirical Asset Pricing — Factor Regression Explorer

Ce site interactif (en anglais) estime des modèles d'évaluation d'actifs pour l'action **Banque Cantonale Vaudoise** (BCVN · SIX, ISIN CH0531751755, Yahoo `BCVN.SW`), le fonds **BCV Swiss Equity A** (ISIN CH0006018706, BCV Asset Management) et d'autres fonds d'actions suisses lus sur Swiss Fund Data — **Raiffeisen Futura - Swiss Stock A**, **Swisscanto Responsible Switzerland**, **UBS Switzerland Sustainable** et le fonds indiciel **UBS 100 Index-Fund Switzerland** —, puis compare leurs alphas. La liste des fonds se trouve dans `pipeline/config.py` (`SFD_FUNDS`) ; le site construit ses menus à partir du jeu de données. Les rendements sont mensuels en CHF, le marché de référence est le **SPI Total Return** et le taux sans risque est le **SARON** capitalisé.

| Rubrique | Contenu |
|---|---|
| Analyze | Un actif au choix : résultats (tableau, alpha net et brut des fonds ; pour les modèles multifactoriels, contributions des facteurs au rendement moyen et à la variance, régressions partielles de chaque facteur ; Single Index en référence), ajustement observé / prédit, diagnostics, régressions mobiles (36, 60 ou 120 mois), comparaison des modèles |
| Compare | Deux actifs au choix sur un échantillon strictement identique : performances (100 CHF, rendement, volatilité, perte maximale), alphas comparés et écart testé par la régression de R_A − R_B, Single Index côte à côte |
| Reports | Rapports PDF vulgarisés en LaTeX (en français), avec leurs sources |
| Data & method | Sources et contrôles, import et export CSV, résumé de la méthodologie |

| Élément | Choix |
|---|---|
| Modèles | CAPM / Single Index, **Fama-French 3**, **Carhart 4**, **Fama-French 5** |
| Univers de facteurs | **Suisse** (par défaut) : SPI TR et facteurs suisses Global Factor Data (JKP) en CHF ; **Europe** (comparaison) : facteurs Fama-French européens convertis en CHF |
| Inférence | OLS classique (Student), **HC3**, **Newey-West HAC** (retards automatiques ou choisis) |
| Interface | Mode clair et sombre ; paramètres conservés dans l'URL ; exports CSV |

Toutes les statistiques sont **recalculées dans le navigateur** à partir de fichiers statiques. Aucun coefficient n'est codé en dur, il n'y a pas de backend, et aucune clé d'API n'est utilisée.

## Architecture

```
pipeline/            Python : récupération, transformation, contrôles, références statsmodels
  sources.py         Yahoo Finance (BCV, SPI), Gérifonds (fonds BCV), Swiss Fund Data (fonds Raiffeisen, Swisscanto, UBS), BNS (SARON, taux du marché monétaire, USD/CHF), K. French (Europe), Global Factor Data (Suisse)
  fund.py            lecture de la série officielle du fonds et contrôles (VNI + distributions, YTD)
  transform.py       fins de mois, rendements, capitalisation SARON ACT/360, conversion CHF
  build.py           -> public/data/dataset.json, data/processed/monthly.csv, build_report.md
  validate.py        -> tests/reference/statsmodels_*.json
  olsref.py          OLS et diagnostics numpy/scipy (même conventions, testés contre statsmodels)
  report.py          -> public/report/rapport_{bcv,fonds,comparaison}.pdf et sources .zip
  report_pair.py     rapport comparatif action / fonds
  report_valuation.py note sur le processus de gestion actions suisses -> rapport_valorisation.pdf
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

Prérequis : Node.js ≥ 22.6 et Python 3.12 (version du workflow, pour laquelle les dépendances sont verrouillées).

```bash
npm ci                                                        # versions exactes de package-lock.json
python -m pip install --require-hashes -r pipeline/requirements.txt   # versions exactes et empreintes

npm run data        # télécharge les données et calcule les références statsmodels
npm test            # tests du moteur, comparaison à statsmodels, couche UI
npm run dev         # http://localhost:5173
npm run build       # site statique dans dist/
```

### Dépendances verrouillées

- **Node** : `package.json` fixe les plages acceptées, `package-lock.json` les versions exactes installées par `npm ci` (workflow et installation locale). Mise à jour : `npm update` puis commit du nouveau `package-lock.json`.
- **Python** : `pipeline/requirements.in` liste les dépendances directes avec leurs versions minimales ; `pipeline/requirements.txt`, généré par `pip-compile`, fixe toutes les versions (dépendances indirectes comprises) avec leurs empreintes SHA-256. Mise à jour, sous Python 3.12 :
  ```bash
  pip install pip-tools
  pip-compile --generate-hashes --strip-extras --allow-unsafe --no-emit-index-url -o pipeline/requirements.txt pipeline/requirements.in
  ```

Pour lancer les tests Python :

```bash
python -m unittest discover -s pipeline/tests -t .
```

Pour régénérer les jeux de test synthétiques : `npm run fixtures`. Ces jeux servent uniquement aux tests et ne sont jamais publiés dans `public/`.

## Rapports de synthèse (LaTeX)

Le site est organisé en quatre rubriques : **Analyser** (un actif : résultats, ajustement, diagnostics, stabilité dans le temps, comparaison des modèles), **Comparer** (deux actifs au choix sur le même échantillon, écart d'alpha testé directement), **Rapports** (tous les PDF, avec leurs sources LaTeX) et **Données et méthode**. Les facteurs proposés sont suisses (SPI + JKP, par défaut) ou européens (Fama-French, comparaison) ; la variante hybride SPI + facteurs européens n'est plus proposée dans l'interface mais reste validée dans le moteur. Les anciens liens (`tab=versus`, `market=SPI`…) sont redirigés. La rubrique Rapports contient notamment une note vulgarisée sur l'approche de gestion actions suisses de la BCV, telle que décrite dans sa brochure « Gestion actions suisses » (janvier 2021) et commune à ses trois fonds en actions suisses : scénario macroéconomique, analyses qualitative, fondamentale (modèle Edwards-Bell-Ohlson) et comportementale, gestion du risque relatif. La note la confronte à la performance mesurée du fonds (Single Index, alpha avant frais approché par alpha net + TER publié, exposition au momentum par le modèle de Carhart) ; les exemples d'entreprises y sont fictifs. Le rapport sur l'action contient :

- l'essentiel en cinq points ;
- la question posée et un lexique ;
- les résultats : performance, bêta, alpha et sa décomposition, robustesse de l'inférence, modèles multifactoriels, fenêtres glissantes, diagnostics ;
- les **limites de l'exercice** : une seule action, sélection a posteriori et tests multiples, alpha ex post, facteurs omis (low-vol, taux), construction des facteurs, période courte, significativité statistique contre économique ;

Les rapports utilisent les mêmes spécifications de référence que le site (SPI TR et facteurs suisses JKP) ; le marché et les facteurs européens, ainsi que l'ancienne variante hybride (SPI et facteurs européens), y figurent comme analyses de robustesse, estimées sur le même échantillon commun.
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
| Taux du marché monétaire | BNS data.snb.ch, cube `zimoma` | SARON de fin de mois (depuis 1999) et GMBF à 3 mois (utilisées depuis 1994) : prolongent le taux sans risque avant août 2009, après contrôle de concordance |
| Facteurs Europe | Kenneth R. French Data Library | 3F, 5F, Momentum ; USD, RF US |
| Fonds BCV Swiss Equity A | Gérifonds, page publique du fonds : graphique « Évolution de la performance (dividendes réinvestis) », quotidien depuis 1997 | Série officielle, distributions brutes réinvesties, nette de frais. Contrôles automatiques : rendements quotidiens recalculés à partir des VNI et des distributions publiées, chaque distribution retrouvée une seule fois, performance YTD = publiée |
| Fonds Raiffeisen, Swisscanto, UBS Sustainable, UBS 100 Index | Swiss Fund Data (swissfunddata.ch, SIX Financial Information / AMAS), export quotidien de la fiche de chaque fonds, « Total Return Chart Price » (depuis 2000-2001, novembre 2009 pour Raiffeisen) | Distributions réinvesties, nette de frais. Contrôles automatiques : Chart Price = VNI, rendement total = rendement de la VNI hors distributions, distributions implicites plausibles (montant, fréquence), TER publié = configuration. Rendements annuels vérifiés contre la fiche mensuelle officielle |
| Facteurs suisses (univers « Suisse ») | Global Factor Data (jkpfactors.com), Jensen, Kelly et Pedersen (2023), archives publiques S3 `[che]_[facteur]_[monthly]_[vw_cap].zip` | `market_equity` → SMB, `be_me` → HML, `ope_be` → RMW, `at_gr1` → CMA, `ret_12_1` → MOM ; terciles, capitalisation plafonnée, USD convertis en CHF par F(1+s) ; mois à moins de 30 titres écartés ; publication annuelle |
| USD/CHF | BNS, cube `devkum` (cours de fin de mois) ; replis : FRED `DEXSZUS`, Yahoo `CHF=X` | Fin de mois |

Si une source échoue, elle est marquée « ERREUR » et ses colonnes restent vides. L'interface affiche alors une erreur explicite pour les modèles concernés, sans aucun résultat de substitution. Pour contourner une source inaccessible, vous pouvez déposer des fichiers dans `data/manual/` (voir son README) ou importer un CSV mensuel directement dans le navigateur.

La méthodologie complète est décrite dans [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md). Elle couvre les actifs et leurs contrôles, le SARON, les univers de facteurs (suisse JKP et européen) et leur conversion en CHF, l'inférence, l'alpha net et brut des fonds, les diagnostics, les comparaisons et les limites.

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
- **Global Factor Data (JKP)** : données académiques gratuites, usage non commercial, citation de Jensen, Kelly et Pedersen (2023), « Is There a Replication Crisis in Finance? », *Journal of Finance* 78(5). Repli : `data/manual/jkp_che_factors.csv` (colonnes `date,SMB,HML,RMW,CMA,MOM`, en USD).
- **Swiss Fund Data** (SIX Financial Information, en partenariat avec l'AMAS) : l'accès à la fiche passe par la page d'avertissement du site (profil « investisseur privé ») ; seuls des rendements mensuels dérivés sont publiés. Vérifier les conditions d'utilisation avant diffusion publique (repli : `data/manual/raif_tr_daily.csv`, colonnes `date,tr_index`).

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
