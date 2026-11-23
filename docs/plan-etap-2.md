# Etap 2 — lokalny ekran / plan wykonania

Data 13.11.2026. Zakres i wykonanie zatwierdzone w briefie użytkownika (załącznik).
Spec: lokalny ekran, dotychczasowy silnik, testy, bez publikacji i danych klientów.

## 2A — stan początkowy

- [x] Odczytano checkpoint, raport, API, package i testy. Bazowo 63/63 PASS.
- [x] Katalog nie jest repozytorium; nie inicjalizujemy Git.
- [x] SHA256 calculator.mjs: 99C85E6E41BF26F1FDB9A3DDF4E401035C75F79F4472B6325573E133BB04AEB0.
- [x] Notion sprawdzone 13.11: D23 roboczo, D11 otwarte. Rejestr 27 testów.
- [x] Node/npm dostępne. Playwright jako jedyna zależność deweloperska do E2E.

## 2B — wybór układu

1. Arkusz operacyjny: dane i tabela pełnej szerokości, poniżej wynik i kontrole.
2. Formularz + panel boczny: stały wynik, ale mniej miejsca na pozycje.
3. Proces krokowy: prosty dla początkujących, wolniejszy i ukrywa kontekst.
Wybrano 1 (decyzja wykonawcy zgodna z briefem). Desktop-first, max1280px,
Segoe UI/system-ui, kwoty tabular-nums, biel/#F4F6F8, tekst #172330, pomocniczy
#52606D, czerwony akcent #C8101E (historyczny #E30613 tylko znak marki),
bursztynowe komunikaty. Focus3px, kontrolki44px, mobile jako pionowe grupy pól.
Bez obrazów, fontów, CDN, animacji i usług projektowych poza lokalnym środowiskiem.

## 2C — interfejsy i pliki

calculator.mjs pozostaje bez zmian. Nowy basket.mjs eksportuje evaluateBasket(form):
sumuje dokładne grosze, wywołuje calculate raz dla koszyka, nakłada tę samą metodę
na wiersze. Należności wierszy half-up roboczo, reszta = koszyk−suma wierszy,
bez automatycznej alokacji. Pełne O/N stosuje również przy O=N; zmienione składniki
przy stałej sumie wymagają jawnego ostrzeżenia. Ujemne różnice nie są obcinane.
summary.mjs: tekst PL; pomija dowolne teksty etykiet/opisów, używa numerów i kategorii.
index.html/styles.css/app.mjs: formularz, tabela, wynik, błędy, kopiowanie i reset.
server.mjs: GET/HEAD, jawna lista plików, loopback127.0.0.1, CSP, brak logowania danych.
tests/basket.test.mjs, tests/server.test.mjs, tests/e2e/calculator.spec.mjs,
playwright.config.mjs, scripts/check.mjs: weryfikacja. package + lock: dev dependency.
README, RAPORT_ETAP_2, nadrzędny STAN_PROJEKTU: instrukcja i ciągłość.

## Kolejność test-first

- [x] Testy koszyka, sum, znaków, reszt ±wiele groszy, blokad i bezpiecznej kopii RED.
- [x] Implementacja adaptera i summary GREEN. Regresja 63 testów.
- [x] Ekran i serwer loopback z testami HTTP i E2E.
- [x] Chromium/Firefox, desktop/mobile, konsola/sieć/storage/klawiatura/kopia.
- [x] Niezależny review, poprawki, ponowna weryfikacja, zrzuty i dokumentacja.

## Review focus

Stary wynik/kopia po zmianie danych; mieszane podstawy/VAT; E/T i koniec roku;
reszta o obu znakach i większa od1gr; wiersze zmienione przy O=N; brak danych
osobowych w kopii mimo wolnego tekstu na ekranie; brak zewnętrznych zapytań.

Otwarte bramki D05/D11/D18/D19/D22 nie blokują tego testowego, lokalnego zakresu.
Brak API finansowego, przeliczania VAT/netto, cen historycznych i rzeczywistych klientów.

Wynik wykonania 13.11: 111/111 testów Node. Pełna macierz 102 E2E PASS/2 pominięcia
(odczyt schowka Firefox), następnie 12/12 końcowych kontroli pola/dat/długich kwot.
Serwer lokalny działa; brak wdrożenia. Raport i checkpoint zaktualizowane.
