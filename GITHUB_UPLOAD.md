# Pakiet do repozytorium GitHub

> **SUPERSEDED (CB-2026-11-25):** opis pakietu pochodzi z dawnej wersji. Obowiązuje wyłącznie
> reguła CB-2026-11-25 opisana w `README.md`; wcześniejsze reguły są historyczne. Przed jakąkolwiek
> publikacją repozytorium (push, Pages, zmiana widoczności) potrzebna jest osobna zgoda właściciela
> i przegląd bramki publikacji (G-01).

Ten katalog jest lokalnym prototypem kalkulatora korekt abonamentu (status TEST_ONLY); nie jest
dopuszczony do użycia produkcyjnego.

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
- Jedyną aktywną regułą obniżek i zakończeń w trakcie miesiąca jest CB-2026-11-25 (miesiące
  28/29/30-dniowe: C, miesiąc 31-dniowy: B, jedna metoda dla całego koszyka). Podwyżki mają osobną
  zasadę opisaną w `README.md`. Dawne reguły (MIN(A,B), rzeczywiste dni ÷ 30) są historyczne.
- Przed użyciem produkcyjnym trzeba zamknąć opisane w README i `docs/` bramki
  prawno-księgowe, w tym D11.
