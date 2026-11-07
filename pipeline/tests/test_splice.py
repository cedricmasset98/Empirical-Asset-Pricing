"""Raccord d'un historique long à une série en ligne (splice_history)."""

import unittest

import numpy as np
import pandas as pd

from pipeline.transform import splice_history


def _series(days, rng, drift=0.0003):
    return pd.Series(1000 * np.cumprod(1 + rng.normal(drift, 0.01, len(days))), index=days)


class TestSplice(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(3)
        self.days = pd.bdate_range("2000-01-03", "2020-12-31")
        self.hist_full = _series(self.days, rng)
        # source récente : depuis 2013, jusqu'en 2026, mêmes niveaux sur le recouvrement
        recent_days = pd.bdate_range("2013-03-05", "2026-10-30")
        ext = pd.bdate_range("2021-01-01", "2026-10-30")
        tail = self.hist_full.iloc[-1] * np.cumprod(1 + rng.normal(0.0003, 0.01, len(ext)))
        self.recent = pd.concat([self.hist_full["2013-03-05":], pd.Series(tail, index=ext)]).reindex(recent_days).dropna()
        self.hist = self.hist_full  # l'historique s'arrête fin 2020

    def test_accepte_et_conserve_les_niveaux_recents(self):
        sp = splice_history(self.hist, self.recent * 1.002)  # léger écart de niveau toléré
        self.assertTrue(sp.ok, sp.message)
        self.assertEqual(sp.series.index[0], self.days[0])
        self.assertEqual(sp.junction, self.recent.index[0])
        r = self.recent * 1.002
        pd.testing.assert_series_equal(sp.series[sp.series.index >= sp.junction], r, check_names=False)
        # rendements de l'historique préservés avant la jonction
        before = sp.series[sp.series.index < sp.junction]
        np.testing.assert_allclose(before.pct_change().dropna(), self.hist[before.index].pct_change().dropna(), rtol=0, atol=1e-12)
        self.assertFalse(sp.series.index.duplicated().any())

    def test_refuse_un_indice_de_prix(self):
        t = np.arange(len(self.recent)) / 252
        price = self.recent * np.exp(-0.03 * t)  # dividendes non réinvestis
        sp = splice_history(self.hist, price / price.iloc[0] * self.recent.iloc[0])
        self.assertFalse(sp.ok)
        self.assertIsNone(sp.series)

    def test_refuse_un_niveau_different(self):
        sp = splice_history(self.hist, self.recent * 1.05)
        self.assertFalse(sp.ok)
        self.assertIn("levels", sp.message)

    def test_refuse_un_recouvrement_trop_court(self):
        sp = splice_history(self.hist[:"2013-06-30"], self.recent)
        self.assertFalse(sp.ok)
        self.assertIn("overlap", sp.message)


if __name__ == "__main__":
    unittest.main()
