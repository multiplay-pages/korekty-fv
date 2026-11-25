# Multiplay BOK/SUD — kalkulator korekty abonamentu

Wspólny kalkulator **TEST_ONLY**. Domyślny ekran przyjmuje cztery dane: miesiąc i rok rozliczenia, ostatni dzień starych warunków oraz dwie ceny brutto całego koszyka po rabatach. Rozwijane szczegóły BOK pozwalają obliczyć ten sam przypadek z pozycji faktury. Lista obejmuje miesięczne rozszerzenia ofert GigaNet, GigaBox i Biznes 3.1. Po obliczeniu rozbicie pozycji pojawia się od razu. Do testów używaj danych syntetycznych.

## Uruchomienie lokalne

W katalogu projektu, z Node.js 22 lub nowszym:

```powershell
npm.cmd start
```

Otwórz [http://127.0.0.1:4173/](http://127.0.0.1:4173/). Jeśli port jest niedostępny, wskaż inny i otwórz adres podany przez serwer:

```powershell
$env:BOK_PORT = '4174'
npm.cmd start
```

## Jak obliczyć należność

1. Wybierz miesiąc i rok rozliczenia. Wpisz ostatni dzień starych warunków włącznie. Kalkulator wyznaczy następny dzień jako datę zmiany warunków.
2. Wpisz obie pełne ceny brutto po rabatach. **O** to dotychczasowy abonament, **N** to nowy abonament. Wpisz 0 zł, jeśli po zmianie opłata wynosi zero. Rodzaj zmiany wynika z cen.
3. Podstawowy wynik szacuje różnicę przy założeniu **F = O**. W sekcji opcjonalnej możesz wpisać faktycznie naliczoną kwotę **F**. W trybie BOK kwota faktury każdej pozycji domyślnie odpowiada staremu abonamentowi. Jeśli jest inna, wybierz „Na fakturze jest inna kwota” i wpisz ją. Wynik i podsumowanie wskazują, w ilu wierszach przyjęto stary abonament. Wpisane wcześniej O i N służą do kontroli, a F jest porównywana, jeśli ją podano.
4. Kliknij „Oblicz korektę”. Wynik podaje należność, różnicę oraz datę naliczania nowej ceny. „Skąd ta kwota?” pokazuje regułę i dni naliczania. Przy równych cenach dodatkowa różnica względem faktury jest sygnałem do kontroli naliczenia.
5. Podsumowanie poglądowe zawiera sumy i ostrzeżenia. Wolne nazwy pozycji pozostają w formularzu. Zmiana danych unieważnia podsumowanie i możliwość kopiowania. Reset usuwa dane sprawy.

Przykład „Faktura wyższa od dotychczasowego abonamentu” daje należność **135,00 zł**, zmniejszenie faktury **25,00 zł** przy F = 160,00 zł i nową stawkę miesięczną **120,00 zł**.

## Reguły demonstratora

`src/billing-policy.mjs` udostępnia `evaluateCorrection(input, policy)`. Formularz wywołuje resolver z wbudowaną polityką **`0.4.0-test-min-ab`**. Dane obejmują źródło `aggregate` lub `lines`, miesiąc (`YYYY-MM`), ostatni dzień starych warunków (`YYYY-MM-DD`), ceny O i N, opcjonalne F i pozycje i informacje o niejednoznacznościach. Rezultat zawiera status, regułę, uzasadnienie, kwoty i flagę dopuszczenia księgowego.

- Zmiany przed miesiącem lub od pierwszego dnia dają pełny nowy abonament dla obniżki. Zmiany po miesiącu zachowują pełny dotychczasowy abonament.
- Podwyżka, także przy zmianie warunków pierwszego dnia, jest naliczana od pierwszego dnia miesiąca następującego po miesiącu zmiany. Kwota za miesiąc zmiany pozostaje dotychczasowa.
- Obniżenie lub zakończenie w trakcie miesiąca używa globalnego MIN(A,B) z dokładnym porównaniem przed zaokrągleniem. Dla każdej pozycji stosuje się ten sam wariant. Różnica faktury to F − należność.
- Profil `0.3.0-test-actual-days` pozostaje dostępny w wywołaniach deweloperskich. Przykład zmiany ze 100 zł na 80 zł od 4 lutego 2027 daje **82,00 zł** w aktywnym profilu, a przy rzeczywistych dniach **76,67 zł**. Oba silniki mają osobną regresję.
- Na poziomie BOK testowe rozbicie pokazuje kwotę docelową, różnicę oraz reszty groszowe. D11 pozostaje otwarte. Przy mieszanym VAT lub kwotach netto można uzyskać poglądowy wynik zbiorczy na podstawie niezależnie potwierdzonych sum brutto. W innych złożonych przypadkach kalkulator kieruje do weryfikacji.

Kwoty liczone są w groszach z użyciem BigInt. Zaokrąglenia są testowe, a reszt groszowych aplikacja nie przypisuje do usług. Wynik wymaga potwierdzenia podstawy umownej i zatwierdzenia księgowego przed użyciem w rozliczeniach.

## Weryfikacja

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run browsers:install
npm.cmd test
npm.cmd run check
npm.cmd run test:e2e
```

E2E startuje własny serwer na wolnym porcie loopback. Można wskazać działającą kopię lokalną przez `BOK_E2E_URL`. Przy powtórzeniu przebiegu można wskazać osobny katalog przez `npm.cmd run test:e2e -- --output=output/playwright/etap3-powtorka`. Projekt używa statycznych modułów ES i kontroli składni Node.js.

[Uzgodnienie A/B i weryfikacja zmian](docs/RAPORT_UZGODNIENIE_AB.md) · [Raport Etapu 3](docs/RAPORT_ETAP_3_AUTO_BILLING_SUD_BOK.md) · [Historia i regresja rzeczywistych dni](docs/RAPORT_REGULA_DNI_I_RESET.md)
