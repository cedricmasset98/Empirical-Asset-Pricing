# Méthodologie

Ce document décrit les conventions retenues. Elles sont appliquées par le pipeline Python (`pipeline/`) et par le moteur statistique exécuté dans le navigateur (`src/engine/`).

## 1. Données et fréquence

Version 1 : **fréquence mensuelle uniquement**. Les fréquences journalière et hebdomadaire apparaissent dans l'interface comme « non disponibles » : elles demandent un traitement propre des jours fériés suisses, des taux sans risque journaliers et des facteurs French journaliers en USD.

Chaque mois est identifié par `AAAA-MM`. La valeur d'une série pour un mois est sa **dernière observation du mois calendaire**. Un mois est écarté, donc laissé manquant, dans deux cas :

- sa dernière observation précède la fin du mois de plus de 5 jours calendaires (`MAX_MONTH_END_GAP_DAYS`) ;
- il n'est pas terminé à la date d'exécution.

Les rendements ne sont calculés qu'entre mois consécutifs. Un mois manquant rend les deux rendements adjacents manquants. Le pipeline n'interpole jamais.

## 2. Action BCV

- Source : Yahoo Finance (`BCVN.SW`) via `yfinance`, colonne `Adj Close`, ajustée des dividendes et des splits.
- Rendement : R_t = P^adj_t / P^adj_{t−1} − 1.
- Contrôles automatiques, publiés dans `data/processed/build_report.md` et dans l'onglet « Données » :
  - présence du **split 10:1 de mai 2020** dans les opérations sur titres ;
  - absence de variation quotidienne supérieure à 35 % du cours ajusté, ce qui détecterait un split non ajusté ;
  - écart moyen positif entre rendement total et rendement de prix, preuve de l'ajustement des dividendes.

## 3. Marché suisse : SPI Total Return

- Source : Yahoo Finance `^SSHI`, c'est-à-dire le SPI (symbole SIX `SXGE`). SIX calcule le SPI comme indice de performance, dividendes réinvestis.
- Le pipeline ne remplace **jamais** cette série par un indice de prix. Si elle est indisponible, les modèles qui l'utilisent affichent une erreur.
- Contrôle de plausibilité : rendement moyen SPI − SMI, ce dernier étant un indice de prix. Ce n'est qu'un indicateur, car les compositions diffèrent.
- Alternative : import manuel `data/manual/spi_tr_daily.csv`, par exemple un export SIX.

## 4. Taux sans risque : SARON

- Source : fixing quotidien publié par la BNS (cube `snbgwdzid`, data.snb.ch). SIX Index AG est l'administrateur du taux.
- Le SARON est un **taux overnight annualisé** (ACT/360). Le pipeline construit l'indice capitalisé :

  I_{d_{i+1}} = I_{d_i} × (1 + r_i/100 × n_i/360),

  où n_i est le nombre de jours calendaires jusqu'au fixing suivant. Le taux du vendredi court ainsi sur le week-end.
- Rendement sans risque réalisé du mois m : R_f,m = I(dernier fixing de m) / I(dernier fixing de m−1) − 1. La convention de date est la même que pour les cours de clôture.
- **Le SARON annualisé n'est jamais soustrait directement à un rendement mensuel.**
- Les taux négatifs (2015-2022) donnent des rendements sans risque négatifs, conservés tels quels.

## 5. Facteurs Fama-French européens et conversion en CHF

### Séries utilisées

Les séries viennent de la Kenneth French Data Library :

- *European Fama-French 3 Factors* ;
- *European Fama-French 5 Factors* ;
- *European Momentum Factor (WML)*.

Elles sont publiées en USD et en pourcentage, et la colonne RF est le T-bill américain à 1 mois.

### Conversion

Soit X_t le cours USD/CHF (CHF par USD) en fin de mois, et s_t = X_t/X_{t−1} − 1. La source principale est la BNS (cube `devkum`, cours de fin de mois) ; en cas d'échec, le pipeline se replie sur FRED `DEXSZUS` puis sur Yahoo `CHF=X`. La source utilisée figure dans le manifeste.

- **Marché européen en CHF** :
  - R_M^USD = (Mkt−RF) + RF_US ;
  - R_M^CHF = (1 + R_M^USD)(1 + s) − 1 ;
  - MKT_CHF = R_M^CHF − R_f^SARON.
- **Facteurs long-short** (SMB, HML, RMW, CMA, WML). Chaque jambe se convertit par 1 + R^CHF = (1 + R^USD)(1 + s), d'où :

  F^CHF = (R_L^USD − R_S^USD)(1 + s) = F^USD (1 + s).

  Ce résultat est exact. Un portefeuille autofinancé ne contient pas de taux sans risque. Il ne garde qu'un terme croisé de change de second ordre.
- Le RF américain ne sert qu'à reconstituer le rendement total du marché en USD. Il n'entre jamais dans un rendement excédentaire en CHF.
- Les modèles FF3 et Carhart utilisent les SMB/HML du fichier 3 facteurs. FF5 utilise ceux du fichier 5 facteurs, construits différemment.

### Limites

- Le cours de fin de mois de la BNS (ou le cours de midi à New York pour FRED) n'est pas relevé exactement à l'heure de clôture utilisée pour les rendements French. Ce décalage de quelques heures est négligeable en mensuel, mais il existe.
- La conversion suppose que l'investisseur CHF ne couvre pas son risque de change.

### Univers de facteurs

| Marché choisi | CAPM | FF3 / Carhart / FF5 |
|---|---|---|
| SPI TR | Single Index Model suisse, cohérent | **Variante hybride** : marché suisse, facteurs européens. Signalée dans l'interface. |
| Europe FF (CHF) | CAPM européen | Univers Fama-French européen cohérent |

## 6. Estimation

On estime y = Xb + e par OLS avec constante, où y = R_BCV − R_f. Les estimations utilisent toutes les observations de la plage pour lesquelles chaque série requise est disponible. Le moteur signale les ruptures de continuité. Il exige au moins max(24, k + 10) observations.

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

## 7. Diagnostics

| Test | Statistique | Loi |
|---|---|---|
| Ljung-Box | Q = n(n+2) Σ r_k²/(n−k), m = min(12, ⌊n/5⌋) | χ²(m) |
| Breusch-Pagan (Koenker) | n·R² de la régression de e² sur X | χ²(k−1) |
| Jarque-Bera | n/6 · (S² + (K−3)²/4), moments biaisés | χ²(2) |

Graphiques complémentaires :

- ACF avec bandes ±1,96/√n ;
- Q-Q plot des résidus standardisés e/s, avec les positions (i − 0,5)/n.

## 8. Régressions mobiles et comparaison

- Les fenêtres glissantes comptent 36, 60 ou 120 observations consécutives et avancent d'un mois. La date affichée est la fin de fenêtre. La méthode d'inférence est celle choisie ; en HAC, les retards suivent la règle automatique sur la taille de la fenêtre.
- La comparaison estime les 8 spécifications (4 modèles × 2 marchés) sur **l'intersection exacte** de leurs dates disponibles dans la plage sélectionnée.

## 9. Validation numérique

| Comparaison | Script de référence | Fichier de test |
|---|---|---|
| Moteur TypeScript contre numpy/scipy, sur un jeu synthétique avec erreurs hétéroscédastiques AR(1) | `tests/fixtures/make_fixtures.py` | `tests/engine.test.ts` |
| Moteur TypeScript contre statsmodels, sur le jeu synthétique **et** les données réelles | `python -m pipeline.validate`, à chaque exécution du workflow | `tests/statsmodels.test.ts` |

Les comparaisons à statsmodels portent sur :

- les coefficients, erreurs standards, statistiques et p-values ;
- les intervalles de confiance, R² et tests globaux ;
- les tests Ljung-Box, Breusch-Pagan et Jarque-Bera ;
- les fenêtres mobiles.

Tolérance relative : 10⁻⁸ à 10⁻⁹.

## 10. Limites connues

- Les ajustements de Yahoo Finance peuvent contenir des erreurs. Les contrôles automatiques en détectent une partie seulement. En cas de doute, utilisez l'import manuel.
- La couverture du SARON quotidien sur le portail BNS (depuis août 2009) et celle du SPI sur Yahoo Finance (depuis mars 2013) limitent l'échantillon : le Single Index Model commence en avril 2013. Un historique SPI TR plus long peut être fourni par import manuel.
- Les rendements French sont révisés occasionnellement par l'auteur : les résultats peuvent changer légèrement d'une mise à jour à l'autre.
- Le facteur momentum européen démarre plus tard que les fichiers 3 et 5 facteurs. L'échantillon commun de la comparaison commence donc à cette date au plus tôt.
