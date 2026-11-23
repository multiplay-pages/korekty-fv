# Dopasowanie ekranu do korekty starego i nowego abonamentu

13.11.2026. Właściciel procesu potwierdził w czacie: koryguje się stary abonament do
naliczenia cząstkowego i dodaje osobną pozycję nowego abonamentu, według przyjętych zasad.
Jest to doprecyzowanie workflow; nie zatwierdza VAT ani alokacji groszy z D11.

Wybrany układ: zachować arkusz, uprościć nazwy, a nad technicznym wynikiem pokazać
„Jak przygotować korektę” z F→starą częścią i nową częścią do dodania.
Nie ma potrzeby dodatkowych grafik w formularzu rozliczeniowym.

Zakres: nowy src/invoice-plan.mjs; zmiany app/index/styles/summary, serwerowej listy
plików, testów, README i checkpointu. Bez zmian calculate i dotychczasowego basket API.
Usunąć opis i etykietę pozycji z ekranu oraz checkbox daty. Jednoznacznie opisać dane:
pełny abonament miesięczny przed/po zmianie. F domyślnie z O, jawny opis założenia;
checkbox na wierszu pozwala wpisać inną rzeczywistą kwotę faktury. VAT/podstawa w szczegółach.
Znaczniki dateVerified w silniku pozostają; cienki interfejs traktuje wprowadzoną datę
jako deklarację użytkownika, bez potwierdzania prawnej skuteczności przez program.

Matematyka rozbicia, liczniki w groszach /30:
- A/A=B: stara O*d, nowa N*(30−d).
- B: stara O*(30−r), nowa N*r.
- Pełna O: stara O*30, nowa0; Pełna N: stara0, nowa N*30.
Odrębnie pokazać faktyczne daty/dni i współczynniki modelu30-dniowego.
Każdą część zaokrąglić niezależnie testowym half-up; bez ukrytej alokacji grosza.
Reszta wiersza = dotychczasowa należność wiersza − suma części.
Reszta całego podziału = reszta koszyka + suma reszt wierszy.
Nie ukrywać znoszących się reszt, np. T26 (+0,01 oraz −0,01).
T27 przy O=N i zmienionych składnikach: części null, jawny wyjątek do D11;
zachować globalne150 i istniejące kontrolne100/50. Nie wybierać arbitralnie A/B.

Plan test-first:
- [x] Nowe testy splitu 28/29/30/31, granic, podwyżek, zakończeń, reszt obu znaków RED.
- [x] Czysty invoice-plan i tekst korekty GREEN. Regresja bazowych111 testów zachowana.
- [x] Uproszczony UI, kwoty do wpisania, kontrolowane wyjątki i nowa kopia.
- [x] Testy przeglądarek/fokusu/resetu/Fauto/wyjątków oraz niezależny przegląd.
- [x] Raport lokalny, zrzuty, README i STAN_PROJEKTU; brak publikacji i zapisów w Notion.

Wynik: 155/155 testów Node, 16 plików ze składnią OK; E2E142 PASS i2 pominięcia
schowka Firefox; końcowa kontrola układu8/8 PASS. Szczegóły i ograniczenia w
`RAPORT_DOPASOWANIE_MMS.md`. Silnik etapu1 i adapter koszyka bez zmian.
