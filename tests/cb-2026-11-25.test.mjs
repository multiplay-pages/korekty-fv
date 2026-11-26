// Testy reguły CB-2026-11-25. Oczekiwania pochodzą z niezależnych fixtures (tests/fixtures/cb-fixtures.json,
// policzonych poza testowaną funkcją) oraz z ręcznie wpisanych przykładów. Żaden test nie liczy wartości oczekiwanej
// funkcją, którą sprawdza.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculate } from '../src/calculator.mjs';
import { evaluateBasket } from '../src/basket.mjs';
import { buildInvoicePlan } from '../src/invoice-plan.mjs';
import { buildResultPresentation, copyResultPresentation } from '../src/summary.mjs';
import { ACTIVE_DEMO_POLICY, evaluateCorrection } from '../src/billing-policy.mjs';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/cb-fixtures.json', import.meta.url), 'utf8'));
const pln = cents => `${cents < 0 ? '-' : ''}${Math.abs(cents) / 100 | 0}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
const typeOf = c => (c.newCents === 0 ? 'WYPOWIEDZENIE' : 'DOWNGRADE');
const row = (old, next, invoiced = old, service = 'internet') => ({ service, old: pln(old), new: pln(next), invoiced: pln(invoiced), basis: 'gross', vat: '' });
const form = c => ({
  month: c.month, effectiveDate: c.effectiveDate, lastOldDate: c.lastOldDate, type: typeOf(c), dateVerified: true,
  rows: c.rows ? c.rows.map((r, i) => row(r.oldCents, r.newCents, r.invoicedCents, i ? 'tv' : 'internet'))
    : [row(c.oldCents, c.newCents, c.invoicedCents)],
});

test('fixtures: 19 przypadków CB w paczce', () => assert.equal(fixtures.cases.length, 19));

for (const c of fixtures.cases) {
  test(`CB ${c.id}: calculate (tryb zbiorczy) — metoda ${c.expected.method}, należność ${pln(c.expected.dueCents)}`, () => {
    const r = calculate({ month: c.month, effectiveDate: c.effectiveDate, lastOldDate: c.lastOldDate, type: typeOf(c),
      old: pln(c.oldCents), new: pln(c.newCents), invoiced: pln(c.invoicedCents), basis: 'gross', dateVerified: true });
    assert.equal(r.method, c.expected.method);
    assert.equal(r.dueCents, String(c.expected.dueCents));
    assert.equal(r.deltaCents, String(c.expected.deltaCents));
    assert.equal(r.daysInMonth, c.daysInMonth);
    assert.equal(r.daysOld, c.daysOld);
    assert.equal(r.daysNew, c.daysNew);
  });

  test(`CB ${c.id}: evaluateBasket (tryb wierszy) zgodny z kwotą koszyka`, () => {
    const r = evaluateBasket(form(c));
    assert.equal(r.global.method, c.expected.method);
    assert.equal(r.global.dueCents, String(c.expected.dueCents));
    assert.equal(r.global.deltaCents, String(c.expected.deltaCents));
    assert.ok(r.rows.every(x => x.method === c.expected.method), 'każdy wiersz używa tej samej metody globalnej');
    if (c.rows) {
      assert.deepEqual(r.rows.map(x => x.due), c.rows.map(x => pln(x.expectedDueCents)));
      assert.equal(r.residual, pln(c.expected.residualCents));
      assert.equal(r.reconciled, false);
      assert.ok(r.warnings.includes('UNALLOCATED_ROUNDING'));
    } else {
      assert.equal(r.rows[0].due, pln(c.expected.dueCents));
      assert.equal(r.residual, '0.00');
    }
  });

  test(`CB ${c.id}: aktywna ścieżka UI (evaluateCorrection) używa polityki CB`, () => {
    const input = c.rows
      ? { month: c.month, lastOldDate: c.lastOldDate, dateVerified: true, source: 'lines', totals: {}, documentState: 'AMOUNT', invoiceConfirmed: true,
          rows: c.rows.map((r, i) => ({ service: i ? 'tv' : 'internet', old: pln(r.oldCents), new: pln(r.newCents), invoiced: pln(r.invoicedCents), basis: 'gross', vat: '23' })) }
      : { month: c.month, lastOldDate: c.lastOldDate, dateVerified: true, documentState: 'AMOUNT',
          totals: { old: pln(c.oldCents), new: pln(c.newCents), invoiced: pln(c.invoicedCents) } };
    const r = evaluateCorrection(input);
    assert.equal(r.amountDue, pln(c.expected.dueCents));
    assert.equal(r.appliedMethod, c.expected.method);
  });
}

test('CB: profil aktywnej polityki jest oznaczony regułą CB-2026-11-25', () => {
  assert.equal(ACTIVE_DEMO_POLICY.rule, 'CB-2026-11-25');
  assert.match(ACTIVE_DEMO_POLICY.version, /cb-2026-11-25/);
});

// Przykład kontrolny O=150, N=100, F=150, d=17 (ręcznie): L28 121,67/28,33, L29 125,00/25,00, L30 128,33/21,67, L31 126,67/23,33.
for (const [month, due, delta, method] of [
  ['2027-02', '121.67', '28.33', 'C'], ['2028-02', '125.00', '25.00', 'C'],
  ['2026-11', '128.33', '21.67', 'C'], ['2027-03', '126.67', '23.33', 'B'],
]) {
  test(`CB przykład kontrolny ${month}: ${due}/${delta}`, () => {
    const r = calculate({ month, effectiveDate: `${month}-18`, type: 'DOWNGRADE', old: '150', new: '100', invoiced: '150', basis: 'gross', dateVerified: true });
    assert.deepEqual([r.method, r.due, r.delta], [method, due, delta]);
  });
}

// Granice dat i brak zmiany — reguła CB ich nie zmienia.
test('CB granice: T w pierwszym dniu miesiąca → pełna N; T po końcu miesiąca → pełna O; O=N → pełna O', () => {
  const base = { type: 'DOWNGRADE', old: '150', new: '100', invoiced: '150', basis: 'gross', dateVerified: true };
  assert.deepEqual([calculate({ ...base, month: '2027-02', effectiveDate: '2027-02-01' }).method, calculate({ ...base, month: '2027-02', effectiveDate: '2027-02-01' }).due], ['Pełna N', '100.00']);
  assert.deepEqual([calculate({ ...base, month: '2027-02', effectiveDate: '2027-03-01' }).method, calculate({ ...base, month: '2027-02', effectiveDate: '2027-03-01' }).due], ['Pełna O', '150.00']);
  const same = calculate({ ...base, type: 'NO_CHANGE', new: '150', month: '2027-02', effectiveDate: '2027-02-18' });
  assert.deepEqual([same.method, same.due], ['Pełna O', '150.00']);
});

test('CB: podwyżka nie podlega C/B (cena O do końca miesiąca zmiany)', () => {
  const r = calculate({ month: '2027-02', effectiveDate: '2027-02-18', type: 'PODWYŻKA', old: '150', new: '180', invoiced: '150', basis: 'gross', dateVerified: true });
  assert.deepEqual([r.method, r.due], ['Pełna O', '150.00']);
});

test('CB T27: ta sama suma, zmiana składników → przegląd, bez samodzielnego podziału', () => {
  const r = evaluateBasket({ month: '2027-03', effectiveDate: '2027-03-18', type: 'NO_CHANGE', dateVerified: true,
    rows: [row(10000, 7000), row(5000, 8000, 5000, 'tv')] });
  assert.ok(r.warnings.includes('COMPONENTS_CHANGED_SAME_TOTAL'));
  assert.equal(r.global.due, '150.00');
  assert.equal(buildInvoicePlan(r).available, false);
});

test('CB: wiersz bez zmiany ceny w koszyku C liczy O·L/30 (nie pełne O)', () => {
  const c = fixtures.cases.find(x => x.id === 'CB-UNCHANGED-ROW');
  const r = evaluateBasket(form(c));
  assert.equal(r.rows[1].due, '37.33'); // 40,00 × 28 / 30
  assert.equal(r.rows[1].method, 'C');
});

test('CB: koszyk mieszany (obniżka + podwyżka składnika) liczony jedną metodą globalną', () => {
  // O=150, N=130, T=18 marca (L=31, d=17): B = 150 + (130−150)×14/30 = 140,67; wiersze 81,33 + 59,33, reszta 0,01.
  const r = evaluateBasket({ month: '2027-03', effectiveDate: '2027-03-18', lastOldDate: '2027-03-17', type: 'DOWNGRADE', dateVerified: true,
    rows: [row(10000, 6000), row(5000, 7000, 5000, 'tv')] });
  assert.equal(r.global.method, 'B');
  assert.deepEqual(r.rows.map(x => x.due), ['81.33', '59.33']);
  assert.equal(r.residual, '0.01');
});

test('CB: kopia z formularza nie używa starych nazw metod', () => {
  const result = evaluateCorrection({ month: '2027-02', lastOldDate: '2027-02-17', dateVerified: true, totals: { old: '150', new: '100', invoiced: '150' } });
  const text = copyResultPresentation(buildResultPresentation(result));
  assert.doesNotMatch(text, /Porównanie A\/B|Metoda A\b|MIN\(A,\s*B\)|A=B|rzeczywiste dni|Historyczn/);
  assert.match(text, /121,67 zł/);
});

// ---- Przegląd wyczerpujący: niezależna formuła BigInt w teście (nie wywołuje testowanych funkcji). ----
const lengthOf = (y, m) => [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
const half30 = n => (n + 15n) / 30n; // half-up dla wartości nieujemnych
const cbDueCents = (o, n, d, L) => {
  const r = BigInt(L - d), D = BigInt(d);
  return half30(L === 31 ? o * 30n + (n - o) * r : o * D + n * r);
};
const sweepMonths = [[2026, 2], [2027, 2], [2028, 2], [2100, 2], [2000, 2], [2026, 4], [2026, 11], [2027, 3], [2027, 1], [2026, 12]];
const sweepPairs = [[15000n, 10000n], [10000n, 8000n], [15000n, 0n], [1n, 0n], [4n, 1n], [9999n, 9998n], [30000n, 100n]];

test('CB sweep: każdy dzień 2–L miesięcy 28/29/30/31 (w tym 1900/2000/2100) zgodny z niezależną formułą', () => {
  let checked = 0;
  for (const [y, m] of sweepMonths) {
    const L = lengthOf(y, m), month = `${y}-${String(m).padStart(2, '0')}`;
    for (const [o, n] of sweepPairs) for (let T = 2; T <= L; T++) {
      const d = T - 1;
      const r = calculate({ month, effectiveDate: `${month}-${String(T).padStart(2, '0')}`, type: n === 0n ? 'WYPOWIEDZENIE' : 'DOWNGRADE',
        old: pln(Number(o)), new: pln(Number(n)), invoiced: pln(Number(o)), basis: 'gross', dateVerified: true });
      assert.equal(r.dueCents, String(cbDueCents(o, n, d, L)), `${month} T=${T} O=${o} N=${n}`);
      assert.equal(r.method, L === 31 ? 'B' : 'C');
      checked++;
    }
  }
  assert.ok(checked > 1000);
});

test('CB sweep: wynik zbiorczy = wynik wierszy (jeden wiersz) dla każdego dnia, bez dryfu między ścieżkami', () => {
  for (const [y, m] of [[2027, 2], [2028, 2], [2026, 11], [2027, 3]]) {
    const L = lengthOf(y, m), month = `${y}-${String(m).padStart(2, '0')}`;
    for (let T = 2; T <= L; T++) {
      const effectiveDate = `${month}-${String(T).padStart(2, '0')}`;
      const agg = calculate({ month, effectiveDate, type: 'DOWNGRADE', old: '150', new: '100', invoiced: '150', basis: 'gross', dateVerified: true });
      const rows = evaluateBasket({ month, effectiveDate, type: 'DOWNGRADE', dateVerified: true, rows: [row(15000, 10000)] });
      const ui = evaluateCorrection({ month, lastOldDate: `${month}-${String(T - 1).padStart(2, '0')}`, dateVerified: true, documentState: 'AMOUNT', totals: { old: '150', new: '100', invoiced: '150' } });
      assert.equal(rows.global.dueCents, agg.dueCents);
      assert.equal(rows.rows[0].due, agg.due);
      assert.equal(ui.amountDue, agg.due);
    }
  }
});

test('CB: wiersze różnych kierunków w koszyku obniżkowym — suma wierszy plus reszta = należność koszyka', () => {
  const r = evaluateBasket({ month: '2027-02', effectiveDate: '2027-02-18', type: 'DOWNGRADE', dateVerified: true,
    rows: [row(10000, 5000), row(4000, 6000, 4000, 'tv')] });
  // O=140, N=110, d=17, L=28: C=(140·17+110·11)/30=3590/30=119,67; wiersze: 66,67 (nie ma ujemnych) — kontrola spójności reszty.
  assert.equal(r.global.method, 'C');
  assert.equal(r.global.due, '119.67');
  const rowsTotal = r.rows.reduce((s, x) => s + BigInt(x.due.replace('.', '')), 0n);
  assert.equal(rowsTotal + BigInt(r.residual.replace('.', '')), BigInt(r.global.dueCents));
});

test('CB: przypadek brzegowy 0,00 zł — jeden dzień usługi w miesiącu 31-dniowym, bez blokady', () => {
  const r = calculate({ month: '2027-03', effectiveDate: '2027-03-02', type: 'WYPOWIEDZENIE', old: '150', new: '0', invoiced: '150', basis: 'gross', dateVerified: true });
  assert.deepEqual([r.method, r.due, r.delta], ['B', '0.00', '150.00']);
  assert.ok(r.warnings.includes('ZERO_FOR_ONE_SERVICE_DAY'));
  // W miesiącu 28-dniowym jeden dzień usługi to 5,00 zł (150×1/30), nie 0,00.
  const feb = calculate({ month: '2027-02', effectiveDate: '2027-02-02', type: 'WYPOWIEDZENIE', old: '150', new: '0', invoiced: '150', basis: 'gross', dateVerified: true });
  assert.deepEqual([feb.method, feb.due], ['C', '5.00']);
});

test('CB: niewiążące F i wpłata P nie zmieniają należności (F≠O, F=0, P dowolne)', () => {
  const base = { month: '2027-02', effectiveDate: '2027-02-18', type: 'DOWNGRADE', old: '150', new: '100', basis: 'gross', dateVerified: true };
  for (const [invoiced, paid] of [['150', '0'], ['130', '150'], ['0', '999'], ['100', '1']]) {
    const r = calculate({ ...base, invoiced, paid });
    assert.equal(r.due, '121.67');
  }
});

test('CB P-08: podwyżka od 1. dnia miesiąca → należność N; w trakcie miesiąca → O, a N od następnego miesiąca', () => {
  const first = evaluateCorrection({ month: '2027-03', lastOldDate: '2027-02-28', dateVerified: true, documentState: 'AMOUNT', totals: { old: '150', new: '180', invoiced: '180' } });
  assert.deepEqual([first.amountDue, first.effectiveBillingDate, first.ruleId, first.decision], ['180.00', '2027-03-01', 'R03', 'NO_CORRECTION']);
  const mid = evaluateCorrection({ month: '2027-03', lastOldDate: '2027-03-17', dateVerified: true, documentState: 'AMOUNT', totals: { old: '150', new: '180', invoiced: '150' } });
  assert.deepEqual([mid.amountDue, mid.effectiveBillingDate, mid.ruleId, mid.decision], ['150.00', '2027-04-01', 'R06', 'NO_CORRECTION']);
});

test('CB BOK/SUD: wynik zbiorczy (SUD) i wierszowy (BOK) dają tę samą należność koszyka', () => {
  const sud = evaluateCorrection({ month: '2027-03', lastOldDate: '2027-03-17', dateVerified: true, documentState: 'AMOUNT', totals: { old: '150', new: '130', invoiced: '150' } });
  const bok = evaluateCorrection({ month: '2027-03', lastOldDate: '2027-03-17', dateVerified: true, source: 'lines', totals: {}, documentState: 'AMOUNT',
    invoiceConfirmed: true, rows: [{ service: 'internet', old: '100', new: '60', invoiced: '100', basis: 'gross', vat: '23' }, { service: 'tv', old: '50', new: '70', invoiced: '50', basis: 'gross', vat: '23' }] });
  assert.equal(sud.amountDue, '140.67');
  assert.equal(bok.amountDue, '140.67');
  assert.equal(bok.correctionRemainder, '-0.01'); // faktura−należność 9,33 minus suma różnic wierszy 9,34 (jawna reszta, bez alokacji)
});

test('BOK liczy wyłącznie z pozycji: inne sumy koszyka (SUD) nie zmieniają wyniku, ostrzeżeń ani możliwości obliczenia', () => {
  const rows = [{ service: 'internet', old: '100', new: '80', invoiced: '100', basis: 'gross', vat: '23' },
    { service: 'tv', old: '50', new: '40', invoiced: '50', basis: 'gross', vat: '23' }];
  const bok = totals => evaluateCorrection({ month: '2026-11', lastOldDate: '2026-11-15', dateVerified: true, source: 'lines', totals,
    documentState: 'AMOUNT', invoiceConfirmed: true, rows });
  const clean = bok({});
  assert.deepEqual([clean.amountDue, clean.dataStatus], ['135.00', 'CONFIRMED']);
  assert.notEqual(clean.decision, 'ERROR');
  for (const totals of [{ old: '999', new: '1', invoiced: '0' }, { old: '150' }, { old: 'abc', new: '-5', invoiced: '' }]) {
    const other = bok(totals);
    assert.deepEqual([other.decision, other.code, other.amountDue, other.correctionRemainder, other.dataStatus, other.warnings, other.confirmation],
      [clean.decision, clean.code, clean.amountDue, clean.correctionRemainder, clean.dataStatus, clean.warnings, clean.confirmation], JSON.stringify(totals));
  }
  // Kontrole pozycji zostają: brak F w pozycji blokuje potwierdzenie, a pusta kwota F nie jest traktowana jak 0 zł.
  const missing = evaluateCorrection({ month: '2026-11', lastOldDate: '2026-11-15', dateVerified: true, source: 'lines', totals: { invoiced: '150' },
    documentState: 'AMOUNT', invoiceConfirmed: true, rows: [rows[0], { ...rows[1], invoiced: '' }] });
  assert.equal(missing.confirmation.allowed, false);
  assert.notEqual(missing.dataStatus, 'CONFIRMED');
  const zero = evaluateCorrection({ month: '2026-11', lastOldDate: '2026-11-15', dateVerified: true, source: 'lines', totals: { invoiced: '150' },
    documentState: 'AMOUNT', invoiceConfirmed: true, rows: [rows[0], { ...rows[1], invoiced: '0' }] });
  assert.equal(zero.confirmation.allowed, true);
  assert.equal(zero.dataStatus, 'CONFIRMED');
});

test('CB guard: kod aplikacji nie zawiera dawnych reguł MIN(A,B) ani „rzeczywistych dni”', () => {
  const policy = readFileSync(new URL('../src/billing-policy.mjs', import.meta.url), 'utf8');
  const protectedBody = policy.slice(policy.indexOf('function evaluateProtectedCorrection'), policy.indexOf('export function evaluateCorrection'));
  assert.match(protectedBody, /evaluateLegacyCorrection\(normalized, ACTIVE_DEMO_POLICY\)/);
  for (const file of ['../app.mjs', '../src/billing-policy.mjs', '../src/calculator.mjs', '../src/summary.mjs', '../src/invoice-plan.mjs', '../src/basket.mjs']) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), 'utf8'),
      /HISTORICAL_MIN_AB|MIN_AB_HISTORICAL|BASELINE_DEMO_POLICY|LEGACY_MIN_AB|PREVIOUS_ACTIVE|ACTUAL_DAYS|evaluateDailyBasket|daily-proration/, file);
  }
});

test('CB guard: stara reguła podana jawnie nie jest liczona (POLICY_UNRESOLVED)', () => {
  const input = { month: '2027-02', lastOldDate: '2027-02-17', dateVerified: true, totals: { old: '150', new: '100', invoiced: '150' } };
  assert.equal(evaluateCorrection(input).amountDue, '121.67');
  for (const partialRule of ['MIN_AB', 'ACTUAL_DAYS']) {
    assert.equal(evaluateCorrection(input, { version: 'stara-regula', partialRule }).code, 'POLICY_UNRESOLVED', partialRule);
  }
});

test('CB: brak przełącznika metody i brak powrotu do starej polityki w ścieżce aktywnej', () => {
  const src = readFileSync(new URL('../app.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /LEGACY_MIN_AB|BASELINE_DEMO_POLICY|ACTUAL_DAYS_TEST_POLICY|methodSelector|name="method"/);
});
