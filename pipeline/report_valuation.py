"""Rapport « Comment la BCV gère-t-elle ses fonds en actions suisses ? »

Processus de gestion actions suisses décrit par la BCV (brochure « Gestion actions
suisses », janvier 2021) : scénario macroéconomique, analyses qualitative,
fondamentale (modèle Edwards-Bell-Ohlson, illustré sur des exemples FICTIFS) et
comportementale, gestion du risque. Il est confronté à la performance mesurée du
fonds BCV Swiss Equity A (Single Index Model contre le SPI, Newey-West ; exposition
au momentum par le modèle de Carhart). Les chiffres d'exemple sont calculés ici ;
ceux du fonds proviennent des données, comme dans les autres rapports.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np

from . import config as C
from . import report as R

# Exemple illustratif (entreprise fictive)
EX = {"B": 100.0, "ROE": 0.15, "RE": 0.10, "PRIX": 120.0}


def ebo_perpetual(b: float, roe: float, re: float) -> float:
    """V0 = B0 + RI/re avec bénéfice résiduel constant RI = (ROE − re)·B0 (fonds propres constants)."""
    return b + (roe - re) * b / re


def compute_valuation(ds: dict) -> dict:
    r = R.compute(ds, "FUND")
    # TER lu sur la page Gérifonds lors de la construction des données ; à défaut,
    # valeur documentée dans la configuration.
    info = ds.get("fund_info") or {k: C.FUND[k] for k in ("ter", "ter_date") if k in C.FUND}
    # Carhart de référence (site) : SPI TR et facteurs suisses, momentum JKP (ret_12_1)
    car = next((c for c in r["comp"] if c["model"] == "CARHART" and c["universe"] == "SWISS"), None)
    if car is not None:
        _, Xc, dc, _ = R.sample(ds, "CARHART", "SWISS", asset="FUND")
        keep = set(car["dates"])
        car = {**car, "mom_mean": float(np.mean([Xc[i, 4] for i, d in enumerate(dc) if d in keep]))}
    return {"fund": r, "info": info, "carhart": car}


def write_valuation(ds: dict, res: dict, gen: Path) -> dict[str, str]:
    num, pct, peq = R.num, R.pct, R.peq
    r = res["fund"]
    f = r["main"]
    a, b = f.params
    se_m = f.se[0]
    te = f.sigma * math.sqrt(12)  # écart de suivi approché : volatilité résiduelle annualisée
    B, ROE, RE, PRIX = EX["B"], EX["ROE"], EX["RE"], EX["PRIX"]
    V = ebo_perpetual(B, ROE, RE)
    re_impl = ROE * B / PRIX  # rendement exigé qui égalise valeur et prix
    m = {
        "DateRapport": R.date_fr(),
        "DateDonnees": ds.get("generated_at", "")[:10],
        "Commit": R.tex_escape((R.os.environ.get("GITHUB_SHA") or R._git_sha())[:7] or "inconnu"),
        "URLSite": f"\\url{{{R.SITE_URL}}}",
        # exemple fictif
        "ExB": num(B, 0), "ExROE": f"{num(100 * ROE, 0)}~\\%", "ExRe": f"{num(100 * RE, 0)}~\\%",
        "ExNI": num(ROE * B, 0), "ExRI": num((ROE - RE) * B, 0), "ExV": num(V, 0), "ExPrix": num(PRIX, 0),
        "ExPotentiel": f"{num(100 * (V / PRIX - 1), 0)}~\\%", "ExPB": num(V / B, 1), "ExPE": num(V / (ROE * B), 0),
        "ExPBMarche": num(PRIX / B, 1), "ExPEMarche": num(PRIX / (ROE * B), 0),
        "ExReImpl": f"{num(100 * re_impl, 1)}~\\%",
        "ExVNeuf": num(ebo_perpetual(B, ROE, 0.09), 0), "ExVOnze": num(ebo_perpetual(B, ROE, 0.11), 0),
        "ExVDouze": num(ebo_perpetual(B, ROE, 0.12), 0),
        # fonds
        "PeriodeDebut": R.month_fr(r["dates"][0]), "PeriodeFin": R.month_fr(r["dates"][-1]), "NObs": str(f.n),
        "Annees": num(f.n / 12, 1),
        "FdsBeta": num(b, 2), "FdsRDeuxPct": f"{num(100 * f.r2, 1)}~\\%", "FdsTE": pct(te, 1),
        "FdsAlphaA": pct(12 * a, 2), "FdsAlphaLo": pct(12 * f.ci_low[0], 2), "FdsAlphaHi": pct(12 * f.ci_high[0], 2),
        "FdsZ": num(f.stat[0], 2), "FdsPEq": peq(f.pvalue[0]), "FdsVerdict": R.verdict(f.pvalue[0]),
        "IRNet": num(12 * a / te, 2),
        "RendFonds": pct(float(np.prod(1 + r["bcv"])) ** (12 / f.n) - 1, 2),
        "RendSPI": pct(float(np.prod(1 + r["spi"])) ** (12 / f.n) - 1, 2),
        "RelFinal": num(100 * float(np.prod(1 + r["bcv"]) / np.prod(1 + r["spi"])), 1),
    }
    ter = res["info"].get("ter")
    if ter is not None:
        gross = 12 * a + ter
        z = gross / (12 * se_m)
        m.update({"TER": pct(ter, 2), "TERDate": R.month_fr(res["info"]["ter_date"][:7]) if res["info"].get("ter_date") else "",
                  "AlphaBrutA": pct(gross, 2), "AlphaBrutZ": num(z, 1), "IRBrut": num(gross / te, 2)})
        if gross > 0 and z >= 1.96:
            brut = (f"En ajoutant le TER actuel ({pct(ter, 2)}) à l'alpha net, on obtient un alpha avant frais d'environ {pct(gross, 2)} par an. "
                    f"Avec la même précision que l'alpha net, cet écart serait statistiquement distinct de zéro (statistique d'environ {num(z, 1)}). "
                    "La gestion semble donc avoir produit un petit surcroît de rendement avant frais, mais inférieur aux frais prélevés.")
        elif gross > 0:
            brut = (f"En ajoutant le TER actuel ({pct(ter, 2)}) à l'alpha net, on obtient un alpha avant frais d'environ {pct(gross, 2)} par an, "
                    f"positif mais pas statistiquement distinct de zéro (statistique d'environ {num(z, 1)}).")
        else:
            brut = (f"Même en ajoutant le TER actuel ({pct(ter, 2)}), l'alpha avant frais resterait d'environ {pct(gross, 2)} par an : "
                    "la gestion n'aurait pas produit de surcroît de rendement mesurable avant frais.")
        m["BrutPhrase"] = brut + " Ce calcul suppose un TER constant sur toute la période ; il est donc indicatif."
        m["TERPhrase"] = f"Le TER (Total Expense Ratio) publié par Gérifonds est de {pct(ter, 2)} ({m['TERDate']})."
    else:
        m.update({"TER": "—", "TERDate": "", "AlphaBrutA": "—", "AlphaBrutZ": "—", "IRBrut": "—"})
        m["BrutPhrase"] = "Le TER du fonds n'étant pas disponible dans les données, l'alpha avant frais n'est pas estimé."
        m["TERPhrase"] = "Le TER du fonds n'est pas disponible dans les données."
    car = res.get("carhart")
    if car is not None:
        cf = car["fit"]
        k = 4  # constante, MKT, SMB, HML, MOM
        mom, p_mom = cf.params[k], cf.pvalue[k]
        contrib = 12 * mom * car["mom_mean"]
        m.update({"CarMom": num(mom, 3), "CarMomZ": num(cf.stat[k], 2), "CarMomPEq": peq(p_mom),
                  "CarAlphaA": pct(12 * cf.params[0], 2), "CarN": str(cf.n),
                  "CarAlphaVerdict": R.verdict(cf.pvalue[0])})
        if p_mom < 0.05 and mom > 0:
            ph = (f"Le modèle de Carhart attribue au fonds une exposition au momentum positive et statistiquement significative "
                  f"(coefficient {num(mom, 3)}, $z$ = {num(cf.stat[k], 2)}), ce qui va dans le sens d'un suivi des tendances")
            ph += (", mais elle est très faible : le fonds se comporte comme s'il détenait, en plus du marché, "
                   f"{num(100 * mom, 1)}~\\% d'un portefeuille momentum." if abs(mom) < 0.1 else ".")
        elif p_mom < 0.05:
            ph = (f"Le modèle de Carhart attribue au fonds une exposition au momentum négative et statistiquement significative "
                  f"(coefficient {num(mom, 3)}, $z$ = {num(cf.stat[k], 2)}) : le portefeuille penche plutôt contre les tendances récentes.")
        else:
            ph = (f"Le modèle de Carhart ne détecte pas d'exposition significative au momentum (coefficient {num(mom, 3)}, "
                  f"$z$ = {num(cf.stat[k], 2)}) : le suivi des tendances ne laisse pas de trace mesurable dans les rendements du fonds.")
        m["CarMomPrime"] = pct(12 * car["mom_mean"], 1)
        m["CarMomContrib"] = pct(contrib, 2)
        m["MomPhrase"] = ph
        m["MomCourt"] = ("avec une légère exposition au momentum, cohérente avec l'analyse comportementale" if p_mom < 0.05 and mom > 0
                         else "sans exposition positive mesurable au momentum")
    else:
        m.update({"CarMom": "—", "CarMomZ": "—", "CarMomPEq": "—", "CarAlphaA": "—", "CarN": "—", "CarAlphaVerdict": "—",
                  "CarMomPrime": "—", "CarMomContrib": "—"})
        m["MomPhrase"] = "Les facteurs nécessaires au modèle de Carhart ne sont pas disponibles : l'exposition au momentum n'est pas estimée."
        m["MomCourt"] = "son exposition au momentum n'étant pas estimée faute de données"
    m["TensionPhrase"] = (
        "Le fonds se comporte presque exactement comme son indice" if f.r2 >= 0.95
        else "Le fonds s'écarte sensiblement de son indice")
    lines = ["% Généré par pipeline/report_valuation.py — ne pas modifier à la main."] + [f"\\newcommand{{\\{k}}}{{{v}}}" for k, v in m.items()]
    (gen / "macros.tex").write_text("\n".join(lines) + "\n", encoding="utf-8")
    R.write_sources(ds, gen)

    # figures
    plt = R.setup_matplotlib()
    res_ = np.linspace(0.07, 0.15, 200)
    vals = np.array([ebo_perpetual(B, ROE, x) for x in res_])
    fig, ax = plt.subplots(figsize=(6.0, 2.8))
    ax.plot(100 * res_, vals, color=R.BLUE, lw=2, label="Valeur intrinsèque EBO")
    ax.axhline(PRIX, color=R.ORANGE, lw=1.6, ls="--", label=f"Prix de marché ({num(PRIX, 0)} CHF)")
    ax.plot([100 * RE], [V], "o", color=R.BLUE, ms=6)
    ax.annotate(f"r = {num(100 * RE, 0)} % → {num(V, 0)} CHF", (100 * RE, V), xytext=(10, 8), textcoords="offset points", fontsize=8)
    ax.plot([100 * re_impl], [PRIX], "o", color=R.ORANGE, ms=6)
    ax.annotate(f"valeur = prix si r = {num(100 * re_impl, 1)} %", (100 * re_impl, PRIX), xytext=(-5, 12), textcoords="offset points", fontsize=8, ha="center")
    ax.set_xlabel("Rendement exigé par les actionnaires r (%)")
    ax.set_ylabel("CHF par action")
    R._pct_axis(ax, "x")
    ax.legend(loc="upper right", fontsize=8)
    fig.savefig(gen / "fig_val_sensibilite.pdf")
    plt.close(fig)

    d = R._dates(r["dates"])
    rel = 100 * np.cumprod(1 + r["bcv"]) / np.cumprod(1 + r["spi"])
    fig, ax = plt.subplots(figsize=(6.0, 2.5))
    ax.plot(d, rel, color="#2b8a3e", lw=1.8)
    ax.axhline(100, color="#111827", lw=1)
    ax.set_ylabel("Fonds / SPI (base 100)")
    ax.annotate(f"{num(rel[-1], 1)}", (d[-1], rel[-1]), xytext=(4, 0), textcoords="offset points", va="center", fontsize=8, color="#2b8a3e")
    fig.savefig(gen / "fig_val_relatif.pdf")
    plt.close(fig)
    return m
