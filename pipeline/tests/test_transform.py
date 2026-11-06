"""Tests des transformations de données. Exécution : python -m unittest discover -s pipeline/tests -t ."""

import unittest

import numpy as np
import pandas as pd

from pipeline.sources import parse_snb_csv
from pipeline.transform import (
    convert_long_short_to_chf,
    convert_market_to_chf,
    month_end_levels,
    parse_french_csv,
    saron_index,
    saron_monthly_returns,
    simple_returns,
)

FRENCH_SAMPLE = """This file was created using the 202509 Bloomberg database.
The 1-month TBill return is from Ibbotson and Associates Inc.

,Mkt-RF,SMB,HML,RF
199007,   0.92,   0.31,  -0.15,   0.68
199008, -12.03,   1.10,   0.42,   0.66
199009,  -9.80, -99.99,   0.10,   0.60

 Annual Factors: January-December
,Mkt-RF,SMB,HML,RF
  1991,  10.00,   1.00,   2.00,   5.00
"""

SNB_SAMPLE = '''"CubeId";"snbgwdzid"
"PublishingDate";"2026-11-05 14:30"

"Date";"D0";"Value"
"2024-01-03";"SARON";"1.70"
"2024-01-03";"ENG";"1.75"
"2024-01-04";"SARON";"1.71"
'''


class TestTransform(unittest.TestCase):
    def test_french_parser(self):
        df = parse_french_csv(FRENCH_SAMPLE)
        self.assertEqual(list(df.columns), ["Mkt-RF", "SMB", "HML", "RF"])
        self.assertEqual(len(df), 3)  # le bloc annuel est ignoré
        self.assertAlmostEqual(df.loc[pd.Period("1990-08", "M"), "Mkt-RF"], -0.1203)
        self.assertTrue(np.isnan(df.loc[pd.Period("1990-09", "M"), "SMB"]))  # -99.99 = manquant

    def test_snb_parser(self):
        df = parse_snb_csv(SNB_SAMPLE)
        s = df[df["D0"] == "SARON"]
        self.assertEqual(len(s), 2)
        self.assertAlmostEqual(s["Value"].iloc[1], 1.71)

    def test_month_end_levels_and_staleness(self):
        d = pd.to_datetime(["2024-01-15", "2024-01-31", "2024-02-10", "2024-03-28", "2024-04-30"])
        s = pd.Series([1.0, 2.0, 3.0, 4.0, 5.0], index=d)
        lv = month_end_levels(s, 5, pd.Period("2024-12", "M"))
        self.assertEqual(lv.stale, ["2024-02"])  # dernière obs. le 10 février
        self.assertEqual([str(p) for p in lv.values.index], ["2024-01", "2024-03", "2024-04"])
        # mois non terminé exclu
        lv2 = month_end_levels(s, 5, pd.Period("2024-03", "M"))
        self.assertNotIn(pd.Period("2024-04", "M"), lv2.values.index)

    def test_returns_never_span_gaps(self):
        idx = pd.PeriodIndex(["2024-01", "2024-03", "2024-04"], freq="M")
        r = simple_returns(pd.Series([100.0, 110.0, 121.0], index=idx))
        self.assertTrue(np.isnan(r[pd.Period("2024-02", "M")]))
        self.assertTrue(np.isnan(r[pd.Period("2024-03", "M")]))
        self.assertAlmostEqual(r[pd.Period("2024-04", "M")], 0.1)

    def test_saron_constant_rate_act360(self):
        # taux constant 1,8 % : le rendement d'un mois = (1 + 0,018/360)^jours − 1
        # lorsque des fixings existent chaque jour calendaire.
        d = pd.date_range("2024-01-31", "2024-03-31", freq="D")
        rate = pd.Series(1.8, index=d)
        r, stale, gaps = saron_monthly_returns(rate, 5, pd.Period("2024-12", "M"))
        self.assertAlmostEqual(r[pd.Period("2024-02", "M")], (1 + 0.018 / 360) ** 29 - 1, places=14)
        self.assertEqual(gaps, [])

    def test_saron_weekend_accrual(self):
        # vendredi → lundi : le taux du vendredi court 3 jours
        d = pd.to_datetime(["2024-01-05", "2024-01-08"])
        idx, _ = saron_index(pd.Series([2.0, 2.0], index=d))
        self.assertAlmostEqual(idx.iloc[1], 1 + 0.02 * 3 / 360, places=15)

    def test_negative_saron(self):
        d = pd.date_range("2016-01-31", "2016-02-29", freq="D")
        r, _, _ = saron_monthly_returns(pd.Series(-0.73, index=d), 5, pd.Period("2016-12", "M"))
        self.assertLess(r.iloc[-1], 0)

    def test_fx_conversion(self):
        idx = pd.PeriodIndex(["2024-01", "2024-02"], freq="M")
        mkt_rf, rf, s = pd.Series([0.02, -0.01], idx), pd.Series([0.004, 0.004], idx), pd.Series([0.0, 0.03], idx)
        m = convert_market_to_chf(mkt_rf, rf, s)
        self.assertAlmostEqual(m.iloc[0], 0.024)  # s = 0 : rendement total USD
        self.assertAlmostEqual(m.iloc[1], (1 - 0.006) * 1.03 - 1)
        # long-short : conversion de chaque jambe puis différence = F_USD(1+s)
        r_long, r_short = 0.05, 0.01
        f_chf = convert_long_short_to_chf(pd.Series([r_long - r_short], idx[:1]), pd.Series([0.03], idx[:1]))
        legs = ((1 + r_long) * 1.03 - 1) - ((1 + r_short) * 1.03 - 1)
        self.assertAlmostEqual(f_chf.iloc[0], legs, places=15)


if __name__ == "__main__":
    unittest.main()
