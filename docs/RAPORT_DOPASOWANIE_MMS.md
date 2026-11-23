# Etap 2 — dopasowanie do pracy na starej i nowej pozycji MMS

13.11.2026. **Status: gotowy do lokalnego przeglądu, TEST_ONLY.** Potwierdzenie procesu przez właściciela BOK
nie zatwierdza księgowania. Końcowa macierz przeglądarek: 142 PASS, 2 celowo pominięte.
Nie publikowano aplikacji, nie tworzono repozytorium i nie zapisywano zmian w Notion/GitHub.

## Rezultat dla operatora

Użytkownik potwierdził, że w MMS koryguje starą pozycję do naliczenia cząstkowego
i dodaje osobną pozycję nowego abonamentu według przyjętych zasad.
Wynik „Jak przygotować korektę” podaje teraz kwotę starej pozycji po korekcie,
zmniejszenie/zwiększenie tej pozycji, nową opłatę, okresy i sumę obu części.
Kopia opisuje działania słowami, żeby znak różnicy nie zmieniał znaczenia między sekcjami.

Przykład T03, listopad2026, zmiana18.11, miesięczne150→100 zł, na fakturze150 zł:

| Działanie | Kwota / okres |
| --- | --- |
| Skoryguj stary abonament | ze150,00 do85,00 zł, 01–17.11.2026 |
| Zmniejszenie starej pozycji | 65,00 zł |
| Dodaj nowy abonament | 43,33 zł, 18–30.11.2026 |
| Razem po zmianie | 128,33 zł |
| Zmniejszenie faktury | 21,67 zł |

Formularz przyjmuje pełne ceny miesięczne. Kwota na fakturze kopiuje dotychczasowy
abonament, a jawna opcja „Na fakturze jest inna kwota” umożliwia odrębne wpisanie F.
Wolne opisy i etykiety oraz osobny checkbox daty usunięto z ekranu.
Podstawa/VAT i pomocnicze wzory są rozwijane. Wprowadzona data jest informacją
od operatora, nie wynikiem weryfikacji prawnej. Wewnętrzny kontrakt `dateVerified:true`
pozostał w API, przekazywany przez ekran bez osobnego potwierdzenia.
Zmiana danych nadal ukrywa wynik i czyści kopię. Nie dodano grafik dekoracyjnych.

## Matematyka i wyjątki

`calculate()` i `evaluateBasket()` pozostają bez zmian. Nowy moduł prezentacji
`buildInvoicePlan()` korzysta z wybranej globalnie metody:

- A / A=B: stary abonament O×d/30, nowy N×(30−d)/30.
- B: stary abonament O×(30−r)/30, nowy N×r/30.
- Pełna O/N zachowuje pełną miesięczną opłatę; podwyżki nie tworzą cząstkowej dopłaty
  w miesiącu zmiany od dnia2 lub później. Data wyższej ceny jest liczona z T, także gdy
  T leży poza miesiącem analizy i przechodzi przez koniec roku.
- Zakończenie nie tworzy nowej opłaty. Dodatnia część zaokrąglona do zera zachowuje
  rzeczywisty okres i komunikat o kontroli zaokrągleń.

Każdy dokładny licznik starej+nowej części jest równy istniejącemu licznikowi wiersza.
Pieniądze to BigInt, liczniki w groszach /30, bez konwersji pieniędzy na Number.
Każda część zaokrąglana niezależnie half-up jako założenie testowe; reszty nie są
przydzielane do arbitralnej części. Daty rzeczywiste nie są mylone ze współczynnikami30.

| Ten sam abonament150→100 od18.dnia | Stara część | Nowa część | Metoda |
| --- | --- | --- | --- |
| Luty28dni /29dni | 85,00 | 43,33 | A |
| Listopad30dni | 85,00 | 43,33 | A=B |
| Marzec31dni | 80,00 | 46,67 | B |

T26: stare53,33/26,67 i nowe28,00/32,67 dają140,67 zł. Dotychczasowe kontrolne
wiersze81,33/59,33 dają140,66 zł. Reszta podziału TV−0,01 oraz reszta koszyka+0,01
znoszą się w sumie, lecz obie pozostają jawne i wymagają D11.
T27: suma150,00 zł i kontrolne pełne O100/50 pozostają. Nie podaje się arbitralnych
starych i nowych części przy kompensujących się zmianach składników.

SHA256 silnika przed/po:
`99c85e6e41bf26f1fdb9a3ddf4e401035c75f79f4472b6325573e133bb04aeb0`.

## Zmienione pliki

- Nowe: `src/invoice-plan.mjs`, `tests/invoice-plan.test.mjs`,
  `docs/plan-korekta-ekranu.md`, ten raport.
- Ekran/kopia: `app.mjs`, `index.html`, `styles.css`, `src/summary.mjs`.
- Udostępnienie nowego modułu: `server.mjs`, `tests/server.test.mjs`, `scripts/check.mjs`.
- Testy przeglądarki: `tests/e2e/calculator.spec.mjs`, `tests/e2e/error-focus.spec.mjs`.
- Dokumentacja: `README.md`, nadrzędny `STAN_PROJEKTU.md`.

Nie zmieniono `src/calculator.mjs`, `src/basket.mjs`, fixture/testów etapu1,
zależności ani historycznych raportów etapów1–2.

## Weryfikacja

| Komenda / kontrola | Wynik |
| --- | --- |
| Bazowa regresja przed zmianami | 111/111 PASS |
| Nowe testy rozbicia wobec pustej implementacji | 38 oczekiwanych FAIL (RED) |
| Pierwsza pełna regresja po implementacji | 149/149 PASS |
| Dodatkowe testy działań i przyszłej daty podwyżki przed poprawką | 3 oczekiwane FAIL (RED) |
| `node --test --test-reporter=tap tests/*.test.mjs` | **155/155 PASS**, w tym44 nowych |
| `node scripts/check.mjs` | **16 plików — składnia OK** |
| Pierwsza macierz uproszczonego UI | **130 PASS, 2 celowo pominięte, 0 FAIL** |
| `node scripts/e2e.mjs --output=output/playwright/mms-final --reporter=list` | **142 PASS, 2 celowo pominięte, 0 FAIL**; 36 scenariuszy ×4 konfiguracje |
| `node scripts/e2e.mjs --grep layout --output=output/playwright/mms-layout-final --reporter=list` | **8/8 PASS** po końcowym uproszczeniu etykiet mobilnych |
| `node demo.mjs` | 128,33 zł; różnica+21,67; A=B |
| `certutil -hashfile src\calculator.mjs SHA256` | Identyczny silnik etapu1 |
| Ponowny niezależny przegląd matematyki i opisów | Brak pozostałych konkretnych błędów |

Kontrole obejmują28/29/30/31dni, Fauto i odrębne F, obniżkę, podwyżkę1/2dnia,
zakończenie, T26/T27, dodatnie i ujemne reszty, duże/błędne kwoty, netto/mieszany VAT,
wiele dat/rabaty, fokus, klawiaturę, reset, unieważnienie wyniku, kopię i jej fallback,
brak trwałego zapisu i brak żądań do usług zewnętrznych.
Konfiguracje: Chromium/Firefox, desktop1440×1000 i symulowany widok mobilny390×844.
Dwa pominięcia dotyczą wyłącznie natywnego odczytu schowka Firefox; natywna kopia
Chromium i ręczne kopiowanie w obu przeglądarkach są objęte kontrolą.
Nie deklarujemy testów na fizycznym telefonie ani pełnego audytu czytników ekranu.

Test serwera HTTP wymagał uruchomienia z dostępem do lokalnych połączeń; wcześniejszy
`fetch failed` w ograniczonym środowisku dotyczył tego dostępu. Po poprawnym uruchomieniu
155/155 PASS. Nie ma TypeScript ani bundlera — kontrola składni nie jest typecheckiem/buildem.
Wolfram potwierdził algebraicznie zgodność części z metodami A/B; nie przesyłano danych klientów.

Dowody: `output/verification/refine-final-unit.tap`, `refine-split-red.tap`,
`refine-semantics-red.tap`, `mms-final-e2e.log`, `mms-layout-final.log`.
Aktualne zrzuty: `output/playwright/mms-desktop.png`, `output/playwright/mms-mobile.png`.
Obejrzano oba końcowe zrzuty: poprawne rozbicie i etykiety, bez obciętych kontrolek
ani poziomego przewijania całego dokumentu w sprawdzonych rozmiarach.

## Otwarte punkty i wznowienie

D11 (VAT, znaki księgowe, niezależne zaokrąglanie części, reszty i MMS) pozostaje
otwarte. D05, D18/D19/D22 oraz pozostałe właściwe bramki produkcyjne nie są zamknięte.
Potwierdzony sposób pracy w MMS nie jest dowodem akceptacji polityki groszy i VAT.
Brak integracji, taryf historycznych, danych klientów, bazy, telemetryki i publikacji.
Wszystkie operacje pozostały lokalne poza odczytami źródeł i weryfikacją algebraiczną.

Adres do przeglądu: http://127.0.0.1:4173. Przy działającym serwerze wystarczy odświeżyć
kartę i wczytać T03. Nie uruchamiać równolegle drugiego serwera na tym samym porcie.
W kolejnych czatach zacząć od `STAN_PROJEKTU.md`, README i tego raportu.
Nie odtwarzać zakończonych etapów od zera; dalszy krok to uwagi do lokalnego ekranu
oraz uzgodnienie D11 przed przeniesieniem kwot do rzeczywistych dokumentów.
