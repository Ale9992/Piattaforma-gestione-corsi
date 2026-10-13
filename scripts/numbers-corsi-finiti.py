#!/usr/bin/env python3
"""Estrae i corsi conclusi dal documento Numbers "Corsi Finiti" in un file JSON.

Nel documento ogni FOGLIO è un cliente e ogni TABELLA è un corso; le righe sono
le lezioni. L'export in CSV perdeva entrambi i nomi, per questo si legge il
documento originale.

    python3 scripts/numbers-corsi-finiti.py "~/Library/.../Corsi Finiti.numbers" corsi.json

Richiede numbers-parser:  pip install numbers-parser
"""
import json
import re
import sys
from datetime import datetime
from pathlib import Path

from numbers_parser import Document

TABELLE_GENERICHE = {"tabella 1", "calendario_lezioni", "calendario", "tabella"}


def testo(valore) -> str:
    if valore is None:
        return ""
    if isinstance(valore, datetime):
        return valore.strftime("%Y-%m-%d")
    if isinstance(valore, float) and valore.is_integer():
        return str(int(valore))
    return str(valore).strip()


def numero(valore):
    if isinstance(valore, (int, float)):
        return float(valore)
    s = testo(valore).replace(",", ".")
    return float(s) if re.fullmatch(r"\d+(\.\d+)?", s) else None


def leggi_tabella(tabella, cliente):
    """Righe della tabella -> lezioni, più il titolo eventualmente in cima."""
    titolo = ""
    lezioni = []
    ore_dichiarate = None

    for indice, riga in enumerate(tabella.rows()):
        celle = [c.value for c in riga]
        # Il testo mostrato conta più del valore: Numbers interpreta "9-11" come data.
        mostrati = []
        for c in riga:
            formattato = getattr(c, "formatted_value", None)
            mostrati.append(formattato if formattato not in (None, "") else testo(c.value))

        pieni = [t for t in (testo(v) for v in celle) if t]
        if not pieni:
            continue

        primo = testo(celle[0])
        if indice == 0 and len(pieni) == 1 and not isinstance(celle[0], datetime):
            titolo = primo  # es. "Corso Santese"
            continue
        if primo.lower() in ("lezione", "lezioni", "giorno"):
            continue  # riga di intestazione

        data = next((c for c in celle if isinstance(c, datetime)), None)
        if data is None:
            ore = next((numero(c) for c in celle if numero(c) is not None), None)
            if ore is not None and lezioni:
                ore_dichiarate = ore  # riga finale col totale
            continue

        indice_data = next(i for i, c in enumerate(celle) if isinstance(c, datetime))
        dopo = mostrati[indice_data + 1 :]
        lezioni.append(
            {
                "etichetta": primo,
                "data": data.strftime("%Y-%m-%d"),
                "orario": next((t for t in (testo(v) for v in dopo) if re.search(r"\d\s*[-–]\s*\d", t)), ""),
                "stato": next((t for t in (testo(v) for v in dopo) if re.search(r"esegui|svolt|annullat", t, re.I)), ""),
                "ore": next((numero(v) for v in dopo if numero(v) is not None), None),
                "nota": testo(dopo[-1]) if dopo and not re.search(r"\d\s*[-–]\s*\d|esegui|annullat", testo(dopo[-1]), re.I) else "",
            }
        )

    nome_tabella = tabella.name.strip()
    corso = "" if nome_tabella.lower() in TABELLE_GENERICHE else nome_tabella
    return {
        "cliente": cliente,
        "corso": corso or titolo or f"Corso {cliente}",
        "titoloInterno": titolo,
        "oreDichiarate": ore_dichiarate,
        "lezioni": lezioni,
    }


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    percorso = Path(sys.argv[1]).expanduser()
    destinazione = Path(sys.argv[2])
    doc = Document(str(percorso))

    corsi = []
    for foglio in doc.sheets:
        for tabella in foglio.tables:
            corso = leggi_tabella(tabella, foglio.name.strip())
            if corso["lezioni"]:
                corsi.append(corso)

    destinazione.write_text(json.dumps(corsi, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(corsi)} corsi estratti in {destinazione}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
