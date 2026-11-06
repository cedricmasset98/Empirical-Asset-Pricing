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

from .validate_common import ASSETS, MODELS, UNIVERSES, design, has_data, required, rows_for  # noqa: E402


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
    """Échantillons : « own » (toutes les dates disponibles pour la spécification),
    « common » (dates communes aux spécifications disponibles du même actif),
    « pair » (dates communes à toutes les spécifications des deux actifs : base de
    la comparaison action / fonds, y compris le portefeuille différence DIFF)."""
    specs = [(m, u) for m in MODELS for u in UNIVERSES]
    cases, diags, rolling, skipped = [], [], [], []
    min_n = lambda m: max(24, len(MODELS[m]) + 11)  # noqa: E731

    def add_cases(asset, m, u, rows, sample):
        if len(rows) < min_n(m):
            skipped.append({"asset": asset, "model": m, "universe": u, "sample": sample, "reason": f"n = {len(rows)} insuffisant"})
            return None
        y, X, dates = design(ds, m, u, rows, asset)
        for cov, r in fit_all(y, X, nw_lags(len(y))).items():
            cases.append({"asset": asset, "model": m, "universe": u, "sample": sample, "cov": cov, "n": len(y),
                          "first_date": dates[0], "last_date": dates[-1], **r})
        return y, X, dates

    commons = {}
    for asset in ("BCV", "FUND"):
        available = [(m, u) for m, u in specs if has_data(ds, required(m, u, asset))]
        skipped += [{"asset": asset, "model": m, "universe": u, "reason": "séries indisponibles"} for m, u in specs if (m, u) not in available]
        if not available:
            continue
        common = rows_for(ds, sorted({c for m, u in available for c in required(m, u, asset)}))
        commons[asset] = (available, common)
        for m, u in available:
            res = add_cases(asset, m, u, rows_for(ds, required(m, u, asset)), "own")
            add_cases(asset, m, u, common, "common")
            if res is None:
                continue
            y, X, dates = res
            diags.append({"asset": asset, "model": m, "universe": u, **diagnostics(y, X)})
            w = 60
            if len(y) >= w + 2:
                pts = []
                for end in sorted({w, (len(y) + w) // 2, len(y)}):
                    fits = fit_all(y[end - w:end], X[end - w:end], nw_lags(w))
                    pts.append({"end_date": dates[end - 1], "fits": {c: {k: fits[c][k] for k in ("params", "ci_low", "ci_high")} for c in ("classical", "HC3", "HAC")}})
                rolling.append({"asset": asset, "model": m, "universe": u, "window": w, "points": pts})
    pair_n = 0
    if "BCV" in commons and "FUND" in commons:
        both = [s for s in commons["BCV"][0] if s in commons["FUND"][0]]
        pair = rows_for(ds, sorted({c for m, u in both for a in ("BCV", "FUND") for c in required(m, u, a)}))
        pair_n = len(pair)
        for m, u in both:
            for asset in ("BCV", "FUND", "DIFF"):
                add_cases(asset, m, u, pair, "pair")
    return {
        "label": label, "dataset_path": source_path, "dataset_generated_at": ds.get("generated_at"),
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "statsmodels_version": statsmodels.__version__,
        "common_n": {a: len(c[1]) for a, c in commons.items()}, "pair_n": pair_n,
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
        print(f"[validate] {out} : {len(ref['cases'])} régressions, {len(ref['diagnostics'])} diagnostics, échantillons communs {ref['common_n']}, paire action/fonds n = {ref['pair_n']}")
        for s in ref["skipped"]:
            print(f"   ignoré : {s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
