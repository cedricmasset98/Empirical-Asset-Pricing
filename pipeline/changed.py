"""Indique si le contenu du jeu de données a changé par rapport au dernier
commit (en ignorant les horodatages). Code de sortie 0 = changé, 1 = identique."""

import json
import subprocess
import sys

PATH = "public/data/dataset.json"


def essence(ds: dict) -> dict:
    return {
        "dates": ds.get("dates"),
        "data": ds.get("data"),
        "sources": [{k: s.get(k) for k in ("id", "status", "coverage", "message")} for s in ds.get("sources", [])],
        "checks": ds.get("checks"),
    }


def main() -> int:
    for pdf in ("rapport_bcv.pdf", "rapport_fonds.pdf", "rapport_comparaison.pdf", "presentation_fonds.pdf"):
        tracked = subprocess.run(["git", "ls-files", "--error-unmatch", f"public/report/{pdf}"], capture_output=True)
        if tracked.returncode != 0:
            return 0  # rapport jamais archivé
    try:
        old = subprocess.run(["git", "show", f"HEAD:{PATH}"], capture_output=True, text=True, check=True).stdout
    except subprocess.CalledProcessError:
        return 0
    with open(PATH, encoding="utf-8") as f:
        new = json.load(f)
    return 0 if essence(json.loads(old)) != essence(new) else 1


if __name__ == "__main__":
    sys.exit(main())
