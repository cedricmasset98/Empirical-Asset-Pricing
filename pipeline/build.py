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
    "bcv_ret": ("Rendement total BCV", "BCVN.SW, cours ajusté (dividendes, splits), fin de mois à fin de mois"),
    "fund_ret": ("Rendement total BCV Swiss Equity A", "Indice de performance officiel Gérifonds, distributions brutes réinvesties, net des frais du fonds"),
    "spi_ret": ("Rendement SPI TR", "Swiss Performance Index (indice de performance, CHF)"),
    "rf_saron": ("Taux sans risque SARON réalisé", "Capitalisation quotidienne ACT/360 du SARON sur le mois"),
    "mkt_eu_chf": ("Marché européen FF, rendement total en CHF", "(1 + Mkt−RF + RF_US)(1 + s) − 1"),
    "smb3_chf": ("SMB (FF3 Europe) en CHF", "SMB_USD × (1 + s)"),
    "hml3_chf": ("HML (FF3 Europe) en CHF", "HML_USD × (1 + s)"),
    "wml_chf": ("WML momentum Europe en CHF", "WML_USD × (1 + s)"),
    "smb5_chf": ("SMB (FF5 Europe) en CHF", "SMB_USD × (1 + s)"),
    "hml5_chf": ("HML (FF5 Europe) en CHF", "HML_USD × (1 + s)"),
    "rmw5_chf": ("RMW (FF5 Europe) en CHF", "RMW_USD × (1 + s)"),
    "cma5_chf": ("CMA (FF5 Europe) en CHF", "CMA_USD × (1 + s)"),
    "fx_usdchf_ret": ("Variation USD/CHF (s)", "CHF par USD, fin de mois"),
    "rf_us": ("RF US (FF)", "T-bill 1 mois, tel que publié par K. French"),
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
              f"{name} : {len(stale)} mois écartés (dernière observation à plus de {C.MAX_MONTH_END_GAP_DAYS} jours de la fin du mois) : {shown}")


def bcv_checks(h: pd.DataFrame, checks: list[dict], last_complete: pd.Period) -> None:
    if "Stock Splits" in h.columns:
        splits = h.loc[h["Stock Splits"].fillna(0) != 0, "Stock Splits"]
        listed = ", ".join(f"{d.date()} (×{v:g})" for d, v in splits.items()) or "aucun"
        may2020 = splits[(splits.index >= "2020-05-01") & (splits.index <= "2020-05-31")]
        if len(may2020) and abs(float(may2020.iloc[0]) - 10) < 1e-9:
            check(checks, "bcv-split-2020", "pass", f"Split 10:1 de mai 2020 présent dans les données ({may2020.index[0].date()}). Splits : {listed}.")
        else:
            check(checks, "bcv-split-2020", "warn", f"Split 10:1 de mai 2020 NON détecté dans les actions sur titres. Splits : {listed}.")
    adj = h["Adj Close"].astype(float).dropna()
    r = adj.pct_change().dropna()
    big = r[r.abs() > 0.35]
    if len(big):
        check(checks, "bcv-jumps", "fail", "Variations quotidiennes > 35 % du cours ajusté (split non ajusté ?) : "
              + ", ".join(f"{d.date()} {v:+.1%}" for d, v in big.items()))
    else:
        check(checks, "bcv-jumps", "pass", f"Aucune variation quotidienne > 35 % du cours ajusté (max |r| = {r.abs().max():.1%}, le {r.abs().idxmax().date()}).")
    if "Close" in h.columns:
        lv_tr = month_end_levels(adj, C.MAX_MONTH_END_GAP_DAYS, last_complete).values
        lv_pr = month_end_levels(h["Close"].astype(float), C.MAX_MONTH_END_GAP_DAYS, last_complete).values
        diff = annual_mean(simple_returns(lv_tr)) - annual_mean(simple_returns(lv_pr))
        n_div = int((h.get("Dividends", pd.Series(dtype=float)).fillna(0) > 0).sum())
        status = "pass" if diff > 0.01 and n_div > 0 else "warn"
        check(checks, "bcv-dividends", status,
              f"Ajustement des dividendes : {n_div} détachements ; rendement total − rendement de prix = {diff:+.2%} par an en moyenne.")


def fund_checks(page, checks: list[dict]) -> None:
    from .fund import reconcile, ytd_check

    rec = reconcile(page)
    ok_share = rec.matched_share >= 0.995
    check(checks, "fund-reconciliation", "pass" if ok_share else "fail",
          f"Fonds : {rec.matched_share:.2%} des {rec.n_days} rendements quotidiens de la série officielle retrouvés à partir des VNI "
          f"et des distributions brutes (tolérance {5e-5:.0e})"
          + (f" ; VNI des infobulles décalées d'un jour à partir de {rec.lag_switch} environ, décalage corrigé dans le contrôle." if rec.lag_switch else "."))
    if rec.dist_bad:
        check(checks, "fund-distributions", "fail", "Fonds : distributions non retrouvées ou comptées incorrectement : "
              + ", ".join(f"{d} (publié {g}, implicite {i})" for d, g, i in rec.dist_bad))
    else:
        check(checks, "fund-distributions", "pass",
              f"Fonds : les {len(rec.dist_ok)} distributions publiées sont incluses une et une seule fois, au montant brut "
              f"(dernière : {rec.dist_ok[-1][0]}, {rec.dist_ok[-1][1]:.2f} CHF)." if rec.dist_ok else "Fonds : aucune distribution à contrôler.")
    if rec.unexplained:
        check(checks, "fund-jumps", "warn", "Fonds : écarts VNI / performance non expliqués par une distribution publiée : " + ", ".join(rec.unexplained))
    y = ytd_check(page)
    if y is None:
        check(checks, "fund-ytd", "warn", "Fonds : performance YTD officielle non lue ; contrôle non effectué.")
    else:
        calc, off = y
        check(checks, "fund-ytd", "pass" if abs(calc - off) < 1e-4 else "fail",
              f"Fonds : performance YTD recalculée {calc:.2%} contre {off:.2%} publiée par Gérifonds au {page.ytd_date.date()}.")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-date", default=None, help="date de référence (AAAA-MM-JJ) ; défaut : aujourd'hui UTC")
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
    fund_page, info = S.fetch_fund()
    sources.append(info)
    if fund_page is not None:
        lv = month_end_levels(fund_page.tr, gap, last_complete)
        cols["fund_ret"] = simple_returns(lv.values)
        stale_note("Fonds", lv.stale, checks)
        if info["status"] == "ok":
            fund_checks(fund_page, checks)

    # --- SPI TR
    spi, info = S.fetch_spi_tr()
    sources.append(info)
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
                      f"Plausibilité « total return » de ^SSHI : rendement moyen SPI − SMI (indice de prix) = {d:+.2%} par an sur "
                      f"{len(common)} mois. Indicateur seulement (compositions différentes) ; la nature TR repose sur la définition SIX du SPI.")

    # --- SARON
    saron, info = S.fetch_saron()
    sources.append(info)
    if saron is not None:
        rf, stale, gaps = saron_monthly_returns(saron, gap, last_complete)
        cols["rf_saron"] = rf
        stale_note("SARON", stale, checks)
        if gaps:
            check(checks, "saron-gaps", "warn", f"{len(gaps)} intervalles > 5 jours entre fixings SARON (le dernier taux connu court jusqu'au fixing suivant) : "
                  + ", ".join(gaps[:8]) + (" …" if len(gaps) > 8 else ""))
        check(checks, "saron-coverage", "pass",
              f"SARON quotidien disponible du {saron.index.min().date()} au {saron.index.max().date()} ; rendement mensuel = capitalisation ACT/360.")

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
                info["message"] = (info.get("message", "") + f" Colonnes : {', '.join(df.columns)}.").strip()
            except Exception as exc:  # noqa: BLE001
                info.update(status="error", message=f"Lecture impossible : {exc}")
        sources.append(info)

    if fx_r is None:
        for key in ff:
            for s in sources:
                if s["id"] == key:
                    s["message"] = (s.get("message", "") + " Conversion en CHF impossible : USD/CHF indisponible.").strip()
                    s["status"] = "error"
        check(checks, "ff-conversion", "fail", "Facteurs Fama-French non convertibles en CHF (taux de change indisponible) : modèles multifactoriels non estimables.")
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
                      f"Cohérence Mkt−RF et RF entre fichiers FF3 et FF5 : écarts max {dm:.2e} et {dr:.2e}.")
        if "mom" in ff:
            fm = ff["mom"]
            wcol = "WML" if "WML" in fm.columns else fm.columns[0]
            cols["wml_usd"] = fm[wcol]
            cols["wml_chf"] = convert_long_short_to_chf(fm[wcol], fx_r.reindex(fm.index))
        if ff:
            check(checks, "ff-conversion", "pass",
                  "Facteurs Fama-French européens convertis en CHF : marché = (1+Mkt−RF+RF_US)(1+s)−1, facteurs long-short = F_USD(1+s). "
                  "Le rendement excédentaire du marché est calculé avec le SARON, jamais avec le RF américain.")

    base = [c for c in ("bcv_ret", "spi_ret", "rf_saron") if c in cols and cols[c].notna().any()]
    if not base:
        print("ERREUR : aucune série de base (BCV, SPI, SARON) n'a pu être construite.", file=sys.stderr)

    # --- assemblage
    # l'index couvre les séries d'analyse ; les séries auxiliaires (change, USD)
    # remontant plus loin ne l'étendent pas
    analysis = [c for c in cols if c in ("bcv_ret", "fund_ret", "spi_ret", "rf_saron") or c.endswith("_chf")]
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
            check(checks, f"range-{c}", "fail", f"{c} : valeurs ≥ 100 % en valeur absolue ({len(bad)}), unités à vérifier.")

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
        "columns": {k: {"label": COLUMN_INFO[k][0], "unit": "rendement mensuel décimal", "description": COLUMN_INFO[k][1]} for k in frame.columns},
        "dates": [str(p) for p in index],
        "data": {k: [clean(v) for v in frame[k].tolist()] for k in frame.columns},
        "sources": sources,
        "checks": checks,
        "notes": [
            f"Dernier mois complet retenu : {last_complete} (date d'exécution {today.date()}).",
            "Valeurs manquantes conservées telles quelles (null) : aucune interpolation.",
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
    print(f"dataset.json : {len(index)} mois, colonnes {list(frame.columns)}")
    for s in sources:
        print(f"  [{s['status']:>6}] {s['id']}: {s.get('coverage')} {s.get('message', '')}")
    for c in checks:
        print(f"  ({c['status']}) {c['message']}")
    return 0 if base else 1


def write_report(ds: dict) -> None:
    lines = ["# Rapport de construction des données", "", f"Généré le {ds['generated_at']}", "", "## Sources", "",
             "| Source | Statut | Couverture | Message |", "|---|---|---|---|"]
    for s in ds["sources"]:
        cov = " → ".join(s.get("coverage") or []) or "—"
        msg = (s.get("message") or "").replace("|", "/")
        lines.append(f"| {s['name']} | {s['status']} | {cov} | {msg} |")
    lines += ["", "## Contrôles", ""]
    lines += [f"- **{c['status']}** — {c['message']}" for c in ds["checks"]]
    lines += ["", "## Couverture des colonnes", "", "| Colonne | Premier mois | Dernier mois | N |", "|---|---|---|---|"]
    for k, v in ds["data"].items():
        idx = [i for i, x in enumerate(v) if x is not None]
        if idx:
            lines.append(f"| {k} | {ds['dates'][idx[0]]} | {ds['dates'][idx[-1]]} | {len(idx)} |")
        else:
            lines.append(f"| {k} | — | — | 0 |")
    (C.PROCESSED_DIR / "build_report.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    sys.exit(main())
