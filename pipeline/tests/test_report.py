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

    def test_fund_and_pair_templates(self):
        import re
        from pipeline import report_pair

        ds = json.loads((ROOT / "tests" / "fixtures" / "synthetic_dataset.json").read_text())
        with tempfile.TemporaryDirectory() as tmp:
            saved = report.GEN
            try:
                report.GEN = Path(tmp)
                m_fund = report.macros(ds, report.compute(ds, "FUND"))
                m_pair = report_pair.write_pair(ds, report_pair.compute_pair(ds), Path(tmp))
            finally:
                report.GEN = saved
            names = {p.name for p in Path(tmp).iterdir()}
        self.assertTrue({"fig_pair_perf.pdf", "fig_pair_nuages.pdf", "fig_pair_alphas.pdf", "tab_pair_models.tex", "tab_sources.tex"} <= names)
        for tpl, m in (("rapport_fonds.tex", m_fund), ("rapport_comparaison.tex", m_pair)):
            used = set(re.findall(r"\\([A-Z][A-Za-z]+)", (ROOT / "report" / tpl).read_text()))
            self.assertEqual(sorted(u for u in used if u not in m and u not in {"LARGE"}), [], tpl)
        # l'écart d'alpha de la comparaison = différence des alphas
        r = report_pair.compute_pair(ds)
        F = r["fits"]
        self.assertAlmostEqual(F[("CAPM", "SPI", "DIFF")].params[0],
                               F[("CAPM", "SPI", "BCV")].params[0] - F[("CAPM", "SPI", "FUND")].params[0], places=12)

    def test_valuation_report(self):
        import re
        from pipeline import report_valuation as V

        self.assertAlmostEqual(V.ebo_perpetual(100, 0.15, 0.10), 150.0)
        self.assertAlmostEqual(V.ebo_perpetual(100, 0.10, 0.10), 100.0)  # ROE = r : valeur = fonds propres
        ds = json.loads((ROOT / "tests" / "fixtures" / "synthetic_dataset.json").read_text())
        with tempfile.TemporaryDirectory() as tmp:
            m = V.write_valuation(ds, V.compute_valuation(ds), Path(tmp))
            names = {p.name for p in Path(tmp).iterdir()}
        self.assertTrue({"fig_val_sensibilite.pdf", "fig_val_relatif.pdf", "macros.tex", "tab_sources.tex"} <= names)
        self.assertEqual(m["ExV"], "150")
        self.assertEqual(m["ExReImpl"], "12,5~\\%")
        used = set(re.findall(r"\\([A-Z][A-Za-z]+)", (ROOT / "report" / "rapport_valorisation.tex").read_text()))
        self.assertEqual(sorted(u for u in used if u not in m and u not in {"LARGE"}), [])

    def test_formatting(self):
        self.assertEqual(report.num(-0.0012, 2), "0,00")
        self.assertEqual(report.num(-1.5, 1), "−1,5")
        self.assertEqual(report.pct(0.0936, 1), "9,4~\\%")
        self.assertEqual(report.tex_escape("a_b & 5%"), "a\\_b \\& 5\\%")
        self.assertEqual(report.peq(0.0001), "< 0,001")


if __name__ == "__main__":
    unittest.main()
