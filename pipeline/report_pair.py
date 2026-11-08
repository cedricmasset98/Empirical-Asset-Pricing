"""Rapport comparatif « Action BCV vs Fonds BCV — Comparaison des alphas ».

Échantillon : mois communs à l'action, au fonds, au SPI, au SARON et à tous les
facteurs européens (identique à l'onglet F du site avec « Marché = Europe FF »).
Spécifications : Single Index (SPI) et CAPM / FF3 / Carhart / FF5 (marché européen
en CHF). Inférence : Newey-West. L'écart d'alpha est estimé et testé par la
régression de R_action − R_fonds sur les mêmes facteurs (α = α_action − α_fonds).
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np

from . import olsref
from . import report as R
from .validate_common import MODELS, design, has_data, required, rows_for

# Référence = spécifications du site (SPI TR et facteurs suisses JKP) ;
# robustesse = marché et facteurs européens de Fama-French (en CHF).
SPECS = [(m, "SWISS") for m in MODELS]
ROBUST = [(m, "EUROPE") for m in MODELS]
ALL_SPECS = SPECS + ROBUST
SPEC_NAMES = {("CAPM", "SWISS"): "Single Index (SPI)", ("FF3", "SWISS"): "Fama-French 3", ("CARHART", "SWISS"): "Carhart 4",
              ("FF5", "SWISS"): "Fama-French 5", ("CAPM", "EUROPE"): "CAPM (Europe)", ("FF3", "EUROPE"): "Fama-French 3 (Europe)",
              ("CARHART", "EUROPE"): "Carhart 4 (Europe)", ("FF5", "EUROPE"): "Fama-French 5 (Europe)"}


def _perf(r: np.ndarray) -> dict:
    path = 100 * np.concatenate([[1.0], np.cumprod(1 + r)])
    n = len(r)
    peak = np.maximum.accumulate(path)
    return {"path": path, "ann": (path[-1] / 100) ** (12 / n) - 1, "vol": float(np.std(r, ddof=1) * math.sqrt(12)),
            "mdd": float((path / peak - 1).min()), "final": float(path[-1])}


def compute_pair(ds: dict) -> dict:
    for a in ("BCV", "FUND"):
        for m, u in ALL_SPECS:
            if not has_data(ds, required(m, u, a)):
                raise RuntimeError(f"Séries indisponibles pour {a} / {m} / {u} : rapport comparatif impossible.")
    cols = sorted({c for m, u in ALL_SPECS for a in ("BCV", "FUND") for c in required(m, u, a)})
    rows = rows_for(ds, cols)
    if len(rows) < 36:
        raise RuntimeError(f"Seulement {len(rows)} mois communs à l'action et au fonds.")
    dates = [ds["dates"][i] for i in rows]
    get = lambda c: np.array([ds["data"][c][i] for i in rows], dtype=float)  # noqa: E731
    fits = {}
    for m, u in ALL_SPECS:
        for a in ("BCV", "FUND", "DIFF"):
            y, X, _ = design(ds, m, u, rows, a)
            fits[(m, u, a)] = olsref.fit(y, X, "HAC")
    sim = {a: design(ds, "CAPM", "SWISS", rows, a) for a in ("BCV", "FUND")}
    perf = {k: _perf(get(c)) for k, c in (("act", "bcv_ret"), ("fds", "fund_ret"), ("spi", "spi_ret"), ("rf", "rf_saron"))}
    return {"dates": dates, "fits": fits, "sim": sim, "perf": perf}


def _verdict(p: float) -> str:
    return R.verdict(p)


def write_pair(ds: dict, r: dict, gen: Path) -> dict[str, str]:
    num, pct, pval, peq = R.num, R.pct, R.pval, R.peq
    F = r["fits"]
    a, f, d = F[("CAPM", "SWISS", "BCV")], F[("CAPM", "SWISS", "FUND")], F[("CAPM", "SWISS", "DIFF")]
    P = r["perf"]
    n = len(r["dates"])
    nsig = lambda asset: sum(F[(m, u, asset)].pvalue[0] < 0.05 for m, u in SPECS)  # noqa: E731
    fa = [12 * F[(m, u, "FUND")].params[0] for m, u in SPECS]
    aa = [12 * F[(m, u, "BCV")].params[0] for m, u in SPECS]

    higher = "l'action" if a.params[0] > f.params[0] else "le fonds"
    if d.pvalue[0] < 0.05:
        diff_phrase = (f"L'écart d'alpha entre l'action et le fonds ({pct(12 * d.params[0], 1)} par an) est statistiquement significatif "
                       f"au seuil de 5~\\% ($z$ = {num(d.stat[0], 2)}, $p$~{peq(d.pvalue[0])}).")
    else:
        diff_phrase = (f"L'écart d'alpha entre l'action et le fonds ({pct(12 * d.params[0], 1)} par an) n'est pas statistiquement significatif "
                       f"au seuil de 5~\\% ($z$ = {num(d.stat[0], 2)}, $p$~{peq(d.pvalue[0])}) : il doit être lu comme un constat descriptif.")
    if f.pvalue[0] >= 0.05:
        fund_phrase = (f"L'alpha du fonds, net de frais, est de {pct(12 * f.params[0], 1)} par an et n'est pas statistiquement distinct de zéro : "
                       "sur la période, le fonds a rapporté à peu près ce que son exposition au marché laissait attendre, frais déduits.")
    elif f.params[0] < 0:
        fund_phrase = (f"L'alpha du fonds, net de frais, est de {pct(12 * f.params[0], 1)} par an et significativement négatif : sur la période, "
                       "le fonds a rapporté moins que son exposition au marché ne le laissait attendre, frais déduits. Un tel écart est de l'ordre de grandeur des frais courants d'un fonds actif.")
    else:
        fund_phrase = (f"L'alpha du fonds, net de frais, est de {pct(12 * f.params[0], 1)} par an et significativement positif : sur la période, "
                       "le fonds a rapporté davantage que son exposition au marché ne le laissait attendre, même après frais.")
    m = {
        "DateRapport": R.date_fr(),
        "DateDonnees": ds.get("generated_at", "")[:10],
        "Commit": R.tex_escape((R.os.environ.get("GITHUB_SHA") or R._git_sha())[:7] or "inconnu"),
        "URLSite": f"\\url{{{R.SITE_URL}}}",
        "PairN": str(n), "PairDebut": R.month_fr(r["dates"][0]), "PairFin": R.month_fr(r["dates"][-1]),
        "PairAnnees": num(n / 12, 1), "NWLags": str(a.hac_lags),
        "ActCroiss": f"{num(P['act']['final'], 0)}~CHF", "FdsCroiss": f"{num(P['fds']['final'], 0)}~CHF",
        "SpiCroiss": f"{num(P['spi']['final'], 0)}~CHF", "RfCroiss": f"{num(P['rf']['final'], 0)}~CHF",
        "ActRend": pct(P["act"]["ann"], 1), "FdsRend": pct(P["fds"]["ann"], 1), "SpiRend": pct(P["spi"]["ann"], 1), "RfRend": pct(P["rf"]["ann"], 2),
        "ActVol": pct(P["act"]["vol"], 1), "FdsVol": pct(P["fds"]["vol"], 1), "SpiVol": pct(P["spi"]["vol"], 1),
        "ActMDD": pct(P["act"]["mdd"], 1), "FdsMDD": pct(P["fds"]["mdd"], 1), "SpiMDD": pct(P["spi"]["mdd"], 1),
        "FdsVsSpi": "inférieure" if P["fds"]["ann"] < P["spi"]["ann"] else "supérieure",
        "PlusHaut": higher,
        "DiffPhrase": diff_phrase,
        "FundPhrase": fund_phrase,
        "ActNbSig": str(nsig("BCV")), "FdsNbSig": str(nsig("FUND")), "DifNbSig": str(nsig("DIFF")), "NbSpecs": str(len(SPECS)),
        "FdsAlphaMin": pct(min(fa), 1), "FdsAlphaMax": pct(max(fa), 1),
        "RobFdsAlphaMin": pct(min(12 * F[(m, u, "FUND")].params[0] for m, u in ROBUST), 1),
        "RobFdsAlphaMax": pct(max(12 * F[(m, u, "FUND")].params[0] for m, u in ROBUST), 1),
        "RobActAlphaMin": pct(min(12 * F[(m, u, "BCV")].params[0] for m, u in ROBUST), 1),
        "RobActAlphaMax": pct(max(12 * F[(m, u, "BCV")].params[0] for m, u in ROBUST), 1),
        "RobActNbSig": str(sum(F[(m, u, "BCV")].pvalue[0] < 0.05 for m, u in ROBUST)),
        "RobNbSpecs": str(len(ROBUST)),
        "ActAlphaMin": pct(min(aa), 1), "ActAlphaMax": pct(max(aa), 1),
    }
    for pre, fit in (("Act", a), ("Fds", f), ("Dif", d)):
        m.update({
            f"{pre}AlphaA": pct(12 * fit.params[0], 1), f"{pre}AlphaLo": pct(12 * fit.ci_low[0], 1), f"{pre}AlphaHi": pct(12 * fit.ci_high[0], 1),
            f"{pre}Z": num(fit.stat[0], 2), f"{pre}PEq": peq(fit.pvalue[0]), f"{pre}Verdict": _verdict(fit.pvalue[0]),
            f"{pre}Beta": num(fit.params[1], 2), f"{pre}RDeux": num(fit.r2, 3), f"{pre}RDeuxPct": f"{num(100 * fit.r2, 1 if fit.r2 >= 0.95 else 0)}~\\%",
            f"{pre}SigmaA": pct(fit.sigma * math.sqrt(12), 1),
        })
    act_first = a.params[0] > f.params[0]
    diff_sig = d.pvalue[0] < 0.05
    if act_first and diff_sig:
        concl = ("Sur la période étudiée, l'action a dégagé un alpha nettement plus élevé que le fonds face au marché suisse, et l'écart est statistiquement significatif. "
                 "Les actionnaires de la banque ont obtenu un rendement supérieur à ce que leur exposition au marché laissait attendre.")
        finale = ("La comparaison indique ainsi que, sur cette période, la création de valeur ajustée du risque de marché a été plus forte pour "
                  "les actionnaires de la BCV que pour les investisseurs de son fonds actions suisses.")
    elif act_first:
        concl = ("Sur la période étudiée, l'alpha estimé de l'action est plus élevé que celui du fonds, mais l'écart n'est pas statistiquement significatif : "
                 "il s'agit d'un constat descriptif.")
        finale = "La comparaison ne permet pas d'affirmer que la création de valeur ajustée du risque de marché a différé entre actionnaires et porteurs de parts."
    else:
        concl = (f"Sur la période étudiée, l'alpha estimé du fonds est plus élevé que celui de l'action"
                 f"{', et l’écart est statistiquement significatif' if diff_sig else ', sans que l’écart soit statistiquement significatif'}.")
        finale = "La comparaison suggère que les porteurs de parts du fonds n'ont pas été moins bien servis, en termes ajustés du risque de marché, que les actionnaires."
    if f.pvalue[0] >= 0.05 or abs(12 * f.params[0]) < 0.015:
        fonds_concl = "Les porteurs de parts du fonds ont obtenu, frais déduits, un rendement proche de celui que leur exposition au marché laissait attendre, ce qui est le résultat le plus courant pour un fonds actions diversifié."
        fonds_incert = "L'alpha du fonds est mesuré beaucoup plus précisément, mais il est petit, de l'ordre de grandeur de frais de gestion."
    else:
        fonds_concl = f"L'alpha du fonds, net de frais, atteint {pct(12 * f.params[0], 1)} par an face au marché suisse."
        fonds_incert = "L'alpha du fonds est mesuré beaucoup plus précisément que celui de l'action."
    m["ConclusionPhrase"] = concl + " " + fonds_concl
    m["FinalePhrase"] = finale
    m["FondsIncertitude"] = fonds_incert
    na = nsig("BCV")
    m["ActRobustePhrase"] = ("L'alpha de l'action reste élevé et significatif à 5~\\% dans toutes les spécifications" if na == len(SPECS)
                             else f"L'alpha de l'action est significatif à 5~\\% dans {na} spécifications sur {len(SPECS)}")
    m["RisquePhrase"] = ("Le fonds est beaucoup plus diversifié : son risque propre (volatilité résiduelle) est nettement plus faible que celui de l'action, ce qui rend son alpha plus précis."
                         if f.sigma < 0.5 * a.sigma else "Les deux actifs présentent un risque propre comparable.")
    lines = ["% Généré par pipeline/report_pair.py — ne pas modifier à la main."] + [f"\\newcommand{{\\{k}}}{{{v}}}" for k, v in m.items()]
    (gen / "macros.tex").write_text("\n".join(lines) + "\n", encoding="utf-8")

    # tableaux
    t = ["\\begin{tabular}{@{}lrrrr@{}}", "\\toprule", "Série (rendement total) & Valeur finale de 100~CHF & Rendement annualisé & Volatilité & Perte maximale \\\\", "\\midrule"]
    for k, lab in (("act", "Action BCV"), ("fds", "Fonds BCV Swiss Equity A"), ("spi", "SPI Total Return"), ("rf", "Placement au SARON")):
        p = P[k]
        t.append(f"{lab} & {num(p['final'], 0)}~CHF & {pct(p['ann'], 1)} & {'—' if k == 'rf' else pct(p['vol'], 1)} & {'—' if k == 'rf' else pct(p['mdd'], 1)} \\\\")
    t += ["\\bottomrule", "\\end{tabular}"]
    (gen / "tab_pair_perf.tex").write_text("\n".join(t) + "\n", encoding="utf-8")

    def row(lab, fn, dval=""):
        return f"{lab} & {fn(a)} & {fn(f)} & {dval} \\\\"
    t = ["\\begin{tabular}{@{}lccc@{}}", "\\toprule", "Single Index (SPI), Newey-West & Action BCV & Fonds BCV & Écart (action $-$ fonds) \\\\", "\\midrule",
         row("$\\alpha$ annualisé", lambda x: pct(12 * x.params[0], 2), pct(12 * d.params[0], 2)),
         row("IC 95~\\% de l'$\\alpha$", lambda x: f"[{pct(12 * x.ci_low[0], 1)} ; {pct(12 * x.ci_high[0], 1)}]", f"[{pct(12 * d.ci_low[0], 1)} ; {pct(12 * d.ci_high[0], 1)}]"),
         row("Statistique $z$ de l'$\\alpha$", lambda x: num(x.stat[0], 2), num(d.stat[0], 2)),
         row("$p$-value de l'$\\alpha$", lambda x: pval(x.pvalue[0]), pval(d.pvalue[0])),
         row("Bêta de marché", lambda x: num(x.params[1], 2)),
         row("$R^2$", lambda x: num(x.r2, 3)),
         row("Volatilité résiduelle (annuelle)", lambda x: pct(x.sigma * math.sqrt(12), 1)),
         row("Nombre de mois", lambda x: str(x.n)),
         "\\bottomrule", "\\end{tabular}"]
    (gen / "tab_pair_alpha.tex").write_text("\n".join(t) + "\n", encoding="utf-8")

    t = ["\\begin{tabular}{@{}lrrrrrr@{}}", "\\toprule",
         "Modèle & $\\alpha$ action & $p$ & $\\alpha$ fonds & $p$ & Écart & $p$ \\\\", "\\midrule"]
    for mm, u in ALL_SPECS:
        fa_, ff_, fd_ = F[(mm, u, "BCV")], F[(mm, u, "FUND")], F[(mm, u, "DIFF")]
        if (mm, u) == SPECS[0]:
            t.append("\\multicolumn{7}{@{}l}{\\emph{Référence : SPI TR et facteurs suisses (JKP)}} \\\\")
        if (mm, u) == ROBUST[0]:
            t += ["\\midrule", "\\multicolumn{7}{@{}l}{\\emph{Robustesse : marché et facteurs européens (Fama-French, en CHF)}} \\\\"]
        t.append(f"{SPEC_NAMES[(mm, u)]} & {pct(12 * fa_.params[0], 1)} & {pval(fa_.pvalue[0])} & {pct(12 * ff_.params[0], 1)} & {pval(ff_.pvalue[0])} & {pct(12 * fd_.params[0], 1)} & {pval(fd_.pvalue[0])} \\\\")
    t += ["\\bottomrule", "\\end{tabular}"]
    (gen / "tab_pair_models.tex").write_text("\n".join(t) + "\n", encoding="utf-8")
    R.write_sources(ds, gen)

    # figures
    plt = R.setup_matplotlib()
    dts = R._dates(r["dates"])
    import pandas as pd

    x = [dts[0] - pd.offsets.MonthEnd(1)] + list(dts)
    fig, ax = plt.subplots(figsize=(6.2, 2.9))
    for k, col, lw, ls, lab in (("act", R.ORANGE, 1.7, "-", "Action BCV"), ("fds", "#2b8a3e", 1.7, "-", "Fonds BCV Swiss Equity A"),
                                ("spi", R.BLUE, 1.4, "-", "SPI Total Return"), ("rf", R.GREY, 1.0, "--", "Placement au SARON")):
        v = P[k]["path"]
        ax.plot(x, v, color=col, lw=lw, ls=ls, label=lab)
        ax.annotate(f"{num(v[-1], 0)} CHF", (x[-1], v[-1]), xytext=(4, 0), textcoords="offset points", va="center", fontsize=8, color=col)
    ax.set_ylabel("Valeur de 100 CHF investis (CHF)")
    ax.set_xlim(x[0], x[-1] + (x[-1] - x[0]) * 0.1)
    ax.legend(loc="upper left", fontsize=8)
    fig.savefig(gen / "fig_pair_perf.pdf")
    plt.close(fig)

    fig, axes = plt.subplots(1, 2, figsize=(6.4, 3.0), sharex=True, sharey=True)
    allx = np.concatenate([r["sim"][k][1][:, 1] for k in ("BCV", "FUND")])
    for ax, k, lab, col in ((axes[0], "BCV", "Action BCV", R.ORANGE), (axes[1], "FUND", "Fonds BCV Swiss Equity A", "#2b8a3e")):
        y, X, _ = r["sim"][k]
        fit = F[("CAPM", "SWISS", k)]
        grid = np.linspace(allx.min(), allx.max(), 60)
        G = np.column_stack([np.ones_like(grid), grid])
        mm, lo, hi = olsref.mean_ci(fit, G)
        ax.fill_between(100 * grid, 100 * lo, 100 * hi, color=col, alpha=0.18, lw=0)
        ax.scatter(100 * X[:, 1], 100 * y, s=7, color=R.BLUE, alpha=0.55, lw=0)
        ax.plot(100 * grid, 100 * mm, color=col, lw=2)
        ax.axhline(0, color=R.GREY, lw=0.6)
        ax.axvline(0, color=R.GREY, lw=0.6)
        ax.set_title(f"{lab}\nβ = {num(fit.params[1], 2)} · α = {num(1200 * fit.params[0], 1)} % / an · R² = {num(fit.r2, 3)}", fontsize=8.5)
        ax.set_xlabel("Rend. excédentaire SPI (% / mois)", fontsize=8)
        R._pct_axis(ax, "x")
        R._pct_axis(ax, "y")
    axes[0].set_ylabel("Rend. excédentaire (% / mois)", fontsize=8)
    fig.tight_layout()
    fig.savefig(gen / "fig_pair_nuages.pdf")
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(6.2, 2.8))
    for i, (mm, u) in enumerate(ALL_SPECS):
        for j, (k, col, mk) in enumerate((("BCV", R.ORANGE, "o"), ("FUND", "#2b8a3e", "D"))):
            fit = F[(mm, u, k)]
            v = 1200 * fit.params[0]
            ax.errorbar(i + (j - 0.5) * 0.25, v, yerr=[[v - 1200 * fit.ci_low[0]], [1200 * fit.ci_high[0] - v]], fmt=mk, color=col, ms=5, capsize=3, lw=1.3,
                        label=("Action BCV" if k == "BCV" else "Fonds BCV Swiss Equity A") if i == 0 else None)
    ax.axhline(0, color="#111827", lw=1.3, zorder=0)
    ax.annotate("α = 0", (len(ALL_SPECS) - 0.55, 0), xytext=(0, 3), textcoords="offset points", fontsize=8, ha="right", va="bottom")
    short = {"CAPM": "SIM", "FF3": "FF3", "CARHART": "Carhart", "FF5": "FF5"}
    ax.set_xticks(range(len(ALL_SPECS)), [("CAPM" if (mm, u) == ("CAPM", "EUROPE") else short[mm]) for mm, u in ALL_SPECS], fontsize=8)
    ax.axvline(len(SPECS) - 0.5, color=R.GREY, lw=0.6, ls=":")
    top = ax.get_ylim()[1]
    ax.text((len(SPECS) - 1) / 2, top, "Référence : SPI + facteurs suisses", ha="center", va="bottom", fontsize=7.5, color=R.BLUE)
    ax.text(len(SPECS) + (len(ROBUST) - 1) / 2, top, "Robustesse : Europe", ha="center", va="bottom", fontsize=7.5, color=R.GREY)
    ax.set_ylabel("α annualisé et IC 95 %")
    R._pct_axis(ax)
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.14), ncol=2, fontsize=8)
    fig.savefig(gen / "fig_pair_alphas.pdf")
    plt.close(fig)
    return m
