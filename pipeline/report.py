"""Génère le rapport de synthèse LaTeX (vulgarisé, avec limites) et le PDF.

Usage : python -m pipeline.report [--no-compile]

Entrées : public/data/dataset.json et le gabarit report/rapport.tex.
Sorties :
  report/build/                        sources LaTeX complètes + PDF
  public/report/rapport_bcv.pdf        rapport téléchargeable depuis le site
  public/report/rapport_bcv_latex.zip  sources LaTeX (gabarit, macros, tableaux, figures)

Tous les nombres du rapport sont calculés ici à partir des données ; le
gabarit ne contient que du texte et des macros (\\AlphaM, \\BetaM, ...).
Spécification de référence : Single Index Model (BCV contre SPI TR, Rf = SARON),
mensuel, échantillon maximal, erreurs standards Newey-West (règle automatique).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import config as C
from . import olsref
from .validate_common import MODELS, UNIVERSES, design, has_data, required, rows_for

TEMPLATE = C.ROOT / "report" / "rapport.tex"
BUILD = C.ROOT / "report" / "build"
GEN = BUILD / "generated"
OUT = C.PUBLIC_DATA.parent / "report"
SITE_URL = "https://cedricmasset.ch/Empirical-Asset-Pricing/"
ROLL_WINDOW = 60

MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
MODEL_NAMES = {"CAPM": "CAPM", "FF3": "Fama-French 3", "CARHART": "Carhart 4", "FF5": "Fama-French 5"}


# ------------------------------------------------------------------ formatage

def tex_escape(s: str) -> str:
    rep = {"\\": r"\textbackslash{}", "&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#", "_": r"\_",
           "{": r"\{", "}": r"\}", "~": r"\textasciitilde{}", "^": r"\textasciicircum{}"}
    return "".join(rep.get(c, c) for c in s)


def num(x: float, d: int = 2) -> str:
    """Nombre au format français (virgule décimale, signe moins typographique)."""
    if x is None or not math.isfinite(x):
        return "—"
    s = f"{abs(x):,.{d}f}".replace(",", " ").replace(".", ",")
    return ("−" if x < 0 and round(abs(x), d) != 0 else "") + s


def pct(x: float, d: int = 2) -> str:
    return f"{num(100 * x, d)}~\\%"


def pval(p: float) -> str:
    if p < 0.001:
        return "< 0,001"
    return num(p, 3)


def peq(p: float) -> str:
    """Relation complète pour « p … » : « = 0,020 » ou « < 0,001 »."""
    return "< 0,001" if p < 0.001 else f"= {num(p, 3)}"


def month_fr(key: str) -> str:
    y, m = key.split("-")
    return f"{MOIS[int(m) - 1]} {y}"


def verdict(p: float) -> str:
    if p < 0.01:
        return "statistiquement significatif au seuil de 1~\\%"
    if p < 0.05:
        return "statistiquement significatif au seuil de 5~\\%"
    if p < 0.10:
        return "seulement faiblement significatif (seuil de 10~\\%)"
    return "pas statistiquement significatif"


# ------------------------------------------------------------------ calculs

def sample(ds: dict, model: str, universe: str, restrict: set[int] | None = None):
    rows = rows_for(ds, required(model, universe))
    if restrict is not None:
        rows = [i for i in rows if i in restrict]
    y, X, dates = design(ds, model, universe, rows)
    return y, X, dates, rows


def compute(ds: dict) -> dict:
    if not has_data(ds, required("CAPM", "SPI")):
        raise RuntimeError("Séries BCV, SPI ou SARON indisponibles : rapport impossible.")
    y, X, dates, rows = sample(ds, "CAPM", "SPI")
    if len(y) < 24:
        raise RuntimeError(f"Seulement {len(y)} observations pour le Single Index Model.")
    fits = {c: olsref.fit(y, X, c) for c in ("classical", "HC3", "HAC")}
    main = fits["HAC"]

    # performance cumulée sur l'échantillon (rendements totaux)
    bcv = np.array([ds["data"]["bcv_ret"][i] for i in rows])
    spi = np.array([ds["data"]["spi_ret"][i] for i in rows])
    rf = np.array([ds["data"]["rf_saron"][i] for i in rows])
    contiguous = all(_mdiff(dates[t - 1], dates[t]) == 1 for t in range(1, len(dates)))

    # comparaison des 8 spécifications sur l'échantillon commun
    specs = [(m, u) for u in UNIVERSES for m in MODELS if has_data(ds, required(m, u))]
    cols = sorted({c for m, u in specs for c in required(m, u)})
    common = set(rows_for(ds, cols))
    comp = []
    for m, u in specs:
        yc, Xc, dc, _ = sample(ds, m, u, common)
        if len(yc) >= max(24, len(MODELS[m]) + 11):
            comp.append({"model": m, "universe": u, "fit": olsref.fit(yc, Xc, "HAC"), "dates": dc})

    # régression mobile (Single Index, Newey-West)
    roll = []
    for end in range(ROLL_WINDOW, len(y) + 1):
        f = olsref.fit(y[end - ROLL_WINDOW:end], X[end - ROLL_WINDOW:end], "HAC")
        roll.append({"date": dates[end - 1], "fit": f})

    e = fits["classical"].resid
    m_lb = olsref.lb_lags(len(e))
    return {
        "y": y, "X": X, "dates": dates, "fits": fits, "main": main, "bcv": bcv, "spi": spi, "rf": rf,
        "contiguous": contiguous, "comp": comp, "roll": roll,
        "lb": olsref.ljung_box(e, m_lb), "lb_lags": m_lb, "bp": olsref.breusch_pagan(e, X), "jb": olsref.jarque_bera(e),
    }


def _mdiff(a: str, b: str) -> int:
    ya, ma = map(int, a.split("-"))
    yb, mb = map(int, b.split("-"))
    return (yb - ya) * 12 + mb - ma


# ------------------------------------------------------------------ macros

def macros(ds: dict, r: dict) -> dict[str, str]:
    f = r["main"]
    a, b = f.params
    n = f.n
    y, X = r["y"], r["X"]
    mean_y, mean_x = float(y.mean()), float(X[:, 1].mean())
    grow_bcv = float(np.prod(1 + r["bcv"]))
    grow_spi = float(np.prod(1 + r["spi"]))
    years = n / 12
    comp = r["comp"]
    comp_alpha = [c["fit"].params[0] for c in comp]
    nsig = sum(c["fit"].pvalue[0] < 0.05 for c in comp)
    roll = r["roll"]
    rb = [x["fit"].params[1] for x in roll]
    ra = [x["fit"].params[0] for x in roll]
    ra_sig = [x["fit"].pvalue[0] < 0.05 for x in roll]
    i_min, i_max = (int(np.argmin(rb)), int(np.argmax(rb))) if roll else (0, 0)
    jb, jb_p, skew, kurt = r["jb"]
    lb_q, lb_p = r["lb"]
    bp_lm, bp_p = r["bp"]
    cl, hc = r["fits"]["classical"], r["fits"]["HC3"]
    commit = os.environ.get("GITHUB_SHA") or _git_sha()
    gen = datetime.now(timezone.utc)
    data_date = ds.get("generated_at", "")[:10]

    beta_phrase = (
        f"Quand le rendement excédentaire du SPI augmente d'un point de pourcentage, celui de BCV augmente en moyenne de {num(b, 2)} point"
        if b >= 0 else
        f"Quand le rendement excédentaire du SPI augmente d'un point de pourcentage, celui de BCV varie en moyenne de {num(b, 2)} point"
    )
    if b < 0.7:
        beta_sens = "nettement moins sensible au marché que la moyenne des actions (bêta de 1)"
    elif b <= 1.2:
        beta_sens = "environ aussi sensible au marché que la moyenne des actions"
    else:
        beta_sens = "plus sensible au marché que la moyenne des actions"
    r2p = 100 * f.r2
    if r2p < 20:
        r2_phrase = "Le marché n'explique donc qu'une petite partie des fluctuations mensuelles de l'action. Le reste correspond surtout à des événements propres à BCV, mais peut aussi refléter d'autres influences communes que le modèle n'inclut pas."
    elif r2p < 50:
        r2_phrase = "Le marché explique une partie appréciable, mais minoritaire, des fluctuations de l'action."
    else:
        r2_phrase = "Le marché explique la majeure partie des fluctuations de l'action."

    # phrases conditionnelles : le texte reste exact quand les données changent
    sig = [r["fits"][c].pvalue[0] < 0.05 for c in ("classical", "HC3", "HAC")]
    inference_concl = ("la conclusion au seuil de 5~\\% ne dépend pas de la méthode retenue" if len(set(sig)) == 1
                       else "la conclusion au seuil de 5~\\% dépend de la méthode retenue, ce qui appelle à la prudence")
    n_comp = len(comp)
    if n_comp and nsig == n_comp:
        fact = "Ajouter des facteurs ne fait pas disparaître l'alpha : il reste positif et significatif à 5~\\% dans toutes les spécifications"
        robust = "L'alpha reste du même ordre et significatif à 5~\\% dans"
    elif nsig == 0:
        fact = "Dans aucune spécification l'alpha n'est significatif à 5~\\%"
        robust = "L'alpha n'est significatif à 5~\\% dans aucune des"
    else:
        fact = f"L'alpha n'est significatif à 5~\\% que dans {nsig} spécifications sur {n_comp}"
        robust = f"L'alpha est significatif à 5~\\% dans {nsig} des"
    r2_main = next((c["fit"].r2 for c in comp if c["model"] == "CAPM" and c["universe"] == "SPI"), f.r2)
    r2_gain = max((c["fit"].r2 for c in comp), default=f.r2) - r2_main
    fact_r2 = ("Les facteurs supplémentaires n'améliorent presque pas l'explication des fluctuations mensuelles de BCV"
               f" (gain de $R^2$ d'au plus {num(100 * r2_gain, 1)} point de pourcentage) : ils ne captent visiblement pas ce qui fait varier cette action d'un mois à l'autre"
               if r2_gain < 0.05 else
               f"Les facteurs supplémentaires améliorent l'explication des fluctuations de BCV (gain de $R^2$ jusqu'à {num(100 * r2_gain, 1)} points)")
    share_sig = float(np.mean(ra_sig)) if roll else 0.0
    roll_phrase = ("mais significatif à 5~\\% dans seulement " if share_sig < 0.5 else "et significatif à 5~\\% dans ")
    roll_limite = ("les fenêtres glissantes montrent d'ailleurs qu'il n'est significatif que sur une minorité de sous-périodes"
                   if share_sig < 0.5 else "même s'il est significatif dans la plupart des fenêtres glissantes, ces fenêtres se chevauchent fortement")
    lowvol = ("et BCV en fait partie" if b < 1 else "ce qui ne concerne toutefois pas directement BCV, dont le bêta dépasse 1")
    beta_part = ("Comme le bêta est faible, l'exposition estimée au marché n'est associée qu'à une partie limitée du rendement moyen excédentaire de BCV"
                 if b < 0.7 else "L'exposition estimée au marché est associée à une part importante du rendement moyen excédentaire de BCV")
    r2_limite = ("Le faible $R^2$ indique que les facteurs étudiés expliquent peu les fluctuations mensuelles de BCV. Cela ne signifie pas, à lui seul, que les modèles évaluent incorrectement son rendement moyen ; mais une partie des fluctuations non expliquées peut provenir de facteurs systématiques absents des modèles."
                 if f.r2 < 0.2 else "Même avec un $R^2$ appréciable, des facteurs pertinents peuvent manquer.")

    perf = ("a progressé davantage que" if grow_bcv > grow_spi else "a progressé moins que")
    part_mkt = (b * mean_x / mean_y) if mean_y > 0 else float("nan")
    if n_comp and nsig == n_comp:
        comp_essentiel = f"L'alpha reste positif et significatif à 5~\\% dans les {n_comp} variantes de modèles testées"
    elif nsig == 0:
        comp_essentiel = f"L'alpha n'est significatif à 5~\\% dans aucune des {n_comp} variantes de modèles testées"
    else:
        comp_essentiel = f"L'alpha est significatif à 5~\\% dans {nsig} des {n_comp} variantes de modèles testées"

    first, last = r["dates"][0], r["dates"][-1]
    out = {
        "PerfPhrase": perf,
        "CompEssentiel": comp_essentiel,
        "PartMarchePct": f"{num(100 * part_mkt, 0)}~\\%" if math.isfinite(part_mkt) else "—",
        "InferenceConclusion": inference_concl,
        "FacteursPhrase": fact,
        "RobustessePhrase": robust,
        "FacteursRDeuxPhrase": fact_r2,
        "RollPhrase": roll_phrase,
        "RollLimite": roll_limite,
        "LowVolPhrase": lowvol,
        "BetaPartPhrase": beta_part,
        "RDeuxLimite": r2_limite,
        "DateRapport": f"{gen.day} {MOIS[gen.month - 1]} {gen.year}",
        "DateDonnees": data_date,
        "Commit": tex_escape(commit[:7] if commit else "inconnu"),
        "URLSite": f"\\url{{{SITE_URL}}}",
        "PeriodeDebut": month_fr(first),
        "PeriodeFin": month_fr(last),
        "NObs": str(n),
        "Annees": num(years, 1),
        "Contigu": "" if r["contiguous"] else " (avec des mois manquants, exclus sans interpolation)",
        "AlphaM": pct(a, 2),
        "AlphaA": pct(12 * a, 1),
        "AlphaAIC": f"[{pct(12 * f.ci_low[0], 1)} ; {pct(12 * f.ci_high[0], 1)}]",
        "AlphaALo": pct(12 * f.ci_low[0], 1),
        "AlphaAHi": pct(12 * f.ci_high[0], 1),
        "AlphaZ": num(f.stat[0], 2),
        "AlphaP": pval(f.pvalue[0]),
        "AlphaPEq": peq(f.pvalue[0]),
        "AlphaADeux": pct(12 * a, 2),
        "MoyBCVADeux": pct(12 * mean_y, 2),
        "PartMarcheADeux": pct(12 * b * mean_x, 2),
        "AlphaVerdict": verdict(f.pvalue[0]),
        "AlphaSens": "positif" if a > 0 else "négatif",
        "AlphaTClassique": num(cl.stat[0], 2),
        "AlphaPClassique": pval(cl.pvalue[0]),
        "AlphaZHC": num(hc.stat[0], 2),
        "AlphaPHC": pval(hc.pvalue[0]),
        "NWLags": str(f.hac_lags),
        "BetaM": num(b, 2),
        "BetaIC": f"[{num(f.ci_low[1], 2)} ; {num(f.ci_high[1], 2)}]",
        "BetaPhrase": beta_phrase,
        "BetaSens": beta_sens,
        "RDeux": num(f.r2, 3),
        "RDeuxPct": f"{num(r2p, 0)}~\\%",
        "RDeuxPhrase": r2_phrase,
        "SigmaA": pct(f.sigma * math.sqrt(12), 1),
        "VolBCV": pct(float(np.std(y, ddof=1)) * math.sqrt(12), 1),
        "VolSPI": pct(float(np.std(X[:, 1], ddof=1)) * math.sqrt(12), 1),
        "MoyBCVA": pct(12 * mean_y, 1),
        "MoyMktA": pct(12 * mean_x, 1),
        "PartMarcheA": pct(12 * b * mean_x, 1),
        "CroissanceBCV": f"{num(100 * grow_bcv, 0)}~CHF",
        "CroissanceSPI": f"{num(100 * grow_spi, 0)}~CHF",
        "RendAnnBCV": pct(grow_bcv ** (1 / years) - 1, 1),
        "RendAnnSPI": pct(grow_spi ** (1 / years) - 1, 1),
        "RendAnnRf": pct(float(np.prod(1 + r["rf"])) ** (1 / years) - 1, 2),
        "CommonN": str(comp[0]["fit"].n) if comp else "0",
        "CommonPeriode": f"{month_fr(comp[0]['dates'][0])} – {month_fr(comp[0]['dates'][-1])}" if comp else "—",
        "NbSpecs": str(len(comp)),
        "AlphaMinA": pct(12 * min(comp_alpha), 1) if comp else "—",
        "AlphaMaxA": pct(12 * max(comp_alpha), 1) if comp else "—",
        "NbSigCinq": str(nsig),
        "RollFenetre": str(ROLL_WINDOW),
        "RollAnnees": {12: "l'année précédente", 24: "les deux années précédentes", 36: "les trois années précédentes", 60: "les cinq années précédentes", 120: "les dix années précédentes"}.get(ROLL_WINDOW, f"les {ROLL_WINDOW} mois précédents"),
        "RollChevauchement": f"{num(100 * (ROLL_WINDOW - 1) / ROLL_WINDOW, 0)}~\\%",
        "RollN": str(len(roll)),
        "RollBetaMin": num(rb[i_min], 2) if roll else "—",
        "RollBetaMinDate": month_fr(roll[i_min]["date"]) if roll else "—",
        "RollBetaMax": num(rb[i_max], 2) if roll else "—",
        "RollBetaMaxDate": month_fr(roll[i_max]["date"]) if roll else "—",
        "RollAlphaPosPct": f"{num(100 * np.mean([x > 0 for x in ra]), 0)}~\\%" if roll else "—",
        "RollAlphaSigPct": f"{num(100 * np.mean(ra_sig), 0)}~\\%" if roll else "—",
        "LBLags": str(r["lb_lags"]),
        "LBQ": num(lb_q, 2),
        "LBp": pval(lb_p),
        "LBpEq": peq(lb_p),
        "LBVerdict": "ne détecte pas d'autocorrélation significative des résidus" if lb_p >= 0.05 else "détecte une autocorrélation significative des résidus",
        "BPLM": num(bp_lm, 2),
        "BPp": pval(bp_p),
        "BPpEq": peq(bp_p),
        "BPVerdict": "ne rejette pas l'homoscédasticité" if bp_p >= 0.05 else "rejette l'homoscédasticité (la variance des résidus dépend du marché)",
        "JB": num(jb, 1),
        "JBp": pval(jb_p),
        "JBpEq": peq(jb_p),
        "JBVerdict": "rejette la normalité des résidus" if jb_p < 0.05 else "ne rejette pas la normalité des résidus",
        "Asym": num(skew, 2),
        "Kurt": num(kurt, 2),
        "ProbUnFaux": f"{num(100 * (1 - 0.95 ** 20), 0)}~\\%",
    }
    return out


def _git_sha() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=C.ROOT, capture_output=True, text=True, check=True).stdout.strip()
    except Exception:  # noqa: BLE001
        return ""


def write_macros(m: dict[str, str]) -> None:
    lines = ["% Généré par pipeline/report.py — ne pas modifier à la main.", "% Toutes les valeurs sont calculées à partir de public/data/dataset.json."]
    for k, v in m.items():
        lines.append(f"\\newcommand{{\\{k}}}{{{v}}}")
    (GEN / "macros.tex").write_text("\n".join(lines) + "\n", encoding="utf-8")


# ------------------------------------------------------------------ tableaux

def write_tables(ds: dict, r: dict) -> None:
    # robustesse de l'inférence (Single Index)
    rows = []
    names = ["$\\alpha$ (\\% par mois)", "$\\beta_M$"]
    for cov, label in (("classical", "OLS classique (Student)"), ("HC3", "Robuste HC3"), ("HAC", f"Newey-West ({r['main'].hac_lags} retards)")):
        f = r["fits"][cov]
        for j, nm in enumerate(names):
            s = 100 if j == 0 else 1
            rows.append(f"{label if j == 0 else ''} & {nm} & {num(s * f.params[j], 3)} & {num(s * f.se[j], 3)} & {num(f.stat[j], 2)} & {pval(f.pvalue[j])} & [{num(s * f.ci_low[j], 3)} ; {num(s * f.ci_high[j], 3)}] \\\\")
        rows.append("\\addlinespace")
    tab = ["\\begin{tabular}{@{}llrrrrc@{}}", "\\toprule",
           "Méthode & Coefficient & Estimation & Erreur std. & $t$ ou $z$ & $p$-value & IC 95~\\% \\\\", "\\midrule",
           *rows[:-1], "\\bottomrule", "\\end{tabular}"]
    (GEN / "tab_inference.tex").write_text("\n".join(tab) + "\n", encoding="utf-8")

    # comparaison des modèles
    lines = ["\\begin{tabular}{@{}llrcrrrr@{}}", "\\toprule",
             "Marché & Modèle & $\\alpha$ annualisé & IC 95~\\% & $z(\\alpha)$ & $p$-value & $\\beta_M$ & $R^2$ \\\\", "\\midrule"]
    last_u = None
    for c in r["comp"]:
        f = c["fit"]
        u = "SPI TR" if c["universe"] == "SPI" else "Europe (CHF)"
        hybrid = "\\textsuperscript{h}" if c["universe"] == "SPI" and c["model"] != "CAPM" else ""
        if last_u is not None and u != last_u:
            lines.append("\\midrule")
        lines.append(f"{u if u != last_u else ''} & {MODEL_NAMES[c['model']]}{hybrid} & {pct(12 * f.params[0], 1)} & [{pct(12 * f.ci_low[0], 1)} ; {pct(12 * f.ci_high[0], 1)}] & {num(f.stat[0], 2)} & {pval(f.pvalue[0])} & {num(f.params[1], 2)} & {num(f.r2, 3)} \\\\")
        last_u = u
    lines += ["\\bottomrule", "\\end{tabular}"]
    (GEN / "tab_comparaison.tex").write_text("\n".join(lines) + "\n", encoding="utf-8")

    # sources
    st = {"ok": "OK", "error": "erreur", "manual": "import manuel"}
    src = ["\\begin{tabular}{@{}>{\\raggedright\\arraybackslash}p{0.38\\textwidth}>{\\raggedright\\arraybackslash}p{0.33\\textwidth}l@{}}", "\\toprule", "Série & Fournisseur & Couverture \\\\", "\\midrule"]
    for s in ds.get("sources", []):
        cov = " – ".join(s.get("coverage") or []) or "—"
        src.append(f"{tex_escape(s['name'])} & {tex_escape(s.get('provider', ''))} ({st.get(s['status'], s['status'])}) & {tex_escape(cov)} \\\\")
    src += ["\\bottomrule", "\\end{tabular}"]
    (GEN / "tab_sources.tex").write_text("\n".join(src) + "\n", encoding="utf-8")


# ------------------------------------------------------------------ figures

def setup_matplotlib():
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib import font_manager

    family = "serif"
    try:
        path = subprocess.run(["kpsewhich", "texgyrepagella-regular.otf"], capture_output=True, text=True).stdout.strip()
        if path:
            for v in ("regular", "bold", "italic", "bolditalic"):
                p = path.replace("regular", v)
                if Path(p).exists():
                    font_manager.fontManager.addfont(p)
            family = "TeX Gyre Pagella"
    except Exception:  # noqa: BLE001
        pass
    plt.rcParams.update({
        "font.family": family, "font.size": 9, "axes.spines.top": False, "axes.spines.right": False,
        "axes.grid": True, "grid.color": "#e5e7eb", "grid.linewidth": 0.6, "axes.edgecolor": "#6b7280",
        "axes.titlesize": 9.5, "legend.frameon": False, "figure.dpi": 150, "savefig.bbox": "tight",
        "axes.formatter.use_locale": False, "axes.unicode_minus": True,
    })
    return plt


BLUE, ORANGE, GREY = "#1f5fa8", "#d9480f", "#6b7280"


def _pct_axis(ax, axis="y"):
    from matplotlib.ticker import FuncFormatter

    fmt = FuncFormatter(lambda v, _: f"{v:.0f} %".replace("-", "−"))
    (ax.yaxis if axis == "y" else ax.xaxis).set_major_formatter(fmt)


def _dates(keys):
    import pandas as pd

    return pd.PeriodIndex(keys, freq="M").to_timestamp(how="end")


def write_figures(r: dict) -> None:
    plt = setup_matplotlib()
    d = _dates(r["dates"])

    # 1. croissance de 100 CHF
    fig, ax = plt.subplots(figsize=(6.2, 2.9))
    series = ((r["bcv"], ORANGE, 1.7, "-", "Action BCV (dividendes réinvestis)"),
              (r["spi"], BLUE, 1.5, "-", "SPI Total Return"),
              (r["rf"], GREY, 1.1, "--", "Placement au SARON"))
    for ret, col, lw, ls, lab in series:
        v = 100 * np.cumprod(1 + ret)
        ax.plot(d, v, color=col, lw=lw, ls=ls, label=lab)
        ax.annotate(f"{num(v[-1], 0)} CHF", (d[-1], v[-1]), xytext=(4, 0), textcoords="offset points",
                    va="center", fontsize=8, color=col)
    ax.set_ylabel("Valeur de 100 CHF investis (CHF)")
    ax.set_xlim(d[0], d[-1] + (d[-1] - d[0]) * 0.09)
    ax.legend(loc="upper left", fontsize=8)
    fig.savefig(GEN / "fig_croissance.pdf")
    plt.close(fig)

    # 2. nuage de points + droite OLS
    f = r["main"]
    x, y = 100 * r["X"][:, 1], 100 * r["y"]
    grid = np.linspace(r["X"][:, 1].min(), r["X"][:, 1].max(), 100)
    G = np.column_stack([np.ones_like(grid), grid])
    m, lo, hi = olsref.mean_ci(f, G)
    fig, ax = plt.subplots(figsize=(6.2, 3.6))
    ax.fill_between(100 * grid, 100 * lo, 100 * hi, color=ORANGE, alpha=0.15, lw=0, label="IC 95 % de la droite")
    ax.scatter(x, y, s=10, color=BLUE, alpha=0.6, lw=0, label="Un mois")
    ax.plot(100 * grid, 100 * m, color="white", lw=4.5)
    ax.plot(100 * grid, 100 * m, color=ORANGE, lw=2.2, label="Droite estimée (OLS)")
    ax.axhline(0, color=GREY, lw=0.6)
    ax.axvline(0, color=GREY, lw=0.6)
    a0 = 100 * f.params[0]
    ax.plot([0], [a0], "o", color=ORANGE, ms=6, mec="white", mew=1.2, zorder=5)
    ax.annotate(f"α = {num(a0, 2)} % par mois\n(hauteur de la droite\nquand le marché fait 0 %)", (0, a0),
                xytext=(0.60, 0.20), textcoords="axes fraction", fontsize=8, color="#1f2937", ha="left", va="top",
                bbox=dict(boxstyle="round,pad=0.3", fc="white", ec="#d1d5db", lw=0.6, alpha=0.95),
                arrowprops=dict(arrowstyle="-|>", color="#374151", lw=0.8, shrinkB=4))
    xr = 100 * grid[int(len(grid) * 0.86)]
    ax.annotate(f"pente = β = {num(f.params[1], 2)}\n(+1 % de marché → +{num(f.params[1], 2)} % BCV)", (xr, 100 * (f.params[0] + f.params[1] * xr / 100)),
                xytext=(0.97, 0.97), textcoords="axes fraction", fontsize=8, color="#1f2937", ha="right", va="top",
                bbox=dict(boxstyle="round,pad=0.3", fc="white", ec="#d1d5db", lw=0.6, alpha=0.95),
                arrowprops=dict(arrowstyle="-|>", color="#374151", lw=0.8, shrinkB=2))
    ax.set_xlabel("Rendement excédentaire du SPI (% par mois)")
    ax.set_ylabel("Rendement excédentaire de BCV (% par mois)")
    _pct_axis(ax, "y")
    _pct_axis(ax, "x")
    ax.legend(loc="upper left", fontsize=8)
    fig.savefig(GEN / "fig_nuage.pdf")
    plt.close(fig)

    # 3. alphas des modèles
    comp = r["comp"]
    if comp:
        fig, ax = plt.subplots(figsize=(6.2, 2.8))
        labels = []
        for i, c in enumerate(comp):
            ff = c["fit"]
            col = BLUE if c["universe"] == "SPI" else ORANGE
            a = 1200 * ff.params[0]
            ax.errorbar(i, a, yerr=[[a - 1200 * ff.ci_low[0]], [1200 * ff.ci_high[0] - a]], fmt="o" if c["universe"] == "SPI" else "D",
                        color=col, ms=5, capsize=3, lw=1.3)
            labels.append(MODEL_NAMES[c["model"]].replace("Fama-French ", "FF"))
        ax.axhline(0, color="#111827", lw=1.3, zorder=0)
        ax.annotate("α = 0", (len(comp) - 0.55, 0), xytext=(0, 3), textcoords="offset points", fontsize=8, color="#111827", ha="right", va="bottom")
        ax.set_xlim(-0.6, len(comp) - 0.4)
        lo_y, hi_y = ax.get_ylim()
        ax.set_ylim(min(lo_y, -0.12 * (hi_y - min(lo_y, 0))), hi_y)
        ax.set_xticks(range(len(comp)), labels)
        ax.set_ylabel("α annualisé et IC 95 %")
        _pct_axis(ax)
        n_spi = sum(c["universe"] == "SPI" for c in comp)
        if 0 < n_spi < len(comp):
            ax.axvline(n_spi - 0.5, color=GREY, lw=0.6, ls=":")
            ax.text((n_spi - 1) / 2, ax.get_ylim()[1], "Marché : SPI TR", ha="center", va="bottom", fontsize=8, color=BLUE)
            ax.text(n_spi + (len(comp) - n_spi - 1) / 2, ax.get_ylim()[1], "Marché : Europe (CHF)", ha="center", va="bottom", fontsize=8, color=ORANGE)
        fig.savefig(GEN / "fig_alphas.pdf")
        plt.close(fig)

    # 4. régression mobile
    roll = r["roll"]
    if roll:
        rd = _dates([x["date"] for x in roll])
        fig, axes = plt.subplots(2, 1, figsize=(6.2, 4.2), sharex=True)
        for ax, j, col, lab, s in ((axes[0], 1, BLUE, "Bêta de marché", 1), (axes[1], 0, ORANGE, "α annualisé", 1200)):
            est = np.array([s * x["fit"].params[j] for x in roll])
            lo = np.array([s * x["fit"].ci_low[j] for x in roll])
            hi = np.array([s * x["fit"].ci_high[j] for x in roll])
            ax.fill_between(rd, lo, hi, color=col, alpha=0.15, lw=0)
            ax.plot(rd, est, color=col, lw=1.6)
            ax.axhline(0, color="#111827", lw=1.1)
            if j == 1:
                ax.axhline(1, color=GREY, lw=0.8, ls=":")
                ax.annotate("β = 1 (sensibilité du marché)", (rd[0], 1), xytext=(2, -3), textcoords="offset points", fontsize=7.5, color=GREY, va="top")
            ax.set_title(f"{lab} — fenêtres glissantes de {ROLL_WINDOW} mois (IC 95 %)", loc="left")
            if j == 0:
                _pct_axis(ax)
        fig.tight_layout()
        fig.savefig(GEN / "fig_rolling.pdf")
        plt.close(fig)


# ------------------------------------------------------------------ compilation

def compile_pdf() -> Path:
    cmd = ["latexmk", "-xelatex", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "rapport.tex"]
    res = subprocess.run(cmd, cwd=BUILD, capture_output=True, text=True)
    if res.returncode != 0:
        log = (BUILD / "rapport.log").read_text(errors="replace") if (BUILD / "rapport.log").exists() else res.stdout
        errs = [line for line in log.splitlines() if line.startswith("!") or ".tex:" in line]
        raise RuntimeError("Compilation LaTeX échouée :\n" + "\n".join(errs[-20:]))
    log = (BUILD / "rapport.log").read_text(errors="replace")
    missing = sorted({line for line in log.splitlines() if "Missing character" in line})
    if missing:
        raise RuntimeError("Caractères absents de la police :\n" + "\n".join(missing[:10]))
    return BUILD / "rapport.pdf"


def package(pdf: Path | None) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    if pdf is not None:
        shutil.copy(pdf, OUT / "rapport_bcv.pdf")
    readme = (
        "Rapport de synthèse — Empirical Asset Pricing (BCV)\n\n"
        "Compilation : latexmk -xelatex rapport.tex   (ou xelatex rapport.tex deux fois)\n"
        "Polices : TeX Gyre Pagella (paquet tex-gyre). Langue : polyglossia (français).\n\n"
        "rapport.tex contient le texte ; generated/ contient les macros chiffrées,\n"
        "les tableaux et les figures produits par pipeline/report.py à partir des données.\n"
    )
    with zipfile.ZipFile(OUT / "rapport_bcv_latex.zip", "w", zipfile.ZIP_DEFLATED) as z:
        z.write(BUILD / "rapport.tex", "rapport_bcv/rapport.tex")
        for p in sorted(GEN.iterdir()):
            z.write(p, f"rapport_bcv/generated/{p.name}")
        z.writestr("rapport_bcv/LISEZMOI.txt", readme)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-compile", action="store_true")
    args = ap.parse_args(argv)
    ds = json.loads((C.PUBLIC_DATA / "dataset.json").read_text())
    shutil.rmtree(BUILD, ignore_errors=True)
    GEN.mkdir(parents=True)
    shutil.copy(TEMPLATE, BUILD / "rapport.tex")
    r = compute(ds)
    m = macros(ds, r)
    write_macros(m)
    write_tables(ds, r)
    write_figures(r)
    pdf = None if args.no_compile else compile_pdf()
    package(pdf)
    print(f"[rapport] {'PDF et ' if pdf else ''}sources LaTeX écrits dans {OUT.relative_to(C.ROOT)} "
          f"(α = {m['AlphaM']}, β = {m['BetaM']}, N = {m['NObs']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
