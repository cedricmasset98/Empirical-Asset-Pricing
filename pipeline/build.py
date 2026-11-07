"""Construit le jeu de données mensuel public/data/dataset.json.

Usage : python -m pipeline.build [--run-date AAAA-MM-JJ]

Le script ne s'arrête pas sur l'échec d'une source : la source est marquée
« error » dans le manifeste, ses colonnes restent vides (null) et l'interface
affiche une erreur explicite pour les modèles concernés. Le code de sortie
est non nul uniquement si aucune donnée de base (BCV, SPI, SARON) n'existe.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from . import config as C
from . import sources as S
from .transform import (
    convert_long_short_to_chf,
    convert_market_to_chf,
    fx_returns,
    month_end_levels,
    parse_french_csv,
    saron_monthly_returns,
    simple_returns,
)

COLUMN_INFO = {
    "bcv_ret": ("BCV total return", "BCVN.SW, adjusted price (dividends, splits), month-end to month-end"),
    "fund_ret": ("BCV Swiss Equity A total return", "Official Gérifonds performance index, gross distributions reinvested, net of fund fees"),
    "raif_ret": ("Raiffeisen Futura - Swiss Stock A total return", "Swiss Fund Data, \"Total Return Chart Price\" (distributions reinvested), net of fund fees"),
    "smb_ch": ("Swiss SMB (JKP, CHF)", "Global Factor Data, Switzerland: size (market_equity), terciles, capped weights; F_USD(1+s)"),
    "hml_ch": ("Swiss HML (JKP, CHF)", "Global Factor Data, Switzerland: book equity / market equity (be_me)"),
    "rmw_ch": ("Swiss RMW (JKP, CHF)", "Global Factor Data, Switzerland: operating profit / book equity (ope_be)"),
    "cma_ch": ("Swiss CMA (JKP, CHF)", "Global Factor Data, Switzerland: asset growth (at_gr1)"),
    "mom_ch": ("Swiss MOM (JKP, CHF)", "Global Factor Data, Switzerland: return from t−12 to t−1 (ret_12_1)"),
    "spi_ret": ("SPI TR return", "Swiss Performance Index (total return index, CHF)"),
    "rf_saron": ("Realised SARON risk-free rate", "Daily ACT/360 compounding of SARON over the month"),
    "mkt_eu_chf": ("FF European market, total return in CHF", "(1 + Mkt−RF + RF_US)(1 + s) − 1"),
    "smb3_chf": ("SMB (FF3 Europe) in CHF", "SMB_USD × (1 + s)"),
    "hml3_chf": ("HML (FF3 Europe) in CHF", "HML_USD × (1 + s)"),
    "wml_chf": ("WML momentum Europe in CHF", "WML_USD × (1 + s)"),
    "smb5_chf": ("SMB (FF5 Europe) in CHF", "SMB_USD × (1 + s)"),
    "hml5_chf": ("HML (FF5 Europe) in CHF", "HML_USD × (1 + s)"),
    "rmw5_chf": ("RMW (FF5 Europe) in CHF", "RMW_USD × (1 + s)"),
    "cma5_chf": ("CMA (FF5 Europe) in CHF", "CMA_USD × (1 + s)"),
    "fx_usdchf_ret": ("USD/CHF change (s)", "CHF per USD, month-end"),
    "rf_us": ("US RF (FF)", "1-month T-bill, as published by K. French"),
    "mkt_rf_usd": ("Mkt−RF Europe (USD, original)", "Kenneth French, Europe 3 Factors"),
    "smb3_usd": ("SMB FF3 (USD, original)", ""),
    "hml3_usd": ("HML FF3 (USD, original)", ""),
    "wml_usd": ("WML (USD, original)", ""),
    "smb5_usd": ("SMB FF5 (USD, original)", ""),
    "hml5_usd": ("HML FF5 (USD, original)", ""),
    "rmw5_usd": ("RMW FF5 (USD, original)", ""),
    "cma5_usd": ("CMA FF5 (USD, original)", ""),
}


def check(checks: list[dict], cid: str, status: str, message: str) -> None:
    checks.append({"id": cid, "status": status, "message": message})


def annual_mean(r: pd.Series) -> float:
    return float(r.dropna().mean() * 12)


def stale_note(name: str, stale: list[str], checks: list[dict]) -> None:
    if stale:
        shown = ", ".join(stale[:12]) + (" …" if len(stale) > 12 else "")
        check(checks, f"{name}-stale", "warn",
              f"{name}: {len(stale)} months dropped (last observation more than {C.MAX_MONTH_END_GAP_DAYS} days before month-end): {shown}")


def bcv_checks(h: pd.DataFrame, checks: list[dict], last_complete: pd.Period) -> None:
    if "Stock Splits" in h.columns:
        splits = h.loc[h["Stock Splits"].fillna(0) != 0, "Stock Splits"]
        listed = ", ".join(f"{d.date()} (×{v:g})" for d, v in splits.items()) or "none"
        may2020 = splits[(splits.index >= "2020-05-01") & (splits.index <= "2020-05-31")]
        if len(may2020) and abs(float(may2020.iloc[0]) - 10) < 1e-9:
            check(checks, "bcv-split-2020", "pass", f"10:1 split of May 2020 present in the data ({may2020.index[0].date()}). Splits: {listed}.")
        else:
            check(checks, "bcv-split-2020", "warn", f"10:1 split of May 2020 NOT detected in the corporate actions. Splits: {listed}.")
    adj = h["Adj Close"].astype(float).dropna()
    r = adj.pct_change().dropna()
    big = r[r.abs() > 0.35]
    if len(big):
        check(checks, "bcv-jumps", "fail", "Daily changes > 35% in the adjusted price (unadjusted split?): "
              + ", ".join(f"{d.date()} {v:+.1%}" for d, v in big.items()))
    else:
        check(checks, "bcv-jumps", "pass", f"No daily change > 35% in the adjusted price (max |r| = {r.abs().max():.1%}, on {r.abs().idxmax().date()}).")
    if "Close" in h.columns:
        lv_tr = month_end_levels(adj, C.MAX_MONTH_END_GAP_DAYS, last_complete).values
        lv_pr = month_end_levels(h["Close"].astype(float), C.MAX_MONTH_END_GAP_DAYS, last_complete).values
        diff = annual_mean(simple_returns(lv_tr)) - annual_mean(simple_returns(lv_pr))
        n_div = int((h.get("Dividends", pd.Series(dtype=float)).fillna(0) > 0).sum())
        status = "pass" if diff > 0.01 and n_div > 0 else "warn"
        check(checks, "bcv-dividends", status,
              f"Dividend adjustment: {n_div} ex-dividend dates; total return − price return = {diff:+.2%} per year on average.")


def jkp_block(fx_r, cols: dict, sources: list, checks: list[dict]) -> None:
    """Facteurs suisses JKP : contrôles, puis conversion F_CHF = F_USD (1 + s)."""
    df, info = S.fetch_jkp_che()
    sources.append(info)
    if df is None:
        check(checks, "jkp", "warn", "Swiss JKP factors unavailable: the Switzerland universe cannot be estimated.")
        return
    bad = [k for k in C.JKP_FACTORS if df[k].abs().max() >= 0.5]
    if bad:
        check(checks, "jkp-range", "fail", f"Swiss JKP factors: monthly returns ≥ 50% for {', '.join(bad)} (check units).")
    for key in C.JKP_FACTORS:
        f = df[key].copy()
        n = df.get(f"n_{key}")
        if n is not None:
            thin = n < C.JKP_MIN_STOCKS
            f[thin] = np.nan  # trop peu de titres : facteur non représentatif
        cols[f"{key.lower()}_ch"] = convert_long_short_to_chf(f, fx_r.reindex(f.index))
    last = df.index.max()
    first = max(df[k].where(df.get(f"n_{k}", pd.Series(np.inf, index=df.index)) >= C.JKP_MIN_STOCKS).first_valid_index() for k in C.JKP_FACTORS)
    check(checks, "jkp", "pass" if info["status"] in ("ok", "manual") else "warn",
          f"Swiss JKP factors from {first} to {last} (months kept: at least {C.JKP_MIN_STOCKS} stocks per factor), converted to CHF as F_USD(1+s). "
          "Updated annually: the latest months of the sample may be missing.")
    pairs = {"SMB": "smb3_usd", "HML": "hml3_usd", "RMW": "rmw5_usd", "CMA": "cma5_usd", "MOM": "wml_usd"}
    cor = {}
    for k, v in pairs.items():
        if v in cols:
            x = pd.concat([df[k], pd.Series(cols[v])], axis=1).dropna()
            if len(x) > 60:
                cor[k] = float(x.corr().iloc[0, 1])
    if cor:
        check(checks, "jkp-vs-europe", "pass",
              "Correlation of Swiss JKP / European Fama-French factors (USD): " + ", ".join(f"{k} {v:.2f}" for k, v in cor.items())
              + ". Moderate correlations expected: different markets and methods.")


def raif_checks(ser, checks: list[dict]) -> None:
    from .raif import check as rcheck

    r = rcheck(ser)
    check(checks, "raif-nav", "pass" if r.chart_eq_nav else "fail",
          "Raiffeisen fund: \"Chart Price\" " + ("equal to the published NAV." if r.chart_eq_nav else "different from the published NAV."))
    check(checks, "raif-reconciliation", "pass" if r.share_ok >= 0.995 else "fail",
          f"Raiffeisen fund: outside distributions, total return = NAV return on {r.share_ok:.2%} of {r.n_days - 1} days"
          + (f" (mismatches: {', '.join(r.bad_days[:6])}{'…' if len(r.bad_days) > 6 else ''})." if r.bad_days else "."))
    dl = ", ".join(f"{d}: {a:.2f}" for d, a in r.distributions[-6:])
    check(checks, "raif-distributions", "warn" if r.anomalies else "pass",
          f"Raiffeisen fund: {len(r.distributions)} implied distributions (latest: {dl})"
          + (" ; " + " ; ".join(r.anomalies) if r.anomalies else "") + ".")
    known = C.RAIF.get("ter")
    if ser.ter is not None and known is not None:
        same = abs(known - ser.ter) < 1e-9
        check(checks, "raif-ter", "pass" if same else "warn",
              f"Raiffeisen fund: published TER {ser.ter:.2%} as of {ser.ter_date.date()}"
              + ("." if same else f", different from the configuration ({known:.2%}): update pipeline/config.py."))


def fund_checks(page, checks: list[dict]) -> None:
    from .fund import reconcile, ytd_check

    rec = reconcile(page)
    ok_share = rec.matched_share >= 0.995
    check(checks, "fund-reconciliation", "pass" if ok_share else "fail",
          f"Fund: {rec.matched_share:.2%} of the {rec.n_days} daily returns of the official series reproduced from NAVs "
          f"and gross distributions (tolerance {5e-5:.0e})"
          + (f"; tooltip NAVs lag by one day from about {rec.lag_switch}, lag corrected in the check." if rec.lag_switch else "."))
    if rec.dist_bad:
        check(checks, "fund-distributions", "fail", "Fund: distributions not found or counted incorrectly: "
              + ", ".join(f"{d} (published {g}, implied {i})" for d, g, i in rec.dist_bad))
    else:
        check(checks, "fund-distributions", "pass",
              f"Fund: the {len(rec.dist_ok)} published distributions are included exactly once, at the gross amount "
              f"(latest: {rec.dist_ok[-1][0]}, {rec.dist_ok[-1][1]:.2f} CHF)." if rec.dist_ok else "Fund: no distribution to check.")
    if rec.unexplained:
        check(checks, "fund-jumps", "warn", "Fund: NAV / performance gaps not explained by a published distribution: " + ", ".join(rec.unexplained))
    y = ytd_check(page)
    if y is None:
        check(checks, "fund-ytd", "warn", "Fund: official YTD performance not read; check skipped.")
    else:
        calc, off = y
        check(checks, "fund-ytd", "pass" if abs(calc - off) < 1e-4 else "fail",
              f"Fund: recomputed YTD performance {calc:.2%} vs {off:.2%} published by Gérifonds as of {page.ytd_date.date()}.")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-date", default=None, help="reference date (YYYY-MM-DD); default: today UTC")
    args = ap.parse_args(argv)
    today = pd.Timestamp(args.run_date) if args.run_date else pd.Timestamp(datetime.now(timezone.utc).date())
    last_complete = today.to_period("M") - 1
    checks: list[dict] = []
    sources: list[dict] = []
    cols: dict[str, pd.Series] = {}
    gap = C.MAX_MONTH_END_GAP_DAYS

    # --- BCV
    bcv, info = S.fetch_bcv()
    sources.append(info)
    if bcv is not None:
        lv = month_end_levels(bcv["Adj Close"].astype(float), gap, last_complete)
        cols["bcv_ret"] = simple_returns(lv.values)
        stale_note("BCV", lv.stale, checks)
        if info["status"] == "ok":
            bcv_checks(bcv, checks, last_complete)

    # --- Fonds BCV Swiss Equity A
    fund_info: dict = {}
    fund_page, info = S.fetch_fund()
    if fund_page is not None and fund_page.ter is not None:
        fund_info = {"ter": fund_page.ter, "ter_date": str(fund_page.ter_date.date()), "ter_source": "Gérifonds, public fund page"}
        known = C.FUND.get("ter")
        if known is not None and abs(known - fund_page.ter) > 1e-9:
            check(checks, "fund-ter", "warn", f"Fund: published TER {fund_page.ter:.2%} ({fund_info['ter_date']}) differs from the configuration value "
                  f"({known:.2%}) used by the site: update pipeline/config.py.")
        else:
            check(checks, "fund-ter", "pass", f"Fund: published TER {fund_page.ter:.2%} as of {fund_info['ter_date']}.")
    sources.append(info)
    if fund_page is not None:
        lv = month_end_levels(fund_page.tr, gap, last_complete)
        cols["fund_ret"] = simple_returns(lv.values)
        stale_note("Fund", lv.stale, checks)
        if info["status"] == "ok":
            fund_checks(fund_page, checks)

    # --- Fonds Raiffeisen Futura - Swiss Stock A
    raif_info: dict = {}
    raif, info = S.fetch_raif()
    sources.append(info)
    if raif is not None:
        lv = month_end_levels(raif.tr, gap, last_complete)
        cols["raif_ret"] = simple_returns(lv.values)
        stale_note("Raiffeisen fund", lv.stale, checks)
        if info["status"] == "ok":
            raif_checks(raif, checks)
            if raif.ter is not None:
                raif_info = {"ter": raif.ter, "ter_date": str(raif.ter_date.date()), "ter_source": "Swiss Fund Data, fund page"}

    # --- SPI TR
    spi, info = S.fetch_spi_tr()
    sources.append(info)
    sp = info.get("splice")
    if sp:
        check(checks, "spi-history", "pass" if sp["ok"] else "warn",
              (f"SPI: history {sp['file']} spliced onto ^SSHI after a consistency check — {sp['message']}"
               if sp["ok"] else
               f"SPI: splice of history {sp['file']} rejected, Yahoo series kept alone — {sp['message']}"))
    if spi is not None:
        lv = month_end_levels(spi, gap, last_complete)
        cols["spi_ret"] = simple_returns(lv.values)
        stale_note("SPI", lv.stale, checks)
        smi = S.fetch_smi_price() if info["status"] == "ok" else None
        if smi is not None:
            smi_r = simple_returns(month_end_levels(smi, gap, last_complete).values)
            common = cols["spi_ret"].dropna().index.intersection(smi_r.dropna().index)
            if len(common) >= 24:
                d = annual_mean(cols["spi_ret"][common]) - annual_mean(smi_r[common])
                check(checks, "spi-total-return", "pass" if d > 0 else "warn",
                      f"SPI total-return plausibility: mean return SPI − SMI (price index) = {d:+.2%} per year over "
                      f"{len(common)} months. Indicative only (different constituents); the TR nature rests on SIX's definition of the SPI.")

    # --- SARON
    saron, info = S.fetch_saron()
    sources.append(info)
    if saron is not None:
        rf, stale, gaps = saron_monthly_returns(saron, gap, last_complete)
        cols["rf_saron"] = rf
        stale_note("SARON", stale, checks)
        if gaps:
            check(checks, "saron-gaps", "warn", f"{len(gaps)} gaps > 5 days between SARON fixings (the last known rate runs until the next fixing): "
                  + ", ".join(gaps[:8]) + (" …" if len(gaps) > 8 else ""))
        check(checks, "saron-coverage", "pass",
              f"Daily SARON available from {saron.index.min().date()} to {saron.index.max().date()}; monthly return = ACT/360 compounding.")

    # --- USD/CHF
    fx, info = S.fetch_usdchf()
    sources.append(info)
    fx_r = None
    if fx is not None:
        lv = month_end_levels(fx, gap, last_complete)
        fx_r = fx_returns(lv.values)
        cols["fx_usdchf_ret"] = fx_r
        stale_note("USD/CHF", lv.stale, checks)

    # --- Fama-French Europe
    ff: dict[str, pd.DataFrame] = {}
    for key in ("ff3", "ff5", "mom"):
        text, info = S.fetch_french(key)
        if text is not None:
            try:
                ff[key] = parse_french_csv(text)
                df = ff[key]
                info["coverage"] = [str(df.index.min()), str(df.index.max())]
                info["message"] = (info.get("message", "") + f" Columns: {', '.join(df.columns)}.").strip()
            except Exception as exc:  # noqa: BLE001
                info.update(status="error", message=f"Could not parse: {exc}")
        sources.append(info)

    if fx_r is None:
        for key in ff:
            for s in sources:
                if s["id"] == key:
                    s["message"] = (s.get("message", "") + " CHF conversion impossible: USD/CHF unavailable.").strip()
                    s["status"] = "error"
        check(checks, "ff-conversion", "fail", "Fama-French factors cannot be converted to CHF (exchange rate unavailable): multifactor models cannot be estimated.")
    else:
        if "ff3" in ff:
            f3 = ff["ff3"]
            cols["mkt_rf_usd"], cols["rf_us"] = f3["Mkt-RF"], f3["RF"]
            cols["smb3_usd"], cols["hml3_usd"] = f3["SMB"], f3["HML"]
            idx = f3.index
            fxa = fx_r.reindex(idx)
            cols["mkt_eu_chf"] = convert_market_to_chf(f3["Mkt-RF"], f3["RF"], fxa)
            cols["smb3_chf"] = convert_long_short_to_chf(f3["SMB"], fxa)
            cols["hml3_chf"] = convert_long_short_to_chf(f3["HML"], fxa)
        if "ff5" in ff:
            f5 = ff["ff5"]
            fxa = fx_r.reindex(f5.index)
            for name in ("SMB", "HML", "RMW", "CMA"):
                cols[f"{name.lower()}5_usd"] = f5[name]
                cols[f"{name.lower()}5_chf"] = convert_long_short_to_chf(f5[name], fxa)
            if "ff3" in ff:
                common = ff["ff3"].index.intersection(f5.index)
                dm = float((ff["ff3"].loc[common, "Mkt-RF"] - f5.loc[common, "Mkt-RF"]).abs().max())
                dr = float((ff["ff3"].loc[common, "RF"] - f5.loc[common, "RF"]).abs().max())
                check(checks, "ff-consistency", "pass" if max(dm, dr) < 1e-9 else "warn",
                      f"Consistency of Mkt−RF and RF between the FF3 and FF5 files: max differences {dm:.2e} and {dr:.2e}.")
        if "mom" in ff:
            fm = ff["mom"]
            wcol = "WML" if "WML" in fm.columns else fm.columns[0]
            cols["wml_usd"] = fm[wcol]
            cols["wml_chf"] = convert_long_short_to_chf(fm[wcol], fx_r.reindex(fm.index))
        jkp_block(fx_r, cols, sources, checks)
        if ff:
            check(checks, "ff-conversion", "pass",
                  "European Fama-French factors converted to CHF: market = (1+Mkt−RF+RF_US)(1+s)−1, long-short factors = F_USD(1+s). "
                  "The market excess return is computed with SARON, never with the US RF.")

    base = [c for c in ("bcv_ret", "spi_ret", "rf_saron") if c in cols and cols[c].notna().any()]
    if not base:
        print("ERROR: no base series (BCV, SPI, SARON) could be built.", file=sys.stderr)

    # --- assemblage
    # l'index couvre les séries d'analyse ; les séries auxiliaires (change, USD)
    # remontant plus loin ne l'étendent pas
    analysis = [c for c in cols if c in ("bcv_ret", "fund_ret", "raif_ret", "spi_ret", "rf_saron") or c.endswith("_chf")]
    all_idx = sorted(set().union(*[set(cols[c].dropna().index) for c in analysis])) if analysis else []
    all_idx = [p for p in all_idx if p <= last_complete]
    if all_idx:
        index = pd.period_range(all_idx[0], all_idx[-1], freq="M")
    else:
        index = pd.PeriodIndex([], freq="M")
    frame = pd.DataFrame({k: v.reindex(index) for k, v in cols.items()}, index=index)

    for c in frame.columns:
        bad = frame[c].dropna()
        bad = bad[bad.abs() >= 1]
        if len(bad):
            check(checks, f"range-{c}", "fail", f"{c}: absolute values ≥ 100% ({len(bad)}), check units.")

    def clean(v: float) -> float | None:
        if v is None or (isinstance(v, float) and math.isnan(v)):
            return None
        return float(f"{v:.12g}")

    dataset = {
        "schema": "eap-dataset/v1",
        "frequency": "monthly",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "origin": "pipeline",
        "asset": C.ASSET,
        "columns": {k: {"label": COLUMN_INFO[k][0], "unit": "monthly return, decimal", "description": COLUMN_INFO[k][1]} for k in frame.columns},
        "dates": [str(p) for p in index],
        "data": {k: [clean(v) for v in frame[k].tolist()] for k in frame.columns},
        "sources": sources,
        "checks": checks,
        "fund_info": fund_info,
        "raif_info": raif_info,
        "notes": [
            f"Last complete month kept: {last_complete} (run date {today.date()}).",
            "Missing values kept as they are (null): no interpolation.",
        ],
    }
    C.PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    (C.PUBLIC_DATA / "dataset.json").write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")))
    C.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    out = frame.copy()
    out.index = out.index.astype(str)
    out.index.name = "date"
    out.to_csv(C.PROCESSED_DIR / "monthly.csv", float_format="%.10g")
    write_report(dataset)
    print(f"dataset.json: {len(index)} months, columns {list(frame.columns)}")
    for s in sources:
        print(f"  [{s['status']:>6}] {s['id']}: {s.get('coverage')} {s.get('message', '')}")
    for c in checks:
        print(f"  ({c['status']}) {c['message']}")
    return 0 if base else 1


def write_report(ds: dict) -> None:
    lines = ["# Data build report", "", f"Generated on {ds['generated_at']}", "", "## Sources", "",
             "| Source | Status | Coverage | Message |", "|---|---|---|---|"]
    for s in ds["sources"]:
        cov = " → ".join(s.get("coverage") or []) or "—"
        msg = (s.get("message") or "").replace("|", "/")
        lines.append(f"| {s['name']} | {s['status']} | {cov} | {msg} |")
    lines += ["", "## Checks", ""]
    lines += [f"- **{c['status']}** — {c['message']}" for c in ds["checks"]]
    lines += ["", "## Column coverage", "", "| Column | First month | Last month | N |", "|---|---|---|---|"]
    for k, v in ds["data"].items():
        idx = [i for i, x in enumerate(v) if x is not None]
        if idx:
            lines.append(f"| {k} | {ds['dates'][idx[0]]} | {ds['dates'][idx[-1]]} | {len(idx)} |")
        else:
            lines.append(f"| {k} | — | — | 0 |")
    (C.PROCESSED_DIR / "build_report.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    sys.exit(main())
