"""Sonde JKP : manifeste, facteurs suisses (che), format."""
import io, json, zipfile
import pandas as pd, requests

B = "https://jkpfactors-data.s3.amazonaws.com/public/"
H = {"User-Agent": "empirical-asset-pricing-pipeline/1.0"}
m = requests.get(B + "availability.json", headers=H, timeout=60); print("manifest", m.status_code, len(m.text))
av = m.json()
print("clés:", list(av)[:20])
def show(o, depth=0, maxk=12):
    if isinstance(o, dict):
        for k in list(o)[:maxk]:
            v = o[k]; print("  " * depth + str(k), ":", (type(v).__name__, len(v) if hasattr(v, "__len__") else v))
            if depth < 2: show(v, depth + 1, 6)
    elif isinstance(o, list):
        print("  " * depth, o[:15])
show(av)
s = json.dumps(av)
print("'che' présent:", "che" in s, "| 'CHE':", "CHE" in s)

def get(sel, w="vw_cap", region="che"):
    u = f"{B}%5B{region}%5D_%5B{sel}%5D_%5Bmonthly%5D_%5B{w}%5D.zip"
    r = requests.get(u, headers=H, timeout=180)
    print("\n==", sel, w, r.status_code, len(r.content))
    if r.status_code != 200: return None
    z = zipfile.ZipFile(io.BytesIO(r.content)); n = [x for x in z.namelist() if x.lower().endswith(".csv")][0]
    df = pd.read_csv(z.open(n), na_values="na"); print("fichier", n, df.shape, list(df.columns))
    print(df.head(3).to_string()); print(df.tail(3).to_string())
    return df

mk = get("mkt")
facs = {}
for code in ["market_equity", "be_me", "ope_be", "at_gr1", "ret_12_1"]:
    d = get(code)
    if d is not None: facs[code] = d
for code, d in facs.items():
    print(code, "début", d["date"].min(), "fin", d["date"].max(), "direction", d["direction"].unique() if "direction" in d else "-",
          "n_stocks min/médiane/dernier", d["n_stocks"].min() if "n_stocks" in d else "-", d["n_stocks"].median() if "n_stocks" in d else "-", d["n_stocks"].iloc[-1] if "n_stocks" in d else "-",
          "moyenne annualisée %.2f%%" % (12 * 100 * d["ret"].mean()))
# séries pour comparaison locale
out = pd.DataFrame({c: d.set_index("date")["ret"] for c, d in facs.items()})
if mk is not None:
    for c in mk.columns:
        if c not in ("location", "name", "freq", "weighting", "date", "excntry", "obs"): pass
    out["mkt"] = mk.set_index("date")[[c for c in mk.columns if "ret" in c][0]]
print("CSVSTART"); print(out.loc["2005-01-01":].to_csv(float_format="%.6f")); print("CSVEND")
