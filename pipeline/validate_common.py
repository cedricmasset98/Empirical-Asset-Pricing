"""Construction des échantillons commune à la validation et au rapport :
mêmes règles que le navigateur (toutes les séries requises disponibles, aucune
interpolation)."""

from __future__ import annotations

import numpy as np

MODELS = {
    "CAPM": ["MKT"],
    "FF3": ["MKT", "SMB", "HML"],
    "CARHART": ["MKT", "SMB", "HML", "MOM"],
    "FF5": ["MKT", "SMB", "HML", "RMW", "CMA"],
}
# SWISS : marché SPI TR et facteurs long-short suisses de Global Factor Data (JKP)
UNIVERSES = ["SPI", "EUROPE", "SWISS"]
# univers repris dans les rapports PDF (inchangés)
REPORT_UNIVERSES = ["SPI", "EUROPE"]
# 'DIFF' : portefeuille long action / court fonds, y = R_BCV − R_fonds (α_DIFF = α_BCV − α_fonds)
ASSETS = {"BCV": ["bcv_ret"], "FUND": ["fund_ret"], "RAIF": ["raif_ret"], "DIFF": ["bcv_ret", "fund_ret"]}


def factor_col(model: str, f: str, universe: str) -> str:
    if f == "MKT":
        return "mkt_eu_chf" if universe == "EUROPE" else "spi_ret"
    if universe == "SWISS":
        return {"SMB": "smb_ch", "HML": "hml_ch", "MOM": "mom_ch", "RMW": "rmw_ch", "CMA": "cma_ch"}[f]
    five = model == "FF5"
    return {
        "SMB": "smb5_chf" if five else "smb3_chf",
        "HML": "hml5_chf" if five else "hml3_chf",
        "MOM": "wml_chf",
        "RMW": "rmw5_chf",
        "CMA": "cma5_chf",
    }[f]


def required(model: str, universe: str, asset: str = "BCV") -> list[str]:
    return ASSETS[asset] + ["rf_saron"] + [factor_col(model, f, universe) for f in MODELS[model]]


def has_data(ds: dict, cols: list[str]) -> bool:
    return all(any(v is not None for v in ds["data"].get(c, [])) for c in cols)


def rows_for(ds: dict, cols: list[str]) -> list[int]:
    return [i for i in range(len(ds["dates"])) if all(ds["data"].get(c, [None] * len(ds["dates"]))[i] is not None for c in cols)]


def design(ds: dict, model: str, universe: str, rows: list[int], asset: str = "BCV") -> tuple[np.ndarray, np.ndarray, list[str]]:
    g = lambda c: np.array([ds["data"][c][i] for i in rows], dtype=float)  # noqa: E731
    rf = g("rf_saron")
    if asset == "BCV":
        y = g("bcv_ret") - rf
    elif asset == "FUND":
        y = g("fund_ret") - rf
    elif asset == "RAIF":
        y = g("raif_ret") - rf
    else:
        y = g("bcv_ret") - g("fund_ret")
    cols = [np.ones(len(rows))]
    for f in MODELS[model]:
        v = g(factor_col(model, f, universe))
        cols.append(v - rf if f == "MKT" else v)
    return y, np.column_stack(cols), [ds["dates"][i] for i in rows]
