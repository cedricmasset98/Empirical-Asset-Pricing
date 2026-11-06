"""La présentation vulgarisée se génère sur le jeu synthétique (sans compilation LaTeX)."""

import json
import re
import tempfile
import unittest
from pathlib import Path

from pipeline import presentation as P

ROOT = Path(__file__).resolve().parents[2]


class TestPresentation(unittest.TestCase):
    def test_macros_et_figures(self):
        ds = json.loads((ROOT / "tests" / "fixtures" / "synthetic_dataset.json").read_text())
        with tempfile.TemporaryDirectory() as tmp:
            saved = P.GEN
            try:
                P.GEN = Path(tmp)
                r = P.compute(ds)
                m = P.macros(ds, r)
                P.write_macros(m)
                P.write_figures(r)
            finally:
                P.GEN = saved
            names = {p.name for p in Path(tmp).iterdir()}
        self.assertTrue({"macros.tex", "fig_cent.pdf", "fig_suivi.pdf", "fig_frais.pdf", "fig_ff.pdf"} <= names)
        # alpha brut = alpha net + TER (même régresseurs, constante décalée de TER/12)
        self.assertAlmostEqual(12 * (r["sim_g"].params[0] - r["sim"].params[0]), r["ter"], places=12)
        # chaque macro utilisée par le gabarit est définie
        tpl = (ROOT / "report" / "presentation_fonds.tex").read_text()
        defined = set(re.findall(r"\\newcommand\{\\([A-Za-z]+)\}", tpl))
        used = set(re.findall(r"\\([A-Z][A-Za-z]+)", tpl))
        self.assertEqual(sorted(u for u in used if u not in m and u not in defined | {"LARGE", "Large", "Rightarrow"}), [])


if __name__ == "__main__":
    unittest.main()
