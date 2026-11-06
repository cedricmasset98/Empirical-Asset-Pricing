"""Calcule les résultats de référence statsmodels pour la validation numérique
du moteur TypeScript (tests/statsmodels.test.ts).

Usage : python -m pipeline.validate
  -> tests/reference/statsmodels_synthetic.json   (jeu synthétique de test)
  -> tests/reference/statsmodels_dataset.json     (données réelles, si présentes)

Les échantillons sont reconstruits exactement comme dans le navigateur :
toutes les observations de la plage pour lesquelles chaque série requise est
disponible, sans interpolation.
"""

from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import statsmodels
import statsmodels.api as sm
from statsmodels.stats.diagnostic import acorr_ljungbox, het_breuschpagan
from statsmodels.stats.stattools import jarque_bera
from statsmodels.tsa.stattools import acf

from . import config as C

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


def nw_lags(n: int) -> int:
    return int(math.floor(4 * (n / 100) ** (2 / 9)))


def lb_lags(n: int) -> int:
    return max(1, min(12, n // 5))


def fit_all(y: np.ndarray, X: np.ndarray, lags: int) -> dict[str, dict]:
    k = X.shape[1]
    model = sm.OLS(y, X)
    fits = {
        "classical": model.fit(),
        "HC3": model.fit(cov_type="HC3", use_t=False),
        "HAC": model.fit(cov_type="HAC", cov_kwds={"maxlags": lags, "use_correction": False}, use_t=False),
        "HAC_corrected": model.fit(cov_type="HAC", cov_kwds={"maxlags": lags, "use_correction": True}, use_t=False),
    }
    out = {}
    R = np.eye(k)[1:]
    for name, r in fits.items():
        ci = np.asarray(r.conf_int(0.05))
        if name == "classical":
            joint_stat, joint_p = float(r.fvalue), float(r.f_pvalue)
        else:
            w = r.wald_test(R, use_f=False, scalar=True)
            joint_stat, joint_p = float(np.squeeze(w.statistic)), float(np.squeeze(w.pvalue))
        out[name] = {
            "params": r.params.tolist(), "bse": r.bse.tolist(), "tvalues": r.tvalues.tolist(), "pvalues": r.pvalues.tolist(),
            "ci_low": ci[:, 0].tolist(), "ci_high": ci[:, 1].tolist(), "rsquared": float(r.rsquared),
            "rsquared_adj": float(r.rsquared_adj), "joint_stat": joint_stat, "joint_pvalue": joint_p,
            "sigma": float(np.sqrt(r.scale)), "hac_lags": lags if name.startswith("HAC") else None,
        }
    return out


def diagnostics(y: np.ndarray, X: np.ndarray) -> dict:
    res = sm.OLS(y, X).fit()
    e = res.resid
    m = lb_lags(len(e))
    lb = acorr_ljungbox(e, lags=[m], return_df=True)
    lm, lm_p, _, _ = het_breuschpagan(e, X)
    jb, jb_p, skew, kurt = jarque_bera(e)
    return {
        "acf": acf(e, nlags=12, fft=False)[1:].tolist(), "lb_lags": m,
        "lb_stat": float(lb["lb_stat"].iloc[0]), "lb_pvalue": float(lb["lb_pvalue"].iloc[0]),
        "bp_stat": float(lm), "bp_pvalue": float(lm_p), "jb_stat": float(jb), "jb_pvalue": float(jb_p),
        "skewness": float(skew), "kurtosis": float(kurt),
    }


def reference(ds: dict, label: str, source_path: str) -> dict:
    specs = [(m, u) for m in MODELS for u in UNIVERSES]
    available = [(m, u) for m, u in specs if has_data(ds, required(m, u))]
    skipped = [{"model": m, "universe": u, "reason": "séries indisponibles"} for m, u in specs if (m, u) not in available]
    all_cols = sorted({c for m, u in available for c in required(m, u)})
    common = rows_for(ds, all_cols)
    cases, diags, rolling = [], [], []
    for m, u in available:
        for sample, rows in (("own", rows_for(ds, required(m, u))), ("common", common)):
            if len(rows) < max(24, len(MODELS[m]) + 11):
                skipped.append({"model": m, "universe": u, "sample": sample, "reason": f"n = {len(rows)} insuffisant"})
                continue
            y, X, dates = design(ds, m, u, rows)
            for cov, r in fit_all(y, X, nw_lags(len(y))).items():
                cases.append({"model": m, "universe": u, "sample": sample, "cov": cov, "n": len(y),
                              "first_date": dates[0], "last_date": dates[-1], **r})
            if sample == "own":
                diags.append({"model": m, "universe": u, **diagnostics(y, X)})
                w = 60
                if len(y) >= w + 2:
                    pts = []
                    for end in sorted({w, (len(y) + w) // 2, len(y)}):
                        fits = fit_all(y[end - w:end], X[end - w:end], nw_lags(w))
                        pts.append({"end_date": dates[end - 1], "fits": {c: {k: fits[c][k] for k in ("params", "ci_low", "ci_high")} for c in ("classical", "HC3", "HAC")}})
                    rolling.append({"model": m, "universe": u, "window": w, "points": pts})
    return {
        "label": label, "dataset_path": source_path, "dataset_generated_at": ds.get("generated_at"),
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "statsmodels_version": statsmodels.__version__, "common_n": len(common),
        "cases": cases, "diagnostics": diags, "rolling": rolling, "skipped": skipped,
    }


def main() -> int:
    C.REFERENCE_DIR.mkdir(parents=True, exist_ok=True)
    targets = [
        ("synthetic", C.ROOT / "tests" / "fixtures" / "synthetic_dataset.json", "statsmodels_synthetic.json"),
        ("dataset", C.PUBLIC_DATA / "dataset.json", "statsmodels_dataset.json"),
    ]
    for label, path, out in targets:
        if not path.exists():
            print(f"[validate] {path} absent — ignoré")
            continue
        ds = json.loads(path.read_text())
        ref = reference(ds, label, str(path.relative_to(C.ROOT)))
        (C.REFERENCE_DIR / out).write_text(json.dumps(ref, indent=1))
        print(f"[validate] {out} : {len(ref['cases'])} régressions, {len(ref['diagnostics'])} diagnostics, échantillon commun n = {ref['common_n']}")
        for s in ref["skipped"]:
            print(f"   ignoré : {s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
