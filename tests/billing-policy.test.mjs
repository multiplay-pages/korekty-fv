import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCorrection as resolve, summarizeGrossRows, LEGACY_MIN_AB_TEST_POLICY, ACTUAL_DAYS_TEST_POLICY,
} from '../src/billing-policy.mjs';

const evaluateCorrection = (input, policy = LEGACY_MIN_AB_TEST_POLICY) => resolve(input, policy);

const base = {
  source: 'aggregate', type: 'DOWNGRADE', month: '2026-11',
  effectiveDate: '2026-11-16', dateVerified: true,
  totals: { old: '150', new: '120', invoiced: '150' },
};
const withCase = (changes, amounts) => ({ ...base, ...changes, totals: { ...base.totals, ...amounts } });
const line = (old, next, invoiced = old, fields = {}) =>
  ({ service: 'internet', basis: 'gross', vat: '23', label: 'Internet', old, new: next, invoiced, ...fields });
const details = (rows, changes = {}) => ({ ...base, source: 'lines', totals: {}, rows, ...changes });

const cases = [
  ['AUTO-01', { effectiveDate: '2026-11-01' }, {}, '120.00', '30.00', 'R03', 30, 0],
  ['AUTO-02', {}, {}, '135.00', '15.00', 'R07', 30, 15],
  ['AUTO-03', { month: '2027-02', effectiveDate: '2027-02-04' }, { old: '100', new: '80', invoiced: '100' }, '82.00', '18.00', 'R07', 28, 3],
  ['AUTO-04', { month: '2028-02', effectiveDate: '2028-02-04' }, { old: '100', new: '80', invoiced: '100' }, '82.00', '18.00', 'R07', 29, 3],
  ['AUTO-05', { month: '2027-03', effectiveDate: '2027-03-04' }, { old: '100', new: '80', invoiced: '100' }, '81.33', '18.67', 'R07', 31, 3],
  ['AUTO-06', { type: 'PODWYŻKA', effectiveDate: '2026-11-01' }, { old: '100', new: '130', invoiced: '100' }, '130.00', '-30.00', 'R03', 30, 0],
  ['AUTO-07', { type: 'PODWYŻKA', effectiveDate: '2026-11-02' }, { old: '100', new: '130', invoiced: '100' }, '100.00', '0.00', 'R06', 30, 1],
  ['AUTO-08', { type: 'WYPOWIEDZENIE', effectiveDate: '', lastOldDate: '2026-11-17' }, { new: '' }, '85.00', '65.00', 'R08', 30, 17],
  ['AUTO-09', { type: 'WYPOWIEDZENIE', month: '2027-03', effectiveDate: '', lastOldDate: '2027-03-01' }, { new: '0' }, '0.00', '150.00', 'R08', 31, 1],
  ['AUTO-10', { type: 'NO_CHANGE', month: '2027-02', effectiveDate: '2027-02-04' }, { new: '150' }, '150.00', '0.00', 'R05', 28, 3],
  ['AUTO-11', {}, { invoiced: '160' }, '135.00', '25.00', 'R07', 30, 15],
];
for (const [id, change, amounts, due, delta, rule, length, oldDays] of cases) {
  test(id, () => {
    const result = evaluateCorrection(withCase(change, amounts));
    assert.equal(result.status, 'TEST_ONLY');
    assert.equal(result.policyVersion, LEGACY_MIN_AB_TEST_POLICY.version);
    assert.equal(result.accountingAllowed, false);
    assert.deepEqual([result.amountDue, result.invoiceDifference, result.ruleId], [due, delta, rule]);
    assert.deepEqual([result.daysInMonth, result.daysOld, result.daysNew], [length, oldDays, length - oldDays]);
    if (id === 'AUTO-07') assert.equal(result.effectiveBillingDate, '2026-12-01');
    if (id === 'AUTO-08') assert.equal(result.effectiveDate, '2026-11-18');
  });
}

test('AUTO-12 rozstrzyga B dokładnie na koszyku i stosuje ją do obu usług', () => {
  const result = evaluateCorrection(details([line('100', '60'), line('50', '70')], {
    month: '2027-03', effectiveDate: '2027-03-18',
  }));
  assert.equal(result.global.method, 'B');
  assert.deepEqual([result.amountDue, result.invoiceDifference, result.global.exact.due.numerator], ['140.67', '9.33', '422000']);
  assert.deepEqual(result.lineBreakdown.map(({ method }) => method), ['B', 'B']);
  assert.ok(result.warnings.includes('OPPOSING_LINE_CHANGES'));
  assert.equal(result.accountingAllowed, false);
  assert.equal(result.rows[1].documentChange, '9.33');
});

for (const [month, date, days, actual] of [
  ['2027-02', '2027-02-04', 28, '76.67'],
  ['2028-02', '2028-02-04', 29, '79.33'],
  ['2027-03', '2027-03-04', 31, '84.67'],
]) {
  test(`profil deweloperski rzeczywistych dni, miesiąc ${days}-dniowy`, () => {
    const input = details([line('100', '80')], { month, effectiveDate: date });
    assert.equal(evaluateCorrection(input, ACTUAL_DAYS_TEST_POLICY).amountDue, actual);
    assert.notEqual(evaluateCorrection(input).amountDue, actual);
    assert.equal(evaluateCorrection({...input, source: 'aggregate', totals: { old: '100', new: '80', invoiced: '100' }}, ACTUAL_DAYS_TEST_POLICY).code, 'LINES_NEEDED');
  });
}
test('profil /30 zachowuje 5 zł za dzień, a MIN(A,B) dopuszcza zero', () => {
  const input = details([line('150', '0')], {
    type: 'WYPOWIEDZENIE', month: '2027-03', effectiveDate: '', lastOldDate: '2027-03-01',
  });
  assert.equal(evaluateCorrection(input, ACTUAL_DAYS_TEST_POLICY).amountDue, '5.00');
  assert.equal(evaluateCorrection(input).amountDue, '0.00');
});

test('granice działają także przy braku częściowej reguły', () => {
  const policy = { version: 'unresolved-test', partialRule: null };
  const before = evaluateCorrection(withCase({ effectiveDate: '2026-10-31' }), policy);
  assert.deepEqual([before.ruleId, before.amountDue, before.daysOld], ['R02', '120.00', 0]);
  const after = evaluateCorrection(withCase({ effectiveDate: '2027-01-16' }), policy);
  assert.deepEqual([after.ruleId, after.amountDue, after.nextMonthAmount], ['R04', '150.00', '150.00']);
  assert.equal(evaluateCorrection(base, policy).code, 'POLICY_UNRESOLVED');
});

test('ostatni dzień miesiąca i przejście grudzień–styczeń', () => {
  const last = evaluateCorrection(withCase({ effectiveDate: '2026-11-30' }));
  assert.deepEqual([last.daysOld, last.daysNew, last.amountDue], [29, 1, '149.00']);
  const end = evaluateCorrection(withCase({ type: 'WYPOWIEDZENIE', month: '2026-12', effectiveDate: '', lastOldDate: '2026-12-31' }, { new: '' }));
  assert.deepEqual([end.effectiveDate, end.amountDue, end.nextMonthAmount], ['2027-01-01', '150.00', '0.00']);
  const increase = evaluateCorrection(withCase({ type: 'PODWYŻKA', month: '2027-01', effectiveDate: '2026-12-31' }, { new: '180' }));
  assert.deepEqual([increase.effectiveBillingDate, increase.amountDue], ['2027-01-01', '180.00']);
});

test('przyszła podwyżka nie jest wcześniejszym pełnym abonamentem', () => {
  const future = evaluateCorrection(withCase({ type: 'PODWYŻKA', effectiveDate: '2026-12-02' }, {new: '180'}));
  assert.deepEqual([future.amountDue, future.nextMonthAmount, future.effectiveBillingDate], ['150.00', '150.00', '2027-01-01']);
});

for (const [label, input, code] of [
  ['nieistniejąca data', withCase({ effectiveDate: '2027-02-29' }), 'INVALID_DATE'],
  ['sprzeczne E i T', withCase({ type: 'WYPOWIEDZENIE', lastOldDate: '2026-11-17' }, {new: '0'}), 'INCONSISTENT_DATES'],
  ['brak E', withCase({ type: 'WYPOWIEDZENIE' }, { new: '0' }), 'END_DATE_REQUIRED'],
  ['błędny kierunek', withCase({}, {new: '160'}), 'DIRECTION_MISMATCH'],
  ['brak F', withCase({}, {invoiced: ''}), 'INVALID_MONEY'],
  ['wiele dat', withCase({multipleDates: true}), 'MULTIPLE_DATES'],
  ['rabaty', withCase({unresolvedDiscounts: true}), 'UNRESOLVED_DISCOUNTS'],
  ['nieporównywalny zakres', withCase({nonComparableScope: true}), 'NON_COMPARABLE_SCOPE'],
  ['niezweryfikowana data', withCase({dateVerified: false}), 'DATE_NOT_VERIFIED'],
  ['zmiana składników bez zmiany sumy', details([line('100','80'),line('50','70')], { type: 'NO_CHANGE' }), 'COMPONENTS_CHANGED_SAME_TOTAL'],
  ['rozbieżność sum', details([line('150','120')], { totals: { old: '160', new: '120', invoiced: '150' } }), 'TOTAL_MISMATCH'],
  ['częściowe sumy przy kontroli', details([line('150','120')], { totals: { old: '150' } }), 'INVALID_MONEY'],
  ['mieszany VAT', details([line('100','80'),line('50','40','50',{vat:'8'})]), 'MIXED_VAT'],
  ['kwota netto', details([line('150','120','150',{basis:'net'})]), 'UNSUPPORTED_BASIS'],
  ['spadek cen niektórych usług przy wzroście sumy', details([line('100','80'),line('50','100')], { type: 'PODWYŻKA' }), 'OPPOSING_LINE_CHANGES'],
]) {
  test(`blokada: ${label}`, () => {
    const result = evaluateCorrection(input);
    assert.equal(result.code, code);
    assert.equal(result.accountingAllowed, false);
    assert.equal(result.amountDue, null);
  });
}

test('nieporównywalne podatkowo pozycje i osobno potwierdzone sumy brutto', () => {
  const input = details([line('100','80'),line('50','40','50',{basis:'net',vat:'8'})], {
    totals: base.totals, grossTotalsVerified: true,
  });
  const result = evaluateCorrection(input);
  assert.equal(result.amountDue, '135.00');
  assert.equal(result.lineBreakdown.length, 0);
  assert.equal(result.accountingAllowed, false);
  assert.ok(result.warnings.includes('AGGREGATE_TAX_REVIEW'));
  assert.deepEqual(summarizeGrossRows(input.rows), { old: null, new: null, invoiced: null });
});

test('suma brutto z potwierdzeniem nie zastępuje kontroli sum brutto pozycji', () => {
  const result = evaluateCorrection(details([line('100','80'),line('50','40','50',{vat:'8'})], {
    totals: {...base.totals, old: '170'}, grossTotalsVerified: true,
  }));
  assert.equal(result.code, 'TOTAL_MISMATCH');
});

test('duplikaty mają niezależne identyfikatory, grosze oraz ta sama kwota dla obu źródeł', () => {
  const rows = [line('0.02','0.01','0',{id: 'a'}), line('0.02','0.01','0',{id: 'b'})];
  const detail = evaluateCorrection(details(rows));
  const aggregate = evaluateCorrection(withCase({}, { old: '0.04', new: '0.02', invoiced: '0' }));
  assert.deepEqual(detail.totals, summarizeGrossRows(rows));
  assert.deepEqual([detail.amountDue, detail.invoiceDifference], [aggregate.amountDue, aggregate.invoiceDifference]);
  assert.deepEqual(detail.rows.map(({ id, label }) => [id, label]), [['a','Internet'],['b','Internet']]);
  assert.equal(detail.global.method, 'A=B');
  assert.equal(detail.residual, '-0.01');
  assert.ok(detail.warnings.includes('UNALLOCATED_ROUNDING'));
});

test('zero jest poprawną kwotą i F pozostaje niezależne od O', () => {
  const input = withCase({ type: 'NO_CHANGE' }, { old: '0', new: '0', invoiced: '0' });
  assert.equal(evaluateCorrection(input).amountDue, '0.00');
  const result = evaluateCorrection(withCase({ type: 'NO_CHANGE' }, { new: '150', invoiced: '140' }));
  assert.equal(result.invoiceDifference, '-10.00');
  assert.ok(result.warnings.includes('INVOICE_DIFFERS_FROM_OLD'));
});


test('kolejny miesiąc z obniżką od drugiego dnia nie ma jednej pełnej ceny', () => {
  const result = evaluateCorrection(withCase({ effectiveDate: '2026-12-02' }));
  assert.deepEqual([result.ruleId, result.amountDue, result.nextMonth, result.nextMonthAmount], ['R04', '150.00', '2026-12-01', null]);
});

test('brak konfiguracji nie wybiera ukrytej reguły częściowej', () => {
  assert.equal(evaluateCorrection(base, null).code, 'POLICY_UNRESOLVED');
  assert.equal(evaluateCorrection(base, { partialRule: 'MIN_AB' }).code, 'POLICY_UNRESOLVED');
});

test('kwoty netto na poziomie zbiorczym wymagają weryfikacji', () => {
  const result = evaluateCorrection(withCase({ basis: 'net' }));
  assert.deepEqual([result.status, result.code, result.amountDue], ['REVIEW', 'UNSUPPORTED_BASIS', null]);
});
