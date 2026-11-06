"""Présentation vulgarisée (Beamer) : le fonds BCV Swiss Equity A face au SPI,
et le parallèle avec Fama et French (2010).

Usage : python -m pipeline.presentation [--no-compile]

Entrées : public/data/dataset.json, le gabarit report/presentation_fonds.tex.
Sorties :
  report/build/presentation/              sources LaTeX + PDF
  public/report/presentation_fonds.pdf    présentation téléchargeable depuis le site

Comme pour les rapports, le gabarit ne contient que du texte : tous les
chiffres propres au fonds sont calculés ici. Les chiffres de Fama et French
(2010) sont des résultats publiés, écrits dans le gabarit avec leur source.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone

import numpy as np

from . import config as C
from . import olsref
from .report import BLUE, GREY, MOIS, ORANGE, _dates, _git_sha, month_fr, num, pct, setup_matplotlib, tex_escape
from .validate_common import design, required, rows_for

TEMPLATE = C.ROOT / "report" / "presentation_fonds.tex"
BUILD = C.ROOT / "report" / "build" / "presentation"
GEN = BUILD / "generated"
OUT = C.PUBLIC_DATA.parent / "report"
PDF_NAME = "presentation_fonds.pdf"
SITE_URL = "https://cedricmasset.ch/Empirical-Asset-Pricing/"
GREEN = "#2b8a3e"

# Fama et French (2010), portefeuille agrégé (pondéré par les encours) des fonds
# actions américains gérés activement, 1984–2006, modèle à trois facteurs :
# alpha net ≈ −0,8 point par an, alpha brut (frais réajoutés) ≈ +0,1 point.
FF_NET, FF_GROSS = -0.008, 0.001


def _fit(ds: dict, model: str, add: float = 0.0):
    rows = rows_for(ds, required(model, "SPI", "FUND"))
    y, X, dates = design(ds, model, "SPI", rows, "FUND")
    return olsref.fit(y + add, X, "HAC"), y, X, dates


def compute(ds: dict) -> dict:
    ter = C.FUND["ter"]
    sim, y, X, dates = _fit(ds, "CAPM")
    sim_g, *_ = _fit(ds, "CAPM", ter / 12)
    car, *_ = _fit(ds, "CARHART")
    car_g, *_ = _fit(ds, "CARHART", ter / 12)
    if sim.n < 60:
        raise RuntimeError(f"Seulement {sim.n} mois pour le fonds : présentation impossible.")

    # comparaison simple, sans taux sans risque : depuis le début commun fonds/SPI
    D = ds["data"]
    idx = [i for i in range(len(ds["dates"])) if D["fund_ret"][i] is not None and D["spi_ret"][i] is not None]
    # uniquement la plus longue suite de mois consécutifs se terminant au dernier mois
    keys = [ds["dates"][i] for i in idx]
    start = 0
    for t in range(1, len(keys)):
        ya, ma = map(int, keys[t - 1].split("-"))
        yb, mb = map(int, keys[t].split("-"))
        if (yb - ya) * 12 + mb - ma != 1:
            start = t
    idx, keys = idx[start:], keys[start:]
    fr = np.array([D["fund_ret"][i] for i in idx])
    sr = np.array([D["spi_ret"][i] for i in idx])
    return {"sim": sim, "sim_g": sim_g, "car": car, "car_g": car_g, "y": y, "X": X, "dates": dates,
            "long_dates": keys, "fr": fr, "sr": sr, "ter": ter}


def _signif(p: float) -> bool:
    return p < 0.05


def macros(ds: dict, r: dict) -> dict[str, str]:
    sim, sim_g, car, car_g = r["sim"], r["sim_g"], r["car"], r["car_g"]
    fr, sr = r["fr"], r["sr"]
    years = len(fr) / 12
    g_f, g_s = float(np.prod(1 + fr)), float(np.prod(1 + sr))
    cagr_f, cagr_s = g_f ** (1 / years) - 1, g_s ** (1 / years) - 1
    gen = datetime.now(timezone.utc)
    commit = _git_sha()

    a_net, a_gross = 12 * sim.params[0], 12 * sim_g.params[0]
    if _signif(sim.pvalue[0]) and a_net < 0:
        net_lecture = "Un écart aussi régulier ne s'explique pas par le hasard : le fonds a bel et bien rapporté moins que son exposition au marché le laissait attendre."
    elif _signif(sim.pvalue[0]):
        net_lecture = "Le fonds a rapporté davantage que son exposition au marché le laissait attendre, et cet écart ne s'explique pas par le hasard."
    else:
        net_lecture = "Cet écart reste dans ce que le hasard peut produire : on ne peut pas affirmer que le fonds a fait mieux ou moins bien que prévu."
    if not _signif(sim_g.pvalue[0]):
        brut_lecture = "Avant frais, le fonds fait à peu près jeu égal avec le marché : l'écart restant est trop faible pour être distingué du hasard."
        brut_court = "avant frais, ni talent ni maladresse mesurable"
    elif a_gross > 0:
        brut_lecture = "Avant frais, le fonds fait légèrement mieux que le marché, et cet avantage ne s'explique pas par le hasard ; les frais l'absorbent toutefois entièrement."
        brut_court = "avant frais, un léger avantage, absorbé par les frais"
    else:
        brut_lecture = "Même avant frais, le fonds fait moins bien que le marché : les frais n'expliquent pas tout l'écart."
        brut_court = "même avant frais, un retard sur le marché"
    part_frais = r["ter"] / abs(a_net) if a_net < 0 else float("nan")
    if not _signif(sim_g.pvalue[0]):
        ne_peut_pas = "que le gérant manque de talent : avant frais, il fait à peu près jeu égal avec le marché"
        peut_frais = "cet écart correspond pour l'essentiel aux frais"
        retenir3 = "Cet écart vient des frais : avant frais, la performance est proche de celle du marché."
        retenir4 = ("C'est la conclusion de Fama et French (2010) pour l'ensemble des fonds actifs : "
                    "\\textbf{ce sont les frais qui font la différence}.")
    elif a_gross > 0:
        ne_peut_pas = "que le gérant manque de talent : avant frais, il bat légèrement le marché"
        peut_frais = "les frais absorbent plus que la valeur ajoutée par le gérant"
        retenir3 = "Avant frais, le gérant ajoute un peu de valeur, mais les frais l'absorbent entièrement."
        retenir4 = ("Fama et French (2010) observent la même chose chez les rares bons gérants : "
                    "\\textbf{leur talent couvre rarement leurs frais}.")
    else:
        ne_peut_pas = "que les frais expliquent tout : même avant frais, le fonds reste en retard"
        peut_frais = "les frais n'expliquent qu'une partie de cet écart"
        retenir3 = "Même avant frais, le fonds reste en retard sur le marché : les frais n'expliquent pas tout."
        retenir4 = ("Fama et French (2010) trouvent aussi, avant frais, quelques fonds nettement moins bons que le marché : "
                    "\\textbf{la maladresse existe, comme le talent}.")

    first, last = r["dates"][0], r["dates"][-1]
    return {
        "DateRapport": f"{gen.day} {MOIS[gen.month - 1]} {gen.year}",
        "DateDonnees": ds.get("generated_at", "")[:10],
        "Commit": tex_escape(commit[:7] if commit else "inconnu"),
        "URLSite": f"\\url{{{SITE_URL}}}",
        # comparaison simple depuis le lancement
        "LongDebut": month_fr(r["long_dates"][0]),
        "LongFin": month_fr(r["long_dates"][-1]),
        "LongAnnees": num(years, 0),
        "CentFonds": num(100 * g_f, 0),
        "CentSPI": num(100 * g_s, 0),
        "CAGRFonds": pct(cagr_f, 1),
        "CAGRSPI": pct(cagr_s, 1),
        "CAGREcart": num(100 * (cagr_s - cagr_f), 1),
        "MoisGagnants": pct(float(np.mean(fr > sr)), 0),
        # régression (SARON disponible)
        "PeriodeDebut": month_fr(first),
        "PeriodeFin": month_fr(last),
        "NObs": str(sim.n),
        "Annees": num(sim.n / 12, 0),
        "Beta": num(sim.params[1], 2),
        "RDeux": pct(sim.r2, 1),
        "TE": pct(float(np.std(r["y"] - r["X"][:, 1], ddof=1)) * np.sqrt(12), 1),
        "AlphaNet": pct(a_net, 2),
        "AlphaNetT": num(sim.stat[0], 1),
        "AlphaNetP": "moins de 1 sur 1000" if sim.pvalue[0] < 0.001 else f"environ {num(100 * sim.pvalue[0], 1)}~\\%",
        "AlphaNetLecture": net_lecture,
        "AlphaCarNet": pct(12 * car.params[0], 2),
        "AlphaCarNetT": num(car.stat[0], 1),
        "TER": pct(r["ter"], 2),
        "TERDate": month_fr(C.FUND["ter_date"][:7]),
        "AlphaBrut": pct(a_gross, 2),
        "AlphaBrutT": num(sim_g.stat[0], 1),
        "AlphaCarBrut": pct(12 * car_g.params[0], 2),
        "AlphaCarBrutT": num(car_g.stat[0], 1),
        "AlphaBrutLecture": brut_lecture,
        "AlphaBrutCourt": brut_court,
        "PartFrais": pct(part_frais, 0) if np.isfinite(part_frais) else "—",
        "NePeutPas": ne_peut_pas,
        "PeutFrais": peut_frais,
        "RetenirTrois": retenir3,
        "RetenirQuatre": retenir4,
        "FFNet": pct(FF_NET, 1),
        "FFBrut": pct(FF_GROSS, 1),
    }


def write_macros(m: dict[str, str]) -> None:
    lines = ["% Généré par pipeline/presentation.py — ne pas modifier à la main."]
    lines += [f"\\newcommand{{\\{k}}}{{{v}}}" for k, v in m.items()]
    (GEN / "macros.tex").write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_figures(r: dict) -> None:
    plt = setup_matplotlib()
    plt.rcParams.update({"font.size": 10, "axes.titlesize": 10.5})

    # 1. 100 CHF investis depuis le début commun
    d = _dates(r["long_dates"])
    fig, ax = plt.subplots(figsize=(7.4, 3.3))
    for ret, col, lab in ((r["sr"], BLUE, "SPI (marché suisse, dividendes réinvestis)"),
                          (r["fr"], GREEN, "Fonds BCV Swiss Equity A (après frais)")):
        v = np.concatenate([[100.0], 100 * np.cumprod(1 + ret)])
        dd = [d[0] - (d[1] - d[0])] + list(d)
        ax.plot(dd, v, color=col, lw=2, label=lab)
        ax.annotate(f"{num(v[-1], 0)} CHF", (dd[-1], v[-1]), xytext=(5, 0), textcoords="offset points",
                    va="center", fontsize=10, color=col, fontweight="bold")
    ax.set_ylabel("Valeur de 100 CHF (CHF)")
    ax.set_xlim(dd[0], dd[-1] + (dd[-1] - dd[0]) * 0.08)
    ax.legend(loc="upper left", fontsize=9)
    fig.savefig(GEN / "fig_cent.pdf")
    plt.close(fig)

    # 2. le fonds suit le SPI : nuage mensuel
    x, y = 100 * r["X"][:, 1], 100 * r["y"]
    fig, ax = plt.subplots(figsize=(5.6, 3.6))
    lim = [min(x.min(), y.min()) - 1, max(x.max(), y.max()) + 1]
    ax.plot(lim, lim, color=GREY, lw=1, ls="--", label="Copie parfaite du SPI")
    ax.scatter(x, y, s=14, color=GREEN, alpha=0.65, lw=0, label="Un mois")
    ax.set_xlim(lim)
    ax.set_ylim(lim)
    ax.set_aspect("equal")
    ax.set_xlabel("SPI, rendement du mois (% au-delà du SARON)")
    ax.set_ylabel("Fonds (% au-delà du SARON)")
    ax.legend(loc="upper left", fontsize=9)
    fig.savefig(GEN / "fig_suivi.pdf")
    plt.close(fig)

    # 3. de l'alpha net à l'alpha brut : les frais
    a_net, ter = 100 * 12 * r["sim"].params[0], 100 * r["ter"]
    a_gross = 100 * 12 * r["sim_g"].params[0]
    fig, ax = plt.subplots(figsize=(6.4, 3.1))
    ax.bar(0, a_net, color=ORANGE, width=0.6)
    ax.bar(1, ter, bottom=a_net, color="#9ca3af", width=0.6)
    ax.bar(2, a_gross, color=GREEN, width=0.6)
    ax.plot([0.3, 0.7], [a_net, a_net], color=GREY, lw=0.8, ls=":")
    ax.plot([1.3, 1.7], [a_net + ter, a_net + ter], color=GREY, lw=0.8, ls=":")
    for i, v, base in ((0, a_net, 0), (1, ter, a_net), (2, a_gross, 0)):
        top = base + v
        lab = (f"+{num(v, 2)} %" if v >= 0 else f"{num(v, 2)} %")
        ax.annotate(lab, (i, top), xytext=(0, 4 if top >= 0 else -4), textcoords="offset points",
                    ha="center", va="bottom" if top >= 0 else "top", fontsize=10, fontweight="bold")
    ax.axhline(0, color="#111827", lw=1)
    ax.set_xticks([0, 1, 2], ["Alpha après frais\n(ce que reçoit l'investisseur)", "+ frais du fonds\n(TER)", "= alpha avant frais\n(travail du gérant)"])
    ax.set_ylabel("Point de % par an")
    ax.grid(axis="x", visible=False)
    lo = min(a_net, 0) - 0.45
    hi = max(a_net + ter, a_gross, 0) + 0.45
    ax.set_ylim(lo, hi)
    fig.savefig(GEN / "fig_frais.pdf")
    plt.close(fig)

    # 4. parallèle avec Fama et French (2010)
    fig, ax = plt.subplots(figsize=(5.2, 3.5))
    w = 0.36
    groups = [("Après frais", a_net, 100 * FF_NET), ("Avant frais", a_gross, 100 * FF_GROSS)]
    for i, (lab, ours, ff) in enumerate(groups):
        for dx, v, col in ((-w / 2, ours, GREEN), (w / 2, ff, BLUE)):
            ax.bar(i + dx, v, width=w, color=col)
            ax.annotate((f"+{num(v, 1)} %" if v >= 0 else f"{num(v, 1)} %"), (i + dx, v), xytext=(0, 4 if v >= 0 else -4),
                        textcoords="offset points", ha="center", va="bottom" if v >= 0 else "top", fontsize=10, fontweight="bold")
    from matplotlib.patches import Patch

    handles = [Patch(color=GREEN, label=f"Fonds BCV Swiss Equity A ({r['dates'][0][:4]}–{r['dates'][-1][:4]})"),
               Patch(color=BLUE, label="Ensemble des fonds actifs US (Fama-French, 1984–2006)")]
    ax.axhline(0, color="#111827", lw=1)
    ax.set_xticks([0, 1], [g[0] for g in groups])
    ax.set_ylabel("Alpha, point de % par an")
    ax.grid(axis="x", visible=False)
    vals = [v for _, a, b in groups for v in (a, b)]
    ax.set_ylim(min(vals) - 0.45, max(vals) + 0.4)
    ax.legend(handles=handles, loc="upper center", bbox_to_anchor=(0.5, -0.12), fontsize=10, ncol=1)
    fig.savefig(GEN / "fig_ff.pdf")
    plt.close(fig)


def compile_pdf() -> None:
    cmd = ["latexmk", "-xelatex", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "presentation.tex"]
    res = subprocess.run(cmd, cwd=BUILD, capture_output=True, text=True)
    log_path = BUILD / "presentation.log"
    log = log_path.read_text(errors="replace") if log_path.exists() else res.stdout
    if res.returncode != 0:
        errs = [line for line in log.splitlines() if line.startswith("!") or ".tex:" in line]
        raise RuntimeError("Compilation LaTeX échouée :\n" + "\n".join(errs[-20:]))
    missing = sorted({line for line in log.splitlines() if "Missing character" in line})
    if missing:
        raise RuntimeError("Caractères absents de la police :\n" + "\n".join(missing[:10]))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-compile", action="store_true")
    args = ap.parse_args(argv)
    ds = json.loads((C.PUBLIC_DATA / "dataset.json").read_text())
    try:
        shutil.rmtree(BUILD, ignore_errors=True)
        GEN.mkdir(parents=True)
        shutil.copy(TEMPLATE, BUILD / "presentation.tex")
        r = compute(ds)
        m = macros(ds, r)
        write_macros(m)
        write_figures(r)
        if not args.no_compile:
            compile_pdf()
            OUT.mkdir(parents=True, exist_ok=True)
            shutil.copy(BUILD / "presentation.pdf", OUT / PDF_NAME)
        print(f"[présentation] {PDF_NAME} : α net = {m['AlphaNet']}, α brut = {m['AlphaBrut']}, N = {m['NObs']}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[présentation] ÉCHEC {PDF_NAME} : {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
