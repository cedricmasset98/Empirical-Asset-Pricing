#!/usr/bin/env bash
# Vérifie que XeLaTeX compile un document avec les paquets et la police du rapport.
set -euo pipefail
fc-cache -f >/dev/null 2>&1 || true
dir=$(mktemp -d)
cat > "$dir/t.tex" <<'TEX'
\documentclass{article}
\usepackage{fontspec}\usepackage{polyglossia}\setdefaultlanguage{french}
\setmainfont{TeX Gyre Pagella}
\usepackage{booktabs,tabularx,enumitem,microtype,graphicx,fancyhdr,caption,amsmath}
\usepackage[most]{tcolorbox}\usepackage[hidelinks]{hyperref}
\begin{document}Test : rendement 9,4~\% ; « guillemets » ; −0,7.\end{document}
TEX
(cd "$dir" && latexmk -xelatex -interaction=nonstopmode -halt-on-error t.tex >/dev/null)
echo "LaTeX opérationnel"
