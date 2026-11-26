> **SUPERSEDED (25.11.2026):** opisane tu reguły MIN(A,B) i/lub „rzeczywiste dni ÷ 30 dla wszystkich miesięcy” zostały zastąpione regułą CB-2026-11-25 (metoda C dla miesięcy 28/29/30-dniowych, B dla 31-dniowych). Dokument zachowano wyłącznie jako historię; nie służy jako specyfikacja obliczeń.

# Etap 1 — plan zaakceptowany poleceniem „Rozpocznij etap 1 lokalnie”
Cel: czysty silnik jednej zmiany, testy T01–T25 i sumaryczne kontrakty T26–T27.
Wybór wykonawcy: JavaScript ESM, Node >=22, bez zależności. Brak repo i wdrożenia.
Zakres: wejście z potwierdzoną datą, kwoty brutto jako tekst PLN, dokładne BigInt/30,
wynik groszowy, metoda, A/B, dni, ostrzeżenia. Opcjonalne E i P.
Zaokrąglenie testowe: half-up wyłącznie końcowej należności (D11 otwarte).
Netto, VAT, rabaty ujemne, wiele dat i alokacja pozycji poza etapem.
Nieznane pola są odrzucane; nie wolno milcząco zgubić dodatkowej zmiany/pozycji.

1. [x] Zapisać snapshot pełnych kart i fixture T01–T25; testy referencyjne najpierw RED.
2. [x] Wdrożyć calculate(input) i walidację; GREEN.
3. [x] Dodać testy błędów i granic najpierw RED, uzupełnić silnik; GREEN.
4. [x] Sprawdzić składnię, pełny zestaw, przykład; zapisać raport i STAN_PROJEKTU.md.
Kryteria: T01–T25 zgodne z kartami, T26–27 zgodne na poziomie sumy, brak automatycznej
alokacji grosza; wpłata nie wpływa na dokument. Brak float w arytmetyce pieniędzy.
Review: lata 1900/2000, koniec roku E/T, wartości niebezpieczne dla Number,
nieznane pola/typy, zaokrąglenie wyłącznie po wyborze metody.

Wykonanie 12.11.2026: testy referencyjne i walidacyjne powstały przed implementacją;
oba zestawy RED uruchomiono przeciw pustej funkcji (błędy asercji).
Następnie wdrożono silnik i uzyskano 63/63 GREEN.
Odstępstwo od kolejności: testy dodatkowe dołączono do zestawu RED przed implementacją,
zamiast wdrażać walidację w osobnej iteracji. Zakres pozostał identyczny.
Nie ma git/worktree/commitów: folder startowy był pusty i nie był repozytorium,
a użytkownik zatwierdził wyłącznie lokalny etap, bez tworzenia repo.
Końcowy przegląd przez osobnego agenta: brak usterek blokujących; 63/63 PASS.

