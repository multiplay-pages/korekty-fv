> **SUPERSEDED (25.11.2026):** opisane tu reguły MIN(A,B) i/lub „rzeczywiste dni ÷ 30 dla wszystkich miesięcy” zostały zastąpione regułą CB-2026-11-25 (metoda C dla miesięcy 28/29/30-dniowych, B dla 31-dniowych). Dokument zachowano wyłącznie jako historię; nie służy jako specyfikacja obliczeń.

# Etap 2 — rzeczywiste dni /30 i czytelny kalkulator

13.11.2026. **Weryfikacja lokalna: PASS.** Wersja reguły0.2.0, prototyp TEST_ONLY.
Nie jest to dopuszczenie do produkcji.

## Polecenie i rozstrzygnięcie

Właściciel wskazał zasadę z załączonego tekstu: cena abonamentu brutto po rabatach
× rzeczywiste dni obowiązywania tej ceny ÷30. W przykładzie luty28-dniowy,
100→80 zł od4.02:100×3/30=10,00 i80×25/30=66,67, razem76,67 zł.
To jawna zmiana wcześniejszego MIN(A,B), który dla tego wejścia dawał82,00 zł.
Nie jest tylko zmianą opisów lub pozornym przeliczeniem dotychczasowego wyniku.

Na osobne pytanie właściciel odpowiedział: **zachować wcześniejszą zasadę podwyżek
od następnego miesiąca**. Podwyżka od1.dnia nadal oznacza pełną nową cenę,
od2.dnia — pełną starą cenę do końca miesiąca, nową od następnego1.dnia względem T.

Pełne niezmienione miesiące pozostają pełnym abonamentem. Niezmieniona usługa
w zmieniającym się koszyku również zachowuje pełną cenę miesięczną.
Zmiana składników przy niezmienionej sumie nadal wymaga uzgodnienia rozbicia z rozliczeniami.
Zasady księgowe, VAT, reszty i D11 nie zostały automatycznie zatwierdzone.

## Co zmieniono na ekranie

- Opisowe nazwy przykładów bez Txx. Nowy przykład lutowy zgodny z materiałem użytkownika.
  Pusty wybór początkowy, bez automatycznego ładowania danych.
- „Sposób naliczenia: Rzeczywiste dni ÷30” lub pełny, opisowy wariant zamiast litery A/B.
- „Skąd te kwoty?” pokazuje dla każdej usługi cenę, rzeczywiste dni, dzielnik30,
  wynik części oraz dodawanie obu kwot. Bez symboli O/N/d/r i porównania dwóch metod.
- Sekcja cen wprost wymaga pełnych miesięcznych kwot brutto po rabatach.
- Kopia zawiera te same wyjaśnienia i słowne zmniejszenie/zwiększenie faktury.
- „Resetuj wszystko” przy formularzu i dodatkowy przycisk „Nowe obliczenie — resetuj wszystko”
  przy wyniku. Reset przywraca wartości, domyślne opcje, pusty wybór przykładu,
  jedną pustą pozycję, zamknięte szczegóły; usuwa wynik, błędy, ostrzeżenia i kopię.
- Zakończenie przed miesiącem lub od jego początku mówi o braku opłaty i świadczenia,
  zamiast sugerować nowy abonament0zł.

## Architektura i dokładność

Nowy `src/daily-proration.mjs`: `evaluateDailyBasket()` korzysta z istniejącej walidacji
i kalendarza `evaluateBasket()`, odrzuca historyczne obliczenia A/B i tworzy nowe
należności, części oraz kontrole reszt. Nie ma wyboru MIN wpływającego na nowy wynik.
`buildInvoicePlan()` i `buildSummary()` rozpoznają nową wersję reguły.
Stary `calculate()`, adapter, ich testy i fixture pozostają zgodne z dawną regułą.

Pieniądze: BigInt w groszach; dokładne liczniki /30; brak float dla kwot i brak
przedwczesnego zaokrąglenia stawki dziennej. Części zaokrąglane niezależnie half-up.
Kontrola części→wiersz i wiersze→wynik łączny pozostaje jawna. Nie przypisujemy grosza
automatycznie do wybranej usługi. Suma części może wymagać uzgodnienia z wynikiem łącznym.

| Przypadek | Bieżący wynik | Różnica względem starej reguły |
| --- | --- | --- |
| Luty28dni,100→80 od4.dnia | 10,00+66,67=76,67 | dawniej82,00 |
| Luty28dni,150→100 od18.dnia | 85,00+36,67=121,67 | dawniej128,33 |
| Luty29dni,150→100 od18.dnia | 85,00+40,00=125,00 | dawniej128,33 |
| Listopad30dni,150→100 od18.dnia | 85,00+43,33=128,33 | bez zmiany |
| Marzec31dni,150→100 od18.dnia | 85,00+46,67=131,67 | dawniej126,67 |
| Marzec, zakończenie po1dniu,150zł | 5,00 | dawniej0,00 |
| Podwyżka150→180 od2.dnia | 150,00 w miesiącu zmiany | zachowana zasada |
| Dwie usługi100→60 i50→70 od18.03 | 145,67 | dawniej140,67 |

## Pliki

Nowe: `src/daily-proration.mjs`, `tests/daily-proration.test.mjs`,
`tests/e2e/user-facing.spec.mjs`, `docs/plan-dni-kalendarzowe.md`, ten raport.

Zmienione: `app.mjs`, `index.html`, `styles.css`, `src/examples.mjs`,
`src/invoice-plan.mjs`, `src/summary.mjs`, `server.mjs`, `scripts/check.mjs`,
`tests/server.test.mjs`, `tests/e2e/calculator.spec.mjs`,
`tests/e2e/error-focus.spec.mjs`, `README.md` i nadrzędny `STAN_PROJEKTU.md`.

Bez zmian: `src/calculator.mjs`, `src/basket.mjs`, fixture/testy ich historycznych
kwot, stare raporty, zależności, prywatne repozytoria ofertowe i Notion.

## Dowody i komendy

| Kontrola | Wynik |
| --- | --- |
| Nowy test wobec starego obliczenia | 8 FAIL /20 PASS — odtworzone różnice (RED) |
| Pierwsze3testy UI przed zmianą | 3 FAIL — odtworzone zgłoszenia (RED) |
| `node --test --test-reporter=tap tests/*.test.mjs` | 190/190 PASS, w tym155 historycznych i35 nowej reguły |
| `node scripts/check.mjs` | 19 plików, składnia OK |
| Pierwszy przebieg Chromium po zmianie | 37 PASS;3 stare testy oczekiwały domyślnie wybranego przykładu — poprawiono jawny wybór w testach |
| `node scripts/e2e.mjs --output=output/playwright/daily-final --reporter=list` | **162 PASS,2 celowo pominięte,0 FAIL**;41scenariuszy ×4konfiguracje |
| `node scripts/e2e.mjs --grep upgrade --output=output/playwright/daily-upgrade-final --reporter=list` | **8/8 PASS** po końcowym doprecyzowaniu etykiety i podpowiedzi daty podwyżki |
| Niezależny przegląd reguły | Brak błędu kwot; uwaga o opisie zera poprawiona i zamknięta |

SHA256 niezmienionego historycznego silnika:
`99c85e6e41bf26f1fdb9a3ddf4e401035c75f79f4472b6325573e133bb04aeb0`.

Nowe testy obejmują regułę właściciela,28/29/30/31dni, pełne miesiące, brak zmiany,
granice dat, zakończenia, podwyżki, stawkę dzienną bez wczesnego zaokrąglenia,
niezmienioną usługę w koszyku, obie reszty groszowe, walidację, wyjaśnienia i pełny reset.
Regresja historyczna nie oznacza akceptacji starych kwot jako oczekiwanych wyników nowej reguły.

Szczegółowe logi: `output/verification/daily-red.tap`, `daily-red-e2e.log`,
`daily-final-unit.tap`, `daily-final-e2e.log`. Aktualne zrzuty z rozwiniętymi wyjaśnieniami:
`output/playwright/daily-desktop.png` i `daily-mobile.png`.
Oględziny widoków z obliczeniami: czytelne kwoty, pełny reset i wyjaśnienia;
brak obciętych kontrolek w sprawdzonych rozmiarach. Końcowa podpowiedź daty podwyżki
wyjaśnia wyjątek bez sugerowania, że wyższa cena obowiązuje już w dniu zmiany warunków.
Kontrola składni nie zastępuje typechecku/builda — projekt nie ma TypeScript ani bundlera.
Przeglądarki to Chromium i Firefox z widokiem desktop oraz emulowanym mobilnym,
nie fizyczny telefon. Dwa testy natywnego odczytu schowka Firefox są celowo pomijane;
fallback ręcznego kopiowania jest sprawdzany w obu przeglądarkach.
WolframContext zwrócił błąd usługi; nie deklarujemy dodatkowego potwierdzenia Wolfram.
Arytmetykę sprawdzono dokładnymi testami i niezależnym przeglądem.

## Źródła i otwarte punkty

Nowa reguła i wyjątek podwyżek pochodzą z bieżącej wiadomości właściciela oraz jego
odpowiedzi. Załącznik: `.codex/attachments/f6d9e068-96c8-41ca-9085-4bd68e0aecef/Wklejony tekst.txt`.
Przywołane w nim opisy innych operatorów i tekst AI nie są dowodem obowiązywania zasad w Multiplay.

Odczytano aktualny [algorytm Notion](https://app.notion.com/p/414daa43f568817784f8e58ecad50f9c),
[specyfikację](https://app.notion.com/p/414daa43f5688104a8acc587a0d8df7e) i
[D11](https://app.notion.com/p/414daa43f568818f97e4fa91a12935e1).
Nadal opisują wcześniejsze MIN(A,B); nie edytowano ich w ramach tej zmiany.
Przed produkcją trzeba uzgodnić dokumentację, właściwe testy i księgowanie nowej reguły.
D11 oraz D05/D18/D19/D22 pozostają otwarte we właściwym zakresie.

Bez integracji MMS, rzeczywistych danych klientów, trwałego zapisu, telemetryki,
repozytorium, publikacji i zmian w usługach zewnętrznych. Serwer pozostawiony lokalnie
pod http://127.0.0.1:4173; należy odświeżyć stronę i wybrać opisowy przykład lutowy.
Stan do wznowienia znajduje się w nadrzędnym `STAN_PROJEKTU.md`.
