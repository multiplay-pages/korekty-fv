// FIX_PACK_6A — testy po niezależnym audycie 6A-QA (Codex). Oczekiwane wartości wpisano ręcznie albo wyliczono
// niezależnie (BigInt, bez funkcji produkcyjnych). Matematyka CB (C dla L=28/29/30, B dla L=31) nie jest tu zmieniana.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { ACTIVE_DEMO_POLICY, evaluateCorrection } from '../src/billing-policy.mjs';
import { buildResultPresentation, copyResultPresentation, billingLabel } from '../src/summary.mjs';
import {
  SCANNED_PUBLIC_FILES, PRIVATE_PATH_RULES, findPrivateCategories,
} from './helpers/privacy-guard.mjs';

const line = (service, old, next, invoiced = old) => ({ service, old, new: next, invoiced, basis: 'gross', vat: '23' });
const bok = (month, lastOldDate, rows, fields = {}) => ({
  month, lastOldDate, dateVerified: true, source: 'lines', totals: {}, rows, documentState: 'AMOUNT',
  invoiceConfirmed: true, ...fields,
});
const agg = (month, lastOldDate, old, next, invoiced) => ({
  month, lastOldDate, dateVerified: true, totals: { old, new: next, invoiced }, documentState: invoiced === undefined ? 'UNKNOWN' : 'AMOUNT',
});
const copyLines = result => copyResultPresentation(buildResultPresentation(result)).split('\n');

// ---------------------------------------------------------------------------------------------------------------
// FIX-01 — jawna reszta należności (należność koszyka − suma należności pozycji), obok reszty korekty.
// ---------------------------------------------------------------------------------------------------------------
test('FIX-01 przypadek A: C, 76,67; pozycje 39,33 + 37,33 = 76,66; reszta należności +0,01; reszta korekty wewn. −0,01, na ekranie +0,01', () => {
  const r = evaluateCorrection(bok('2027-02', '2027-02-03', [line('internet', '60', '40'), line('tv', '40', '40')]));
  assert.deepEqual([r.decision, r.appliedMethod, r.amountDue, r.correctionAmount], ['CORRECTION', 'C', '76.67', '23.33']);
  assert.deepEqual(r.lineBreakdown.map(row => row.due), ['39.33', '37.33']);
  assert.equal(r.rowsDueTotal, '76.66');
  assert.equal(r.dueRemainder, '0.01');
  assert.equal(r.correctionRemainder, '-0.01');
  const view = buildResultPresentation(r);
  assert.deepEqual(view.reconciliation, [
    'Należność koszyka: 76,67 zł',
    'Suma należności pozycji: 76,66 zł',
    'Reszta należności koszyka +0,01 zł do uzgodnienia.',
  ]);
  // 26.11.2026: korekta prezentowana jako należność − F (−23,33), więc reszta korekty na ekranie ma znak przeciwny do wewnętrznej.
  assert.equal(view.remainder, 'Reszta korekty koszyka +0,01 zł do uzgodnienia.');
  assert.deepEqual(view.rows.map(row => row.delta), ['−20,67 zł', '−2,67 zł']);
  const copy = copyLines(r);
  for (const text of [...view.reconciliation, view.remainder]) assert.ok(copy.includes(text), text);
  assert.ok(copy.some(text => text === 'Korekta faktury: −23,33 zł (zmniejszenie)'));
});

test('FIX-01 przypadek B (T26): B, 140,67; pozycje 81,33 + 59,33 = 140,66; reszta należności +0,01; reszta korekty wewn. −0,01, na ekranie +0,01', () => {
  const r = evaluateCorrection(bok('2027-03', '2027-03-17', [line('internet', '100', '60'), line('tv', '50', '70')]));
  assert.deepEqual([r.appliedMethod, r.amountDue, r.correctionAmount], ['B', '140.67', '9.33']);
  assert.deepEqual(r.lineBreakdown.map(row => row.due), ['81.33', '59.33']);
  assert.deepEqual([r.rowsDueTotal, r.dueRemainder, r.correctionRemainder], ['140.66', '0.01', '-0.01']);
  const view = buildResultPresentation(r);
  assert.deepEqual(view.reconciliation, [
    'Należność koszyka: 140,67 zł',
    'Suma należności pozycji: 140,66 zł',
    'Reszta należności koszyka +0,01 zł do uzgodnienia.',
  ]);
  assert.equal(view.remainder, 'Reszta korekty koszyka +0,01 zł do uzgodnienia.');
  // TV: należność 59,33 > F 50,00 → korekta pozycji +9,33 (wewnętrznie F − należność = −9,33).
  assert.deepEqual(view.rows.map(row => row.delta), ['−18,67 zł', '+9,33 zł']);
  assert.ok(copyLines(r).includes('Suma należności pozycji: 140,66 zł'));
});

test('FIX-01 reszta zerowa: obie reszty pokazane jako 0,00 zł, bez zdania „do uzgodnienia”', () => {
  // Listopad (30 dni), d = 15: C = (O×15 + N×15)/30; 100→80 i 50→40 dają 90,00 + 45,00 = 135,00 = koszyk.
  const r = evaluateCorrection(bok('2026-11', '2026-11-15', [line('internet', '100', '80'), line('tv', '50', '40')]));
  assert.deepEqual([r.appliedMethod, r.amountDue, r.rowsDueTotal, r.dueRemainder, r.correctionRemainder], ['C', '135.00', '135.00', '0.00', '0.00']);
  const view = buildResultPresentation(r);
  assert.deepEqual(view.reconciliation, [
    'Należność koszyka: 135,00 zł',
    'Suma należności pozycji: 135,00 zł',
    'Reszta należności koszyka 0,00 zł.',
    'Reszta korekty koszyka 0,00 zł.',
  ]);
  assert.equal(view.remainder, '');
  const copy = copyLines(r);
  for (const text of view.reconciliation) assert.ok(copy.includes(text), text);
});

test('FIX-01 przeciwny znak (niezależnie wyliczony przypadek): reszta należności −0,01, reszta korekty wewn. +0,01, na ekranie −0,01', () => {
  // Luty 2027 (28 dni), d = 3, r = 25. Ręcznie (grosze ×30): koszyk (3300×3 + 2200×25)/30 = 2163,33 → 21,63;
  // pozycje (3000×3 + 2000×25)/30 = 1966,67 → 19,67 oraz (300×3 + 200×25)/30 = 196,67 → 1,97; suma 21,64.
  const r = evaluateCorrection(bok('2027-02', '2027-02-03', [line('internet', '30', '20'), line('tv', '3', '2')]));
  assert.deepEqual([r.appliedMethod, r.amountDue], ['C', '21.63']);
  assert.deepEqual(r.lineBreakdown.map(row => row.due), ['19.67', '1.97']);
  assert.deepEqual([r.rowsDueTotal, r.dueRemainder, r.correctionAmount, r.correctionRemainder], ['21.64', '-0.01', '11.37', '0.01']);
  const view = buildResultPresentation(r);
  assert.equal(view.reconciliation[2], 'Reszta należności koszyka −0,01 zł do uzgodnienia.');
  assert.equal(view.remainder, 'Reszta korekty koszyka −0,01 zł do uzgodnienia.');
  const copy = copyLines(r);
  assert.ok(copy.includes('Reszta należności koszyka −0,01 zł do uzgodnienia.'));
  assert.ok(copy.includes('Reszta korekty koszyka −0,01 zł do uzgodnienia.'));
});

test('FIX-01 brak reszt dla trybu zbiorczego i brak automatycznej alokacji groszy', () => {
  const r = evaluateCorrection(agg('2027-02', '2027-02-03', '100', '80', '100'));
  const view = buildResultPresentation(r);
  assert.deepEqual(view.reconciliation, []);
  assert.ok(!copyLines(r).some(text => /Suma należności pozycji|Reszta należności/.test(text)));
  // Należności pozycji pozostają samodzielnymi zaokrągleniami; reszta nie jest doliczana do żadnej z nich.
  const a = evaluateCorrection(bok('2027-02', '2027-02-03', [line('internet', '60', '40'), line('tv', '40', '40')]));
  assert.deepEqual(a.lineBreakdown.map(row => row.due), ['39.33', '37.33']);
});

test('FIX-01 przed potwierdzeniem danych ekran ma uzgodnienie, a kopia nie zawiera pozycji ani reszt', () => {
  const r = evaluateCorrection(bok('2027-02', '2027-02-03', [line('internet', '60', '40'), line('tv', '40', '40')], { invoiceConfirmed: false }));
  const view = buildResultPresentation(r);
  assert.equal(view.reconciliation.length, 3);
  assert.ok(!copyLines(r).some(text => /Suma należności pozycji/.test(text)));
});

// ---------------------------------------------------------------------------------------------------------------
// FIX-02 — cena umowna za analizowany miesiąc przy podwyżce, oddzielnie od faktury i od abonamentu w kolejnych miesiącach.
// ---------------------------------------------------------------------------------------------------------------
const field = (view, id) => view.fields.find(item => item.id === id);
const increase = (lastOldDate, invoiced) => evaluateCorrection(agg('2027-03', lastOldDate, '150', '180', invoiced));

test('FIX-02 T=01.03: cena umowna 180, nowa cena od 01.03.2027; F=150 i F=180 bez korekty i dopłaty', () => {
  for (const invoiced of ['150', '180']) {
    const r = increase('2027-02-28', invoiced);
    assert.equal(r.decision, 'NO_CORRECTION', invoiced);
    assert.equal(r.correctionAmount, null);
    const view = buildResultPresentation(r);
    assert.deepEqual(field(view, 'contract-price'), { id: 'contract-price', label: 'Cena umowna za 03.2027', value: '180,00 zł' });
    assert.equal(field(view, 'nominal-price').label, 'Abonament od 01.03.2027');
    assert.equal(field(view, 'nominal-price').value, '180,00 zł');
    assert.equal(field(view, 'result-invoiced').value, `${invoiced},00 zł`);
    const copy = copyLines(r);
    assert.ok(copy.includes('Cena umowna za 03.2027: 180,00 zł'));
    assert.ok(copy.includes('Abonament od 01.03.2027: 180,00 zł'));
    assert.ok(!copy.some(text => /zmniejszenie|Zwiększenie/.test(text)));
  }
});

test('FIX-02 T=02.03: cena umowna za marzec 150, nowa cena od 01.04.2027; F=150 zostaje, F=180 → REVIEW bez korekty', () => {
  const keep = increase('2027-03-01', '150');
  assert.equal(keep.decision, 'NO_CORRECTION');
  let view = buildResultPresentation(keep);
  assert.equal(field(view, 'contract-price').value, '150,00 zł');
  assert.equal(field(view, 'contract-price').label, 'Cena umowna za 03.2027');
  assert.equal(field(view, 'result-invoiced').label, 'Faktura pozostaje');
  assert.equal(field(view, 'nominal-price').label, 'Abonament od 01.04.2027');
  assert.equal(field(view, 'nominal-price').value, '180,00 zł');
  assert.ok(copyLines(keep).includes('Cena umowna za 03.2027: 150,00 zł'));

  const review = increase('2027-03-01', '180');
  assert.deepEqual([review.decision, review.code, review.correctionAmount], ['REVIEW', 'EARLY_INCREASE_ON_INVOICE', null]);
  view = buildResultPresentation(review);
  assert.equal(field(view, 'contract-price').value, '150,00 zł', 'cena ustalona — pokazana także w REVIEW');
  assert.equal(field(view, 'result-invoiced').value, '180,00 zł');
  assert.equal(field(view, 'nominal-price').label, 'Abonament od 01.04.2027');
  const copy = copyLines(review);
  assert.ok(copy.includes('Cena umowna za 03.2027: 150,00 zł'));
  assert.ok(!copy.some(text => /zmniejszenie|Zwiększenie/.test(text)));
});

test('FIX-02 F nieznane: cena umowna pokazana, brak wymyślonej faktury; T=01 i T=02', () => {
  for (const [lastOld, price, from] of [['2027-02-28', '180,00 zł', '01.03.2027'], ['2027-03-01', '150,00 zł', '01.04.2027']]) {
    const r = increase(lastOld, undefined);
    assert.equal(r.decision, 'NO_CORRECTION_EXPECTED');
    const view = buildResultPresentation(r);
    assert.equal(field(view, 'contract-price').value, price);
    assert.equal(field(view, 'nominal-price').label, `Abonament od ${from}`);
    assert.equal(field(view, 'result-invoiced'), undefined);
  }
});

test('FIX-02 nie pokazuje ceny umownej, gdy cena pozostaje nieustalona (REFER, brak daty, VAT, składniki)', () => {
  const base = agg('2027-03', '2027-03-01', '150', '180', '150');
  for (const input of [{ ...base, dateVerified: false }, { ...base, multipleDates: true }, { ...base, unresolvedDiscounts: true }]) {
    const r = evaluateCorrection(input);
    assert.equal(r.decision, 'REFER');
    assert.equal(field(buildResultPresentation(r), 'contract-price'), undefined);
    assert.ok(!copyLines(r).some(text => /Cena umowna/.test(text)));
  }
  // 26.11.2026: mieszany VAT (23% + 8%) nie blokuje już wyniku — podwyżka od dnia 1 ma cenę umowną N, a VAT zostaje informacją (D11).
  const mixed = evaluateCorrection(bok('2027-03', '2027-03-01', [line('internet', '100', '120', '100'), { ...line('tv', '50', '60'), vat: '8' }]));
  assert.equal(mixed.decision, 'NO_CORRECTION');
  assert.equal(field(buildResultPresentation(mixed), 'contract-price').value, '150,00 zł'); // T = 02.03 → cena umowna O za marzec
  assert.ok(mixed.warnings.includes('MIXED_VAT_GROSS_ONLY'));
  assert.equal(mixed.accountingAllowed, false);
  const same = evaluateCorrection(bok('2027-03', '2027-03-01', [line('internet', '100', '110'), line('tv', '50', '40')]));
  assert.equal(same.code, 'COMPONENTS_CHANGED_SAME_TOTAL');
  assert.equal(field(buildResultPresentation(same), 'contract-price'), undefined);
});

test('FIX-02 podwyżka w miesiącu przed i po zmianie nie dostaje pola „Cena umowna” (zostaje „Abonament za miesiąc”)', () => {
  const before = evaluateCorrection(agg('2027-04', '2027-03-10', '150', '180', '180'));
  assert.equal(field(buildResultPresentation(before), 'contract-price'), undefined);
  assert.equal(field(buildResultPresentation(before), 'due').label, 'Abonament za miesiąc');
  const after = evaluateCorrection(agg('2027-02', '2027-03-10', '150', '180', '150')); // zmiana po miesiącu analizy
  assert.equal(field(buildResultPresentation(after), 'contract-price'), undefined);
  assert.equal(field(buildResultPresentation(after), 'due').value, '150,00 zł');
});

// ---------------------------------------------------------------------------------------------------------------
// FIX-03 — daysOld/daysNew przy podwyżce wynikają z polityki cenowej, nie z podziału kalendarzowego po dacie T.
// ---------------------------------------------------------------------------------------------------------------
const months = [['2027-02', '2027-01-31', '2027-02-01', 28], ['2028-02', '2028-01-31', '2028-02-01', 29],
  ['2026-11', '2026-10-31', '2026-11-01', 30], ['2027-03', '2027-02-28', '2027-03-01', 31]];
for (const [month, lastBefore, lastFirst, length] of months) {
  test(`FIX-03 podwyżka w miesiącu ${length}-dniowym (${month}): T = 1. dnia → [0, ${length}], T = 2. dnia → [${length}, 0]`, () => {
    const first = evaluateCorrection(agg(month, lastBefore, '150', '180', '150'));
    assert.deepEqual([first.daysOld, first.daysNew, first.daysInMonth], [0, length, length]);
    assert.equal(first.effectiveBillingDate, `${month}-01`);
    const second = evaluateCorrection(agg(month, lastFirst, '150', '180', '150'));
    assert.deepEqual([second.daysOld, second.daysNew, second.daysInMonth], [length, 0, length]);
    assert.equal(second.effectiveDate, `${month}-02`, 'T pozostaje datą skuteczności zdarzenia');
  });
}

test('FIX-03 podwyżka: T w środku miesiąca, w miesiącu wcześniejszym i późniejszym niż miesiąc analizy', () => {
  const mid = evaluateCorrection(agg('2027-03', '2027-03-17', '150', '180', '150'));
  assert.deepEqual([mid.daysOld, mid.daysNew, mid.effectiveDate, mid.effectiveBillingDate], [31, 0, '2027-03-18', '2027-04-01']);
  const earlier = evaluateCorrection(agg('2027-03', '2027-02-09', '150', '180', '180')); // zmiana w poprzednim miesiącu
  assert.deepEqual([earlier.daysOld, earlier.daysNew, earlier.effectiveBillingDate], [0, 31, '2027-03-01']);
  const later = evaluateCorrection(agg('2027-03', '2027-04-09', '150', '180', '150')); // zmiana w następnym miesiącu
  assert.deepEqual([later.daysOld, later.daysNew], [31, 0]);
  const farEarlier = evaluateCorrection(agg('2027-03', '2027-02-01', '150', '180', '180'));
  assert.deepEqual([farEarlier.daysOld, farEarlier.daysNew], [0, 31]);
});

test('FIX-03 bez zmian: obniżka i zakończenie nadal używają dni d/r wg daty T', () => {
  const down = evaluateCorrection(agg('2027-03', '2027-03-17', '150', '100', '150'));
  assert.deepEqual([down.appliedMethod, down.daysOld, down.daysNew, down.amountDue], ['B', 17, 14, '126.67']);
  const feb = evaluateCorrection(agg('2027-02', '2027-02-03', '100', '80', '100'));
  assert.deepEqual([feb.appliedMethod, feb.daysOld, feb.daysNew, feb.amountDue], ['C', 3, 25, '76.67']);
  const end = evaluateCorrection({ month: '2026-11', lastOldDate: '2026-11-17', dateVerified: true, type: 'WYPOWIEDZENIE', totals: { old: '150', new: '0', invoiced: '150' } });
  assert.deepEqual([end.daysOld, end.daysNew, end.amountDue], [17, 13, '85.00']);
  const noChange = evaluateCorrection(agg('2027-03', '2027-03-01', '150', '150', '150'));
  assert.equal(noChange.amountDue, '150.00');
});

test('FIX-03 podsumowanie z ekranu i kopii podaje dni zgodne z polityką cenową', () => {
  const r = evaluateCorrection(agg('2027-03', '2027-03-01', '150', '180', '150'));
  assert.equal(r.daysOld + r.daysNew, r.daysInMonth);
  assert.ok(!copyLines(r).some(text => /Dni starej ceny: 1\./.test(text)));
});

// ---------------------------------------------------------------------------------------------------------------
// FIX-04 — etykiety metod opisują wyłącznie regułę CB (dawne reguły usunięto z kodu w etapie KISS).
// ---------------------------------------------------------------------------------------------------------------
const downgrade31 = agg('2027-03', '2027-03-17', '150', '100', '150');

test('FIX-04 etykiety: B i C to etykiety reguły CB; pełne miesiące mają czytelne nazwy', () => {
  assert.match(billingLabel('B'), /^Reguła CB — miesiąc 31-dniowy/);
  assert.match(billingLabel('C'), /^Reguła CB — miesiąc 28\/29\/30-dniowy/);
  assert.equal(billingLabel('Pełna O'), 'Pełny dotychczasowy abonament');
  assert.equal(billingLabel('Pełna N'), 'Pełny nowy abonament');
});

test('FIX-04 ścieżka aktywna: reguła CB, bez znaczników ani nazw dawnych reguł', () => {
  const active = evaluateCorrection(downgrade31);
  assert.equal(active.policyVersion, ACTIVE_DEMO_POLICY.version);
  assert.equal(active.historical, undefined);
  assert.match(active.formulaReason, /reguła CB-2026-11-25/);
  const view = buildResultPresentation(active);
  assert.match(view.explanation.method, /^Reguła CB/);
  assert.ok(!/MIN\(A,B\)|Historyczn|rzeczywiste dni/.test(copyLines(active).join('\n')));
});

test('FIX-04 w UI nie ma selektora metod ani odwołań do reguł historycznych', () => {
  const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
  for (const file of ['index.html', 'app.mjs']) {
    assert.doesNotMatch(read(file), /MIN_AB|MIN\(A,B\)|ACTUAL_DAYS|calculation-mode|name="calculation/, file);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// FIX-05 — zabezpieczenie dokumentacji i świeżego klonu (bez zależności od lokalnego .git/info/exclude).
// ---------------------------------------------------------------------------------------------------------------
const repoFile = name => new URL(`../${name}`, import.meta.url);
const readRepo = name => readFileSync(repoFile(name), 'utf8');

test('FIX-05 .gitignore jest śledzonym plikiem repo i chroni output/, node_modules/, artefakty testów i lokalne instrukcje', () => {
  assert.ok(existsSync(repoFile('.gitignore')), 'brak .gitignore w repozytorium');
  const lines = readRepo('.gitignore').split(/\r?\n/).map(value => value.trim());
  for (const entry of ['node_modules/', 'output/', 'test-results/', 'playwright-report/', '/CLAUDE.md', '/AGENTS.md', '.claude/']) {
    assert.ok(lines.includes(entry), `.gitignore nie zawiera ${entry}`);
  }
});

test('FIX-05 GITHUB_UPLOAD.md nie podaje starej reguły jako obowiązującej i wskazuje jedyną aktywną regułę CB', () => {
  const text = readRepo('GITHUB_UPLOAD.md');
  assert.match(text, /SUPERSEDED/);
  assert.match(text, /CB-2026-11-25/);
  assert.doesNotMatch(text, /Obecna reguła nalicza obniżki i zakończenia według rzeczywistych dni/);
});

test('FIX-05 README nie linkuje dokumentów niedostępnych w świeżym klonie i wskazuje jedyną aktywną regułę', () => {
  const text = readRepo('README.md');
  for (const target of text.matchAll(/\]\((?!https?:)([^)#]+)\)/g)) {
    assert.ok(existsSync(repoFile(target[1])), `README linkuje nieistniejący plik: ${target[1]}`);
  }
  assert.doesNotMatch(text, /RAPORT_UZGODNIENIE_AB|RAPORT_ETAP_3_AUTO_BILLING/);
  assert.match(text, /jedyn[aą] aktywn[aą] regu/i);
  assert.match(text, /CB-2026-11-25/);
});

// ---------------------------------------------------------------------------------------------------------------
// SEC-01 — prosty, deterministyczny strażnik prywatności (reguły: tests/helpers/privacy-guard.mjs).
// Nie zależy od konta systemowego, katalogu domowego, nazwy komputera ani lokalnej konfiguracji.
// Pełny audyt poufności przed publikacją to osobne zadanie (6C/G-01).
// ---------------------------------------------------------------------------------------------------------------

const MUST_DETECT = [
  // Windows: różne loginy, separatory, escapowanie
  ['Windows, backslash, login z myślnikiem', String.raw`C:\Users\demo-user\Documents\file.txt`],
  ['Windows, login z kropką i wielkimi literami', String.raw`D:\Users\Anna.Nowak\Desktop\plik.txt`],
  ['Windows, małe litery', String.raw`c:\users\admin\AppData\Local\Temp`],
  ['Windows, separator /', 'C:/Users/demo-user/Documents/file.txt'],
  ['Windows, separatory mieszane', String.raw`C:\Users/demo-user\mixed/path`],
  ['Windows, escapowanie JSON', JSON.stringify(String.raw`C:\Users\demo-user\file.txt`)],
  ['Windows, escapowanie źródła JS', String.raw`const p = 'C:\\Users\\demo-user\\x';`],
  ['Windows, podwójne escapowanie', String.raw`"C:\\\\Users\\\\demo-user\\\\x"`],
  ['Windows, file:///C:/Users/…', 'file:///C:/Users/demo-user/Documents/x.txt'],
  // macOS / Linux
  ['Linux /home/…/…', '/home/demo-user/project/file.txt'],
  ['Linux, katalog domowy bez dalszej ścieżki', 'cd /home/demo-user'],
  ['macOS /Users/…/…', '/Users/demo-user/project/file.txt'],
  ['Linux, cudzysłów', '"/home/demo-user/x"'],
  ['file:///home/…', 'file:///home/demo-user/x'],
  ['file:///Users/…', 'file:///Users/demo-user/x'],
  ['Linux, ukośniki z escapowaniem JSON', String.raw`\/home\/demo-user\/x`],
  // OneDrive (prywatne ścieżki)
  ['OneDrive w profilu Windows', String.raw`C:\Users\demo-user\OneDrive\Documents\x`],
  ['OneDrive firmowy na dysku', String.raw`D:\OneDrive - Firma Przykładowa\Zadania\x`],
  ['OneDrive na dysku, separator /', 'E:/OneDrive/Dokumenty/plik.txt'],
  ['OneDrive firmowy bez litery dysku', 'OneDrive - Firma Przykładowa/Zadania/plik.txt'],
  ['OneDrive z tyldą', '~/OneDrive/Dokumenty/x'],
  ['OneDrive, escapowanie', String.raw`C:\\OneDrive - Firma\\x`],
  // Notion
  ['Notion www.notion.so', 'https://www.notion.so/Strona-0123456789abcdef'],
  ['Notion *.notion.site', 'https://firma.notion.site/Strona-1'],
  ['Notion app.notion.com', 'https://app.notion.com/p/abc123'],
  ['Notion bez schematu', 'notion.so/Strona-1'],
  ['Notion http', 'http://notion.site/x'],
  ['Notion, escapowane ukośniki', String.raw`https:\/\/www.notion.so\/x`],
];

const MUST_NOT_DETECT = [
  ['zwykły kod z „server”', 'const server = createServer(); server.listen(4175);'],
  ['ścieżka usługi z „server”', '/api/server/status'],
  ['nazwa usługi Internet', 'Internet 300 Mb/s — abonament'],
  ['opcja formularza Internet', '<option value="internet">Internet</option>'],
  ['notion.sort(items)', 'notion.sort(items)'],
  ['notion.search(query)', 'const hits = notion.search(query);'],
  ['identyfikator notionSort', 'const notionSort = items => items;'],
  ['pakiet @example/onedrive-client', "import { OneDriveClient } from '@example/onedrive-client';"],
  ['pakiet onedrive-api', "const api = require('onedrive-api');"],
  ['nazwa pakietu w package.json', '"@example/onedrive-client": "^1.2.3"'],
  ['dokumentacja Microsoft o OneDrive', 'https://learn.microsoft.com/pl-pl/onedrive/developer/'],
  ['publiczne repozytorium GitHub OneDrive', 'https://github.com/OneDrive/onedrive-api-docs/blob/master/README.md'],
  ['dokumentacja techniczna Notion API', 'https://developers.notion.com/reference/intro'],
  ['pakiet npm klienta Notion', 'https://www.npmjs.com/package/@notionhq/client'],
  ['publiczny URL z segmentem home', 'https://docs.example.org/home/overview'],
  ['publiczny URL z segmentem Users', 'https://example.com/Users/guide'],
  ['względna ścieżka src/', 'src/billing-policy.mjs'],
  ['względna ścieżka tests/', './tests/helpers/privacy-guard.mjs'],
  ['względna ścieżka nadrzędna', '../README.md'],
  ['względna ścieżka docs/', 'docs/RAPORT_ETAP_2.md'],
  ['katalog home w projekcie', 'src/home/page.mjs'],
  ['systemowa ścieżka Windows', String.raw`C:\Windows\System32\cmd.exe`],
  ['Program Files', String.raw`C:\Program Files\nodejs\node.exe`],
  ['ścieżka systemowa Unix', '/usr/local/bin/node'],
  ['katalog tymczasowy Unix', '/tmp/build/output'],
  ['współdzielony profil Public', String.raw`C:\Users\Public\Documents`],
  ['identyfikatory users/home w kodzie', 'const userHome = getUsers().map(user => user.home);'],
  ['indeks users[0]', 'users[0].name'],
  ['zwykłe zdanie', 'Użytkownik wpisuje kwotę 150,00 zł'],
];

test('SEC-01-FINAL macierz: syntetyczne prywatne ścieżki i adresy są wykrywane', () => {
  const missed = MUST_DETECT.filter(([, sample]) => findPrivateCategories(sample).length === 0).map(([name]) => name);
  assert.deepEqual(missed, [], 'nie wykryto przypadków');
});

test('SEC-01-FINAL macierz: nieszkodliwe dane nie powodują alarmu', () => {
  const falseAlarms = MUST_NOT_DETECT.filter(([, sample]) => findPrivateCategories(sample).length > 0).map(([name]) => name);
  assert.deepEqual(falseAlarms, [], 'fałszywe alarmy');
});

test('SEC-01-FINAL kategorie reguł są jawne i niezmienne', () => {
  assert.deepEqual(PRIVATE_PATH_RULES.map(rule => rule.id), ['windows-profile', 'unix-profile', 'onedrive', 'notion']);
});

test('SEC-01-FINAL śledzone pliki aplikacji i dokumentacji bieżącej nie zawierają prywatnych ścieżek ani adresów Notion', () => {
  for (const file of SCANNED_PUBLIC_FILES) {
    assert.deepEqual(findPrivateCategories(readRepo(file)), [], `${file}: wykryto prywatną ścieżkę lub adres wewnętrzny`);
  }
});

test('SEC-01-FINAL wynik nie zależy od konta, katalogu domowego ani nazwy komputera (symulacja zmiennych środowiska)', () => {
  const corpus = [...MUST_DETECT, ...MUST_NOT_DETECT].map(([, sample]) => sample);
  const baseline = corpus.map(findPrivateCategories);
  const baselineFiles = SCANNED_PUBLIC_FILES.map(file => findPrivateCategories(readRepo(file)));
  const keys = ['USERNAME', 'USER', 'LOGNAME', 'HOME', 'USERPROFILE', 'COMPUTERNAME', 'HOSTNAME'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const account of ['server', 'internet', 'test', 'root', 'runner', 'demo-user', '']) {
      for (const key of keys) process.env[key] = key === 'HOME' || key === 'USERPROFILE' ? `/home/${account}` : account;
      assert.deepEqual(corpus.map(findPrivateCategories), baseline, `konto „${account}”`);
      assert.deepEqual(SCANNED_PUBLIC_FILES.map(file => findPrivateCategories(readRepo(file))), baselineFiles, `pliki, konto „${account}”`);
    }
    for (const key of keys) delete process.env[key];
    assert.deepEqual(corpus.map(findPrivateCategories), baseline, 'brak zmiennych środowiska');
  } finally {
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});

test('SEC-01-FINAL standardowy strażnik nie odczytuje konta systemowego, katalogu domowego, nazwy komputera ani konfiguracji lokalnej', () => {
  // Wzorce składane z fragmentów, aby nie dopasować samego siebie.
  const common = [['node', ':os'], ['user', 'Info'], ['home', 'dir\\('], ['host', 'name\\(']].map(parts => new RegExp(parts.join('')));
  const helperOnly = [['process', '\\.env'], ['BOK', '_PRIVATE']].map(parts => new RegExp(parts.join('')));
  for (const [file, patterns] of [['tests/fix-pack-6a.test.mjs', common], ['tests/helpers/privacy-guard.mjs', [...common, ...helperOnly]]]) {
    const source = readRepo(file);
    patterns.forEach((pattern, index) => assert.ok(!pattern.test(source), `${file}: zależność od środowiska (wzorzec #${index + 1})`));
  }
});
