# Bieżąca zmiana: rzeczywiste dni /30, czytelne wyjaśnienia i pełny reset

Źródło zmiany: wiadomość właściciela procesu z13.11.2026 i załączony tekst.
Cena po rabatach × faktyczne dni okresu ÷30. Przykład akceptacji:
100→80 zł od4.02 w lutym28-dniowym: 10,00+66,67=76,67 zł.
To zmiana względem wcześniejszego MIN(A,B), które dawało82,00 zł.
Tekst o innych operatorach nie jest podstawą umowną Multiplay ani potwierdzeniem D11.
Notion i historyczne testy pozostają niezmienione; konflikt opisany lokalnie.

Plan:
- [x] Testy RED przykładu, 28/29/30/31dni i zakończenia z rzeczywistą liczbą dni.
- [x] Osobny moduł nowej reguły, użycie dotychczasowej walidacji; historyczny silnik bez zmian.
- [x] Ceny oznaczone jako po rabatach; konkretne działania zamiast A/B i liter we wzorach.
- [x] Przykłady opisowe bez kodów Txx; pierwszy przykład zgodny z załącznikiem.
- [x] Reset wartości, przykładów, opcji, rozwiniętych szczegółów, wyniku i kopii;
  dostępny przy formularzu i przy wyniku.
- [x] Regresja starych zasad jako historia, nowe testy, E2E desktop/mobile i raport/checkpoint.

Reguły niezależne: pełny niezmieniony miesiąc ma pełną miesięczną cenę;
częściowe okresy korzystają z rzeczywistych dni bez wyrównania do30.
Nie zaokrąglać stawki dziennej przed mnożeniem. Nie przenosić reszt groszowych.
Kompensujące zmiany przy niezmienionej sumie pozostają wyjątkiem do uzgodnienia D11.
Odpowiedź użytkownika: podwyżki zachowują wcześniejsze pełne O do końca miesiąca
przy zmianie od2.dnia lub później; od1.dnia pełne N. Nie naliczać cząstkowej dopłaty.

Weryfikacja:190/190 Node, składnia19plików OK; E2E162 PASS i2celowo pominięte
testy natywnego odczytu schowka Firefox. Raport: RAPORT_REGULA_DNI_I_RESET.md.
