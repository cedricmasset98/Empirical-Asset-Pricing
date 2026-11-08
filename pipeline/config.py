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
# Taux du marché monétaire, valeurs mensuelles (cube zimoma) : SARON en fin de
# mois (depuis juin 1999) et créances comptables à court terme de la Confédération
# à 3 mois (GMBF, dernière enchère du mois, depuis 1992). Servent à prolonger le
# taux sans risque avant le SARON quotidien (août 2009).
SNB_MM_CUBE = "zimoma"
SNB_MM_DATA_URL = f"https://data.snb.ch/api/cube/{SNB_MM_CUBE}/data/csv/en"
SNB_MM_ITEMS = {"saron_eom": "SARON", "tbill_3m": "EG3M"}
SNB_MM_FROM = "1988-01"
# Raccord : approximation par le taux de fin de mois précédent acceptée si, sur la
# période du SARON quotidien, corrélation ≥ 0,95 et écart moyen ≤ 0,20 pt/an ;
# GMBF acceptées si, sur la période commune avec le SARON de fin de mois,
# corrélation ≥ 0,90 et écart moyen ≤ 0,75 pt/an.
RF_APPROX_MIN_CORR = 0.95
RF_APPROX_MAX_DIFF = 0.0020
RF_TBILL_MIN_CORR = 0.90
RF_TBILL_MAX_DIFF = 0.0075
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
    "ter_source": "Monthly fund factsheet (data as of 31.07.2026), TER as of 31.03.2026",
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
    "ter_source": "Raiffeisen monthly factsheet (data as of 30.09.2026) and Swiss Fund Data, TER as of 30.06.2026",
}
SFD_FUND_ID = 16291  # identifiant interne Swiss Fund Data de la classe A
SFD_BASE = "https://www.swissfunddata.ch/sfdpub"
SFD_ENTRY_URL = f"{SFD_BASE}/sfd-eingang/private?url=%2Fde%2Ffunds%2Fshow%2F{SFD_FUND_ID}"
SFD_SHOW_URL = f"{SFD_BASE}/de/funds/show/{SFD_FUND_ID}"
SFD_CSV_URL = f"{SFD_BASE}/de/funds/excelData/{SFD_FUND_ID}"

FRENCH_BASE = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/"

# Facteurs suisses de Global Factor Data (Jensen, Kelly et Pedersen, 2023, « Is There a
# Replication Crisis in Finance? », Journal of Finance 78(5)). Portefeuilles long-short
# par terciles de la caractéristique, pondérés par la capitalisation plafonnée
# (vw_cap), en USD, signe déjà orienté (« direction ») vers la jambe à rendement
# attendu élevé. Archives publiques S3 ; manifeste : availability.json.
JKP_BASE = "https://jkpfactors-data.s3.amazonaws.com/public/"
JKP_REGION = "che"
JKP_WEIGHTING = "vw_cap"
# Facteur du site -> caractéristique JKP la plus proche de la définition Fama-French
JKP_FACTORS = {
    "SMB": ("market_equity", "market capitalisation (small − big)"),
    "HML": ("be_me", "book equity / market equity (value − growth)"),
    "RMW": ("ope_be", "operating profit / book equity (robust − weak)"),
    "CMA": ("at_gr1", "annual growth in total assets (conservative − aggressive)"),
    "MOM": ("ret_12_1", "return from t−12 to t−1 (winners − losers)"),
}
JKP_MIN_STOCKS = 30  # en dessous, le facteur repose sur trop peu de titres par jambe
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
    "yahoo": "Yahoo Finance — restrictive terms of use (personal use). Only derived monthly returns are published; check compliance before public distribution.",
    "six": "SIX index data (SPI, SARON) — property of SIX Index AG; public distribution of index data may require a licence. To be checked.",
    "snb": "SNB data portal (data.snb.ch) — public data, cite the source.",
    "french": "Kenneth R. French Data Library — free use with citation.",
    "jkp": "Global Factor Data (jkpfactors.com), Jensen, Kelly and Pedersen (2023) — free academic data, non-commercial use, citation required.",
    "fred": "FRED, Federal Reserve Bank of St. Louis (H.10) — cite the source.",
    "swissfunddata": "Swiss Fund Data (SIX Financial Information AG / AMAS), public data subject to the site's terms — only derived monthly returns are published; check the terms of use before public distribution.",
    "gerifonds": "Gérifonds SA (BCV subsidiary), public fund page — only derived monthly returns are published; check the terms of use before public distribution.",
}
