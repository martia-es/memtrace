// Plantilla de pandoc (typst) para el paper: A4, dos columnas, título y resumen a todo el ancho.
#set page(paper: "a4", margin: (x: 1.6cm, top: 1.8cm, bottom: 2cm), numbering: "1", columns: 2)
#set columns(gutter: 0.6cm)
#set text(font: "New Computer Modern", size: 9pt, lang: "en")
#set par(justify: true, leading: 0.68em, spacing: 1.1em)
#set list(spacing: 0.9em, body-indent: 0.6em)
#set enum(spacing: 0.9em, body-indent: 0.6em)
#set heading(numbering: none)
#show heading.where(level: 2): it => block(above: 1.6em, below: 0.8em, text(size: 10.5pt, weight: "bold", it.body))
#show heading.where(level: 3): it => block(above: 1.3em, below: 0.7em, text(size: 9.5pt, weight: "bold", style: "italic", it.body))
#show raw: set text(size: 7.5pt)
#show raw.where(block: true): it => block(width: 100%, fill: luma(245), inset: 4pt, radius: 2pt, it)
#show link: set text(fill: rgb("#1a4f8a"))

// Las tablas anchas flotan a todo el ancho de la página, con letra pequeña
#show figure: set block(breakable: false)
#set figure(placement: auto, scope: "parent")
#show table: set text(size: 6.8pt)
#set table(inset: (x: 3pt, y: 2.5pt), stroke: (x, y) => (top: if y <= 1 { 0.5pt } else { 0pt }, bottom: 0.5pt))
#show table.cell.where(y: 0): set text(weight: "bold")

#place(top + center, scope: "parent", float: true, clearance: 1.2em)[
  #align(center)[
    #text(size: 15pt, weight: "bold")[$title$]
    $if(author)$#v(0.5em) #text(size: 10pt)[$author$]$endif$
  ]
]

$body$
