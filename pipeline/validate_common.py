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
UNIVERSES = ["SPI", "EUROPE"]


def factor_col(model: str, f: str, universe: str) -> str:
    if f == "MKT":
        return "spi_ret" if universe == "SPI" else "mkt_eu_chf"
    five = model == "FF5"
    return {
        "SMB": "smb5_chf" if five else "smb3_chf",
        "HML": "hml5_chf" if five else "hml3_chf",
        "MOM": "wml_chf",
        "RMW": "rmw5_chf",
        "CMA": "cma5_chf",
    }[f]


def required(model: str, universe: str) -> list[str]:
    return ["bcv_ret", "rf_saron"] + [factor_col(model, f, universe) for f in MODELS[model]]


def has_data(ds: dict, cols: list[str]) -> bool:
    return all(any(v is not None for v in ds["data"].get(c, [])) for c in cols)


def rows_for(ds: dict, cols: list[str]) -> list[int]:
    return [i for i in range(len(ds["dates"])) if all(ds["data"].get(c, [None] * len(ds["dates"]))[i] is not None for c in cols)]


def design(ds: dict, model: str, universe: str, rows: list[int]) -> tuple[np.ndarray, np.ndarray, list[str]]:
    g = lambda c: np.array([ds["data"][c][i] for i in rows], dtype=float)  # noqa: E731
    rf = g("rf_saron")
    y = g("bcv_ret") - rf
    cols = [np.ones(len(rows))]
    for f in MODELS[model]:
        v = g(factor_col(model, f, universe))
        cols.append(v - rf if f == "MKT" else v)
    return y, np.column_stack(cols), [ds["dates"][i] for i in rows]
