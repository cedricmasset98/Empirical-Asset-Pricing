"""Transformations pures (testées dans pipeline/tests) : agrégation mensuelle,
rendements, capitalisation du SARON, lecture des fichiers Fama-French et
conversion des facteurs en CHF. Aucune interpolation des valeurs manquantes."""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass

import numpy as np
import pandas as pd


# --------------------------------------------------------------- agrégation mensuelle

@dataclass
class MonthlyLevels:
    values: pd.Series  # index PeriodIndex('M'), dernier niveau du mois
    last_date: pd.Series  # date de la dernière observation du mois
    stale: list[str]  # mois écartés (dernière observation trop éloignée de la fin de mois)


def month_end_levels(daily: pd.Series, max_gap_days: int, last_complete: pd.Period) -> MonthlyLevels:
    """Dernière observation de chaque mois calendaire. Un mois est écarté si sa
    dernière observation précède la fin du mois de plus de `max_gap_days` jours,
    ou s'il n'est pas encore terminé (> last_complete)."""
    s = daily.dropna()
    s = s[~s.index.duplicated(keep="last")].sort_index()
    if s.empty:
        return MonthlyLevels(pd.Series(dtype=float), pd.Series(dtype="datetime64[ns]"), [])
    periods = s.index.to_period("M")
    df = pd.DataFrame({"v": s.values, "d": s.index}, index=periods)
    last = df.groupby(level=0).last()
    month_end = last.index.to_timestamp(how="end").normalize()
    gap = (month_end - pd.DatetimeIndex(last["d"])).days
    stale_mask = np.asarray(gap > max_gap_days)
    stale = [str(p) for p in last.index[stale_mask]]
    keep = ~stale_mask & np.asarray(last.index <= last_complete)
    last = last[keep]
    # le premier mois peut être partiel en début de série : il ne sert que de
    # niveau de départ (le rendement est mesuré d'une fin de mois à la suivante).
    return MonthlyLevels(last["v"].astype(float), last["d"], stale)


def simple_returns(levels: pd.Series) -> pd.Series:
    """R_t = P_t / P_{t−1} − 1 sur des mois consécutifs uniquement : un mois
    manquant rend NaN les deux rendements adjacents (jamais de rendement
    multi-mois présenté comme mensuel)."""
    if levels.empty:
        return levels
    idx = pd.period_range(levels.index.min(), levels.index.max(), freq="M")
    full = levels.reindex(idx)
    return (full / full.shift(1) - 1).iloc[1:]


# --------------------------------------------------------------- SARON

def saron_index(daily_rate_pct: pd.Series) -> tuple[pd.Series, list[str]]:
    """Indice capitalisé du SARON (convention ACT/360) :
        I_{d_{i+1}} = I_{d_i} × (1 + r_i/100 × n_i/360),
    où n_i est le nombre de jours calendaires jusqu'au fixing suivant (le taux
    du vendredi court donc sur le week-end). Retourne l'indice aux dates de
    fixing et la liste des écarts anormaux (> 5 jours) entre fixings."""
    r = daily_rate_pct.dropna().sort_index()
    r = r[~r.index.duplicated(keep="last")]
    dates = pd.DatetimeIndex(r.index)
    n_days = np.diff(dates.values).astype("timedelta64[D]").astype(int)
    growth = 1 + r.values[:-1] / 100 * n_days / 360
    idx = np.concatenate([[1.0], np.cumprod(growth)])
    warnings = [f"{dates[i].date()}→{dates[i + 1].date()} ({n_days[i]} j)" for i in np.where(n_days > 5)[0]]
    return pd.Series(idx, index=dates), warnings


def saron_monthly_returns(daily_rate_pct: pd.Series, max_gap_days: int, last_complete: pd.Period) -> tuple[pd.Series, list[str], list[str]]:
    """Rendement sans risque réalisé de chaque mois = I(fin m) / I(fin m−1) − 1,
    l'indice étant pris au dernier fixing du mois (même convention de date que
    les cours de clôture)."""
    index, gaps = saron_index(daily_rate_pct)
    lv = month_end_levels(index, max_gap_days, last_complete)
    return simple_returns(lv.values), lv.stale, gaps


# --------------------------------------------------------------- Fama-French

def parse_french_csv(text: str) -> pd.DataFrame:
    """Lit le premier bloc mensuel (dates AAAAMM) d'un fichier CSV de la
    Kenneth French Data Library. Les valeurs, publiées en %, sont converties en
    décimal ; -99.99 / -999 sont des valeurs manquantes."""
    rows = list(csv.reader(io.StringIO(text)))
    header: list[str] | None = None
    data: list[list[str]] = []
    started = False
    for row in rows:
        cells = [c.strip() for c in row]
        if not any(cells):
            if started:
                break
            continue
        first = cells[0]
        if len(first) == 6 and first.isdigit():
            started = True
            data.append(cells)
        elif started:
            break
        elif first == "" and len(cells) > 1:
            header = cells[1:]
    if header is None or not data:
        raise ValueError("Bloc mensuel introuvable dans le fichier Fama-French.")
    idx = pd.PeriodIndex([pd.Period(year=int(r[0][:4]), month=int(r[0][4:]), freq="M") for r in data])
    values = np.array([[float(v) for v in r[1 : 1 + len(header)]] for r in data])
    df = pd.DataFrame(values, index=idx, columns=header)
    df = df.mask(df <= -99.99)
    return df / 100


# --------------------------------------------------------------- conversion en CHF

def fx_returns(levels_chf_per_usd: pd.Series) -> pd.Series:
    """s_t = X_t / X_{t−1} − 1, X = CHF par USD en fin de mois (gain d'un
    investisseur CHF détenant 1 USD)."""
    return simple_returns(levels_chf_per_usd)


def convert_market_to_chf(mkt_rf_usd: pd.Series, rf_us: pd.Series, fx_ret: pd.Series) -> pd.Series:
    """Rendement total du marché européen en CHF :
        R_M^USD = (Mkt−RF) + RF_US ;  R_M^CHF = (1 + R_M^USD)(1 + s) − 1.
    Le rendement excédentaire en CHF s'obtient ensuite en soustrayant le SARON."""
    r_usd = mkt_rf_usd + rf_us
    return (1 + r_usd) * (1 + fx_ret) - 1


def convert_long_short_to_chf(factor_usd: pd.Series, fx_ret: pd.Series) -> pd.Series:
    """Facteur long-short en CHF. Chaque jambe se convertit par
    (1 + R^CHF) = (1 + R^USD)(1 + s), d'où
        F^CHF = R_L^CHF − R_S^CHF = (R_L^USD − R_S^USD)(1 + s) = F^USD (1 + s).
    Le résultat est exact : le portefeuille autofinancé n'a pas d'exposition
    au change hormis ce terme croisé. Aucun taux sans risque n'intervient."""
    return factor_usd * (1 + fx_ret)
