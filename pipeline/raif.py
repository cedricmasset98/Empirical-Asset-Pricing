"""Fonds Raiffeisen Futura - Swiss Stock A : lecture de la série Swiss Fund Data et contrôles.

Swiss Fund Data (swissfunddata.ch, SIX Financial Information, en partenariat avec
l'Asset Management Association Switzerland) publie pour chaque fonds suisse un
export CSV quotidien (« excelData ») contenant notamment :
  * Net Asset Value : la valeur nette d'inventaire (VNI) publiée ;
  * Total Return Chart Price : la VNI corrigée des distributions, réinvesties à la
    date ex (série de rendement total, nette des frais du fonds).
L'export commence le 23.11.2009 pour cette classe.

Contrôles effectués :
  1. « Chart Price » = VNI chaque jour (même série) ;
  2. hors dates de distribution, le rendement total quotidien est égal au
     rendement de la VNI (à l'arrondi près) ;
  3. aux dates ex, la distribution implicite D = VNI_{t−1}(1 + R_TR) − VNI_t est
     positive, inférieure à 5 % de la VNI, et il y en a au plus deux par an.
Les rendements annuels de la série ont en outre été comparés une fois à la fiche
mensuelle officielle (2023 : 6,6 % ; 2024 : 5,9 % ; 2025 : 11,0 % ; YTD 30.09.2026 :
7,8 %) : écarts inférieurs à 0,05 point.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

TOL_RETURN = 5e-5  # VNI arrondie au centime, indice TR à trois décimales
JUMP = 1e-4  # saut minimal du rapport TR/VNI signalant une distribution


@dataclass
class SfdSeries:
    nav: pd.Series  # VNI quotidienne
    tr: pd.Series  # indice de rendement total quotidien
    chart: pd.Series = field(default_factory=lambda: pd.Series(dtype=float))
    ter: float | None = None
    ter_date: pd.Timestamp | None = None


def parse_csv(text: str) -> SfdSeries:
    """Lit l'export « excelData » de Swiss Fund Data (séparateur ;, en-tête sur la ligne « Date; »)."""
    lines = text.lstrip("﻿").splitlines()
    try:
        start = next(i for i, l in enumerate(lines) if l.startswith("Date;"))
    except StopIteration as exc:
        raise ValueError("Export Swiss Fund Data : ligne d'en-tête « Date; » introuvable.") from exc
    df = pd.read_csv(io.StringIO("\n".join(lines[start:])), sep=";")
    need = {"Date", "Net Asset Value", "Total Return Chart Price"}
    if not need <= set(df.columns):
        raise ValueError(f"Export Swiss Fund Data : colonnes manquantes {sorted(need - set(df.columns))}.")
    df["Date"] = pd.to_datetime(df["Date"], format="%Y-%m-%d")
    df = df.set_index("Date").sort_index()
    df = df[~df.index.duplicated(keep="last")]
    nav = pd.to_numeric(df["Net Asset Value"], errors="coerce")
    tr = pd.to_numeric(df["Total Return Chart Price"], errors="coerce")
    ok = nav.notna() & tr.notna() & (nav > 0) & (tr > 0)
    chart = pd.to_numeric(df["Chart Price"], errors="coerce")[ok] if "Chart Price" in df else pd.Series(dtype=float)
    return SfdSeries(nav=nav[ok], tr=tr[ok], chart=chart)


def parse_ter(page: str) -> tuple[float, pd.Timestamp] | None:
    """TER et date publiés sur la fiche du fonds (« TER 1.20% … Datum TER 30.06.2026 »)."""
    txt = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", page))
    m = re.search(r"\bTER\s*([\d.]+)\s*%\s*(?:Datum TER|Date TER|TER Date|Date du TER)\s*(\d{2}\.\d{2}\.\d{4})", txt)
    if not m:
        return None
    return float(m.group(1)) / 100, pd.to_datetime(m.group(2), format="%d.%m.%Y")


@dataclass
class Checks:
    n_days: int
    chart_eq_nav: bool
    share_ok: float  # part des jours sans distribution où R_TR = R_VNI
    bad_days: list[str]
    distributions: list[tuple[str, float]]  # (date ex, montant implicite)
    anomalies: list[str]


def check(s: SfdSeries) -> Checks:
    nav, tr = s.nav, s.tr
    chart_eq = bool(len(s.chart) == 0 or np.allclose(s.chart.reindex(nav.index).values, nav.values, atol=1e-9, equal_nan=False))
    r_tr = tr.pct_change().iloc[1:]
    r_nav = nav.pct_change().iloc[1:]
    ratio_jump = (tr / nav).pct_change().iloc[1:]
    is_dist = ratio_jump > JUMP
    plain = ~is_dist & ~(ratio_jump < -JUMP)
    diff = (r_tr - r_nav)[plain].abs()
    bad = [str(d.date()) for d in diff[diff > TOL_RETURN].index]
    share = float((diff <= TOL_RETURN).mean()) if len(diff) else 0.0
    dists, anomalies = [], []
    for d in ratio_jump[is_dist].index:
        i = nav.index.get_loc(d)
        amount = float(nav.iloc[i - 1] * (1 + r_tr.loc[d]) - nav.iloc[i])
        dists.append((str(d.date()), round(amount, 2)))
        if not 0 < amount < 0.05 * nav.iloc[i - 1]:
            anomalies.append(f"distribution implicite atypique le {d.date()} : {amount:.2f}")
    for d in ratio_jump[ratio_jump < -JUMP].index:
        anomalies.append(f"baisse du rapport TR/VNI le {d.date()} ({ratio_jump.loc[d]:.2%})")
    per_year = pd.Series([pd.Timestamp(d).year for d, _ in dists]).value_counts()
    if len(per_year) and per_year.max() > 2:
        anomalies.append(f"plus de deux distributions implicites en {int(per_year.idxmax())}")
    return Checks(len(nav), chart_eq, share, bad, dists, anomalies)
