"""Le générateur de rapport fonctionne sur le jeu synthétique (sans compilation LaTeX)."""

import json
import tempfile
import unittest
from pathlib import Path

from pipeline import report

ROOT = Path(__file__).resolve().parents[2]


class TestReport(unittest.TestCase):
    def test_macros_tables_figures(self):
        ds = json.loads((ROOT / "tests" / "fixtures" / "synthetic_dataset.json").read_text())
        with tempfile.TemporaryDirectory() as tmp:
            saved = report.GEN
            try:
                report.GEN = Path(tmp)
                r = report.compute(ds)
                m = report.macros(ds, r)
                report.write_macros(m)
                report.write_tables(ds, r)
                report.write_figures(r)
            finally:
                report.GEN = saved
            names = {p.name for p in Path(tmp).iterdir()}
        self.assertTrue({"macros.tex", "tab_inference.tex", "tab_comparaison.tex", "tab_sources.tex",
                         "fig_croissance.pdf", "fig_nuage.pdf", "fig_alphas.pdf", "fig_rolling.pdf"} <= names)
        # chaque macro utilisée par le gabarit est définie
        import re
        used = set(re.findall(r"\\([A-Z][A-Za-z]+)", (ROOT / "report" / "rapport.tex").read_text()))
        self.assertEqual(sorted(u for u in used if u not in m and u not in {"LARGE"}), [])

    def test_formatting(self):
        self.assertEqual(report.num(-0.0012, 2), "0,00")
        self.assertEqual(report.num(-1.5, 1), "−1,5")
        self.assertEqual(report.pct(0.0936, 1), "9,4~\\%")
        self.assertEqual(report.tex_escape("a_b & 5%"), "a\\_b \\& 5\\%")
        self.assertEqual(report.peq(0.0001), "< 0,001")


if __name__ == "__main__":
    unittest.main()
