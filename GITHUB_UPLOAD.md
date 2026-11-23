# Pakiet do prywatnego repozytorium GitHub

Ten katalog można w całości umieścić w **nowym prywatnym repozytorium**. Jest to lokalny
prototyp kalkulatora korekt abonamentu 1/30; nie jest dopuszczony do użycia produkcyjnego.

## Co wysłać

Wyślij zawartość rozpakowanego archiwum `bok-1-30-github.zip`, zachowując strukturę
folderów. W pakiecie są między innymi:

- ekran WWW: `index.html`, `app.mjs`, `styles.css`, `favicon.svg`;
- logika obliczeń: `src/`;
- testy: `tests/` i `scripts/`;
- opis uruchomienia i ograniczeń: `README.md` oraz `docs/`.

Nie dodawaj ręcznie `node_modules/`, `output/`, raportów przeglądarek ani lokalnych logów.
Reguły `.gitignore` zabezpieczają przed przypadkowym dodaniem tych plików po utworzeniu
repozytorium.

## Pierwsze uruchomienie po pobraniu z GitHub

Wymagany jest Node.js 22 lub nowszy. W katalogu repozytorium uruchom:

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run browsers:install
npm.cmd test
npm.cmd run check
npm.cmd start
```

Ekran będzie dostępny pod adresem `http://127.0.0.1:4173`.

## Ważne ograniczenia

- Nie ma integracji z MMS, księgowością ani bazą danych.
- Nie wpisuj danych rzeczywistych klientów do przykładów ani do zgłoszeń GitHub.
- Obecna reguła nalicza obniżki i zakończenia według rzeczywistych dni / 30 po rabatach;
  podwyżki zachowują osobną zasadę od kolejnego miesiąca.
- Przed użyciem produkcyjnym trzeba zamknąć opisane w README i `docs/` bramki
  prawno-księgowe, w tym D11.
