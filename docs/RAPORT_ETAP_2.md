> **SUPERSEDED (25.11.2026):** opisane tu reguły MIN(A,B) i/lub „rzeczywiste dni ÷ 30 dla wszystkich miesięcy” zostały zastąpione regułą CB-2026-11-25 (metoda C dla miesięcy 28/29/30-dniowych, B dla 31-dniowych). Dokument zachowano wyłącznie jako historię; nie służy jako specyfikacja obliczeń.

# Multiplay BOK — Etap 2: lokalny ekran kalkulatora

Data: 13.11.2026. **STATUS: PASS dla lokalnego prototypu testowego.**
Nie jest to dopuszczenie do rzeczywistych korekt ani zamknięcie bramek prawno-księgowych.

## Wykonano

- Lokalnie działający polski ekran: 4 rodzaje zdarzeń, miesiąc, T i E, potwierdzenie daty.
- Dodawanie/usuwanie pozycji (1–50), Oᵢ/Nᵢ/Fᵢ, usługa, etykieta i opis, podstawa oraz informacyjny VAT.
- Zakończenie zeruje i blokuje Nᵢ. Kierunek zmiany oceniamy po sumie koszyka.
- Wynik globalny, dni L/d/r, porównanie A/B, wybrana metoda i nominalna nowa cena.
- Propozycje pozycji z jedną wspólną metodą, znaki różnic, kontrola sum, nieprzypisana reszta groszowa.
- Błędy blokujące, ostrzeżenia, informacje i eskalacje z nazwami pól i powiązaniem dla czytnika ekranu.
- Robocze podsumowanie do schowka i zaznaczenie tekstu do ręcznej kopii, jeśli dostęp jest zablokowany.
- Reset, 7 przykładów syntetycznych i unieważnianie wyniku/kopii po zmianach.
- Zmiana daty lub scenariusza wymaga ponownego potwierdzenia skutecznej daty.

## Architektura

HTML/CSS/JavaScript ESM bez frameworka i bez zależności w przeglądarce.
`app.mjs → evaluateBasket() → calculate()`; `buildSummary()` tworzy tekst bez wolnych opisów.
Zachowano API i plik `src/calculator.mjs` etapu1 bez zmian.
SHA256 przed i po: `99C85E6E41BF26F1FDB9A3DDF4E401035C75F79F4472B6325573E133BB04AEB0`.
Jedyna dodana zależność deweloperska: `@playwright/test` 1.65.0, zablokowana przez package-lock.
Przeglądarki testowe pobrano lokalnie do node_modules/.cache; bez globalnych instalacji.

Precyzja: BigInt w groszach, dokładne liczniki /30, porównanie koszyka przed zaokrągleniem.
Wiersze stosują globalną metodę, nigdy oddzielne MIN. Half-up pozostaje założeniem testowym D11.
Reszta = należność koszyka − suma zaokrąglonych wierszy; może mieć oba znaki i więcej niż 1 grosz.
Nie rozdzielamy jej automatycznie. Przy pełnej O/N wiersze również przyjmują Oᵢ/Nᵢ.
T27 ma jawne ostrzeżenie o zmienionych składnikach mimo stałej sumy.

## Pliki

Nowe:
- `index.html`, `styles.css`, `favicon.svg`, `app.mjs`: ekran i interakcje.
- `src/basket.mjs`, `src/summary.mjs`, `src/examples.mjs`: adapter, tekst i przykłady.
- `server.mjs`: lokalny serwer z jawną listą zasobów.
- `tests/basket.test.mjs`, `tests/server.test.mjs`, `tests/e2e/calculator.spec.mjs`,
  `tests/e2e/error-focus.spec.mjs`: regresja, formularz, prywatność i dostępność.
- `playwright.config.mjs`, `scripts/check.mjs`, `scripts/e2e.mjs`: kontrola i przeglądarki.
- `package-lock.json`, `.gitignore`, `docs/plan-etap-2.md`, `docs/etap-2-zrodla.json`, ten raport.

Zmodyfikowane: `package.json`, `README.md`, nadrzędny `STAN_PROJEKTU.md`.
Nie zmieniano silnika, testów/fixture etapu1 ani historycznego raportu etapu1.
Dowody testów i zrzuty znajdują się w `output/`, poza plikami aplikacji udostępnianymi HTTP.

## Testy i obserwowalne dowody

Środowisko: Windows, Node26.13.0, Chromium158 (Playwright1254), Firefox (Playwright1572).

| Komenda / zakres | Wynik |
| --- | --- |
| Bazowe `npm.cmd test`, przed zmianami | 63/63 PASS |
| `node --test --test-reporter=tap tests/*.test.mjs` | **111/111 PASS**, w tym63 istniejące,47 adaptera i1 serwera |
| `npm.cmd run check` / `node scripts/check.mjs` | **14 plików JS — składnia OK** |
| `node scripts/e2e.mjs` — pełna macierz przed ostatnim rozszerzeniem walidacji długich kwot | **102 PASS, 2 celowo pominięte, 0 FAIL**; 26 scenariuszy ×4 konfiguracje |
| `node scripts/e2e.mjs error-focus.spec.mjs --output=output/playwright/input-final --reporter=list` — końcowa walidacja po poprawce długich kwot | **12/12 PASS**; 3 scenariusze ×4 konfiguracje (w tym powtórzone8 kontroli) |
| `node demo.mjs` | Należność128,33; różnica+21,67; A=B |
| Niezależny przegląd | Brak blokera matematycznego;47/47 testów adaptera i144 dodatkowe porównania dokładnych liczników |

Konfiguracje: Chromium desktop1440×1000, Firefox desktop1440×1000,
Chromium mobile390×844 i Firefox mobile390×844. Są to realne przeglądarki desktopowe
z symulowanym widokiem mobilnym, nie testy na fizycznym telefonie.
W obu przeglądarkach dodatkowo sprawdzono desktop i mobile w testach układu.
Dwa pominięcia dotyczą wyłącznie natywnego odczytu schowka w Firefox (brak tego samego
API uprawnień testowych); natywną kopię sprawdzono w Chromium, a ręczny fallback w obu.
Nie deklarujemy natywnego odczytu schowka Firefox jako przetestowanego.

T26: B, koszyk140,67; różnica+9,33; propozycje81,33/59,33; ich suma140,66;
reszta+0,01 otwarta. Różnice wierszy+18,67/−9,33 zachowane.
T27: pełna O, koszyk150,00, różnica0,00, wiersze100/50 i ostrzeżenie D11.
Sprawdzono także28/29/30/31 dni, podwyżkę od1/2dnia, zakończenie E/T, F≠O,
blokadę kwot/netto/mieszanego VAT/wielu dat/rabatów, przykłady, reset, schowek,
brak zapisu, odświeżenie, klawiaturę, nazwy kontrolek i brak poziomego przewijania.
Diagnostyka każdego głównego scenariusza: brak zewnętrznych żądań, błędów konsoli,
błędów strony, nieudanych żądań i odpowiedzi HTTP>=400.

Dowody:
- `output/verification/output-stage2-final-unit.tap`;
- `output/verification/output-stage2-e2e-final.log` i `output/playwright/results.json`;
- `output/verification/output-stage2-input-final.log`;
- `output/playwright/desktop.png`, `output/playwright/mobile.png`.

Nie ma bundlera, TypeScript ani kroku kompilacji; `--check` nie jest typecheckiem.
Testy lokalnego HTTP i przeglądarek wymagały uruchomienia poza ograniczeniem połączeń
środowiska wykonawczego. Zwykły lokalny proces serwera działa na komputerze użytkownika.
Początkowy nieudany dostęp HTTP w ograniczonym środowisku nie był błędem aplikacji.

## Wykryte i poprawione

- Nazwa przycisku reset zasłaniała metodę formularza: użyto prototype.reset.call(form).
- Błąd kwoty nie identyfikował wiersza/pola: dodano opis, aria-describedby i przycisk fokusu.
- Zbyt niski maxlength mógł obciąć długą błędną kwotę do poprawnie wyglądającej:
  wejście zachowuje takie kwoty, a parser je odrzuca. Dedykowany test RED→GREEN w4 konfiguracjach.
- Dopracowano polskie podglądy dat, mobilne porównanie O/N i ukrycie skip-link poza fokusem.
- Poprawiono błędne założenia testów: wyłączone N=0, semantyka komunikatu0zł,
  normalizacja CRLF schowka Windows. Nie osłabiono testów kwot ani prywatności.
- Jedna ręczna oczekiwana wartość testu wielkiej kwoty była błędna: po niezależnej analizie
  B=O−0,004666… końcówka pozostaje,99, nie,98. Silnika nie zmieniano.

## UI/UX

Wybrano arkusz operacyjny spośród3 koncepcji; wynik i porównanie pozycji są poniżej danych.
Systemowa typografia, cyfry tabelaryczne, czytelny fokus i etykiety, minimum dekoracji.
Niezależny przegląd wizualny oraz oględziny zrzutów desktop/mobile: PASS dla tych widoków.
Natywne kontrolki kalendarza mogą stosować język/układ dat systemu operacyjnego;
dlatego obok zawsze jest jawny podgląd polski dd.mm.rrrr i mm.rrrr.

## Bezpieczeństwo i otwarte bramki

Wyłącznie loopback127.0.0.1:4173. Serwer udostępnia tylko zasoby ekranu, GET/HEAD,
nie zapisuje danych, nie loguje treści sprawy; ma CSP connect-src 'none', no-store,
ochronę Host i blokadę formularzy/ramek. Brak danych rzeczywistych klientów,
localStorage, sessionStorage, cookies, bazy, telemetryki, integracji MMS i publikacji.
Dowolne teksty etykiet/opisów są wyświetlane przez textContent i pomijane w kopii.
Nie tworzono repo ani PR, nie wykonano push/deploy, nie edytowano Notion ani GitHub.
MagicPath/Figma nie były potrzebne; nie przesyłano makiet/kodu do zewnętrznych usług.
Notion odczytano jako źródło; Context7 posłużył do ogólnej dokumentacji Playwright.

Otwarte: D11 (VAT, znaki, księgowanie, grosze), D05, D18/D19/D22 i właściwe pozostałe
bramki przed produkcją. Brak weryfikacji czytnikiem ekranu na fizycznym urządzeniu.
Propozycje pozycji i half-up są testowe; nie traktować kopii jako instrukcji MMS.

## Uruchomienie i kolejny etap

```powershell
Set-Location 'C:\Users\lcichanowicz\OneDrive - Multiplay\Dokumenty\ChatGPT\30\bok-1-30'
npm.cmd start
```

Adres: http://127.0.0.1:4173. Serwer pozostawiono uruchomiony do przeglądu.
Ctrl+C zatrzymuje serwer. Przy ponownym uruchamianiu nie uruchamiaj drugiej kopii na tym samym porcie.

**NEXT STEP:** przegląd lokalnego prototypu przez właściciela BOK i zebranie konkretnych uwag do ekranu;
ustalenie D11 z księgowością przed zamianą roboczych propozycji na wartości operacyjne MMS.
