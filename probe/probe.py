"""Sonde 2 : swissfunddata.ch (disclaimer, recherche, historique des prix)."""
import re
import requests
from html import unescape

H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}
s = requests.Session(); s.headers.update(H)
B = "https://www.swissfunddata.ch"

def show(r, n=0):
    print("status", r.status_code, "final", r.url, "len", len(r.text), "cookies", s.cookies.get_dict())
    if n: print(r.text[:n])

r = s.get(B + "/sfdpub/de/funds/search?text=CH0011980981", timeout=40); show(r)
for f in re.findall(r"<form.*?</form>", r.text, flags=re.S | re.I):
    print("FORM:", re.sub(r"\s+", " ", f)[:1500])
for a in sorted(set(re.findall(r'href="([^"]+)"', r.text))):
    if "sfd" in a or "disclaimer" in a.lower() or "eingang" in a: print(" a:", a)
