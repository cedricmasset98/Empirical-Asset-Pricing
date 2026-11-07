"""Sonde 4 : swissfunddata.ch fiche 16291, export Excel et données du graphique."""
import io, re
import pandas as pd, requests

H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}
s = requests.Session(); s.headers.update(H)
B = "https://www.swissfunddata.ch"
r = s.get(B + "/sfdpub/sfd-eingang/private?url=%2Fde%2Ffunds%2Fshow%2F16291", timeout=40)
s.post(B + "/sfdpub/sfd-eingang/private?url=%2Fde%2Ffunds%2Fshow%2F16291", data={"_action_set": "einverstanden"}, timeout=40)

x = s.get(B + "/sfdpub/de/funds/excelData/16291", timeout=60)
print("excel", x.status_code, x.headers.get("content-type"), x.headers.get("content-disposition"), len(x.content))
print(x.content[:300])
for eng in (None, "openpyxl", "xlrd"):
    try:
        df = pd.read_excel(io.BytesIO(x.content), engine=eng, header=None)
        print("read_excel", eng, df.shape); print(df.head(15).to_string()); print(df.tail(8).to_string()); break
    except Exception as e:
        print("read_excel", eng, "erreur", e)
try:
    df = pd.read_csv(io.BytesIO(x.content), sep=None, engine="python", header=None, encoding="latin-1")
    print("csv", df.shape); print(df.head(15).to_string()); print(df.tail(8).to_string())
except Exception as e:
    print("csv erreur", e)

p = s.get(B + "/sfdpub/de/funds/show/16291", timeout=60)
t = p.text
print("show", p.status_code, len(t))
for m in re.finditer(r"(data|series)\s*:\s*\[\s*\[", t):
    print("série à", m.start(), t[m.start():m.start() + 300])
for kw in ["Ausschüttung", "Ausschuettung", "Ex-Datum", "Ex-Date", "Inventarwert", "NAV", "TER", "Benchmark", "Lancierung"]:
    for m in list(re.finditer(kw, t))[:2]:
        print(kw, "→", re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", t[m.start() - 100:m.start() + 400])))
c = s.get(B + "/sfdpub/de/funds/chart/16291", timeout=60)
print("chart", c.status_code, len(c.text))
for m in re.finditer(r"(data|series)\s*:\s*\[", c.text):
    print("chart série", c.text[m.start():m.start() + 300])
for u in re.findall(r'["\'](/sfdpub/[^"\']*(?:json|data|chart)[^"\']*)["\']', c.text)[:30]:
    print(" url:", u)
