import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateBasket } from '../src/basket.mjs';
import { buildSummary } from '../src/summary.mjs';

const row = (old = '100', next = '60', invoiced = old) => ({ label: 'I-01', description: 'Opis wewnętrzny', service: 'internet', old, new: next, invoiced, basis: 'gross', vat: '' });
const t26 = { month: '2027-03', effectiveDate: '2027-03-18', type: 'DOWNGRADE', dateVerified: true, multipleDates: false, unresolvedDiscounts: false, rows: [row(), { ...row('50','70'), service: 'tv' }] };

test('T26: jedna globalna B, ujemna różnica TV, reszta nieprzydzielona', () => {
  const r = evaluateBasket(t26);
  assert.equal(r.global.method, 'B');
  assert.equal(r.global.due, '140.67');
  assert.equal(r.global.delta, '9.33');
  assert.deepEqual(r.rows.map(x => x.due), ['81.33','59.33']);
  assert.deepEqual(r.rows.map(x => x.delta), ['18.67','-9.33']);
  assert.equal(r.rowSum, '140.66');
  assert.equal(r.rowDeltaSum, '9.34');
  assert.equal(r.residual, '0.01');
  assert.equal(r.reconciled, false);
  assert.equal(r.status, 'TEST_ONLY_D11_OPEN');
});
test('T27: pełne O na wszystkich wierszach, jawna kontrola zmienionych składników', () => {
  const r = evaluateBasket({ ...t26, type: 'NO_CHANGE', rows: [row('100','70'),row('50','80')] });
  assert.equal(r.global.due,'150.00');
  assert.equal(r.global.delta,'0.00');
  assert.deepEqual(r.rows.map(x=>x.due),['100.00','50.00']);
  assert.ok(r.warnings.includes('COMPONENTS_CHANGED_SAME_TOTAL'));
});
test('ujemna reszta większa niż grosz nie jest ograniczana ani przydzielana', () => {
  const r = evaluateBasket({ ...t26, month:'2026-11',effectiveDate:'2026-11-18',type:'WYPOWIEDZENIE',lastOldDate:'2026-11-17',rows:Array.from({length:10},()=>row('0.01','0')) });
  assert.equal(r.global.due,'0.06');
  assert.equal(r.rowSum,'0.10');
  assert.equal(r.residual,'-0.04');
  assert.equal(r.rowDeltaSum,'0.00');
  assert.equal(r.global.delta,'0.04');
});
test('brak zmiany sumy przy F innym niż O zachowuje rzeczywistą różnicę dokumentu', () => {
  const r=evaluateBasket({...t26,type:'NO_CHANGE',rows:[row('100','70','90'),row('50','80')]});
  assert.equal(r.global.delta,'-10.00');
  assert.ok(r.warnings.includes('COMPONENTS_CHANGED_SAME_TOTAL'));
});
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/reference.json', import.meta.url)));
for(const f of fixtures) test(`${f.id}: cienki adapter zachowuje zgodność silnika`,()=>{
  const {old,new:next,invoiced,basis,...rest}=f.input;
  const r=evaluateBasket({...rest,rows:[row(old,next,invoiced)]});
  assert.equal(r.global.due,f.expected.due);
  assert.equal(r.global.delta,f.expected.delta);
  assert.equal(r.global.method,f.expected.method);
  assert.equal(r.rows[0].due,f.expected.due);
  assert.equal(r.residual,'0.00');
});
test('wspólne A=B w miesiącu30 rozpisuje równe metody, a suma jest dokładna',()=>{
  const r=evaluateBasket({...t26,month:'2026-11',effectiveDate:'2026-11-18'});
  assert.equal(r.global.method,'A=B');
  assert.equal(r.global.due,'141.33');
  assert.deepEqual(r.rows.map(x=>x.due),['82.67','58.67']);
  assert.equal(r.residual,'-0.01');
});
test('kopiowany tekst ma kwoty, daty, wiersze i status; pomija wszystkie wolne teksty',()=>{
  const r=evaluateBasket({...t26,rows:[{...row(),label:'Jan Kowalski',description:'PESEL 12345678901'},row('50','70')]});
  const text=buildSummary(r);
  assert.match(text,/18\.03\.2027/);
  assert.match(text,/140,67 zł/);
  assert.match(text,/\+9,33 zł/);
  assert.match(text,/Pozycja 1/);
  assert.match(text,/D11/);
  assert.match(text,/PROPOZYCJA TESTOWA/);
  assert.match(text,/nieprzypisan/i);
  assert.doesNotMatch(text,/Jan|Kowalski|PESEL|12345678901/);
});
test('duże sumy, brak mutacji, wynik można serializować',()=>{
  const f={...t26,rows:[Object.freeze(row('99999999999999.99','99999999999999.98'))]};
  const before=JSON.stringify(f);
  const r=evaluateBasket(f);
  // B = O − 0,01×14/30, czyli O − 0,004666… PLN; half-up zachowuje końcówkę ,99.
  assert.equal(r.global.due,'99999999999999.99');
  assert.equal(JSON.stringify(f),before);
  assert.doesNotThrow(()=>JSON.stringify(r));
});
for(const [name,patch,code] of [
  ['brak wierszy',{rows:[]},'ROWS_REQUIRED'],
  ['wiele dat',{multipleDates:true},'MULTIPLE_DATES'],
  ['rabaty',{unresolvedDiscounts:true},'UNRESOLVED_DISCOUNTS'],
  ['netto',{rows:[{...row(),basis:'net'}]},'UNSUPPORTED_BASIS'],
  ['mieszane VAT',{rows:[{...row(),vat:'23'},{...row(),vat:'8'}]},'MIXED_VAT'],
  ['niepełne VAT',{rows:[{...row(),vat:'23'},row()]},'MIXED_VAT'],
  ['zła kwota',{rows:[row('-1','0')]},'INVALID_MONEY'],
  ['zbyt wiele miejsc',{rows:[row('1.001','0')]},'INVALID_MONEY'],
  ['liczba JS',{rows:[row(100,'0')]},'INVALID_MONEY'],
  ['zbyt duża suma',{rows:[row('999999999999999','0'),row('999999999999999','0')]},'TOTAL_TOO_LARGE'],
  ['data wiersza',{rows:[{...row(),effectiveDate:'2027-03-19'}]},'UNSUPPORTED_FIELD'],
  ['nieznana usługa',{rows:[{...row(),service:'Jan Kowalski'}]},'INVALID_SERVICE'],
  ['ponad limit wierszy',{rows:Array.from({length:51},()=>row())},'ROW_LIMIT'],
  ['brak potwierdzenia',{dateVerified:false},'DATE_NOT_VERIFIED'],
  ['niezgodny kierunek',{type:'PODWYŻKA'},'DIRECTION_MISMATCH'],
]) test(`blokada koszyka: ${name}`,()=>assert.throws(()=>evaluateBasket({...t26,...patch}),e=>e.code===code));
