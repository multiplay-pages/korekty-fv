# Multiplay BOK — kalkulator korekt 1/30, lokalny etap 2

**Bieżąca reguła: 0.2.0 — rzeczywiste dni /30, ceny po rabatach. Status TEST_ONLY.**
To lokalny prototyp, bez dopuszczenia do rzeczywistych korekt.

## Jak liczymy teraz

- Obniżka i zakończenie w trakcie miesiąca: każda cena miesięczna brutto po rabatach
  × rzeczywista liczba dni jej obowiązywania ÷30.
- Stary okres kończy się dzień przed datą zmiany. Nowy okres obejmuje dzień zmiany
  i ostatni dzień miesiąca. Dzielnik zawsze30; licznik zależy od kalendarza.
- Pełny miesiąc bez zmiany ceny pozostaje pełnym abonamentem. Nie mnożymy go przez28/30 czy31/30.
  Usługa bez zmiany ceny zachowuje pełny abonament również w koszyku z inną zmienianą usługą.
- Podwyżki zachowują wcześniejszą zasadę, ponownie potwierdzoną przez właściciela:
  od1.dnia — pełna nowa cena; od2.dnia lub później — stara cena do końca miesiąca,
  wyższa od1.dnia następnego miesiąca względem daty zmiany.
- Zakończenie przed początkiem analizowanego miesiąca lub jego1.dnia daje0 zł,
  bez sugerowania nowego abonamentu.
- Kwoty są liczone dokładnie jako BigInt w groszach z mianownikiem30. Nie zaokrąglamy
  stawki dziennej. Niezależne testowe zaokrąglenia części do groszy są jawne; ewentualne
  reszty wymagają uzgodnienia, bez automatycznego dopisania grosza do usługi.
- Kompensujące zmiany usług przy niezmienionej sumie pozostają wyjątkiem do uzgodnienia
  z rozliczeniami. Kalkulator nie podaje wtedy arbitralnego rozbicia części.

Przykład z polecenia właściciela: luty2027, cena100→80 zł od4.02:

| Okres / działanie | Wyliczenie |
| --- | --- |
| Stary abonament, 01–03.02 | 100 ×3 ÷30 = 10,00 zł |
| Nowy abonament, 04–28.02 | 80 ×25 ÷30 = 66,67 zł |
| Razem | 76,67 zł |
| Zmniejszenie faktury pierwotnej100 zł | 23,33 zł |

Różnica faktury nie jest automatycznie zwrotem z wpłat ani saldem klienta.

## Otwórz i sprawdź

W PowerShell:

```powershell
Set-Location 'C:\Users\lcichanowicz\OneDrive - Multiplay\Dokumenty\ChatGPT\30\bok-1-30'
npm.cmd start
```

Adres: [http://127.0.0.1:4173](http://127.0.0.1:4173). Przy działającym serwerze odśwież kartę.
Nie uruchamiaj drugiej kopii na zajętym porcie. Ctrl+C zatrzymuje serwer.
Moduły wymagają HTTP; nie otwieraj index.html bezpośrednio jako pliku.

Wybierz „Luty:100→80 zł od4lutego”, wczytaj i oblicz. „Skąd te kwoty?” pokazuje
działania z rzeczywistymi cenami i dniami. Nazwy przykładów nie zawierają kodów testów.
Wpisuj pełne ceny miesięczne po rabatach; części liczy kalkulator. Kwota faktury
domyślnie jest taka jak stary abonament, z opcją wpisania faktycznie innego naliczenia.
Dla każdej usługi potwierdź porównanie kwoty z fakturą. Zmiana miesiąca, usługi lub
kwoty wymaga ponownego potwierdzenia. Wbudowane przykłady są danymi testowymi i mają
potwierdzenia zaznaczone automatycznie.

Przy zakończeniu wpisz ostatni dzień usługi; pierwszy dzień bez usługi wyliczamy
automatycznie. Zmiana scenariusza nie usuwa wpisanej wcześniej ceny nowego abonamentu.
Po kliknięciu „Oblicz korektę” lista braków prowadzi do wymagających uzupełnienia pól.

„Resetuj wszystko” przy formularzu oraz „Nowe obliczenie — resetuj wszystko” przy wyniku
przywracają pustą pojedynczą pozycję, domyślne opcje, brak wybranego przykładu i zamknięte
szczegóły; usuwają wynik, błędy i kopię. Każda edycja unieważnia wcześniejszy wynik.

## Kontrole

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run test:e2e
```

Bez npm: `node --test tests/*.test.mjs`, `node scripts/check.mjs`,
`node scripts/e2e.mjs`. Wyniki i dokładne komendy: `docs/RAPORT_REGULA_DNI_I_RESET.md`.
Nie ma TypeScript ani bundlera; kontrola składni nie jest typecheckiem/buildem.
Node>=22; Playwright i jego przeglądarki są już lokalnie.
Na innym komputerze: `npm.cmd ci --ignore-scripts`, `npm.cmd run browsers:install`.

## API i zgodność historyczna

Bieżący ekran wywołuje `evaluateDailyBasket(form)` z `src/daily-proration.mjs`.
Używa istniejącej walidacji `evaluateBasket()` dla kwot, kalendarza, kierunku ceny,
VAT, liczby pozycji i złożonych przypadków. Historyczne wyniki A/B są odrzucane;
nowe należności oblicza osobny moduł.

Wejście: miesiąc YYYY-MM, data zmiany YYYY-MM-DD, rodzaj zdarzenia
DOWNGRADE/WYPOWIEDZENIE/PODWYŻKA/NO_CHANGE, opcjonalny ostatni dzień usługi,
`dateVerified:true`, opcje kontroli i1–50 wierszy. Wiersz:
service internet/tv/rental/other, tekstowe ceny old/new/invoiced, basis gross i vat.
Kwoty nieujemne, maks.15cyfr przed separatorem i2po nim; netto, mieszany VAT,
wiele dat, nierozstrzygnięte rabaty i dodatkowe pola są blokowane.

Wynik zawiera `rule:ACTUAL_DAYS_OVER_30_AFTER_DISCOUNTS`, global, rows, invoicePlan,
kontrole reszt oraz ostrzeżenia. `buildInvoicePlan()` i `buildSummary()` rozpoznają
nową regułę. UI i kopia opisują ją słowami, bez A/B i symbolicznych wzorów.
Wpisana data jest informacją od operatora; ekran nie sprawdza skuteczności prawnej.
Kontrakt dateVerified pozostaje w wewnętrznym API, bez osobnego checkboxa.

`src/calculator.mjs`, `src/basket.mjs` oraz stare fixture/testy nie zostały przepisane:
pozostają regresją historycznej reguły MIN(A,B). Nie są testem zgodności nowego liczenia
z dawnymi kwotami kart Notion. Stary demo.mjs również przedstawia dawną regułę.
Historyczne raporty: RAPORT_ETAP_1.md, RAPORT_ETAP_2.md, RAPORT_DOPASOWANIE_MMS.md.

## Źródła, ograniczenia i wznowienie

Nowa reguła pochodzi z polecenia właściciela i załączonego tekstu z13.11.2026.
Wyjątek podwyżek został w tej samej rozmowie potwierdzony osobno.
[Algorytm w Notion](https://app.notion.com/p/414daa43f568817784f8e58ecad50f9c)
nadal opisuje wcześniejszy MIN(A,B); nie aktualizowano zdalnych dokumentów ani testów.
[D11](https://app.notion.com/p/414daa43f568818f97e4fa91a12935e1) nadal jest otwarte,
podobnie właściwe bramki przed produkcją. Opisy innych operatorów nie stanowią podstawy umownej Multiplay.

Wyłącznie127.0.0.1, jawna lista zasobów GET/HEAD, no-store i CSP connect-src none.
Brak integracji MMS, danych klientów, zapisu w przeglądarce, bazy, telemetryki i publikacji.
Repozytorium `multiplay-pages/korekty-fv` i GitHub Pages istnieją; lokalne poprawki
formularza nie zostały jeszcze do nich wprowadzone. Nie zmieniano Notion.
Kontynuację zaczynaj od nadrzędnego STAN_PROJEKTU.md i najnowszego raportu.

