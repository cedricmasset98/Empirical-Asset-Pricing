"""Sonde temporaire : sources possibles pour Raiffeisen Futura - Swiss Stock A (CH0011980981)."""
import re, traceback
import requests, pandas as pd, yfinance as yf

H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}
FACT = {2023: 6.6, 2024: 5.9, 2025: 11.0}

for t in ["RSWI.SW", "0P00000KCT.SW", "0P00000KCT.F", "0P00000KCT", "CH0011980981.SW"]:
    print(f"\n===== yfinance {t}")
    try:
        h = yf.Ticker(t).history(period="max", interval="1d", auto_adjust=False, actions=True)
        if h.empty:
            print("vide"); continue
        print("n", len(h), "début", h.index[0].date(), "fin", h.index[-1].date(), "cols", list(h.columns))
        print("dernier Close", h["Close"].iloc[-1], "Adj", h["Adj Close"].iloc[-1], "Volume moyen", h.get("Volume", pd.Series([0])).tail(250).mean())
        d = h["Dividends"][h["Dividends"] > 0] if "Dividends" in h else pd.Series(dtype=float)
        print("dividendes", len(d)); print(d.tail(25).to_string())
        idx = h.index.tz_localize(None) if h.index.tz is not None else h.index
        adj = pd.Series(h["Adj Close"].values, index=idx)
        y = adj.resample("YE").last()
        r = y.pct_change() * 100
        print("rendements annuels (Adj Close) :", {k.year: round(v, 2) for k, v in r.dropna().tail(12).items()})
        print("factsheet :", FACT)
        # jours de cotation par mois récents
        print("obs par mois (12 derniers):", adj.resample("ME").count().tail(12).tolist())
        print("dates des 15 dernières obs:", [str(x.date()) for x in idx[-15:]])
    except Exception:
        traceback.print_exc()

urls = [
    "https://www.swissfunddata.ch/sfdpub/en/funds/search?searchString=CH0011980981",
    "https://www.swissfunddata.ch/sfdpub/de/funds/search?text=1198098",
    "https://www.raiffeisen.ch/rch/de/privatkunden/anlegen/anlagefonds/fondskurse.html",
    "https://www.fundinfo.com/en/CH-prof/LandingPage?query=CH0011980981",
    "https://www.vontobel.com/en-ch/asset-management/funds/CH0011980981/",
    "https://markets.ft.com/data/funds/tearsheet/historical?s=CH0011980981:CHF",
    "https://www.morningstar.ch/ch/funds/snapshot/snapshot.aspx?id=F00000040Y",
    "https://lt.morningstar.com/api/rest.svc/timeseries_price/2nhcdckzon?id=0P00000KCT&currencyId=CHF&idtype=Morningstar&frequency=monthly&startDate=2000-01-01&outputType=COMPACTJSON",
    "https://tools.morningstar.co.uk/api/rest.svc/timeseries_cumulativereturn/t92wz0sj7c?id=0P00000KCT]2]0]FOCHE$$ALL&currencyId=CHF&idtype=Morningstar&frequency=monthly&startDate=2000-01-01&outputType=COMPACTJSON",
]
for u in urls:
    print(f"\n===== GET {u}")
    try:
        r = requests.get(u, headers=H, timeout=40)
        print("status", r.status_code, "type", r.headers.get("content-type"), "len", len(r.text), "final", r.url)
        txt = r.text
        print(txt[:600].replace("\n", " "))
        for m in re.findall(r'(https?://[^"\'\s<>]*(?:csv|xls|json|chart|price|kurs|nav|history)[^"\'\s<>]*)', txt, flags=re.I)[:20]:
            print("  lien:", m)
    except Exception as e:
        print("erreur", e)
