"""Fonds BCV Swiss Equity A : lecture de la série officielle Gérifonds et contrôles.

La page publique de la classe (gerifonds.ch/fr/iframe/<ISIN>?period=6) contient :
  * un graphique « Évolution de la performance (dividendes réinvestis) » dont les
    points (attribut data-chart) donnent, pour chaque jour de VNI, l'indice de
    performance base 100 et, en infobulle, la VNI ;
  * la performance YTD officielle ;
  * la table des distributions (montants bruts).

Contrôles effectués sur la série :
  1. rapprochement jour par jour : R_TR = (VNI_t + D_t)/VNI_{t−1} − 1, avec D_t la
     distribution brute à la date ex. Le contrôle tolère le décalage d'un jour des
     VNI affichées en infobulle observé depuis septembre 2021 ;
  2. chaque distribution de la table est retrouvée une et une seule fois dans la
     série (montant implicite = montant brut publié) ;
  3. aucun saut inexpliqué (distribution absente de la table) ;
  4. performance YTD recalculée = performance YTD officielle.
"""

from __future__ import annotations

import html as html_lib
import json
import re
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

TOL_RETURN = 5e-5  # tolérance de rapprochement quotidien (VNI arrondies au centime)
TOL_DIST = 0.006  # CHF


@dataclass
class FundPage:
    tr: pd.Series  # indice de performance, dividendes réinvestis
    nav: pd.Series  # VNI affichée en infobulle (peut être décalée d'un jour)
    distributions: pd.Series  # montant brut par date ex
    ytd: float | None = None
    ytd_date: pd.Timestamp | None = None


def parse_page(text: str) -> FundPage:
    charts = re.findall(r'data-chart="([^"]*)"', text)
    if not charts:
        raise ValueError("Graphique de performance (data-chart) introuvable dans la page Gérifonds.")
    points = json.loads(html_lib.unescape(charts[0]))
    rows = []
    for v in points.values():
        date = pd.to_datetime(v[0], format="%d.%m.%Y")
        m = re.search(r"VNI:\s*([\d'.,]+)", v[2] if len(v) > 2 else "")
        nav = float(m.group(1).replace("'", "").replace(",", "")) if m else np.nan
        rows.append((date, float(v[1]), nav))
    df = pd.DataFrame(rows, columns=["date", "tr", "nav"]).drop_duplicates("date", keep="last").set_index("date").sort_index()

    plain = re.sub(r"<[^>]+>", " ", html_lib.unescape(re.sub(r"<script.*?</script>", " ", text, flags=re.S)))
    plain = re.sub(r"\s+", " ", plain)
    ytd = ytd_date = None
    m = re.search(r"Performance YTD\s*(-?[\d.]+)\s*%\s*(\d{2}\.\d{2}\.\d{4})", plain)
    if m:
        ytd, ytd_date = float(m.group(1)) / 100, pd.to_datetime(m.group(2), format="%d.%m.%Y")
    dists: dict[pd.Timestamp, float] = {}
    i = plain.find("Distributions Date")
    if i >= 0:
        for d, gross in re.findall(r"(\d{2}\.\d{2}\.\d{4}) CHF (\d+\.\d+)", plain[i:]):
            dists[pd.to_datetime(d, format="%d.%m.%Y")] = float(gross)
    return FundPage(df["tr"], df["nav"], pd.Series(dists, dtype=float).sort_index(), ytd, ytd_date)


@dataclass
class Reconciliation:
    n_days: int
    matched_share: float
    lag_switch: str | None
    dist_ok: list[tuple[str, float, float]] = field(default_factory=list)
    dist_bad: list[tuple[str, float, float | None]] = field(default_factory=list)
    unexplained: list[str] = field(default_factory=list)


def reconcile(page: FundPage) -> Reconciliation:
    tr, nav = page.tr, page.nav
    D = page.distributions.reindex(tr.index).fillna(0.0)
    r_tr = tr.pct_change()
    errs, implied = {}, {}
    for lag in (0, 1):
        v = nav.shift(-lag)
        rec = (v + D) / v.shift(1) - 1
        errs[lag] = (r_tr - rec).abs()
        implied[lag] = (r_tr - (v / v.shift(1) - 1)) * v.shift(1)  # distribution implicite
    valid = r_tr.notna() & nav.notna()
    best = np.minimum(errs[0].fillna(np.inf), errs[1].fillna(np.inf))
    matched = (best < TOL_RETURN) & valid
    # dernier jour : la VNI décalée n'est pas encore connue
    n = int(valid.iloc[:-1].sum())
    share = float(matched.iloc[:-1].sum() / n) if n else 0.0
    use1 = (errs[1] < errs[0]) & valid
    roll = use1.rolling(20, min_periods=20).mean()
    switch = roll[roll > 0.9].index
    rep = Reconciliation(n, share, str(switch[0].date()) if len(switch) else None)
    for d, gross in page.distributions.items():
        if d not in tr.index or d == tr.index[0]:
            continue
        cands = [implied[0].get(d), implied[1].get(d)]
        cands = [c for c in cands if c is not None and np.isfinite(c)]
        best_c = min(cands, key=lambda c: abs(c - gross)) if cands else None
        if best_c is not None and abs(best_c - gross) < TOL_DIST:
            rep.dist_ok.append((str(d.date()), gross, round(best_c, 4)))
        else:
            rep.dist_bad.append((str(d.date()), gross, None if best_c is None else round(best_c, 4)))
    # sauts non expliqués : écart TR − VNI significatif un jour sans distribution publiée
    no_dist = D == 0
    gap = np.minimum((implied[0]).abs().fillna(np.inf), (implied[1]).abs().fillna(np.inf))
    not_last = pd.Series(True, index=tr.index)
    not_last.iloc[-1] = False
    jumps = gap[(gap > 0.05) & no_dist & valid & ~matched & not_last]
    rep.unexplained = [str(d.date()) for d in jumps.index[:20]]
    return rep


def ytd_check(page: FundPage) -> tuple[float, float] | None:
    """(YTD recalculé, YTD officiel) à la date officielle."""
    if page.ytd is None or page.ytd_date not in page.tr.index:
        return None
    prev_year_end = page.tr[page.tr.index < pd.Timestamp(year=page.ytd_date.year, month=1, day=1)]
    if prev_year_end.empty:
        return None
    return float(page.tr.loc[page.ytd_date] / prev_year_end.iloc[-1] - 1), page.ytd
