# Rapport de construction des données

Généré le 2026-11-06T04:18:27Z

## Sources

| Source | Statut | Couverture | Message |
|---|---|---|---|
| BCV (BCVN.SW) — cours ajustés dividendes et opérations sur titres | ok | 2002-12-06 → 2026-11-05 |  |
| SPI — Swiss Performance Index (SXGE), indice de performance (TR), CHF | ok | 2013-03-05 → 2026-11-05 |  |
| SARON — fixing quotidien (taux overnight annualisé, %) | ok | 2026-10-26 → 2026-10-30 | Série BNS D0(SARON) « SARON fixing at the close of the trading day » |
| USD/CHF (CHF par USD), cours quotidien | ok | 2003-09-17 → 2026-11-06 | FRED indisponible (ReadTimeout: HTTPSConnectionPool(host='fred.stlouisfed.org', port=443): Read timed out. (read timeout=60)) |
| European Fama-French 3 Factors (mensuel, USD, RF = T-bill US 1 mois) | ok | 1990-07 → 2026-09 | Colonnes : Mkt-RF, SMB, HML, RF. |
| European Fama-French 5 Factors (mensuel, USD, RF = T-bill US 1 mois) | ok | 1990-07 → 2026-09 | Colonnes : Mkt-RF, SMB, HML, RMW, CMA, RF. |
| European Momentum Factor (mensuel, USD, RF = T-bill US 1 mois) | ok | 1990-11 → 2026-09 | Colonnes : WML. |

## Contrôles

- **warn** — BCV : 1 mois écartés (dernière observation à plus de 5 jours de la fin du mois) : 2026-11
- **pass** — Split 10:1 de mai 2020 présent dans les données (2020-05-28). Splits : 2020-05-28 (×10).
- **pass** — Aucune variation quotidienne > 35 % du cours ajusté (max |r| = 14.6%, le 2009-03-10).
- **pass** — Ajustement des dividendes : 23 détachements ; rendement total − rendement de prix = +3.39% par an en moyenne.
- **warn** — SPI : 1 mois écartés (dernière observation à plus de 5 jours de la fin du mois) : 2026-11
- **pass** — Plausibilité « total return » de ^SSHI : rendement moyen SPI − SMI (indice de prix) = +3.06% par an sur 163 mois. Indicateur seulement (compositions différentes) ; la nature TR repose sur la définition SIX du SPI.
- **pass** — SARON quotidien disponible du 2026-10-26 au 2026-10-30 ; rendement mensuel = capitalisation ACT/360.
- **warn** — USD/CHF : 1 mois écartés (dernière observation à plus de 5 jours de la fin du mois) : 2026-11
- **pass** — Cohérence Mkt−RF et RF entre fichiers FF3 et FF5 : écarts max 0.00e+00 et 0.00e+00.
- **pass** — Facteurs Fama-French européens convertis en CHF : marché = (1+Mkt−RF+RF_US)(1+s)−1, facteurs long-short = F_USD(1+s). Le rendement excédentaire du marché est calculé avec le SARON, jamais avec le RF américain.

## Couverture des colonnes

| Colonne | Premier mois | Dernier mois | N |
|---|---|---|---|
| bcv_ret | 2003-01 | 2026-10 | 286 |
| spi_ret | 2013-04 | 2026-10 | 163 |
| rf_saron | — | — | 0 |
| fx_usdchf_ret | 2003-10 | 2026-10 | 277 |
| mkt_rf_usd | 1990-07 | 2026-09 | 435 |
| rf_us | 1990-07 | 2026-09 | 435 |
| smb3_usd | 1990-07 | 2026-09 | 435 |
| hml3_usd | 1990-07 | 2026-09 | 435 |
| mkt_eu_chf | 2003-10 | 2026-09 | 276 |
| smb3_chf | 2003-10 | 2026-09 | 276 |
| hml3_chf | 2003-10 | 2026-09 | 276 |
| smb5_usd | 1990-07 | 2026-09 | 435 |
| smb5_chf | 2003-10 | 2026-09 | 276 |
| hml5_usd | 1990-07 | 2026-09 | 435 |
| hml5_chf | 2003-10 | 2026-09 | 276 |
| rmw5_usd | 1990-07 | 2026-09 | 435 |
| rmw5_chf | 2003-10 | 2026-09 | 276 |
| cma5_usd | 1990-07 | 2026-09 | 435 |
| cma5_chf | 2003-10 | 2026-09 | 276 |
| wml_usd | 1990-11 | 2026-09 | 431 |
| wml_chf | 2003-10 | 2026-09 | 276 |
