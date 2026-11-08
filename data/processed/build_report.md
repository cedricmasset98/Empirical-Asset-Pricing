# Data build report

Generated on 2026-11-08T15:25:35Z

## Sources

| Source | Status | Coverage | Message |
|---|---|---|---|
| BCV (BCVN.SW) — prices adjusted for dividends and corporate actions | ok | 2002-12-06 → 2026-11-06 |  |
| BCV Swiss Equity A (CH0006018706) — official performance, distributions reinvested | ok | 1997-12-31 → 2026-11-05 | 7325 daily values; 28 published distributions. |
| Raiffeisen Futura - Swiss Stock A (CH0011980981) — total return, distributions reinvested | ok | 2009-11-23 → 2026-11-05 | 4261 daily values (NAV and total return). |
| Swisscanto (CH) Equity Fund Responsible Switzerland AA (CH0011792451) — total return, distributions reinvested | ok | 2001-04-19 → 2026-11-05 | 6408 daily values (NAV and total return). |
| UBS (CH) Equity Fund - Switzerland Sustainable (CHF) P (CH0002791769) — total return, distributions reinvested | ok | 2000-01-04 → 2026-11-05 | 6755 daily values (NAV and total return). |
| UBS 100 Index-Fund Switzerland (CHF) P (CH0002788807) — total return, distributions reinvested | ok | 2000-01-04 → 2026-11-05 | 6754 daily values (NAV and total return). |
| SPI — Swiss Performance Index (SXGE), total return index, CHF | ok | 1988-01-04 → 2026-11-06 |  |
| SARON — daily fixing (annualised overnight rate, %) | ok | 2009-08-24 → 2026-10-30 | SNB series D0(SARON) "SARON fixing at the close of the trading day" |
| Swiss money market rates, monthly: month-end SARON and 3-month Confederation money market debt register claims (%) | ok | 1992-01-01 → 2026-10-01 | SNB series D0(SARON,EG3M); saron_eom from 1999-06; tbill_3m from 1992-01. |
| USD/CHF (CHF per USD), month-end rate | ok | 1980-01-31 → 2026-10-31 | SNB series devkum D0(M1),D1(USD1) |
| European Fama-French 3 Factors (monthly, USD, RF = 1-month US T-bill) | ok | 1990-07 → 2026-09 | Columns: Mkt-RF, SMB, HML, RF. |
| European Fama-French 5 Factors (monthly, USD, RF = 1-month US T-bill) | ok | 1990-07 → 2026-09 | Columns: Mkt-RF, SMB, HML, RMW, CMA, RF. |
| European Momentum Factor (monthly, USD, RF = 1-month US T-bill) | ok | 1990-11 → 2026-09 | Columns: WML. |
| Swiss Global Factor Data (JKP) factors: size, value, profitability, investment, momentum — monthly, USD | ok | 1986-01 → 2025-12 | Characteristics: SMB = market_equity, HML = be_me, RMW = ope_be, CMA = at_gr1, MOM = ret_12_1; weighting vw_cap; last published month 2025-12. |

## Checks

- **warn** — BCV: 1 months dropped (last observation more than 5 days before month-end): 2026-11
- **pass** — 10:1 split of May 2020 present in the data (2020-05-28). Splits: 2020-05-28 (×10).
- **pass** — No daily change > 35% in the adjusted price (max |r| = 14.6%, on 2009-03-10).
- **pass** — Dividend adjustment: 23 ex-dividend dates; total return − price return = +3.39% per year on average.
- **pass** — Fund: published TER 1.11% as of 2026-03-31.
- **warn** — Fund: 1 months dropped (last observation more than 5 days before month-end): 2026-11
- **pass** — Fund: 100.00% of the 7323 daily returns of the official series reproduced from NAVs and gross distributions (tolerance 5e-05); tooltip NAVs lag by one day from about 2021-09-28, lag corrected in the check.
- **pass** — Fund: the 28 published distributions are included exactly once, at the gross amount (latest: 2026-07-21, 5.70 CHF).
- **pass** — Fund: recomputed YTD performance 15.56% vs 15.56% published by Gérifonds as of 2026-11-05.
- **warn** — Raiffeisen fund: 1 months dropped (last observation more than 5 days before month-end): 2026-11
- **pass** — Raiffeisen fund: "Chart Price" equal to the published NAV.
- **pass** — Raiffeisen fund: outside distributions, total return = NAV return on 100.00% of 4260 days.
- **pass** — Raiffeisen fund: 14 implied distributions (latest: 2021-06-24: 3.80, 2022-11-04: 3.70, 2023-11-06: 5.20, 2024-11-07: 4.50, 2025-11-05: 4.50, 2026-09-02: 4.60).
- **pass** — Raiffeisen fund: published TER 1.20% as of 2026-06-30.
- **warn** — Swisscanto fund: 1 months dropped (last observation more than 5 days before month-end): 2026-11
- **pass** — Swisscanto fund: "Chart Price" equal to the published NAV.
- **pass** — Swisscanto fund: outside distributions, total return = NAV return on 100.00% of 4777 days.
- **warn** — Swisscanto fund: 1630 daily total-return values from 2001-04-19 have no published NAV in the export and cannot be cross-checked; the checks above start on 2007-10-12.
- **pass** — Swisscanto fund: 18 implied distributions (latest: 2021-01-19: 21.60, 2022-01-25: 35.80, 2023-01-18: 20.35, 2024-01-23: 23.20, 2025-01-22: 25.65, 2026-01-21: 24.80).
- **pass** — Swisscanto fund: published TER 1.40% as of 2025-09-30.
- **warn** — UBS Sustainable fund: 1 months dropped (last observation more than 5 days before month-end): 2026-11
- **pass** — UBS Sustainable fund: "Chart Price" equal to the published NAV.
- **pass** — UBS Sustainable fund: outside distributions, total return = NAV return on 100.00% of 6754 days.
- **pass** — UBS Sustainable fund: 25 implied distributions (latest: 2022-01-12: 26.05, 2023-01-11: 24.81, 2023-05-08: 18.80, 2024-01-10: 9.20, 2025-01-13: 28.63, 2025-05-08: 30.99).
- **pass** — UBS Sustainable fund: published TER 0.95% as of 2025-10-31.
- **warn** — UBS 100 index fund: 1 months dropped (last observation more than 5 days before month-end): 2026-11
- **pass** — UBS 100 index fund: "Chart Price" equal to the published NAV.
- **pass** — UBS 100 index fund: outside distributions, total return = NAV return on 100.00% of 6753 days.
- **pass** — UBS 100 index fund: 26 implied distributions (latest: 2021-01-11: 166.31, 2022-01-12: 188.85, 2023-01-11: 199.97, 2024-01-10: 214.70, 2025-01-13: 212.66, 2026-01-14: 219.88).
- **pass** — UBS 100 index fund: published TER 0.27% as of 2025-10-31.
- **pass** — SPI: history data/history/spi_tr_history.csv spliced onto ^SSHI after a consistency check — 3061 common trading days (2013-03-05 → 2025-05-16); median ratio 1.00000, drift +0.000%, diverging days 0.03%
- **warn** — SPI: 1 months dropped (last observation more than 5 days before month-end): 2026-11
- **pass** — SPI total-return plausibility: mean return SPI − SMI (price index) = +2.09% per year over 431 months. Indicative only (different constituents); the TR nature rests on SIX's definition of the SPI.
- **pass** — Daily SARON available from 2009-08-24 to 2026-10-30; monthly return = ACT/360 compounding.
- **pass** — Month-end SARON of the previous month × days/360 vs realised compounded SARON: correlation 0.997, mean difference +0.006 pt/yr, max monthly gap 0.029 pt, 206 months. Approximation accepted.
- **pass** — 3-month Confederation money market debt register claims vs month-end SARON (both × days/360): correlation 0.954, mean difference -0.002 pt/yr, max monthly gap 0.143 pt, 122 months. Splice accepted.
- **pass** — Risk-free rate: 1994-02 → 1999-06: 3-month Confederation money market debt register claims (end of previous month) × days/360; 1999-07 → 2009-08: month-end SARON of the previous month × days/360; 2009-09 → 2026-10: daily SARON compounded over the month (ACT/360).
- **pass** — Consistency of Mkt−RF and RF between the FF3 and FF5 files: max differences 0.00e+00 and 0.00e+00.
- **pass** — Swiss JKP factors from 1993-07 to 2025-12 (months kept: at least 30 stocks per factor), converted to CHF as F_USD(1+s). Updated annually: the latest months of the sample may be missing.
- **pass** — Correlation of Swiss JKP / European Fama-French factors (USD): SMB 0.58, HML 0.64, RMW 0.40, CMA 0.34, MOM 0.78. Moderate correlations expected: different markets and methods.
- **pass** — European Fama-French factors converted to CHF: market = (1+Mkt−RF+RF_US)(1+s)−1, long-short factors = F_USD(1+s). The market excess return is computed with SARON, never with the US RF.

## Column coverage

| Column | First month | Last month | N |
|---|---|---|---|
| bcv_ret | 2003-01 | 2026-10 | 286 |
| fund_ret | 1998-01 | 2026-10 | 346 |
| raif_ret | 2009-12 | 2026-10 | 203 |
| swc_ret | 2001-05 | 2026-10 | 306 |
| ubss_ret | 2000-02 | 2026-10 | 321 |
| ubs100_ret | 2000-02 | 2026-10 | 321 |
| spi_ret | 1988-02 | 2026-10 | 465 |
| rf_saron | 1994-02 | 2026-10 | 393 |
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
| smb_ch | 1989-03 | 2025-12 | 442 |
| hml_ch | 1991-07 | 2025-12 | 414 |
| rmw_ch | 1993-07 | 2025-12 | 390 |
| cma_ch | 1992-05 | 2025-12 | 404 |
| mom_ch | 1990-03 | 2025-12 | 430 |
