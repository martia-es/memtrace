#!/usr/bin/env bash
# Genera paper.pdf (A4, dos columnas) desde paper.md. Requiere pandoc y typst (brew install pandoc typst).
# Uso, desde cualquier carpeta:   docs/research/mem-paper/build-pdf.sh
set -euo pipefail
cd "$(dirname "$0")"
command -v pandoc >/dev/null || { echo "Falta pandoc: brew install pandoc" >&2; exit 1; }
command -v typst >/dev/null || { echo "Falta typst: brew install typst" >&2; exit 1; }
title="$(sed -n '1s/^# //p' paper.md)"
# el título (primer H1) va en la plantilla, a todo el ancho; --columns grande evita que pandoc reparta anchos de tabla por los guiones
tail -n +2 paper.md | pandoc -f markdown+pipe_tables -t typst --template=paper-template.typ --columns=100000 \
  -M title="$title" -M author="MemTrace team" -o paper.typ.tmp
typst compile paper.typ.tmp paper.pdf
rm -f paper.typ.tmp
echo "OK: $(pwd)/paper.pdf"
