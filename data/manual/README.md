# Import manuel des sources

Si un fichier ci-dessous existe dans ce dossier, le pipeline (`python -m pipeline.build`) l'utilise **à la place** de la source en ligne. La source est alors marquée « manuel » dans le manifeste et dans l'interface.

| Fichier | Colonnes | Contenu |
|---|---|---|
| `bcv_daily.csv` | `date,adj_close` | Cours BCV ajusté des dividendes **et** des opérations sur titres |
| `spi_tr_daily.csv` | `date,spi_tr` | Niveau du SPI **Total Return** (SXGE), jamais un indice de prix |
| `saron_daily.csv` | `date,rate_pct` | Fixing SARON quotidien en % annualisé (ex. 1.703) |
| `fund_tr_daily.csv` | `date,tr_index` | Indice de performance du fonds BCV Swiss Equity A, **distributions brutes réinvesties**, net de frais (jamais une VNI seule) |
| `usdchf_daily.csv` | `date,chf_per_usd` | Cours USD/CHF, en CHF pour 1 USD |
| `Europe_3_Factors.csv` | format K. French | Fichier CSV décompressé de la Data Library |
| `Europe_5_Factors.csv` | format K. French | idem |
| `Europe_Mom_Factor.csv` | format K. French | idem |

Les dates sont au format `AAAA-MM-JJ`.

Avant de publier des fichiers ici sur un dépôt public, vérifiez que leur licence autorise la redistribution.

Vous pouvez aussi importer **directement dans le navigateur** un CSV mensuel déjà préparé (onglet « Données & méthodologie »). Ce fichier n'est envoyé nulle part.
