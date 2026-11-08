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
# Spécifications des rapports, alignées sur le site : référence = univers suisse
# (SPI TR + facteurs JKP, CAPM = Single Index) ; robustesse = univers européen et
# ancienne variante hybride (SPI + facteurs européens, modèles multifactoriels).
REPORT_SPECS = (
    [("ref", m, "SWISS") for m in ("CAPM", "FF3", "CARHART", "FF5")]
    + [("eu", m, "EUROPE") for m in ("CAPM", "FF3", "CARHART", "FF5")]
    + [("hyb", m, "SPI") for m in ("FF3", "CARHART", "FF5")]
)
REPORT_UNIVERSES = ["SWISS", "EUROPE", "SPI"]
# 'DIFF' : portefeuille long action / court fonds, y = R_BCV − R_fonds (α_DIFF = α_BCV − α_fonds)
ASSETS = {"BCV": ["bcv_ret"], "FUND": ["fund_ret"], "DIFF": ["bcv_ret", "fund_ret"]}


def register_assets(ds: dict) -> list[str]:
    """Ajoute à ASSETS les actifs décrits dans le jeu de données (fonds Swiss Fund
    Data compris) et retourne la liste des actifs simples à valider."""
    for a in ds.get("assets") or []:
        ASSETS[a["id"]] = [a["column"]]
    if "raif_ret" in ds.get("data", {}) and "RAIF" not in ASSETS:
        ASSETS["RAIF"] = ["raif_ret"]
    return [k for k in ASSETS if k != "DIFF"]


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
    if asset == "DIFF":
        y = g("bcv_ret") - g("fund_ret")
    else:
        y = g(ASSETS[asset][0]) - rf
    cols = [np.ones(len(rows))]
    for f in MODELS[model]:
        v = g(factor_col(model, f, universe))
        cols.append(v - rf if f == "MKT" else v)
    return y, np.column_stack(cols), [ds["dates"][i] for i in rows]
