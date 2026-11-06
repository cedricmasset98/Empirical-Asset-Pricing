"""Paramètres des sources de données (aucune clé API requise)."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"  # téléchargements bruts (non versionnés)
MANUAL_DIR = ROOT / "data" / "manual"  # fichiers d'import manuel (prioritaires)
PROCESSED_DIR = ROOT / "data" / "processed"
PUBLIC_DATA = ROOT / "public" / "data"
REFERENCE_DIR = ROOT / "tests" / "reference"

ASSET = {
    "name": "Banque Cantonale Vaudoise",
    "ticker": "BCVN",
    "yahoo": "BCVN.SW",
    "isin": "CH0531751755",
    "currency": "CHF",
}

YAHOO_BCV = "BCVN.SW"
# ^SSHI = SPI (Swiss Performance Index, symbole SIX SXGE). Selon SIX, le SPI est
# calculé comme indice de performance (dividendes réinvestis). Le pipeline ne
# remplace JAMAIS cette série par un indice de prix.
YAHOO_SPI_TR = "^SSHI"
# Indice de prix SMI : utilisé uniquement pour un contrôle de plausibilité du
# caractère « total return » de ^SSHI, jamais comme benchmark.
YAHOO_SMI_PRICE = "^SSMI"

SNB_CUBE = "snbgwdzid"
SNB_DIMENSIONS_URL = f"https://data.snb.ch/api/cube/{SNB_CUBE}/dimensions/en"
SNB_DATA_URL = f"https://data.snb.ch/api/cube/{SNB_CUBE}/data/csv/en"
SNB_FROM_DATE = "1999-01-01"
SNB_FX_DIMENSIONS_URL = "https://data.snb.ch/api/cube/devkum/dimensions/en"
SNB_FX_DATA_URL = "https://data.snb.ch/api/cube/devkum/data/csv/en"

FRENCH_BASE = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/"
FRENCH_FILES = {
    "ff3": ["Europe_3_Factors_CSV.zip"],
    "ff5": ["Europe_5_Factors_CSV.zip"],
    "mom": ["Europe_Mom_Factor_CSV.zip", "Europe_MOM_Factor_CSV.zip"],
}

FRED_USDCHF = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DEXSZUS"
YAHOO_USDCHF = "CHF=X"  # repli : USD/CHF (CHF par USD)

# Tolérance (jours calendaires) entre la dernière observation d'un mois et la
# fin du mois ; au-delà, le mois est considéré comme incomplet (valeur manquante).
MAX_MONTH_END_GAP_DAYS = 5

HTTP_HEADERS = {"User-Agent": "empirical-asset-pricing-pipeline/1.0 (academic research)"}

LICENSES = {
    "yahoo": "Yahoo Finance — conditions d'utilisation restrictives (usage personnel). Seuls des rendements mensuels dérivés sont publiés ; vérifier la conformité avant diffusion publique.",
    "six": "Données d'indices SIX (SPI, SARON) — propriété de SIX Index AG ; la diffusion publique de données d'indices peut nécessiter une licence. À vérifier.",
    "snb": "Portail de données BNS (data.snb.ch) — données publiques, citer la source.",
    "french": "Kenneth R. French Data Library — usage libre avec citation.",
    "fred": "FRED, Federal Reserve Bank of St. Louis (H.10) — citer la source.",
}
