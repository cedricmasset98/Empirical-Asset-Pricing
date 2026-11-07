"""Sonde 5 : validation de la série swissfunddata (TR) contre factsheet et Yahoo."""
import io
import numpy as np, pandas as pd, requests, yfinance as yf

H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}
s = requests.Session(); s.headers.update(H)
B = "https://www.swissfunddata.ch"
s.get(B + "/sfdpub/sfd-eingang/private?url=%2Fde%2Ffunds%2Fshow%2F16291", timeout=40)
s.post(B + "/sfdpub/sfd-eingang/private?url=%2Fde%2Ffunds%2Fshow%2F16291", data={"_action_set": "einverstanden"}, timeout=40)
x = s.get(B + "/sfdpub/de/funds/excelData/16291", timeout=60)
lines = x.text.splitlines()
print(lines[:4]); print(lines[-3:])
df = pd.read_csv(io.StringIO("\n".join(lines[2:])), sep=";")
df["Date"] = pd.to_datetime(df["Date"]); df = df.set_index("Date").sort_index()
print(df.dtypes.to_string()); print("n", len(df), df.index[0].date(), df.index[-1].date())
print("NaN par colonne", df.isna().sum().to_dict())
print("Chart Price == NAV ?", float((df["Chart Price"] - df["Net Asset Value"]).abs().max()))
gaps = df.index.to_series().diff().dt.days
print("écarts > 5 jours:", gaps[gaps > 5].to_string())
tr = df["Total Return Chart Price"]; nav = df["Net Asset Value"]
y = tr.resample("YE").last().pct_change() * 100
print("TR annuel:", {k.year: round(v, 2) for k, v in y.dropna().items()})
print("factsheet: 2023 6.6, 2024 5.9, 2025 11.0 ; YTD 30.09.2026 7.8")
print("YTD 30.09.2026:", round((tr[:"2026-09-30"].iloc[-1] / tr[:"2025-12-31"].iloc[-1] - 1) * 100, 2))
ratio = tr / nav
jumps = ratio.pct_change()
j = jumps[jumps.abs() > 1e-4]
for d, v in j.items():
    i = nav.index.get_loc(d)
    impl = nav.iloc[i] * v  # distribution implicite ≈ NAV_ex × saut du ratio
    print("saut ratio", d.date(), round(v * 100, 4), "% → distribution implicite ≈", round(impl, 2), "NAV", nav.iloc[i - 1], "->", nav.iloc[i])
m = tr.resample("ME").last().pct_change().dropna()
yh = yf.Ticker("0P00000KCT.SW").history(period="max", auto_adjust=False)
if not yh.empty:
    a = pd.Series(yh["Adj Close"].values, index=yh.index.tz_localize(None)).resample("ME").last().pct_change().dropna()
    j2 = pd.concat([m, a], axis=1, keys=["sfd", "yahoo"]).dropna()
    d = (j2.sfd - j2.yahoo)
    print("mois communs", len(j2), "corr", round(j2.corr().iloc[0, 1], 5), "écart abs moyen (pb)", round(d.abs().mean() * 1e4, 1), "max (pb)", round(d.abs().max() * 1e4, 1))
    print(d.abs().sort_values().tail(5).to_string())
print("derniers points:"); print(df.tail(5)[["Net Asset Value", "Total Return Chart Price", "Closing Price"]].to_string())
