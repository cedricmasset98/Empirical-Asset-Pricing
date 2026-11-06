"""olsref (numpy/scipy, utilisé par le rapport) = statsmodels = références du moteur."""

import json
import unittest
from pathlib import Path

import numpy as np

from pipeline import olsref
from pipeline.validate_common import design, required, rows_for

ROOT = Path(__file__).resolve().parents[2]

try:
    import statsmodels.api as sm  # noqa: F401

    HAS_SM = True
except ImportError:
    HAS_SM = False


def load():
    ds = json.loads((ROOT / "tests" / "fixtures" / "synthetic_dataset.json").read_text())
    rows = rows_for(ds, required("CARHART", "EUROPE"))
    return design(ds, "CARHART", "EUROPE", rows)


class TestOlsRef(unittest.TestCase):
    def test_against_numpy_fixture(self):
        ref = json.loads((ROOT / "tests" / "fixtures" / "numpy_reference.json").read_text())["CARHART_EUROPE"]
        y, X, _ = load()
        for cov in ("classical", "HC3", "HAC"):
            f = olsref.fit(y, X, cov, ref["hac_lags"] if cov == "HAC" else None)
            np.testing.assert_allclose(f.params, ref["beta"], rtol=1e-10)
            np.testing.assert_allclose(f.se, ref[cov]["se"], rtol=1e-10)
            np.testing.assert_allclose(f.pvalue, ref[cov]["pvalue"], rtol=1e-8)
            self.assertAlmostEqual(f.joint_stat, ref[cov]["joint"]["stat"], places=8)

    @unittest.skipUnless(HAS_SM, "statsmodels non installé")
    def test_against_statsmodels(self):
        import statsmodels.api as sm
        from statsmodels.stats.diagnostic import acorr_ljungbox, het_breuschpagan

        y, X, _ = load()
        L = olsref.nw_lags(len(y))
        pairs = {
            "classical": sm.OLS(y, X).fit(),
            "HC3": sm.OLS(y, X).fit(cov_type="HC3", use_t=False),
            "HAC": sm.OLS(y, X).fit(cov_type="HAC", cov_kwds={"maxlags": L, "use_correction": False}, use_t=False),
        }
        for cov, r in pairs.items():
            f = olsref.fit(y, X, cov)
            np.testing.assert_allclose(f.params, r.params, rtol=1e-10)
            np.testing.assert_allclose(f.se, r.bse, rtol=1e-9)
            np.testing.assert_allclose(f.pvalue, r.pvalues, rtol=1e-7, atol=1e-14)
            np.testing.assert_allclose(np.column_stack([f.ci_low, f.ci_high]), np.asarray(r.conf_int(0.05)), rtol=1e-9)
        e = pairs["classical"].resid
        lb = acorr_ljungbox(e, lags=[12], return_df=True)
        self.assertAlmostEqual(olsref.ljung_box(e, 12)[0], float(lb["lb_stat"].iloc[0]), places=8)
        self.assertAlmostEqual(olsref.breusch_pagan(e, X)[0], het_breuschpagan(e, X)[0], places=8)


if __name__ == "__main__":
    unittest.main()
