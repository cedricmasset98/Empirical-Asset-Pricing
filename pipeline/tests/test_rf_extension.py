"""Prolongement du taux sans risque avant le SARON quotidien."""
import unittest

import numpy as np
import pandas as pd

from pipeline.transform import extend_rf, rf_from_rates

LIM = ((0.95, 0.90), (0.0020, 0.0075))


def months(a: str, b: str) -> pd.PeriodIndex:
    return pd.period_range(a, b, freq="M")


class RfExtensionTest(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(3)
        idx = months("1990-01", "2015-12")
        # taux de fin de mois (%), marche aléatoire lisse
        self.saron_eom = pd.Series(2 + np.cumsum(rng.normal(0, 0.15, len(idx))), index=idx)
        self.tbill = self.saron_eom - 0.1 + rng.normal(0, 0.05, len(idx))
        # réalisé « quotidien » à partir de 2009-09 : moyenne des taux de début et de fin de mois
        real_idx = months("2009-09", "2015-12")
        r = (self.saron_eom.shift(1) + self.saron_eom) / 2
        self.real = (r / 100 * pd.Series(idx.days_in_month, index=idx) / 360)[real_idx]

    def test_rf_from_rates(self):
        r = pd.Series([1.2, 2.4], index=months("2020-01", "2020-02"))
        out = rf_from_rates(r)
        self.assertEqual(list(out.index.astype(str)), ["2020-02"])
        self.assertAlmostEqual(out.iloc[0], 0.012 * 29 / 360)

    def test_segments_and_values(self):
        sar = self.saron_eom[self.saron_eom.index >= pd.Period("1999-06", "M")]
        tb = self.tbill[self.tbill.index >= pd.Period("1992-01", "M")]
        ext = extend_rf(self.real, sar, tb, *LIM)
        self.assertTrue(ext.approx_ok and ext.tbill_ok)
        self.assertEqual([g.start for g in ext.segments], ["1992-02", "1999-07", "2009-09"])
        self.assertEqual(ext.segments[0].end, "1999-06")
        # mois réalisés jamais remplacés
        pd.testing.assert_series_equal(ext.series[self.real.index], self.real, check_names=False)
        m = pd.Period("2005-03", "M")
        self.assertAlmostEqual(ext.series[m], sar[m - 1] / 100 * 31 / 360)
        m = pd.Period("1995-04", "M")
        self.assertAlmostEqual(ext.series[m], tb[m - 1] / 100 * 30 / 360)
        self.assertTrue(ext.series.index.is_monotonic_increasing and ext.series.index.is_unique)

    def test_tbill_gap_stops_segment(self):
        sar = self.saron_eom[self.saron_eom.index >= pd.Period("1999-06", "M")]
        tb = self.tbill[self.tbill.index >= pd.Period("1992-01", "M")].drop(pd.Period("1996-05", "M"))
        ext = extend_rf(self.real, sar, tb, *LIM)
        self.assertEqual(ext.segments[0].start, "1996-07")  # 1996-06 a besoin du taux de 1996-05

    def test_rejected_when_inconsistent(self):
        sar = self.saron_eom[self.saron_eom.index >= pd.Period("1999-06", "M")] + 1.0  # +1 pt/an
        ext = extend_rf(self.real, sar, self.tbill, *LIM)
        self.assertFalse(ext.approx_ok)
        self.assertEqual(len(ext.segments), 1)
        pd.testing.assert_series_equal(ext.series, self.real, check_names=False)
        tb_bad = self.tbill + 3.0
        ext = extend_rf(self.real, self.saron_eom[self.saron_eom.index >= pd.Period("1999-06", "M")], tb_bad, *LIM)
        self.assertTrue(ext.approx_ok)
        self.assertFalse(ext.tbill_ok)
        self.assertEqual(ext.segments[0].start, "1999-07")


if __name__ == "__main__":
    unittest.main()
