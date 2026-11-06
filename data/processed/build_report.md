# Rapport de construction des données

Généré le 2026-11-06T18:55:24Z

## Sources

| Source | Statut | Couverture | Message |
|---|---|---|---|
| BCV (BCVN.SW) — cours ajustés dividendes et opérations sur titres | ok | 2002-12-06 → 2026-11-06 |  |
| BCV Swiss Equity A (CH0006018706) — performance officielle, distributions réinvesties | ok | 1997-12-31 → 2026-11-05 | 7325 valeurs quotidiennes ; 28 distributions publiées. |
| SPI — Swiss Performance Index (SXGE), indice de performance (TR), CHF | ok | 1988-01-04 → 2026-11-06 |  |
| SARON — fixing quotidien (taux overnight annualisé, %) | ok | 2009-08-24 → 2026-10-30 | Série BNS D0(SARON) « SARON fixing at the close of the trading day » |
| USD/CHF (CHF par USD), cours de fin de mois | ok | 1980-01-31 → 2026-10-31 | Série BNS devkum D0(M1),D1(USD1) |
| European Fama-French 3 Factors (mensuel, USD, RF = T-bill US 1 mois) | ok | 1990-07 → 2026-09 | Colonnes : Mkt-RF, SMB, HML, RF. |
| European Fama-French 5 Factors (mensuel, USD, RF = T-bill US 1 mois) | ok | 1990-07 → 2026-09 | Colonnes : Mkt-RF, SMB, HML, RMW, CMA, RF. |
| European Momentum Factor (mensuel, USD, RF = T-bill US 1 mois) | ok | 1990-11 → 2026-09 | Colonnes : WML. |

## Contrôles

- **warn** — BCV : 1 mois écartés (dernière observation à plus de 5 jours de la fin du mois) : 2026-11
- **pass** — Split 10:1 de mai 2020 présent dans les données (2020-05-28). Splits : 2020-05-28 (×10).
- **pass** — Aucune variation quotidienne > 35 % du cours ajusté (max |r| = 14.6%, le 2009-03-10).
- **pass** — Ajustement des dividendes : 23 détachements ; rendement total − rendement de prix = +3.39% par an en moyenne.
- **warn** — Fonds : 1 mois écartés (dernière observation à plus de 5 jours de la fin du mois) : 2026-11
- **pass** — Fonds : 100.00% des 7323 rendements quotidiens de la série officielle retrouvés à partir des VNI et des distributions brutes (tolérance 5e-05) ; VNI des infobulles décalées d'un jour à partir de 2021-09-28 environ, décalage corrigé dans le contrôle.
- **pass** — Fonds : les 28 distributions publiées sont incluses une et une seule fois, au montant brut (dernière : 2026-07-21, 5.70 CHF).
- **pass** — Fonds : performance YTD recalculée 15.56% contre 15.56% publiée par Gérifonds au 2026-11-05.
- **pass** — SPI : historique data/history/spi_tr_history.csv raccordé à ^SSHI après contrôle de concordance — 3061 séances communes (2013-03-05 → 2025-05-16) ; ratio médian 1.00000, dérive +0.000%, jours divergents 0.03%
- **warn** — SPI : 1 mois écartés (dernière observation à plus de 5 jours de la fin du mois) : 2026-11
- **pass** — Plausibilité « total return » du SPI : rendement moyen SPI − SMI (indice de prix) = +2.09% par an sur 431 mois. Indicateur seulement (compositions différentes) ; la nature TR repose sur la définition SIX du SPI.
- **pass** — SARON quotidien disponible du 2009-08-24 au 2026-10-30 ; rendement mensuel = capitalisation ACT/360.
- **pass** — Cohérence Mkt−RF et RF entre fichiers FF3 et FF5 : écarts max 0.00e+00 et 0.00e+00.
- **pass** — Facteurs Fama-French européens convertis en CHF : marché = (1+Mkt−RF+RF_US)(1+s)−1, facteurs long-short = F_USD(1+s). Le rendement excédentaire du marché est calculé avec le SARON, jamais avec le RF américain.

## Couverture des colonnes

| Colonne | Premier mois | Dernier mois | N |
|---|---|---|---|
| bcv_ret | 2003-01 | 2026-10 | 286 |
| fund_ret | 1998-01 | 2026-10 | 346 |
| spi_ret | 1988-02 | 2026-10 | 465 |
| rf_saron | 2009-09 | 2026-10 | 206 |
| fx_usdchf_ret | 1988-02 | 2026-10 | 465 |
| mkt_rf_usd | 1990-07 | 2026-09 | 435 |
| rf_us | 1990-07 | 2026-09 | 435 |
| smb3_usd | 1990-07 | 2026-09 | 435 |
| hml3_usd | 1990-07 | 2026-09 | 435 |
| mkt_eu_chf | 1990-07 | 2026-09 | 435 |
| smb3_chf | 1990-07 | 2026-09 | 435 |
| hml3_chf | 1990-07 | 2026-09 | 435 |
| smb5_usd | 1990-07 | 2026-09 | 435 |
| smb5_chf | 1990-07 | 2026-09 | 435 |
| hml5_usd | 1990-07 | 2026-09 | 435 |
| hml5_chf | 1990-07 | 2026-09 | 435 |
| rmw5_usd | 1990-07 | 2026-09 | 435 |
| rmw5_chf | 1990-07 | 2026-09 | 435 |
| cma5_usd | 1990-07 | 2026-09 | 435 |
| cma5_chf | 1990-07 | 2026-09 | 435 |
| wml_usd | 1990-11 | 2026-09 | 431 |
| wml_chf | 1990-11 | 2026-09 | 431 |
