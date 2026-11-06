# Historiques longs

Ces fichiers prolongent vers le passé une source en ligne dont l'historique est trop court. Contrairement à `data/manual/`, ils ne **remplacent pas** la source en ligne : ils ne servent qu'avant sa première date, et seulement si les deux séries concordent sur leur période commune (`pipeline.transform.splice_history`). Le résultat du contrôle apparaît dans `data/processed/build_report.md` (contrôle `spi-history`).

Les contrôles portent sur :

- le niveau : ratio médian à moins de 1 % ;
- la dérive : moins de 1 % entre le début et la fin du recouvrement ;
- les jours divergents : au plus 2 % au-delà de 0,5 %.

Si l'un d'eux échoue, le raccord est refusé et seule la série en ligne est utilisée.

| Fichier | Colonnes | Contenu |
|---|---|---|
| `spi_tr_history.csv` | `date,spi_tr` | SPI **Total Return** (SXGE), CHF, quotidien du 1988-01-04 au 2025-05-16. Repris de `SPI [TR] [CHF].xlsx` (dépôt Financial-time-series-analysis). Les points mensuels de 1987 du fichier d'origine sont écartés, car leurs dates sont manifestement décalées (1 045,5 au 1987-06-01, alors que l'indice vaut 1 000 à cette date). Prolonge `^SSHI` (Yahoo), disponible depuis mars 2013 seulement. |

Données d'indice SIX : vérifier que la licence autorise leur publication dans un dépôt public.
