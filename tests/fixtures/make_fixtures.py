"""Génère les jeux de test déterministes du moteur statistique.

- synthetic_dataset.json : jeu SYNTHÉTIQUE au schéma eap-dataset/v1 (tests et
  smoke test de l'interface uniquement ; jamais publié dans public/).
- numpy_reference.json : résultats calculés indépendamment avec numpy/scipy
  (lstsq, formules matricielles directes) pour vérifier le moteur TypeScript.
- distributions_reference.json : valeurs de référence scipy.stats.

La comparaison à statsmodels est faite séparément par pipeline/validate.py
(exécuté en CI, où statsmodels est installé).

Usage : python tests/fixtures/make_fixtures.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from scipy import stats

HERE = Path(__file__).resolve().parent
RNG = np.random.default_rng(20261106)
N = 240


def month_keys(start_year: int, start_month: int, n: int) -> list[str]:
    out = []
    y, m = start_year, start_month
    for _ in range(n):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


def make_dataset() -> dict:
    dates = month_keys(2005, 1, N)
    rf = np.clip(0.0008 + 0.0004 * np.sin(np.arange(N) / 30) + RNG.normal(0, 0.00005, N), -0.0007, None)
    mkt_spi = rf + 0.006 + RNG.normal(0, 0.042, N)
    mkt_eu = rf + 0.005 + 0.8 * (mkt_spi - rf - 0.006) + RNG.normal(0, 0.025, N)
    smb3 = RNG.normal(0.001, 0.02, N)
    hml3 = RNG.normal(0.002, 0.025, N)
    wml = RNG.normal(0.006, 0.035, N)
    smb5 = smb3 + RNG.normal(0, 0.004, N)
    hml5 = hml3 + RNG.normal(0, 0.004, N)
    rmw5 = RNG.normal(0.003, 0.015, N)
    cma5 = RNG.normal(0.002, 0.015, N)
    # erreurs AR(1) et hétéroscédastiques
    u = np.zeros(N)
    z = RNG.standard_t(6, N) * 0.03
    for t in range(N):
        u[t] = (0.25 * u[t - 1] if t else 0.0) + z[t] * (1 + 4 * abs(mkt_spi[t] - rf[t]))
    bcv = rf + 0.002 + 0.55 * (mkt_spi - rf) + 0.15 * smb3 + 0.3 * hml3 - 0.05 * wml + u
    cols = {
        "bcv_ret": bcv,
        "spi_ret": mkt_spi,
        "rf_saron": rf,
        "mkt_eu_chf": mkt_eu,
        "smb3_chf": smb3,
        "hml3_chf": hml3,
        "wml_chf": wml,
        "smb5_chf": smb5,
        "hml5_chf": hml5,
        "rmw5_chf": rmw5,
        "cma5_chf": cma5,
    }
    data = {k: [float(f"{v:.12g}") for v in arr] for k, arr in cols.items()}
    # trous volontaires : facteurs FF5 indisponibles sur les 18 premiers mois,
    # momentum manquant sur 2 mois isolés
    for i in range(18):
        for k in ("smb5_chf", "hml5_chf", "rmw5_chf", "cma5_chf"):
            data[k][i] = None
    data["wml_chf"][100] = None
    data["wml_chf"][101] = None
    return {
        "schema": "eap-dataset/v1",
        "frequency": "monthly",
        "generated_at": "2026-11-06T00:00:00Z",
        "origin": "manual-csv",
        "asset": {"name": "SYNTHÉTIQUE (tests)", "ticker": "TEST", "yahoo": "TEST", "isin": "-", "currency": "CHF"},
        "columns": {k: {"label": k, "unit": "rendement décimal mensuel"} for k in cols},
        "dates": dates,
        "data": data,
        "sources": [
            {"id": "synthetic", "name": "Données synthétiques de test", "provider": "tests/fixtures/make_fixtures.py",
             "url": "", "status": "manual", "message": "Jeu simulé, ne représente aucun titre réel."}
        ],
        "checks": [],
        "notes": ["DONNÉES SYNTHÉTIQUES — usage exclusivement réservé aux tests automatiques."],
    }


# ------------------------------------------------------------------ références numpy

def ols_numpy(y: np.ndarray, X: np.ndarray, hac_lags: int) -> dict:
    n, k = X.shape
    b, *_ = np.linalg.lstsq(X, y, rcond=None)
    e = y - X @ b
    xtx_inv = np.linalg.inv(X.T @ X)
    s2 = e @ e / (n - k)
    v_cl = s2 * xtx_inv
    h = np.einsum("ij,jk,ik->i", X, xtx_inv, X)
    meat = (X * (e**2 / (1 - h) ** 2)[:, None]).T @ X
    v_hc3 = xtx_inv @ meat @ xtx_inv
    u = X * e[:, None]
    s = u.T @ u
    for lag in range(1, hac_lags + 1):
        w = 1 - lag / (hac_lags + 1)
        g = u[lag:].T @ u[:-lag]
        s += w * (g + g.T)
    v_hac = xtx_inv @ s @ xtx_inv
    sst = ((y - y.mean()) ** 2).sum()
    r2 = 1 - (e @ e) / sst
    out = {
        "n": n, "k": k, "beta": b.tolist(), "r2": r2, "r2adj": 1 - (1 - r2) * (n - 1) / (n - k),
        "sigma": float(np.sqrt(s2)), "hac_lags": hac_lags,
    }
    for name, v in (("classical", v_cl), ("HC3", v_hc3), ("HAC", v_hac), ("HAC_corrected", v_hac * n / (n - k))):
        se = np.sqrt(np.diag(v))
        tstat = b / se
        if name == "classical":
            p = 2 * stats.t.sf(np.abs(tstat), n - k)
            crit = stats.t.ppf(0.975, n - k)
            f = ((sst - e @ e) / (k - 1)) / s2
            joint = {"stat": f, "pvalue": stats.f.sf(f, k - 1, n - k)}
        else:
            p = 2 * stats.norm.sf(np.abs(tstat))
            crit = stats.norm.ppf(0.975)
            bs = b[1:]
            w = bs @ np.linalg.inv(v[1:, 1:]) @ bs
            joint = {"stat": w, "pvalue": stats.chi2.sf(w, k - 1)}
        out[name] = {
            "se": se.tolist(), "stat": tstat.tolist(), "pvalue": p.tolist(),
            "ci_low": (b - crit * se).tolist(), "ci_high": (b + crit * se).tolist(), "joint": joint,
        }
    # diagnostics
    d = e - e.mean()
    c0 = d @ d
    m = 12
    r = np.array([(d[kk:] @ d[:-kk]) / c0 for kk in range(1, m + 1)])
    q = n * (n + 2) * np.sum(r**2 / (n - np.arange(1, m + 1)))
    e2 = e**2
    g, *_ = np.linalg.lstsq(X, e2, rcond=None)
    ea = e2 - X @ g
    r2a = 1 - (ea @ ea) / ((e2 - e2.mean()) ** 2).sum()
    lm = n * r2a
    skew = stats.skew(e)
    kurt = stats.kurtosis(e, fisher=False)
    jb = n / 6 * (skew**2 + (kurt - 3) ** 2 / 4)
    out["diagnostics"] = {
        "acf": r.tolist(),
        "ljung_box": {"lags": m, "stat": q, "pvalue": stats.chi2.sf(q, m)},
        "breusch_pagan": {"stat": lm, "pvalue": stats.chi2.sf(lm, k - 1)},
        "jarque_bera": {"stat": jb, "pvalue": stats.chi2.sf(jb, 2), "skewness": skew, "kurtosis": kurt},
    }
    return out


def build_xy(ds: dict, factors: list[str], market: str) -> tuple[np.ndarray, np.ndarray, list[str]]:
    cols = ["bcv_ret", "rf_saron", market] + factors
    rows = [i for i in range(len(ds["dates"])) if all(ds["data"][c][i] is not None for c in cols)]
    g = lambda c: np.array([ds["data"][c][i] for i in rows], dtype=float)  # noqa: E731
    rf = g("rf_saron")
    y = g("bcv_ret") - rf
    X = np.column_stack([np.ones(len(rows)), g(market) - rf] + [g(f) for f in factors])
    return y, X, [ds["dates"][i] for i in rows]


def main() -> None:
    ds = make_dataset()
    (HERE / "synthetic_dataset.json").write_text(json.dumps(ds, ensure_ascii=False))

    specs = {
        "CAPM_SPI": ([], "spi_ret"),
        "FF3_SPI": (["smb3_chf", "hml3_chf"], "spi_ret"),
        "CARHART_EUROPE": (["smb3_chf", "hml3_chf", "wml_chf"], "mkt_eu_chf"),
        "FF5_EUROPE": (["smb5_chf", "hml5_chf", "rmw5_chf", "cma5_chf"], "mkt_eu_chf"),
    }
    ref = {}
    for key, (factors, market) in specs.items():
        y, X, dates = build_xy(ds, factors, market)
        n = len(y)
        lags = int(np.floor(4 * (n / 100) ** (2 / 9)))
        ref[key] = ols_numpy(y, X, lags)
        ref[key]["first_date"], ref[key]["last_date"] = dates[0], dates[-1]
    (HERE / "numpy_reference.json").write_text(json.dumps(ref, indent=1))

    dist = {
        "t_two_sided": [[t, df, float(2 * stats.t.sf(abs(t), df))] for t, df in
                        [(0.5, 5), (1.96, 30), (2.5, 100), (-3.2, 12), (6.0, 238), (0.0, 10), (12.0, 50)]],
        "t_crit": [[a, df, float(stats.t.ppf(1 - a / 2, df))] for a, df in [(0.05, 5), (0.05, 58), (0.05, 236), (0.01, 30)]],
        "norm_cdf": [[x, float(stats.norm.cdf(x))] for x in [-8, -3.5, -1.96, -0.3, 0, 0.7, 2.33, 5]],
        "norm_ppf": [[p, float(stats.norm.ppf(p))] for p in [1e-10, 0.001, 0.025, 0.3, 0.5, 0.8, 0.975, 0.999999]],
        "f_sf": [[f, d1, d2, float(stats.f.sf(f, d1, d2))] for f, d1, d2 in
                 [(0.5, 1, 100), (4.0, 3, 200), (25.0, 5, 230), (1.2, 4, 60)]],
        "chi2_sf": [[x, k, float(stats.chi2.sf(x, k))] for x, k in
                    [(0.5, 1), (5.99, 2), (21.0, 12), (60.0, 5), (3.0, 4), (150.0, 2)]],
    }
    (HERE / "distributions_reference.json").write_text(json.dumps(dist, indent=1))
    print("Fixtures écrites dans", HERE)


if __name__ == "__main__":
    main()
