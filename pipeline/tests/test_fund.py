"""Lecture de la page Gérifonds et contrôles de la série du fonds (page SYNTHÉTIQUE)."""

import html
import json
import unittest

import numpy as np
import pandas as pd

from pipeline import fund


def synthetic_page(lag_from: str | None = None, drop_dist: bool = False, double_count: bool = False) -> str:
    rng = np.random.default_rng(3)
    days = pd.bdate_range("2023-12-29", "2025-03-14")
    nav = [300.0]
    dists = {pd.Timestamp("2024-07-16"): 5.1}
    tr = [100.0]
    for d in days[1:]:
        r = rng.normal(0.0003, 0.008)
        D = dists.get(d, 0.0)
        new_nav = round(nav[-1] * (1 + r) - D, 2)
        rtr = (new_nav + D * (2 if double_count else 1)) / nav[-1] - 1
        nav.append(new_nav)
        tr.append(tr[-1] * (1 + rtr))
    shown = list(nav)
    if lag_from:
        k = list(days).index(pd.Timestamp(lag_from))
        shown = nav[:k] + [nav[i - 1] for i in range(k, len(nav))]
    points = {str(i + 1): [d.strftime("%d.%m.%Y"), tr[i], f"<strong>{d:%d.%m.%Y}</strong><br /><strong>VNI:{shown[i]:.2f}</strong>"]
              for i, d in enumerate(days)}
    ytd_end = days[-1]
    y0 = [i for i, d in enumerate(days) if d.year < ytd_end.year][-1]
    ytd = tr[-1] / tr[y0] - 1
    rows = "" if drop_dist else "<tr><td>16.07.2024</td><td>CHF</td><td>5.1000</td><td>3.3150</td><td>5.1000</td></tr>"
    return (f"<div>Performance YTD</div><div>{100 * ytd:.2f}%</div><div>{ytd_end:%d.%m.%Y}</div>"
            "<div>TER</div><div>1.11%</div><div>31.03.2026</div>"
            f'<div class="charts-google" data-chart="{html.escape(json.dumps(points))}"></div>'
            f"<h3>Distributions</h3><table><tr><th>Date</th><th>VNI Devise</th></tr>{rows}</table>")


class TestFund(unittest.TestCase):
    def test_parse_and_reconcile(self):
        p = fund.parse_page(synthetic_page())
        self.assertGreater(len(p.tr), 250)
        self.assertEqual(list(p.distributions.items()), [(pd.Timestamp("2024-07-16"), 5.1)])
        r = fund.reconcile(p)
        self.assertGreater(r.matched_share, 0.995)
        self.assertEqual(len(r.dist_ok), 1)
        self.assertEqual(r.dist_bad, [])
        self.assertAlmostEqual(p.ter, 0.0111)
        self.assertEqual(str(p.ter_date.date()), "2026-03-31")
        calc, off = fund.ytd_check(p)
        self.assertAlmostEqual(calc, off, places=4)

    def test_lagged_tooltips_are_tolerated(self):
        r = fund.reconcile(fund.parse_page(synthetic_page(lag_from="2024-09-02")))
        self.assertGreater(r.matched_share, 0.99)
        self.assertEqual(r.dist_bad, [])
        self.assertIsNotNone(r.lag_switch)

    def test_double_counted_distribution_is_detected(self):
        r = fund.reconcile(fund.parse_page(synthetic_page(double_count=True)))
        self.assertEqual(len(r.dist_bad), 1)

    def test_missing_distribution_is_detected(self):
        r = fund.reconcile(fund.parse_page(synthetic_page(drop_dist=True)))
        self.assertIn("2024-07-16", r.unexplained)

    def test_missing_chart_raises(self):
        with self.assertRaises(ValueError):
            fund.parse_page("<html>rien</html>")


if __name__ == "__main__":
    unittest.main()
