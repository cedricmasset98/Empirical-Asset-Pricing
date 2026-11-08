# Méthodologie

Ce document décrit les conventions retenues. Elles sont appliquées par le pipeline Python (`pipeline/`) et par le moteur statistique exécuté dans le navigateur (`src/engine/`, `src/ui/analysis.ts`). La rubrique « Data & method » du site en donne un résumé.

## 1. Données et fréquence

Version 1 : **fréquence mensuelle uniquement**. Les fréquences journalière et hebdomadaire apparaissent dans l'interface comme « non disponibles » : elles demandent un traitement propre des jours fériés suisses, des taux sans risque journaliers et de facteurs journaliers.

Chaque mois est identifié par `AAAA-MM`. La valeur d'une série pour un mois est sa **dernière observation du mois calendaire**. Un mois est écarté, donc laissé manquant, dans deux cas :

- sa dernière observation précède la fin du mois de plus de 5 jours calendaires (`MAX_MONTH_END_GAP_DAYS`) ;
- il n'est pas terminé à la date d'exécution.

Les rendements ne sont calculés qu'entre mois consécutifs. Un mois manquant rend les deux rendements adjacents manquants. Le pipeline n'interpole jamais.

## 2. Actifs étudiés

Les actifs proposés sont l'action BCV (`bcv_ret`), le fonds BCV Swiss Equity A (`fund_ret`) et les fonds lus sur Swiss Fund Data (section 2.3). Ils sont traités par le même moteur : seule la variable dépendante change. La liste des actifs, leurs libellés et leurs frais sont publiés dans `dataset.json` (champ `assets`) ; le site construit ses menus à partir de cette liste.

### 2.1 Action BCV

- Source : Yahoo Finance (`BCVN.SW`) via `yfinance`, colonne `Adj Close`, ajustée des dividendes et des splits.
- Rendement : R_t = P^adj_t / P^adj_{t−1} − 1.
- Contrôles automatiques, publiés dans `data/processed/build_report.md` et dans la rubrique « Data & method » :
  - présence du **split 10:1 de mai 2020** dans les opérations sur titres ;
  - absence de variation quotidienne supérieure à 35 % du cours ajusté, ce qui détecterait un split non ajusté ;
  - écart moyen positif entre rendement total et rendement de prix, preuve de l'ajustement des dividendes.

### 2.2 Fonds BCV Swiss Equity A (CH0006018706)

- **Source.** Série officielle de Gérifonds, la direction de fonds de la BCV : graphique « Évolution de la performance (dividendes réinvestis) » de la page publique du fonds (`gerifonds.ch/fr/iframe/CH0006018706`). Elle est quotidienne depuis le 31.12.1997, en base 100, avec distributions brutes réinvesties à la date ex et nette des frais incorporés dans la VNI. Le pipeline ne reconstruit pas lui-même le rendement total : il utilise la série officielle et la **vérifie**.
- **Contrôles** :
  1. Chaque rendement quotidien est recalculé par $(\mathrm{VNI}_t + D_t)/\mathrm{VNI}_{t-1} - 1$ ($D_t$ = distribution brute publiée), avec une tolérance de 5·10⁻⁵ ; au moins 99,5 % des jours doivent être retrouvés. Les VNI affichées en infobulle sont décalées d'un jour depuis septembre 2021 ; le contrôle corrige ce décalage, sans incidence sur la série de performance.
  2. Chacune des distributions de la table publiée est retrouvée **une et une seule fois**, au montant brut. Un oubli ou un double comptage fait échouer le contrôle.
  3. La performance YTD recalculée doit être égale à la performance YTD publiée sur la page.
  4. Le TER lu sur la page est comparé à celui de `pipeline/config.py`.

### 2.3 Fonds lus sur Swiss Fund Data

| Clé | Fonds | ISIN | Gestion | Historique quotidien |
|---|---|---|---|---|
| `RAIF` | Raiffeisen Futura - Swiss Stock A | CH0011980981 | active (Vontobel AM pour Raiffeisen), indice SPI | depuis nov. 2009 |
| `SWC` | Swisscanto (CH) Equity Fund Responsible Switzerland AA | CH0011792451 | active (Zürcher Kantonalbank), indice SPI, critères de durabilité | depuis avril 2001 |
| `UBSS` | UBS (CH) Equity Fund – Switzerland Sustainable P | CH0002791769 | active, indice SPI, critères de durabilité | depuis janv. 2000 |
| `UBS100` | UBS 100 Index-Fund Switzerland P | CH0002788807 | **indicielle** (UBS 100 Index) : témoin passif | depuis janv. 2000 |

- **Source.** Swiss Fund Data (SIX Financial Information / AMAS), export quotidien de la fiche de chaque fonds, colonne « Total Return Chart Price » : distributions réinvesties à la date ex, nette de frais. L'accès passe par la page d'avertissement « investisseur privé », acceptée automatiquement par le pipeline. L'export doit porter l'ISIN attendu.
- **Ajouter un fonds** : une entrée dans `SFD_FUNDS` (`pipeline/config.py`) suffit ; aucune modification du site n'est nécessaire.
- **Témoin passif.** Pour le fonds indiciel, l'alpha net attendu est proche de −TER (et l'alpha brut proche de zéro), à l'écart de suivi près entre l'UBS 100 et le SPI : c'est un contrôle de bout en bout du site.
- **Durabilité.** Les fonds Swisscanto et UBS Sustainable appliquent des critères de durabilité, dont l'introduction a pu modifier leur gestion au cours de la période.
- **Contrôles** :
  1. « Chart Price » = VNI publiée ;
  2. hors distributions, rendement total = rendement de la VNI (au moins 99,5 % des jours) ;
  3. chaque saut est une distribution implicite plausible, $D = \mathrm{VNI}_{t-1}(1 + R^{TR}_t) - \mathrm{VNI}_t$ : montant positif et inférieur à 5 % de la VNI, au plus deux par an ;
  4. TER publié sur la fiche = TER de la configuration (lorsqu'un TER de référence est configuré).

  Pour le fonds Raiffeisen, les rendements annuels ont été vérifiés contre la fiche mensuelle officielle (2023 : 6,6 % ; 2024 : 5,9 % ; 2025 : 11,0 %).

### 2.4 Rendements des fonds

Dernier point de la série dans chaque mois, puis $R_t = I_t/I_{t-1} - 1$. Les rendements sont nets des frais incorporés dans la VNI et avant fiscalité personnelle : impôt anticipé récupérable pour un investisseur suisse, commissions d'émission et de rachat non incluses. L'alpha estimé sur ces rendements est donc un **alpha net** (section 7).

## 3. Marché suisse : SPI Total Return

- Source : Yahoo Finance `^SSHI`, c'est-à-dire le SPI (symbole SIX `SXGE`). SIX calcule le SPI comme indice de performance, dividendes réinvestis.
- Le pipeline ne remplace **jamais** cette série par un indice de prix. Si elle est indisponible, les modèles qui l'utilisent affichent une erreur.
- Contrôle de plausibilité : rendement moyen SPI − SMI, ce dernier étant un indice de prix. Ce n'est qu'un indicateur, car les compositions diffèrent.
- Historique long : Yahoo ne remonte qu'à mars 2013. Avant, la série est prolongée par `data/history/spi_tr_history.csv` (SPI TR quotidien depuis janvier 1988). Le raccord n'a lieu que si les deux séries concordent sur leur période commune : niveau, absence de dérive (qui trahirait un indice de prix) et jours divergents. Sinon, il est refusé et signalé dans le rapport de construction. Les niveaux Yahoo sont conservés ; l'historique est remis à leur échelle à la date de jonction.
- Alternative : import manuel `data/manual/spi_tr_daily.csv`, par exemple un export SIX. Il remplace alors entièrement la source Yahoo et l'historique.

## 4. Taux sans risque : SARON et prolongement

- Source : fixing quotidien publié par la BNS (cube `snbgwdzid`, data.snb.ch). SIX Index AG est l'administrateur du taux.
- Le SARON est un **taux overnight annualisé** (ACT/360). Le pipeline construit l'indice capitalisé :

  I_{d_{i+1}} = I_{d_i} × (1 + r_i/100 × n_i/360),

  où n_i est le nombre de jours calendaires jusqu'au fixing suivant. Le taux du vendredi court ainsi sur le week-end.
- Rendement sans risque réalisé du mois m : R_f,m = I(dernier fixing de m) / I(dernier fixing de m−1) − 1. La convention de date est la même que pour les cours de clôture.
- **Le SARON annualisé n'est jamais soustrait directement à un rendement mensuel.**
- Les taux négatifs (2015-2022) donnent des rendements sans risque négatifs, conservés tels quels.
- Dans tous les univers, le rendement excédentaire de l'actif et celui du marché sont calculés avec le SARON.

### 4.1 Prolongement avant le SARON quotidien

Le SARON quotidien du portail BNS commence le 24 août 2009. Pour les mois antérieurs, la colonne `rf_saron` est prolongée par des taux mensuels du cube `zimoma` de la BNS, relevés en fin de mois :

| Période | Taux r_{m−1} (% annualisé, fin du mois m−1) | Remarque |
|---|---|---|
| depuis septembre 2009 | — | SARON quotidien capitalisé (ci-dessus) |
| juillet 1999 – août 2009 | SARON de fin de mois | même taux, mais un seul relevé par mois |
| février 1994 – juin 1999 | Créances comptables à court terme de la Confédération (GMBF) à 3 mois | équivalent suisse des T-bills, rendement de la dernière enchère du mois ; la série commence en 1992, mais des mois manquent jusqu'à janvier 1994 |

- **Formule** : R_f,m = r_{m−1}/100 × j_m/360, où j_m est le nombre de jours du mois m. Le taux est connu au début du mois (ex ante), comme le T-bill utilisé par K. French, alors que le SARON capitalisé est un rendement réalisé.
- **Vérification de la convention** : sur 2009-2026, la valeur mensuelle du cube `zimoma` est le fixing du dernier jour du mois (écart maximal 0,005 point avec le fixing quotidien arrondi), et non une moyenne mensuelle.
- **Contrôles de raccord**, publiés dans les contrôles du jeu de données :
  1. l'approximation par le SARON de fin de mois est comparée au SARON capitalisé sur la période commune (depuis septembre 2009) : elle est retenue si la corrélation est d'au moins 0,95 et l'écart moyen d'au plus 0,20 point par an ;
  2. le taux GMBF est comparé au SARON de fin de mois sur 1999-2009 : il est retenu si la corrélation est d'au moins 0,90 et l'écart moyen d'au plus 0,75 point par an.

  Un raccord refusé laisse le taux sans risque manquant pour les mois concernés. Un mois manquant dans la série GMBF interrompt le prolongement : seuls les mois contigus au segment suivant sont utilisés, sans interpolation.
- **Limites** : le taux GMBF à 3 mois contient une petite prime de terme par rapport à un taux au jour le jour ; un taux fixé en début de mois ne reflète pas les changements de taux intervenus pendant le mois (par exemple les baisses d'octobre 2008), ce qui crée des écarts mensuels de quelques centièmes de point, sans effet notable sur les régressions.
- Les taux spot des obligations de la Confédération, également publiés par la BNS, n'ont pas été retenus : leur échéance la plus courte est d'un an, ce qui ajouterait une prime de terme et un risque de taux sur l'horizon mensuel.

## 5. Facteurs

### 5.1 Univers de facteurs

L'interface propose deux univers, pour les quatre modèles (CAPM / Single Index, Fama-French 3, Carhart 4, Fama-French 5) :

| Univers | Marché (MKT) | Facteurs long-short | Statut |
|---|---|---|---|
| **Suisse** (`SWISS`, par défaut) | SPI TR − SARON | SMB, HML, RMW, CMA, MOM suisses de Global Factor Data (JKP), en CHF | Univers de référence, homogène pour un actif suisse |
| **Europe** (`EUROPE`) | Marché européen Fama-French en CHF − SARON | SMB, HML, RMW, CMA, WML européens de K. French, en CHF | Comparaison : ce n'est pas le marché naturel d'un actif suisse |

Dans l'univers suisse, le CAPM est le **Single Index Model** contre le SPI TR.

Modèles : FF3 = MKT, SMB, HML ; Carhart = FF3 + MOM ; FF5 = FF3 + RMW + CMA.

**Ancienne variante hybride.** Avant l'ajout des facteurs suisses, les modèles multifactoriels pouvaient combiner le marché SPI et les facteurs européens (univers `SPI` du moteur). Cette variante, non homogène, **n'est plus proposée dans l'interface**. Le moteur la conserve pour deux usages : la validation contre statsmodels, qui couvre les trois univers, et les rapports PDF, qui n'ont pas encore été mis à jour (section 11). Les anciens liens `market=SPI` sont redirigés vers l'univers suisse.

### 5.2 Facteurs suisses : Global Factor Data (JKP)

- **Source.** Jensen, Kelly et Pedersen (2023, *Journal of Finance*), archives publiques de jkpfactors.com : fichiers `[che]_[caractéristique]_[monthly]_[vw_cap].zip`, rendements mensuels en USD, déjà orientés (jambe longue = prime attendue).
- **Correspondance** avec les facteurs Fama-French :

  | Facteur | Caractéristique JKP | Portefeuille long − court |
  |---|---|---|
  | SMB | `market_equity` | petites − grandes capitalisations |
  | HML | `be_me` | valeur − croissance (fonds propres comptables / capitalisation) |
  | RMW | `ope_be` | rentables − peu rentables (résultat d'exploitation / fonds propres) |
  | CMA | `at_gr1` | conservatrices − agressives (croissance annuelle des actifs) |
  | MOM | `ret_12_1` | gagnantes − perdantes (rendement de t−12 à t−1) |

- **Construction.** Portefeuilles long-short sur les terciles de chaque caractéristique, pondérés par la capitalisation plafonnée (`vw_cap`). Ce ne sont pas les tris doubles 2×3 de Fama et French : les **mêmes SMB et HML** servent pour FF3, Carhart et FF5.
- **Filtre.** Les mois où un facteur repose sur moins de 30 titres (`JKP_MIN_STOCKS`) sont écartés.
- **Conversion en CHF.** F^CHF = F^USD (1 + s), comme les facteurs européens (section 5.4).
- **Contrôles.** Rendements mensuels inférieurs à 50 % en valeur absolue ; pays et caractéristique de chaque fichier vérifiés ; corrélation avec les facteurs européens publiée (attendue modérée : entre 0,3 et 0,8 environ sur les données actuelles).
- **Couverture.** La publication est **annuelle** : l'univers suisse s'arrête au dernier mois publié (décembre 2025 pour la version actuelle), plus tôt que le SPI, le SARON et les actifs.

### 5.3 Facteurs européens : Kenneth French Data Library

- *European Fama-French 3 Factors*, *European Fama-French 5 Factors* et *European Momentum Factor (WML)*.
- Publiés en USD et en pourcentage ; la colonne RF est le T-bill américain à 1 mois.
- FF3 et Carhart utilisent les SMB/HML du fichier 3 facteurs. FF5 utilise ceux du fichier 5 facteurs, construits différemment.

### 5.4 Conversion en CHF

Soit X_t le cours USD/CHF (CHF par USD) en fin de mois, et s_t = X_t/X_{t−1} − 1. La source principale est la BNS (cube `devkum`, cours de fin de mois) ; en cas d'échec, le pipeline se replie sur FRED `DEXSZUS` puis sur Yahoo `CHF=X`. La source utilisée figure dans le manifeste.

- **Marché européen en CHF** :
  - R_M^USD = (Mkt−RF) + RF_US ;
  - R_M^CHF = (1 + R_M^USD)(1 + s) − 1 ;
  - MKT_CHF = R_M^CHF − R_f^SARON.
- **Facteurs long-short** (suisses et européens). Chaque jambe se convertit par 1 + R^CHF = (1 + R^USD)(1 + s), d'où :

  F^CHF = (R_L^USD − R_S^USD)(1 + s) = F^USD (1 + s).

  Ce résultat est exact. Un portefeuille autofinancé ne contient pas de taux sans risque. Il ne garde qu'un terme croisé de change de second ordre.
- Le RF américain ne sert qu'à reconstituer le rendement total du marché européen en USD. Il n'entre jamais dans un rendement excédentaire en CHF.

Limites : le cours de fin de mois de la BNS (ou le cours de midi à New York pour FRED) n'est pas relevé exactement à l'heure de clôture des rendements des facteurs, décalage négligeable en mensuel ; la conversion suppose que l'investisseur CHF ne couvre pas son risque de change. Pour les facteurs suisses, convertir en USD puis revenir en CHF n'est pas neutre au second ordre, mais l'effet est du même ordre que ce terme croisé.

## 6. Estimation

On estime y = Xb + e par OLS avec constante, où y = R_actif − R_f et X contient la constante et les facteurs du modèle. Les estimations utilisent toutes les observations de la plage choisie pour lesquelles chaque série requise est disponible. Le moteur signale les ruptures de continuité. Il exige au moins max(24, k + 10) observations.

| Méthode | Covariance | Tests individuels | Test global |
|---|---|---|---|
| Classique | s²(X′X)⁻¹, s² = SSR/(n−k) | Student t(n−k) | F(k−1, n−k) |
| HC3 | (X′X)⁻¹ X′ diag(e²/(1−h)²) X (X′X)⁻¹ | Normale (z) | Wald χ²(k−1) |
| Newey-West | noyau de Bartlett, L retards, sans correction n/(n−k) | Normale (z) | Wald χ²(k−1) |

- Retards par défaut : L = ⌊4(n/100)^(2/9)⌋ (Newey et West, 1994). L peut être choisi manuellement.
- Les coefficients sont identiques pour toutes les méthodes. Seules la covariance, les statistiques, les p-values et les intervalles changent.
- Pour les méthodes robustes, aucune statistique F classique n'est affichée : le test global est un test de Wald.
- Alpha annualisé = 12 × alpha mensuel (annualisation arithmétique). Les t-stats sont inchangés.
- La droite et sa bande de confiance sur le nuage de points représentent l'intervalle de la **moyenne conditionnelle** x₀′b ± c·√(x₀′Vx₀), calculé avec la covariance de la méthode choisie.

## 7. Alpha net et alpha brut des fonds

- Les rendements des fonds étant nets des frais incorporés dans la VNI, la constante estimée est un **alpha net**.
- L'**alpha brut** (avant frais de gestion) ajoute le TER publié : α_brut = α_net + TER/12 par mois.
- Ajouter TER/12 à chaque rendement mensuel décale la constante de TER/12 sans changer les pentes, les résidus ni les erreurs standards. L'intervalle de confiance est décalé d'autant, et le test de l'alpha brut est celui de H0 : α_net = −TER/12, avec la même loi (Student ou normale) que l'estimation.
- TER utilisés : celui lu par le pipeline (page Gérifonds pour le fonds BCV, fiche Swiss Fund Data pour les autres fonds), avec sa date et sa source, publiés dans `fund_info` et `raif_info` du jeu de données. Sans TER lu, aucun alpha brut n'est affiché.
- Approximations : TER actuel supposé constant sur toute la période ; les frais de transaction, qui ne font pas partie du TER, restent déduits.
- L'action BCV n'a pas d'alpha brut.

## 7 bis. Lecture graphique du modèle choisi

Dans l'onglet « Results », le nuage de points du Single Index (SPI TR) reste affiché comme référence. Pour tout autre modèle, il est précédé de graphiques propres au modèle choisi (`src/engine/decompose.ts`), tous exacts pour une OLS avec constante :

- **Contributions au rendement moyen** (cascade, annualisée ×12) : ȳ = α + Σ_j β_j x̄_j. Chaque barre est le produit de la sensibilité au facteur et de la prime moyenne de ce facteur sur l'échantillon.
- **Contributions à la variance** : R² = Σ_j β_j cov(x_j, y) / var(y), complété par la part non expliquée 1 − R². Une contribution peut être négative lorsque les facteurs sont corrélés entre eux.
- **Régressions partielles** (added-variable plots) : pour chaque facteur j, on régresse y et x_j sur tous les autres régresseurs, constante comprise, puis on trace les résidus de y contre ceux de x_j. Par le théorème de Frisch-Waugh-Lovell, la pente vaut exactement β_j et les résidus sont ceux du modèle complet. La bande vaut ±c·se(β_j)·|x̃|, avec l'erreur standard et la valeur critique de la méthode d'inférence choisie ; le R² partiel est indiqué.

Ces propriétés sont vérifiées par `tests/decompose.test.ts`.

## 8. Diagnostics

| Test | Statistique | Loi |
|---|---|---|
| Ljung-Box | Q = n(n+2) Σ r_k²/(n−k), m = min(12, ⌊n/5⌋) | χ²(m) |
| Breusch-Pagan (Koenker) | n·R² de la régression de e² sur X | χ²(k−1) |
| Jarque-Bera | n/6 · (S² + (K−3)²/4), moments biaisés | χ²(2) |

Graphiques complémentaires :

- ACF avec bandes ±1,96/√n ;
- Q-Q plot des résidus standardisés e/s, avec les positions (i − 0,5)/n.

## 9. Régressions mobiles et comparaisons

- **Régressions mobiles.** Les fenêtres glissantes comptent 36, 60 ou 120 observations consécutives et avancent d'un mois. La date affichée est la fin de fenêtre. La méthode d'inférence est celle choisie ; en HAC, les retards suivent la règle automatique sur la taille de la fenêtre.
- **Comparaison des modèles** (rubrique « Analyze »). Les 8 spécifications (4 modèles × univers suisse et européen) sont estimées sur **l'intersection exacte** de leurs dates disponibles dans la plage choisie. Comme l'univers suisse s'arrête au dernier mois publié par JKP, cet échantillon commun s'arrête aussi à cette date.
- **Comparaison de deux actifs** (rubrique « Compare »). Deux actifs au choix, A et B, sont estimés sur les **mêmes mois** : l'intersection des disponibilités des deux actifs, du SPI, du SARON et de tous les facteurs des quatre modèles de l'univers choisi. L'écart d'alpha est estimé par la régression de R_A − R_B sur les mêmes facteurs. Sa constante vaut exactement α_A − α_B, et son erreur standard (classique, HC3 ou Newey-West) tient compte de la corrélation entre les deux actifs. Le Single Index des deux actifs est affiché sur le même échantillon. Pour les fonds, les alphas nets et bruts sont présentés ; l'écart d'alpha brut entre deux fonds est l'écart net augmenté de (TER_A − TER_B)/12.

## 10. Validation numérique

| Comparaison | Script de référence | Fichier de test |
|---|---|---|
| Moteur TypeScript contre numpy/scipy, sur un jeu synthétique avec erreurs hétéroscédastiques AR(1) | `tests/fixtures/make_fixtures.py` | `tests/engine.test.ts` |
| Moteur TypeScript contre statsmodels, sur le jeu synthétique **et** les données réelles | `python -m pipeline.validate`, à chaque exécution du workflow | `tests/statsmodels.test.ts` |

La validation couvre les trois actifs et les trois univers du moteur (suisse, européen et l'ancienne variante hybride). Les comparaisons à statsmodels portent sur :

- les coefficients, erreurs standards, statistiques et p-values ;
- les intervalles de confiance, R² et tests globaux ;
- les tests Ljung-Box, Breusch-Pagan et Jarque-Bera ;
- les fenêtres mobiles.

Tolérance relative : 10⁻⁸ à 10⁻⁹.

## 11. Limites connues

- Les ajustements de Yahoo Finance peuvent contenir des erreurs. Les contrôles automatiques en détectent une partie seulement. En cas de doute, utilisez l'import manuel.
- Le SPI TR remonte à 1988 et le taux sans risque prolongé à février 1994 (section 4.1). Les échantillons sont désormais limités par les actifs eux-mêmes : action BCV depuis 2003 (historique Yahoo), fonds BCV depuis 1998, fonds UBS depuis 2000, fonds Swisscanto depuis 2001, fonds Raiffeisen depuis décembre 2009, et, dans l'univers suisse, par la disponibilité des facteurs JKP.
- Les facteurs suisses JKP sont publiés une fois par an : les derniers mois manquent jusqu'à la mise à jour suivante. Ils ne reproduisent pas exactement la construction Fama-French (terciles par caractéristique, pas de tri double).
- Les rendements French et JKP sont révisés occasionnellement par leurs auteurs : les résultats peuvent changer légèrement d'une mise à jour à l'autre.
- Le facteur momentum européen démarre plus tard que les fichiers 3 et 5 facteurs. Dans l'univers européen, l'échantillon commun commence donc à cette date au plus tôt.
- **Rapports PDF.** Les rapports (`report/`) n'utilisent pas encore l'univers suisse : leurs modèles multifactoriels reposent sur le marché SPI avec facteurs européens (ancienne variante hybride, signalée « h » dans leurs tableaux) et sur l'univers européen. Ils seront alignés sur le site lors de leur prochaine révision.
