import unittest

import numpy as np
import pandas as pd

from pipeline.raif import check, parse_csv, parse_ter


def sfd_csv(nav: np.ndarray, tr: np.ndarray, days: pd.DatetimeIndex) -> str:
    head = ["sep=;", "Raiffeisen Futura - Swiss Stock A - CH0011980981 (CHF)",
            "Date;CCY Chart Price;Chart Price;CCY Adjusted Chart Price;Adjusted Chart Price;CCY Total Return Chart Price;"
            "Total Return Chart Price;Net Asset Value;Issue Price;Redemption Price;Closing Price"]
    rows = [f"{d.date()};CHF;{n:.2f};CHF;{n:.2f};CHF;{t:.3f};{n:.2f};;;" for d, n, t in zip(days, nav, tr)]
    return "\n".join(head + rows) + "\n"


class TestRaif(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(3)
        self.days = pd.bdate_range("2020-01-01", "2022-12-30")
        r = rng.normal(0.0003, 0.008, len(self.days))
        nav = [200.0]
        tr = [200.0]
        self.ex = {self.days[150]: 3.7, self.days[420]: 5.2}
        for i in range(1, len(self.days)):
            n = round(nav[-1] * (1 + r[i]), 2)
            d = self.ex.get(self.days[i], 0.0)
            n_ex = round(n - d, 2)
            tr.append(tr[-1] * (n_ex + d) / nav[-1])
            nav.append(n_ex)
        self.nav, self.tr = np.array(nav), np.array(tr)

    def test_parse_and_checks(self):
        s = parse_csv(sfd_csv(self.nav, self.tr, self.days))
        self.assertEqual(len(s.tr), len(self.days))
        c = check(s)
        self.assertTrue(c.chart_eq_nav)
        self.assertGreaterEqual(c.share_ok, 0.995)
        self.assertEqual([a for _, a in c.distributions], [3.7, 5.2])
        self.assertEqual([d for d, _ in c.distributions], [str(d.date()) for d in self.ex])
        self.assertEqual(c.anomalies, [])

    def test_thousands_separator(self):
        """Valeurs ≥ 1000 exportées avec « ' » (1'442.88) : aucune ligne perdue."""
        text = "\n".join([
            "sep=;", "Pictet CH - Swiss Equities -P dy CHF - CH0002783923 (CHF)",
            "Date;CCY Chart Price;Chart Price;CCY Adjusted Chart Price;Adjusted Chart Price;CCY Total Return Chart Price;"
            "Total Return Chart Price;Net Asset Value;Issue Price;Redemption Price;Closing Price",
            "2009-08-18;CHF;998.50;CHF;990.1;CHF;998.50;998.50;;;",
            "2009-08-19;CHF;1'442.88;CHF;1'333.868;CHF;1'442.88;1'442.88;;;",
            "2009-08-20;CHF;1'460.22;CHF;1'349.898;CHF;1'460.22;1'460.22;;;",
        ]) + "\n"
        s = parse_csv(text)
        self.assertEqual(len(s.tr), 3)
        self.assertAlmostEqual(s.nav.iloc[-1], 1460.22)
        self.assertTrue(check(s).chart_eq_nav)

    def test_tr_before_nav(self):
        """Rendement total publié avant la VNI : série TR complète, contrôles sur la partie commune."""
        nav = self.nav.copy()
        text = sfd_csv(nav, self.tr, self.days).splitlines()
        head, rows = text[:3], text[3:]
        rows = [";".join(r.split(";")[:7] + [""] + r.split(";")[8:]) if i < 100 else r for i, r in enumerate(rows)]
        s = parse_csv("\n".join(head + rows) + "\n")
        self.assertEqual(len(s.tr), len(self.days))
        self.assertEqual(len(s.nav), len(self.days) - 100)
        c = check(s)
        self.assertEqual(c.tr_only_days, 100)
        self.assertEqual(c.checked_from, str(self.days[100].date()))
        self.assertGreaterEqual(c.share_ok, 0.995)

    def test_missing_header(self):
        with self.assertRaises(ValueError):
            parse_csv("sep=;\nautre chose\n")

    def test_ter(self):
        page = "<td>TER</td><td>1.20%</td></tr><tr><td>Datum TER</td><td>30.06.2026</td>"
        ter, d = parse_ter(page)
        self.assertAlmostEqual(ter, 0.012)
        self.assertEqual(str(d.date()), "2026-06-30")
        self.assertIsNone(parse_ter("<p>rien</p>"))


if __name__ == "__main__":
    unittest.main()
