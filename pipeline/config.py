"""Paramètres des sources de données (aucune clé API requise)."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"  # téléchargements bruts (non versionnés)
MANUAL_DIR = ROOT / "data" / "manual"  # fichiers d'import manuel (prioritaires)
HISTORY_DIR = ROOT / "data" / "history"  # historiques longs raccordés aux sources en ligne
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
# Yahoo ne remonte qu'à mars 2013 : data/history/spi_tr_history.csv (date,spi_tr,
# SPI TR quotidien depuis 1988) prolonge la série vers le passé, après contrôle
# de concordance sur la période commune (pipeline.transform.splice_history).
SPI_TR_HISTORY = "spi_tr_history.csv"
# Indice de prix SMI : utilisé uniquement pour un contrôle de plausibilité du
# caractère « total return » de ^SSHI, jamais comme benchmark.
YAHOO_SMI_PRICE = "^SSMI"

SNB_CUBE = "snbgwdzid"
SNB_DIMENSIONS_URL = f"https://data.snb.ch/api/cube/{SNB_CUBE}/dimensions/en"
SNB_DATA_URL = f"https://data.snb.ch/api/cube/{SNB_CUBE}/data/csv/en"
SNB_FROM_DATE = "1999-01-01"
SNB_FX_DIMENSIONS_URL = "https://data.snb.ch/api/cube/devkum/dimensions/en"
SNB_FX_DATA_URL = "https://data.snb.ch/api/cube/devkum/data/csv/en"

# Fonds BCV Swiss Equity A (CH0006018706), géré par BCV Asset Management, administré
# par Gérifonds. La page publique de la classe contient la série officielle de
# performance « dividendes réinvestis » (base 100, quotidienne depuis 1997), les VNI
# et la table des distributions. Aucune API documentée n'existe : une seule page est
# lue, et tout changement de structure produit une erreur explicite (pas de valeur
# de substitution). Repli : data/manual/fund_tr_daily.csv (date,tr_index).
FUND = {
    "name": "BCV Swiss Equity A",
    "isin": "CH0006018706",
    "valor": "601870",
    "bloomberg": "GERBCAS SW",
    "manager": "BCV Asset Management",
    "currency": "CHF",
    "benchmark": "SPI",
    "inception": "1997-04-22",
    # Frais totaux (TER) publiés : utilisés pour reconstituer un rendement « avant
    # frais » (rendement net + TER/12), comme Fama et French (2010). Seul le TER
    # récent est connu : il est appliqué à toute la période (approximation).
    "ter": 0.0111,
    "ter_date": "2026-03-31",
    "ter_source": "Fiche mensuelle du fonds (données au 31.07.2026), TER au 31.03.2026",
}
GERIFONDS_FUND_URL = "https://www.gerifonds.ch/fr/iframe/CH0006018706?period=6"

# Fonds Raiffeisen Futura - Swiss Stock A (CH0011980981), gestion active déléguée à
# Vontobel Asset Management (direction : Vontobel Fonds Services AG), indice de
# référence SPI TR. Série : export quotidien de Swiss Fund Data (SIX Financial
# Information / AMAS), « Total Return Chart Price » (distributions réinvesties, net
# des frais), depuis le 23.11.2009. L'accès passe par la page d'avertissement du
# site (profil « investisseur privé »). Repli : data/manual/raif_tr_daily.csv
# (date,tr_index).
RAIF = {
    "name": "Raiffeisen Futura - Swiss Stock A",
    "isin": "CH0011980981",
    "valor": "1198098",
    "manager": "Vontobel Asset Management AG (mandat de Raiffeisen Suisse)",
    "fund_management": "Vontobel Fonds Services AG",
    "currency": "CHF",
    "benchmark": "SPI",
    "inception": "2001-06-08",
    "ter": 0.0120,
    "ter_date": "2026-06-30",
    "ter_source": "Fiche mensuelle Raiffeisen (données au 30.09.2026) et Swiss Fund Data, TER au 30.06.2026",
}
SFD_FUND_ID = 16291  # identifiant interne Swiss Fund Data de la classe A
SFD_BASE = "https://www.swissfunddata.ch/sfdpub"
SFD_ENTRY_URL = f"{SFD_BASE}/sfd-eingang/private?url=%2Fde%2Ffunds%2Fshow%2F{SFD_FUND_ID}"
SFD_SHOW_URL = f"{SFD_BASE}/de/funds/show/{SFD_FUND_ID}"
SFD_CSV_URL = f"{SFD_BASE}/de/funds/excelData/{SFD_FUND_ID}"

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
    "swissfunddata": "Swiss Fund Data (SIX Financial Information AG / AMAS), données publiques soumises aux conditions du site — seuls des rendements mensuels dérivés sont publiés ; vérifier les conditions d'utilisation avant diffusion publique.",
    "gerifonds": "Gérifonds SA (filiale de la BCV), page publique du fonds — seuls des rendements mensuels dérivés sont publiés ; vérifier les conditions d'utilisation avant diffusion publique.",
}
