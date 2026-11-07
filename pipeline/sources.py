"""Récupération des séries brutes. Chaque fonction retourne (données, info) ;
en cas d'échec, données = None et info["status"] = "error" avec un message
explicite (jamais de valeur de substitution).

Fichiers d'import manuel (prioritaires s'ils existent, cf. data/manual/README.md) :
  bcv_daily.csv       date,adj_close            (cours ajusté dividendes + splits)
  spi_tr_daily.csv    date,spi_tr               (SPI Total Return, niveau)
  saron_daily.csv     date,rate_pct             (fixing SARON en % annualisé)
  usdchf_daily.csv    date,chf_per_usd
  Europe_3_Factors.csv / Europe_5_Factors.csv / Europe_Mom_Factor.csv (format French)
"""

from __future__ import annotations

import io
import json
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import pandas as pd
import requests

from . import config as C
from .transform import splice_history

Info = dict[str, Any]


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _retry(fn: Callable[[], Any], attempts: int = 3, wait: float = 5.0) -> Any:
    last: Exception | None = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001
            last = exc
            if i < attempts - 1:
                time.sleep(wait * (i + 1))
    assert last is not None
    raise last


def _get(url: str, timeout: float = 60, **kw: Any) -> requests.Response:
    r = requests.get(url, headers=C.HTTP_HEADERS, timeout=timeout, **kw)
    r.raise_for_status()
    return r


def _coverage(idx: pd.Index) -> list[str] | None:
    if len(idx) == 0:
        return None
    return [str(pd.Timestamp(idx.min()).date()), str(pd.Timestamp(idx.max()).date())]


def _manual_csv(name: str, value_col: str) -> pd.Series | None:
    path = C.MANUAL_DIR / name
    if not path.exists():
        return None
    return _read_level_csv(path, value_col)


def _read_level_csv(path: Path, value_col: str) -> pd.Series:
    df = pd.read_csv(path)
    if "date" not in df.columns or value_col not in df.columns:
        raise ValueError(f"{path.name} : colonnes attendues 'date' et '{value_col}'.")
    s = pd.Series(pd.to_numeric(df[value_col], errors="coerce").values, index=pd.to_datetime(df["date"]))
    return s.dropna().sort_index()


def _save_raw(name: str, obj: pd.Series | pd.DataFrame) -> None:
    C.RAW_DIR.mkdir(parents=True, exist_ok=True)
    obj.to_csv(C.RAW_DIR / name)


# --------------------------------------------------------------------- Yahoo

def yahoo_history(ticker: str) -> pd.DataFrame:
    import yfinance as yf

    def run() -> pd.DataFrame:
        h = yf.Ticker(ticker).history(period="max", interval="1d", auto_adjust=False, actions=True)
        if h is None or h.empty:
            raise RuntimeError(f"Aucune donnée renvoyée par Yahoo Finance pour {ticker}.")
        h = h.copy()
        h.index = pd.to_datetime(pd.Index(h.index).map(lambda d: d.date()))
        return h

    return _retry(run)


def fetch_bcv() -> tuple[pd.DataFrame | None, Info]:
    """Cours BCV : Close (ajusté des splits) et Adj Close (ajusté des splits et
    des dividendes), dividendes et splits."""
    info: Info = {
        "id": "bcv", "name": "BCV (BCVN.SW) — cours ajustés dividendes et opérations sur titres",
        "provider": "Yahoo Finance via yfinance", "url": "https://finance.yahoo.com/quote/BCVN.SW/history",
        "license": C.LICENSES["yahoo"], "columns": ["bcv_ret"], "retrieved_at": _now(),
    }
    try:
        manual = _manual_csv("bcv_daily.csv", "adj_close")
        if manual is not None:
            info.update(status="manual", provider="Import manuel data/manual/bcv_daily.csv", coverage=_coverage(manual.index))
            return pd.DataFrame({"Adj Close": manual}), info
        h = yahoo_history(C.YAHOO_BCV)
        _save_raw("bcv_daily.csv", h)
        info.update(status="ok", coverage=_coverage(h.index))
        return h, info
    except Exception as exc:  # noqa: BLE001
        info.update(status="error", message=f"{type(exc).__name__}: {exc}")
        return None, info


def fetch_spi_tr() -> tuple[pd.Series | None, Info]:
    info: Info = {
        "id": "spi", "name": "SPI — Swiss Performance Index (SXGE), indice de performance (TR), CHF",
        "provider": "Yahoo Finance via yfinance (^SSHI)", "url": "https://finance.yahoo.com/quote/%5ESSHI/history",
        "license": C.LICENSES["six"] + " " + C.LICENSES["yahoo"], "columns": ["spi_ret"], "retrieved_at": _now(),
    }
    try:
        manual = _manual_csv("spi_tr_daily.csv", "spi_tr")
        if manual is not None:
            info.update(status="manual", provider="Import manuel data/manual/spi_tr_daily.csv", coverage=_coverage(manual.index))
            return manual, info
        h = yahoo_history(C.YAHOO_SPI_TR)
        _save_raw("spi_daily.csv", h)
        s = h["Close"].astype(float)
        info.update(status="ok", coverage=_coverage(s.index))
        hist_path = C.HISTORY_DIR / C.SPI_TR_HISTORY
        if hist_path.exists():
            hist = _read_level_csv(hist_path, "spi_tr")
            sp = splice_history(hist, s)
            info["splice"] = {"ok": sp.ok, "message": sp.message, "file": f"data/history/{C.SPI_TR_HISTORY}"}
            if sp.ok:
                s = sp.series
                info.update(coverage=_coverage(s.index),
                            provider=f"{info['provider']} ; avant le {sp.junction.date()} : historique data/history/{C.SPI_TR_HISTORY}")
        return s, info
    except Exception as exc:  # noqa: BLE001
        info.update(status="error", message=f"{type(exc).__name__}: {exc}")
        return None, info


def fetch_smi_price() -> pd.Series | None:
    """SMI (indice de prix), uniquement pour le contrôle de plausibilité."""
    try:
        return yahoo_history(C.YAHOO_SMI_PRICE)["Close"].astype(float)
    except Exception:  # noqa: BLE001
        return None


# --------------------------------------------------------------------- SARON (BNS)

def _find_saron_items(node: Any, path: list[str] | None = None) -> list[tuple[str, str, str]]:
    """Parcourt la structure de dimensions BNS et retourne (dim_id, item_id, nom)."""
    out: list[tuple[str, str, str]] = []
    if isinstance(node, dict):
        dims = node.get("dimensions")
        if isinstance(dims, list):
            for d in dims:
                did = d.get("id", "")
                for item_id, name in _walk_items(d.get("dimensionItems", [])):
                    out.append((did, item_id, name))
    return out


def _walk_items(items: list[Any]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for it in items or []:
        if isinstance(it, dict):
            if "id" in it and "name" in it:
                out.append((str(it["id"]), str(it["name"])))
            out.extend(_walk_items(it.get("dimensionItems", [])))
    return out


def parse_snb_csv(text: str) -> pd.DataFrame:
    """CSV BNS : en-tête de métadonnées, puis "Date";"D0";...;"Value"."""
    lines = text.splitlines()
    start = next(i for i, l in enumerate(lines) if l.replace('"', "").split(";")[0].strip() == "Date")
    df = pd.read_csv(io.StringIO("\n".join(lines[start:])), sep=";", dtype=str)
    df.columns = [c.strip().strip('"') for c in df.columns]
    df["Value"] = pd.to_numeric(df["Value"], errors="coerce")
    return df


def fetch_saron() -> tuple[pd.Series | None, Info]:
    info: Info = {
        "id": "saron", "name": "SARON — fixing quotidien (taux overnight annualisé, %)",
        "provider": "Banque nationale suisse, data.snb.ch (cube snbgwdzid) ; administrateur : SIX Index AG",
        "url": "https://data.snb.ch/en/topics/ziredev/cube/snbgwdzid",
        "license": C.LICENSES["snb"] + " " + C.LICENSES["six"], "columns": ["rf_saron"], "retrieved_at": _now(),
    }
    try:
        manual = _manual_csv("saron_daily.csv", "rate_pct")
        if manual is not None:
            info.update(status="manual", provider="Import manuel data/manual/saron_daily.csv", coverage=_coverage(manual.index))
            return manual, info
        dims = _retry(lambda: _get(C.SNB_DIMENSIONS_URL).json())
        items = _find_saron_items(dims)
        candidates = [(d, i, n) for d, i, n in items if "SARON" in n.upper() and "COMPOUND" not in n.upper()]
        if not candidates:
            raise RuntimeError(f"Série SARON introuvable dans le cube {C.SNB_CUBE} : {json.dumps(items)[:400]}")
        dim_id, item_id, item_name = candidates[0]
        # sans fromDate, l'API ne renvoie que les observations les plus récentes
        params = {"dimSel": f"{dim_id}({item_id})", "fromDate": C.SNB_FROM_DATE}
        text = _retry(lambda: _get(C.SNB_DATA_URL, params=params).text)
        df = parse_snb_csv(text)
        if dim_id in df.columns:
            df = df[df[dim_id] == item_id]
        s = pd.Series(df["Value"].values, index=pd.to_datetime(df["Date"])).dropna().sort_index()
        if s.empty:
            raise RuntimeError("Série SARON vide.")
        _save_raw("saron_daily.csv", s.rename("rate_pct"))
        info.update(status="ok", coverage=_coverage(s.index), message=f"Série BNS {dim_id}({item_id}) « {item_name} »")
        return s, info
    except Exception as exc:  # noqa: BLE001
        info.update(status="error", message=f"{type(exc).__name__}: {exc}")
        return None, info


# --------------------------------------------------------------------- Fama-French

def fetch_french(key: str) -> tuple[str | None, Info]:
    labels = {"ff3": "European Fama-French 3 Factors", "ff5": "European Fama-French 5 Factors", "mom": "European Momentum Factor"}
    manual_names = {"ff3": "Europe_3_Factors.csv", "ff5": "Europe_5_Factors.csv", "mom": "Europe_Mom_Factor.csv"}
    cols = {"ff3": ["mkt_eu_chf", "smb3_chf", "hml3_chf"], "ff5": ["smb5_chf", "hml5_chf", "rmw5_chf", "cma5_chf"], "mom": ["wml_chf"]}
    info: Info = {
        "id": key, "name": f"{labels[key]} (mensuel, USD, RF = T-bill US 1 mois)",
        "provider": "Kenneth R. French Data Library", "url": "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html",
        "license": C.LICENSES["french"], "columns": cols[key], "retrieved_at": _now(),
    }
    manual = C.MANUAL_DIR / manual_names[key]
    if manual.exists():
        info.update(status="manual", provider=f"Import manuel data/manual/{manual.name}")
        return manual.read_text(encoding="latin-1"), info
    errors = []
    for fname in C.FRENCH_FILES[key]:
        try:
            content = _retry(lambda: _get(C.FRENCH_BASE + fname).content)
            with zipfile.ZipFile(io.BytesIO(content)) as z:
                member = next(n for n in z.namelist() if n.lower().endswith(".csv"))
                text = z.read(member).decode("latin-1")
            C.RAW_DIR.mkdir(parents=True, exist_ok=True)
            (C.RAW_DIR / member).write_text(text, encoding="latin-1")
            info.update(status="ok", url=C.FRENCH_BASE + fname)
            return text, info
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{fname}: {type(exc).__name__}: {exc}")
    info.update(status="error", message=" | ".join(errors))
    return None, info


# --------------------------------------------------------------------- USD/CHF

def fetch_usdchf_snb() -> tuple[pd.Series, str]:
    """Cours USD/CHF de fin de mois publié par la BNS (cube devkum)."""
    dims = _retry(lambda: _get(C.SNB_FX_DIMENSIONS_URL).json())
    by_dim: dict[str, list[tuple[str, str]]] = {}
    for d in dims.get("dimensions", []):
        by_dim[d.get("id", "")] = _walk_items(d.get("dimensionItems", []))
    sel = []
    for did, items in by_dim.items():
        eom = [i for i, n in items if "end of month" in n.lower() or "month-end" in n.lower()]
        usd = [i for i, n in items if i.upper().startswith("USD")]
        if eom:
            sel.append(f"{did}({eom[0]})")
        elif usd:
            sel.append(f"{did}({usd[0]})")
    if len(sel) != len(by_dim) or not sel:
        raise RuntimeError(f"Dimensions BNS devkum non reconnues : {json.dumps(by_dim)[:400]}")
    params = {"dimSel": ",".join(sel), "fromDate": "1980-01"}
    df = parse_snb_csv(_retry(lambda: _get(C.SNB_FX_DATA_URL, params=params).text))
    for part in sel:
        did, iid = part[:-1].split("(")
        if did in df.columns:
            df = df[df[did] == iid]
    # observations mensuelles AAAA-MM : datées au dernier jour du mois
    idx = pd.PeriodIndex(df["Date"].str[:7], freq="M").to_timestamp(how="end").normalize()
    s = pd.Series(df["Value"].values, index=idx).dropna().sort_index()
    if s.empty:
        raise RuntimeError("Série USD/CHF BNS vide.")
    return s, ",".join(sel)


def fetch_usdchf() -> tuple[pd.Series | None, Info]:
    """USD/CHF (CHF par USD) : BNS (fin de mois) → FRED (quotidien) → Yahoo (quotidien)."""
    info: Info = {
        "id": "fx", "name": "USD/CHF (CHF par USD), cours de fin de mois",
        "provider": "Banque nationale suisse, data.snb.ch (cube devkum, cours de fin de mois)",
        "url": "https://data.snb.ch/en/topics/ziredev/cube/devkum", "license": C.LICENSES["snb"],
        "columns": ["fx_usdchf_ret"], "retrieved_at": _now(),
    }
    manual = _manual_csv("usdchf_daily.csv", "chf_per_usd")
    if manual is not None:
        info.update(status="manual", provider="Import manuel data/manual/usdchf_daily.csv", coverage=_coverage(manual.index))
        return manual, info
    errors = []
    try:
        s, sel = fetch_usdchf_snb()
        _save_raw("usdchf_snb_monthly.csv", s.rename("chf_per_usd"))
        info.update(status="ok", coverage=_coverage(s.index), message=f"Série BNS devkum {sel}")
        return s, info
    except Exception as exc:  # noqa: BLE001
        errors.append(f"BNS : {type(exc).__name__}: {exc}")
    try:
        text = _retry(lambda: _get(C.FRED_USDCHF, timeout=30).text, attempts=2)
        df = pd.read_csv(io.StringIO(text))
        s = pd.Series(pd.to_numeric(df["DEXSZUS"], errors="coerce").values, index=pd.to_datetime(df[df.columns[0]])).dropna().sort_index()
        _save_raw("usdchf_fred_daily.csv", s.rename("chf_per_usd"))
        info.update(status="ok", provider="FRED, Federal Reserve Bank of St. Louis — DEXSZUS (H.10, midi New York)",
                    url="https://fred.stlouisfed.org/series/DEXSZUS", license=C.LICENSES["fred"], coverage=_coverage(s.index),
                    message="Repli : " + " | ".join(errors))
        return s, info
    except Exception as exc:  # noqa: BLE001
        errors.append(f"FRED : {type(exc).__name__}: {exc}")
    try:
        s = yahoo_history(C.YAHOO_USDCHF)["Close"].astype(float)
        info.update(status="ok", provider="Yahoo Finance (CHF=X)", url="https://finance.yahoo.com/quote/CHF%3DX",
                    license=C.LICENSES["yahoo"], coverage=_coverage(s.index), message="Repli : " + " | ".join(errors))
        return s, info
    except Exception as exc:  # noqa: BLE001
        errors.append(f"Yahoo : {type(exc).__name__}: {exc}")
    info.update(status="error", message=" | ".join(errors))
    return None, info


# --------------------------------------------------------------------- Fonds BCV Swiss Equity A

def fetch_fund():
    """Série officielle Gérifonds « dividendes réinvestis » du fonds BCV Swiss Equity A.

    Retourne (FundPage | None, info). Repli : data/manual/fund_tr_daily.csv
    (date,tr_index), indice de performance distributions brutes réinvesties.
    """
    from .fund import FundPage, parse_page

    info: Info = {
        "id": "fund", "name": "BCV Swiss Equity A (CH0006018706) — performance officielle, distributions réinvesties",
        "provider": "Gérifonds SA, page publique du fonds (graphique « Évolution de la performance (dividendes réinvestis) »)",
        "url": "https://www.gerifonds.ch/fr/iframe/CH0006018706", "license": C.LICENSES["gerifonds"],
        "columns": ["fund_ret"], "retrieved_at": _now(),
    }
    try:
        manual = _manual_csv("fund_tr_daily.csv", "tr_index")
        if manual is not None:
            info.update(status="manual", provider="Import manuel data/manual/fund_tr_daily.csv", coverage=_coverage(manual.index))
            return FundPage(manual, pd.Series(dtype=float), pd.Series(dtype=float)), info
        text = _retry(lambda: _get(C.GERIFONDS_FUND_URL, timeout=120).text)
        page = parse_page(text)
        if len(page.tr) < 250:
            raise RuntimeError(f"Historique Gérifonds trop court ({len(page.tr)} points) : structure de page modifiée ?")
        _save_raw("fund_gerifonds_daily.csv", pd.DataFrame({"tr_index": page.tr, "nav_tooltip": page.nav}))
        info.update(status="ok", coverage=_coverage(page.tr.index),
                    message=f"{len(page.tr)} valeurs quotidiennes ; {len(page.distributions)} distributions publiées.")
        return page, info
    except Exception as exc:  # noqa: BLE001
        info.update(status="error", message=f"{type(exc).__name__}: {exc}")
        return None, info


# --------------------------------------------------------------------- Fonds Raiffeisen Futura - Swiss Stock A

def fetch_raif():
    """Série Swiss Fund Data « Total Return Chart Price » du fonds Raiffeisen Futura - Swiss Stock A.

    Retourne (SfdSeries | None, info). Repli : data/manual/raif_tr_daily.csv (date,tr_index).
    """
    from .raif import SfdSeries, parse_csv, parse_ter

    info: Info = {
        "id": "raif", "name": f"{C.RAIF['name']} ({C.RAIF['isin']}) — rendement total, distributions réinvesties",
        "provider": "Swiss Fund Data (SIX Financial Information / AMAS), export quotidien « Total Return Chart Price »",
        "url": C.SFD_SHOW_URL, "license": C.LICENSES["swissfunddata"],
        "columns": ["raif_ret"], "retrieved_at": _now(),
    }
    try:
        manual = _manual_csv("raif_tr_daily.csv", "tr_index")
        if manual is not None:
            info.update(status="manual", provider="Import manuel data/manual/raif_tr_daily.csv", coverage=_coverage(manual.index))
            return SfdSeries(nav=pd.Series(dtype=float), tr=manual), info

        def run():
            s = requests.Session()
            s.headers.update(C.HTTP_HEADERS)
            s.get(C.SFD_ENTRY_URL, timeout=60).raise_for_status()
            # page d'avertissement : accès en tant qu'investisseur privé
            s.post(C.SFD_ENTRY_URL, data={"_action_set": "einverstanden"}, timeout=60).raise_for_status()
            csv = s.get(C.SFD_CSV_URL, timeout=120)
            csv.raise_for_status()
            if "Total Return Chart Price" not in csv.text[:2000]:
                raise RuntimeError("Export Swiss Fund Data inattendu (avertissement non accepté ou format modifié).")
            show = s.get(C.SFD_SHOW_URL, timeout=120).text
            return csv.text, show

        text, show = _retry(run)
        ser = parse_csv(text)
        if len(ser.tr) < 1000:
            raise RuntimeError(f"Historique Swiss Fund Data trop court ({len(ser.tr)} points).")
        t = parse_ter(show)
        if t is not None:
            ser.ter, ser.ter_date = t
        _save_raw("raif_swissfunddata_daily.csv", pd.DataFrame({"nav": ser.nav, "tr_index": ser.tr}))
        info.update(status="ok", coverage=_coverage(ser.tr.index), message=f"{len(ser.tr)} valeurs quotidiennes (VNI et rendement total).")
        return ser, info
    except Exception as exc:  # noqa: BLE001
        info.update(status="error", message=f"{type(exc).__name__}: {exc}")
        return None, info
