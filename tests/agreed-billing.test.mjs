import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCorrection as resolve, BASELINE_DEMO_POLICY } from '../src/billing-policy.mjs';

const evaluateCorrection = input => resolve(input, BASELINE_DEMO_POLICY);

const form = (month, lastOldDate, old = '100', next = '80', invoiced) => ({
  dateVerified: true, month, lastOldDate, totals: { old, new: next, invoiced },
});
const line = (old, next, invoiced = old) => ({ service: 'internet', basis: 'gross', vat: '23', old, new: next, invoiced });

for (const [month, length, amount, method] of [
  ['2027-02', 28, '82.00', 'A'], ['2028-02', 29, '82.00', 'A'],
  ['2026-11', 30, '82.00', 'A=B'], ['2027-03', 31, '81.33', 'B'],
]) {
  test(`cztery parametry i MIN(A,B) dla ${length} dni`, () => {
    const result = evaluateCorrection(form(month, month + '-03'));
    assert.deepEqual([result.status, result.effectiveDate, result.type, result.appliedMethod, result.amountDue, result.invoiceAssumed],
      ['TEST_ONLY', month + '-04', 'DOWNGRADE', method, amount, true]);
  });
}

for (const [lastOldDate, expectedT] of [['2027-01-31', '2027-02-01'], ['2027-02-03', '2027-02-04']]) {
  test(`podwyżka od ${expectedT} naliczana dopiero od marca`, () => {
    const result = evaluateCorrection(form('2027-02', lastOldDate, '100', '130'));
    assert.deepEqual([result.ruleId, result.amountDue, result.invoiceDifference, result.effectiveDate, result.effectiveBillingDate, result.nextMonthAmount],
      ['R06', '100.00', '0.00', expectedT, '2027-03-01', '130.00']);
    assert.deepEqual([result.daysOld, result.daysNew], [28, 0]);
  });
}

test('naliczanie podwyżki od stycznia i wynik w kolejnym miesiącu', () => {
  const december = evaluateCorrection(form('2026-12', '2026-11-30', '100', '130'));
  const january = evaluateCorrection(form('2027-01', '2026-11-30', '100', '130'));
  assert.deepEqual([december.amountDue, december.effectiveBillingDate, december.nextMonthAmount, january.amountDue],
    ['100.00', '2027-01-01', '130.00', '130.00']);
});

test('zmiana ceny od pierwszego dnia stosuje pełne N przy obniżce', () => {
  const result = evaluateCorrection(form('2027-02', '2027-01-31'));
  assert.deepEqual([result.ruleId, result.amountDue, result.effectiveDate], ['R03', '80.00', '2027-02-01']);
});

test('ostatni dzień lutego jako E, wyższa cena od miesiąca po T', () => {
  const result = evaluateCorrection(form('2027-02', '2027-02-28', '100', '130'));
  assert.deepEqual([result.ruleId, result.effectiveDate, result.amountDue, result.nextMonthAmount, result.effectiveBillingDate],
    ['R04', '2027-03-01', '100.00', '100.00', '2027-04-01']);
});

test('brak zmiany ceny odróżnia rozbieżność kwoty z faktury od korekty abonamentowej', () => {
  const basic = evaluateCorrection(form('2027-02', '2027-02-03', '100', '100'));
  const verified = evaluateCorrection(form('2027-02', '2027-02-03', '100', '100', '110'));
  assert.deepEqual([basic.ruleId, basic.invoiceDifference, basic.priceCorrection], ['R05', '0.00', '0.00']);
  assert.deepEqual([verified.ruleId, verified.invoiceDifference, verified.priceCorrection, verified.invoiceAssumed], ['R05', '10.00', '0.00', false]);
});

test('kwota faktury zero jest jawna i przeważa nad założeniem', () => {
  const result = evaluateCorrection(form('2027-02', '2027-02-03', '100', '80', '0'));
  assert.deepEqual([result.invoicedAmount, result.invoiceDifference, result.invoiceAssumed], ['0.00', '-82.00', false]);
});

test('dopasowanie O/N koszyka i faktyczne F pozycji w BOK', () => {
  const input = { ...form('2027-02', '2027-02-03'), source: 'lines', rows: [line('60','40','70'),line('40','40','41')] };
  const result = evaluateCorrection(input);
  assert.deepEqual([result.status, result.amountDue, result.invoicedAmount, result.invoiceDifference], ['TEST_ONLY', '82.00', '111.00', '29.00']);
  assert.equal(evaluateCorrection({...input, totals:{...input.totals, invoiced:'100'}}).code, 'TOTAL_MISMATCH');
});

test('brak ustalonej daty wstrzymuje kalkulację', () => {
  const input = { ...form('2027-02', ''), dateVerified: false };
  assert.equal(evaluateCorrection(input).code, 'DATE_NOT_VERIFIED');
});

test('stawka zerowa daje 0 zł po jednym dniu marca', () => {
  const result = evaluateCorrection(form('2027-03', '2027-03-01', '150', '0'));
  assert.deepEqual([result.appliedMethod, result.amountDue, result.invoiceDifference], ['B', '0.00', '150.00']);
});
