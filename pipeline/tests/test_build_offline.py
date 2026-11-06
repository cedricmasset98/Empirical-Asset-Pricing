"""Test de bout en bout du pipeline sans réseau : toutes les sources sont
fournies par des fichiers d'import manuel SYNTHÉTIQUES dans un dossier
temporaire (aucune écriture dans public/)."""

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from pipeline import build
from pipeline import config as C


def french_text(cols: list[str], months: pd.PeriodIndex, rng: np.random.Generator) -> str:
    lines = ["Synthetic file", "", "," + ",".join(cols)]
    for p in months:
        vals = rng.normal(0.5, 3, len(cols))
        if cols[-1] == "RF":
            vals[-1] = 0.3
        lines.append(f"{p.year}{p.month:02d}," + ",".join(f"{v:.2f}" for v in vals))
    lines += ["", " Annual Factors: January-December", "," + ",".join(cols), "  2001," + ",".join("1.00" for _ in cols)]
    return "\n".join(lines) + "\n"


class TestBuildOffline(unittest.TestCase):
    def test_end_to_end(self):
        rng = np.random.default_rng(1)
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            manual = tmp / "manual"
            manual.mkdir()
            days = pd.bdate_range("2009-12-01", "2012-06-30")
            px = 100 * np.cumprod(1 + rng.normal(0.0003, 0.01, len(days)))
            pd.DataFrame({"date": days.date, "adj_close": px}).to_csv(manual / "bcv_daily.csv", index=False)
            pd.DataFrame({"date": days.date, "spi_tr": px * 0.9}).to_csv(manual / "spi_tr_daily.csv", index=False)
            pd.DataFrame({"date": days.date, "rate_pct": 0.25}).to_csv(manual / "saron_daily.csv", index=False)
            pd.DataFrame({"date": days.date, "chf_per_usd": 1.0 + 0.0001 * np.arange(len(days))}).to_csv(manual / "usdchf_daily.csv", index=False)
            months = pd.period_range("2009-12", "2012-05", freq="M")
            (manual / "Europe_3_Factors.csv").write_text(french_text(["Mkt-RF", "SMB", "HML", "RF"], months, rng))
            (manual / "Europe_5_Factors.csv").write_text(french_text(["Mkt-RF", "SMB", "HML", "RMW", "CMA", "RF"], months, rng))
            (manual / "Europe_Mom_Factor.csv").write_text(french_text(["WML"], months, rng))

            saved = {k: getattr(C, k) for k in ("MANUAL_DIR", "RAW_DIR", "PROCESSED_DIR", "PUBLIC_DATA")}
            try:
                C.MANUAL_DIR, C.RAW_DIR, C.PROCESSED_DIR, C.PUBLIC_DATA = manual, tmp / "raw", tmp / "processed", tmp / "public"
                code = build.main(["--run-date", "2012-06-15"])
            finally:
                for k, v in saved.items():
                    setattr(C, k, v)
            self.assertEqual(code, 0)
            ds = json.loads((tmp / "public" / "dataset.json").read_text())
            self.assertEqual(ds["dates"][-1], "2012-05")  # juin 2012 incomplet exclu
            self.assertTrue(all(s["status"] == "manual" for s in ds["sources"]))
            i = ds["dates"].index("2011-03")
            for col in ("bcv_ret", "spi_ret", "rf_saron", "mkt_eu_chf", "smb3_chf", "wml_chf", "cma5_chf"):
                self.assertIsNotNone(ds["data"][col][i], col)
            # cohérence : rendement BCV = rendement SPI (même chemin de prix × 0,9)
            self.assertAlmostEqual(ds["data"]["bcv_ret"][i], ds["data"]["spi_ret"][i], places=10)
            # SARON 0,25 % : 28.02.2011 → 31.03.2011 = 31 jours ACT/360
            self.assertAlmostEqual(ds["data"]["rf_saron"][i], 0.0025 * 31 / 360, places=7)  # écart = effet de capitalisation
            # marché converti : (1 + Mkt-RF + RF)(1 + s) − 1
            j = ds["dates"].index("2011-03")
            m = ds["data"]["mkt_rf_usd"][j] + ds["data"]["rf_us"][j]
            s = ds["data"]["fx_usdchf_ret"][j]
            self.assertAlmostEqual(ds["data"]["mkt_eu_chf"][j], (1 + m) * (1 + s) - 1, places=10)
            self.assertTrue((tmp / "processed" / "build_report.md").exists())


if __name__ == "__main__":
    unittest.main()
