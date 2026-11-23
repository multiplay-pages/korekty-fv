# Raport lokalnego etapu 1 — 12.11.2026

Status: ukończono lokalny etap silnika testowego. Produkcja: niedopuszczona.

## Wykonano

- Czysta funkcja calculate: data T/E, miesiąc, typ, O/N/F, opcjonalna wpłata P.
- Dokładne grosze BigInt i ułamki /30; wybór metody przed zaokrągleniem.
- Walidacja danych i kierunku, jawne ostrzeżenia, wynik ze znakiem i statusem TEST_ONLY.
- Snapshot 27 pełnych kart Notion i fixture T01–T25 z URL źródeł.
- T26–T27 sprawdzają tylko kontrakt sumaryczny; pełne kryteria MMS pozostają otwarte.
- Dokumentacja API, przykład oraz wspólny plik stanu projektu.

## Weryfikacja

Środowisko: Windows PowerShell, Node v26.13.0, bez zainstalowanych zależności.

| Komenda | Wynik |
| --- | --- |
| node --test tests/calculator.test.mjs (pusta funkcja) | RED — asercje wyników nie przechodzą, red-reference.log |
| node --test tests/calculator.test.mjs (rozszerzony zestaw, pusta funkcja) | RED — red-all.log |
| node --test --test-reporter=tap tests/calculator.test.mjs | 63 PASS, 0 FAIL, 0 TODO, test-results.tap |
| npm.cmd test | 63 PASS, 0 FAIL; final-tests.log |
| npm.cmd run check | Wszystkie trzy pliki JS przeszły node --check |
| npm.cmd run demo | 128.33 PLN należności, +21.67 PLN różnicy, A=B; demo-output.txt |

Nie ma etapu kompilacji/bundlowania ani TypeScript; typecheck nie był uruchamiany.
`node --check` sprawdza składnię, a nie typy. Nie instalowano kompilatora.
`git status --short` i `git diff --stat` potwierdziły brak repozytorium; nie tworzymy go.
PowerShell zgłasza przy starcie komunikat InitializeDefaultDrives niezwiązany z aplikacją;
komendy Node/npm i testy zakończyły się kodem 0.

Osobny reviewer odczytał kod, testy, fixture i plan oraz powtórzył testy: brak usterek
blokujących zakres etapu 1. Sprawdził m.in. duże kwoty, daty, równość koszyka i pola wejścia.

Wolfram niezależnie potwierdził algebraiczną różnicę A−B oraz T26:
łączna B = 422/3 PLN, Internet B = 244/3 PLN, TV B = 178/3 PLN.
To weryfikacja matematyczna, bez potwierdzenia VAT i księgowania.

## Ograniczenia

Half-up jest testowym założeniem do D11. Wyłącznie jedna data i uzgodniony koszyk brutto.
Bez alokacji pozycji, VAT/netto, rabatów ujemnych, wielu zmian, danych klientów i UI.
T27 w tabeli ma A=B; w API brak zmiany oznacza pełne O (tak jak T20), przy pomocniczych
A=B. Nie wybieramy samodzielnie metody księgowej dla wierszy.
Brak przeglądarki, serwera, integracji, nowego repo, publikacji i zmian w Notion/GitHub.

Przed rzeczywistymi korektami: D05, D11 i pozostałe właściwe bramki umowne,
operacyjne i techniczne, w tym D18/D19/D22. Testy nie zamykają żadnej z tych decyzji.
