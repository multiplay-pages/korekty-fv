import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculate, CB_RULE } from '../src/calculator.mjs';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/reference.json', import.meta.url), 'utf8'));
for (const fixture of fixtures) {
  test(`${fixture.id}: należność, różnica i metoda wg CB-2026-11-25 (wartości referencyjne wpisane ręcznie)`, () => {
    const result = calculate(fixture.input);
    assert.equal(result.due, fixture.expected.due);
    assert.equal(result.delta, fixture.expected.delta);
    assert.equal(result.method, fixture.expected.method);
    assert.equal(result.rule, 'CB-2026-11-25');
    if (fixture.expected.a) assert.equal(result.a, fixture.expected.a);
    if (fixture.expected.b) assert.equal(result.b, fixture.expected.b);
    if (fixture.expected.c) assert.equal(result.c, fixture.expected.c);
  });
}
test('calculate() ma jedną regułę CB; metody A i A=B nie występują', () => {
  for (const fixture of fixtures) {
    const result = calculate(fixture.input);
    assert.equal(result.rule, CB_RULE);
    assert.ok(['B', 'C', 'Pełna O', 'Pełna N'].includes(result.method), fixture.id);
  }
});

const base = { month: '2026-11', effectiveDate: '2026-11-18', type: 'DOWNGRADE', old: '150', new: '100', invoiced: '150', basis: 'gross', dateVerified: true };
test('T26: globalny koszyk daje 140,67; alokacja D11 pozostaje poza wynikiem', () => {
  const result = calculate({ ...base, month: '2027-03', effectiveDate: '2027-03-18', new: '130' });
  assert.equal(result.method, 'B');
  assert.equal(result.due, '140.67');
  assert.equal(result.delta, '9.33');
  assert.equal(result.exact.a.numerator, '424000');
  assert.equal(result.exact.b.numerator, '422000');
  assert.equal(result.exact.b.denominator, '30');
  assert.equal(result.lineAllocationStatus, 'NOT_IMPLEMENTED_D11');
});
test('T27: stała suma 150,00, nigdy 149,00; brak rozstrzygnięcia pozycji', () => {
  const result = calculate({ ...base, month: '2027-03', effectiveDate: '2027-03-18', new: '150', type: 'NO_CHANGE' });
  assert.equal(result.due, '150.00');
  assert.equal(result.delta, '0.00');
  assert.equal(result.a, '150.00');
  assert.equal(result.b, '150.00');
  assert.equal(result.lineAllocationStatus, 'NOT_IMPLEMENTED_D11');
});
test('wpłata nie wpływa na należność ani korektę dokumentu', () => {
  for (const paid of ['0', '70', '150', '250']) {
    const r = calculate({ ...base, paid });
    assert.equal(r.due, '128.33');
    assert.equal(r.delta, '21.67');
  }
});
test('F różne od O ostrzega, a ujemna różnica nie ginie', () => {
  const r = calculate({ ...base, invoiced: '100' });
  assert.equal(r.delta, '-28.33');
  assert.ok(r.warnings.includes('INVOICE_DIFFERS_FROM_OLD'));
  assert.ok(r.warnings.includes('ADDITIONAL_AMOUNT_REVIEW'));
});
test('T08: wynik zerowy jest objaśniony i nieblokowany', () => {
  const r = calculate(fixtures[7].input);
  assert.equal(r.due, '0.00');
  assert.ok(r.warnings.includes('ZERO_FOR_ONE_SERVICE_DAY'));
  assert.equal(r.status, 'TEST_ONLY');
});
test('T20: równy koszyk oznacza brak zmiany, mimo etykiety downgrade', () => {
  const r = calculate(fixtures[19].input);
  assert.equal(r.classification, 'NO_CHANGE');
  assert.ok(r.warnings.includes('NO_PRICE_CHANGE'));
});
test('kwoty z przecinkiem, ułamki grosza i half-up tylko po wyborze minimum', () => {
  const r = calculate({ ...base, month: '2027-03', effectiveDate: '2027-03-17', old: '0,03', new: '0', invoiced: '0,03', type: 'WYPOWIEDZENIE' });
  assert.equal(r.exact.a.numerator, '48');
  assert.equal(r.exact.b.numerator, '45');
  assert.equal(r.due, '0.02');
  assert.equal(r.method, 'B');
  assert.equal(r.delta, '0.01');
});
test('duże kwoty są dokładne powyżej precyzji Number w groszach', () => {
  const r = calculate({ ...base, old: '999999999999999.99', new: '999999999999999.98', invoiced: '999999999999999.99' });
  assert.equal(r.due, '999999999999999.99');
  assert.equal(r.delta, '0.00');
});
test('E/T przechodzi przez koniec roku i daty poza miesiącem', () => {
  const r = calculate({ ...base, month: '2027-01', effectiveDate: '2027-01-01', lastOldDate: '2026-12-31', type: 'WYPOWIEDZENIE', new: '0' });
  assert.equal(r.due, '0.00');
  assert.equal(r.daysOld, 0);
  assert.equal(r.daysNew, 31);
  assert.equal(calculate({ ...base, effectiveDate: '2027-01-01' }).due, '150.00');
  assert.equal(calculate({ ...base, effectiveDate: '2025-12-31' }).due, '100.00');
});
test('kalendarz gregoriański: 1900 zwykły, 2000 i 2028 przestępne', () => {
  for (const [month, effectiveDate, days] of [['1900-02','1900-02-28',28],['2000-02','2000-02-29',29],['2028-02','2028-02-29',29]]) {
    const r = calculate({ ...base, month, effectiveDate });
    assert.equal(r.daysInMonth, days);
    assert.equal(r.daysOld + r.daysNew, days);
  }
});
test('brak mutacji wejścia i wynik gotowy do JSON', () => {
  const input = Object.freeze({ ...base });
  assert.doesNotThrow(() => JSON.stringify(calculate(input)));
  assert.deepEqual(input, base);
});
for (const [name, patch, code] of [
  ['zła data', { effectiveDate: '2027-02-29' }, 'INVALID_DATE'],
  ['1900 nie jest przestępny', { effectiveDate: '1900-02-29' }, 'INVALID_DATE'],
  ['zły miesiąc', { month: '2026-13' }, 'INVALID_MONTH'],
  ['rok zero', { month: '0000-01' }, 'INVALID_MONTH'],
  ['niepotwierdzona data', { dateVerified: false }, 'DATE_NOT_VERIFIED'],
  ['pozorna zgoda', { dateVerified: 'true' }, 'DATE_NOT_VERIFIED'],
  ['błędny E', { lastOldDate: '2026-11-16' }, 'INCONSISTENT_DATES'],
  ['ujemna cena', { old: '-1' }, 'INVALID_MONEY'],
  ['float na wejściu', { old: 150 }, 'INVALID_MONEY'],
  ['za dużo miejsc', { new: '1.001' }, 'INVALID_MONEY'],
  ['NaN', { old: 'NaN' }, 'INVALID_MONEY'],
  ['wykładnik', { old: '1e2' }, 'INVALID_MONEY'],
  ['pusta kwota', { old: '' }, 'INVALID_MONEY'],
  ['za duża kwota', { old: '1000000000000000' }, 'INVALID_MONEY'],
  ['ujemna wpłata', { paid: '-1' }, 'INVALID_MONEY'],
  ['zły typ', { type: 'UPGRADE' }, 'INVALID_TYPE'],
  ['sprzeczny kierunek', { new: '180' }, 'DIRECTION_MISMATCH'],
  ['wypowiedzenie N>0', { type: 'WYPOWIEDZENIE' }, 'DIRECTION_MISMATCH'],
  ['brak zmiany z inną ceną', { type: 'NO_CHANGE' }, 'DIRECTION_MISMATCH'],
  ['netto', { basis: 'net' }, 'UNSUPPORTED_BASIS'],
  ['wiele dat', { changes: [] }, 'UNSUPPORTED_FIELD'],
  ['pozycje', { lines: [] }, 'UNSUPPORTED_FIELD'],
  ['dane osobowe', { customerName: 'Test' }, 'UNSUPPORTED_FIELD'],
]) test(`walidacja: ${name}`, () => {
  assert.throws(() => calculate({ ...base, ...patch }), error => error.code === code);
});
for (const value of [null, [], '150', undefined]) test(`odrzuca wejście ${JSON.stringify(value)}`, () => {
  assert.throws(() => calculate(value), error => error.code === 'INVALID_INPUT');
});
