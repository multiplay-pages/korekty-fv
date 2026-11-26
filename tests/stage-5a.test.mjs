import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCorrection, nextCalendarDay } from '../src/billing-policy.mjs';
import { buildResultPresentation, copyResultPresentation } from '../src/summary.mjs';
import { matrix, references } from './fixtures/stage-5a.mjs';
import goldenCopies from './fixtures/stage-5a-copy.json' with { type: 'json' };

for (const [id, input, decision, dataStatus, correction, due] of matrix) {
  test(`5A ${id}: ${decision} / ${dataStatus}`, () => {
    const result = evaluateCorrection(input);
    assert.deepEqual([result.decision,result.dataStatus,result.correctionAmount,result.amountDue], [decision,dataStatus,correction,due]);
    assert.equal(result.documentState, input.documentState);
    assert.equal(result.status, 'TEST_ONLY');
    assert.equal(result.accountingAllowed, false);
    assert.deepEqual(Buffer.from(copyResultPresentation(buildResultPresentation(result))), Buffer.from(goldenCopies[id]), id);
    if (decision !== 'CORRECTION') assert.deepEqual(result.lineBreakdown, []);
    if (['M03','M03-SUD'].includes(id)) assert.ok(result.warnings.includes('INVOICE_DIFFERS_FROM_OLD'));
  });
}

for (const [index,[input,method,due]] of references.entries()) {
  test(`5A przypadek referencyjny ${index + 1}: ${method}`, () => {
    const result = evaluateCorrection(input);
    assert.deepEqual([result.appliedMethod,result.amountDue], [method,due]);
  });
}

const flags = { unresolvedDiscounts: true, multipleDates: true, dateVerified: false, nonComparableScope: true };
for (const [flag, value] of Object.entries(flags)) {
  const decisionPaths = ['M01','M06b','M07','M10-zgodna','M11','M12','M13','M17','M18','M22-brak','M26','M27-netto','M28','R2a-ujemny-wiersz','R2a-wzrost-sumy'];
  for (const id of decisionPaths) {
    test(`5A R1 ${flag} ma pierwszeństwo przed ${id}`, () => {
      const input = matrix.find(([candidate]) => candidate === id)[1];
      const result = evaluateCorrection({ ...input, [flag]: value });
      assert.deepEqual([result.decision,result.amountDue,result.correctionAmount,result.lineBreakdown,result.accountingAllowed], ['REFER',null,null,[],false]);
    });
  }
}

for (const [lastOldDate, first] of [
  ['2026-10-31','2026-11-01'], ['2026-11-30','2026-12-01'], ['2026-12-31','2027-01-01'],
  ['2027-02-28','2027-03-01'], ['2028-02-28','2028-02-29'], ['2028-02-29','2028-03-01'],
]) {
  test(`5A U7 daty ${lastOldDate} / ${first}`, () => {
    assert.equal(nextCalendarDay(lastOldDate), first);
    const result = evaluateCorrection({ month:first.slice(0,7), dateVerified:true, lastOldDate, totals:{ old:'150',new:'120' } });
    assert.equal(result.effectiveDate, first);
    assert.equal(result.monthRelation, 'CHANGE');
    assert.equal(result.variants.length, first.endsWith('-01') ? 4 : 0);
  });
}

for (const [id, other] of [
  ['M05', 'Inna kwota (w tym 0,00 zł) → wpisz kwotę.'],
  ['M15', 'Inna kwota (w tym 0,00 zł) → wpisz kwotę do weryfikacji.'],
  ['M21', 'Inna kwota → wpisz kwotę.'],
]) {
  test(`5A ${id}: wariant innej kwoty właściwie opisuje 0,00 zł`, () => {
    const input = matrix.find(([candidate]) => id === candidate)[1];
    const view = buildResultPresentation(evaluateCorrection(input));
    const copy = copyResultPresentation(view).split('\n');
    assert.equal(view.variants.length, 4);
    assert.equal(view.variants.filter(variant => /\b0,00 zł/.test(variant)).length, 1);
    assert.equal(view.variants.find(variant => variant.startsWith('Inna kwota')), other);
    assert.ok(copy.includes(other));
    if (id === 'M21') {
      const zero = 'Wystawiona według nowego abonamentu (0,00 zł) → bez korekty.';
      assert.ok(view.variants.includes(zero));
      assert.ok(copy.includes(zero));
    }
  });
}

for (const [id, signs, remainder, remainderLabel] of [
  ['M24', ['9.33','0.00','9.33','0.00'], '0.01', 'Reszta korekty koszyka −0,01 zł do uzgodnienia.'],
  ['R2a-ujemny-wiersz', ['18.67','-9.33'], '-0.01', 'Reszta korekty koszyka +0,01 zł do uzgodnienia.'],
]) {
  test(`5A ${id} Q-02–Q-04: rzeczywiste znaki i reszta`, () => {
    const input = matrix.find(([candidate]) => id === candidate)[1];
    const result = evaluateCorrection(input);
    assert.deepEqual(result.lineBreakdown.map(row => row.delta), signs);
    assert.equal(result.correctionRemainder, remainder);
    const view = buildResultPresentation(result), copy = copyResultPresentation(view);
    assert.match(copy, /Podsumowanie poglądowe/i);
    for (const row of view.rows) assert.ok(copy.includes([row.label,row.invoiced,row.due,row.delta].join(' · ')));
    assert.equal(view.remainder, remainderLabel);
    assert.ok(copy.split('\n').includes(remainderLabel));
    if (id === 'R2a-ujemny-wiersz') {
      const partRemainder = 'Reszta zaokrąglenia części pozycji: −0,01 zł.';
      assert.ok(view.parts.some(part => part.remainder === partRemainder));
      assert.ok(copy.includes(partRemainder));
    }
    assert.match(copy, /D11/);
    assert.doesNotMatch(copy, /zwiększenie|do dodania|zmniejsz starą pozycję/i);
  });
}

test('5A BOK przed potwierdzeniem: tabela poglądowa i podsumowanie koszyka bez wierszy', () => {
  const input = matrix.find(([id]) => id === 'M25')[1];
  const result = evaluateCorrection(input);
  assert.equal(result.confirmation.allowed, true);
  const view = buildResultPresentation(result);
  assert.equal(view.rows.length, 4);
  assert.equal(view.copyRows, false);
  assert.doesNotMatch(copyResultPresentation(view), /1\. Internet|Reszta korekty koszyka \+0,01 zł/);
});

test('5A A3 i A4: korekta wymaga F w kwietniu po lutowej obniżce', () => {
  const input = { month:'2027-04', lastOldDate:'2027-02-15', dateVerified:true, totals:{old:'150',new:'100'} };
  const missing = evaluateCorrection(input);
  assert.deepEqual([missing.amountDue,missing.dataStatus,missing.decision,missing.correctionAmount], ['100.00','MISSING','INVOICE_REQUIRED',null]);
  const exact = evaluateCorrection({...input,totals:{...input.totals,invoiced:'100'}});
  assert.deepEqual([exact.amountDue,exact.dataStatus,exact.decision,exact.correctionAmount], ['100.00','ENTERED','NO_CORRECTION',null]);
});

test('5A A5 i A6: pierwszego dnia podwyżki 150 i 180 pozostają, a 165 trafia do weryfikacji', () => {
  const input = { month:'2027-03', lastOldDate:'2027-02-28', dateVerified:true };
  for (const [invoiced,decision,variants] of [[undefined,'NO_CORRECTION_EXPECTED',4],['150','NO_CORRECTION',0],
    ['180','NO_CORRECTION',0],['165','REVIEW',0]]) {
    const result = evaluateCorrection({...input,totals:{old:'150',new:'180',invoiced}});
    // P-08: cena N obowiązuje od dnia 1 (T = 2027-03-01); decyzje o fakturze bez zmian.
    assert.deepEqual([result.decision,result.effectiveBillingDate,result.correctionAmount,result.variants.length,result.amountDue], [decision,'2027-03-01',null,variants,'180.00']);
  }
});
