"""Sonde 3 : swissfunddata.ch, accès investisseur privé, fiche du fonds et historique."""
import re
import requests

H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}
s = requests.Session(); s.headers.update(H)
B = "https://www.swissfunddata.ch"

def links(t, pat):
    return sorted(set(a for a in re.findall(r'(?:href|src|data-url|action)="([^"]+)"', t) if re.search(pat, a, re.I)))

r = s.get(B + "/sfdpub/sfd-eingang/private?url=%2Fde%2Ffunds%2Fsearch%3Ftext%3DCH0011980981", timeout=40)
print("status", r.status_code, r.url, len(r.text))
for _ in range(3):
    forms = re.findall(r"<form[^>]*action=\"([^\"]+)\"[^>]*>(.*?)</form>", r.text, flags=re.S | re.I)
    acc = [(a, b) for a, b in forms if "_action_set" in b]
    if not acc:
        break
    a, b = acc[0]
    data = dict(re.findall(r'<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"', b))
    data["_action_set"] = re.search(r'name="_action_set" value="([^"]+)"', b).group(1)
    print("POST", a, data)
    r = s.post(B + a.replace("&amp;", "&"), data=data, timeout=40)
    print("status", r.status_code, r.url, len(r.text))
L = links(r.text, r"funds/|fonds/")
print("liens fonds:", L[:40])
txt = re.sub(r"<[^>]+>", " ", r.text); txt = re.sub(r"\s+", " ", txt)
i = txt.find("Swiss Stock"); print("extrait:", txt[max(0, i - 300): i + 600])
cand = [a for a in L if re.search(r"/funds/(show|detail|overview)|/fonds/", a)]
for a in cand[:4]:
    u = a if a.startswith("http") else B + a
    p = s.get(u, timeout=40); print("\n== fiche", u, p.status_code, len(p.text))
    t2 = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", p.text))
    print(t2[:1500])
    for x in links(p.text, r"price|preis|kurs|export|excel|csv|xls|histor|chart|json|nav|distribution|ausschuett"):
        print("  lien:", x)
