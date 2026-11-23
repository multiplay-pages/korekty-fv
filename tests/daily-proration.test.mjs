import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDailyBasket } from '../src/daily-proration.mjs';
import { buildInvoicePlan } from '../src/invoice-plan.mjs';
import { buildSummary } from '../src/summary.mjs';

const line=(old='100',next='80',invoiced=old)=>({service:'internet',old,new:next,invoiced,basis:'gross',vat:''});
const base={month:'2027-02',effectiveDate:'2027-02-04',type:'DOWNGRADE',dateVerified:true,rows:[line()]};

test('przykład właściciela: luty100→80 od4.02 daje10+66,67=76,67',()=>{
  const r=evaluateDailyBasket(base),p=buildInvoicePlan(r);
  assert.equal(r.global.due,'76.67');assert.equal(r.global.delta,'23.33');
  assert.equal(p.rows[0].oldCharge,'10.00');assert.equal(p.rows[0].newCharge,'66.67');
  assert.equal(p.oldUnits,3);assert.equal(p.newUnits,25);
  assert.equal(p.rows[0].newPeriod.from,'2027-02-04');assert.equal(p.rows[0].newPeriod.to,'2027-02-28');
});
for(const [month,newPart,due,days] of [['2027-02','36.67','121.67',11],['2028-02','40.00','125.00',12],['2026-11','43.33','128.33',13],['2027-03','46.67','131.67',14]]) {
  test(`${month}: rzeczywiste dni obu części, bez wyrównania do30`,()=>{
    const r=evaluateDailyBasket({...base,month,effectiveDate:`${month}-18`,rows:[line('150','100')]}),p=buildInvoicePlan(r);
    assert.equal(r.global.due,due);assert.equal(p.rows[0].oldCharge,'85.00');assert.equal(p.rows[0].newCharge,newPart);
    assert.equal(p.oldUnits,17);assert.equal(p.newUnits,days);
  });
  test(`${month}: zakończenie po17dniach to85,00 zł`,()=>{
    const r=evaluateDailyBasket({...base,type:'WYPOWIEDZENIE',month,effectiveDate:`${month}-18`,lastOldDate:`${month}-17`,rows:[line('150','0')]}),p=buildInvoicePlan(r);
    assert.equal(r.global.due,'85.00');assert.equal(p.rows[0].newCharge,'0.00');assert.equal(p.rows[0].newPeriod,null);
  });
  test(`${month}: brak zmiany to pełna miesięczna cena`,()=>{
    const r=evaluateDailyBasket({...base,type:'NO_CHANGE',month,effectiveDate:`${month}-18`,rows:[line('150','150')]}),p=buildInvoicePlan(r);
    assert.equal(r.global.due,'150.00');assert.equal(p.rows[0].oldCharge,'150.00');assert.equal(p.rows[0].newCharge,'0.00');
  });
}
test('jeden rzeczywisty dzień usługi w marcu daje5,00 zł',()=>{
  const r=evaluateDailyBasket({...base,type:'WYPOWIEDZENIE',month:'2027-03',effectiveDate:'2027-03-02',lastOldDate:'2027-03-01',rows:[line('150','0')]});
  assert.equal(r.global.due,'5.00');assert(!r.warnings.includes('ZERO_FOR_ONE_SERVICE_DAY'));
});
test('nie zaokrąglamy dziennej stawki:50×5÷30 to8,33, nie8,35',()=>{
  const r=evaluateDailyBasket({...base,type:'WYPOWIEDZENIE',effectiveDate:'2027-02-06',rows:[line('50','0')]});
  assert.equal(r.global.due,'8.33');
});
test('zakończenie od początku miesiąca nie jest nazwane pełnym nowym abonamentem',()=>{
  const r=evaluateDailyBasket({...base,type:'WYPOWIEDZENIE',effectiveDate:'2027-02-01',rows:[line('100','0')]}),p=buildInvoicePlan(r);
  assert.equal(r.global.method,'NO_SERVICE');assert.equal(r.global.due,'0.00');
  assert.equal(p.rows[0].oldPeriod,null);assert.equal(p.rows[0].newPeriod,null);
  assert.doesNotMatch(buildSummary(r),/Pełny nowy abonament/);
});
test('niezmieniona usługa zachowuje pełny abonament w zmieniającym się koszyku',()=>{
  const r=evaluateDailyBasket({...base,rows:[line('100','80'),{...line('50','50'),service:'tv'}]}),p=buildInvoicePlan(r);
  assert.equal(r.global.due,'126.67');assert.equal(p.rows[1].oldCharge,'50.00');assert.equal(p.rows[1].newCharge,'0.00');
  assert.equal(p.rows[1].billingMode,'UNCHANGED');
});
for(const [T,due] of [['2027-01-31','80.00'],['2027-02-01','80.00'],['2027-03-01','100.00']])test(`pełny miesiąc przy dacie${T}`,()=>{
  assert.equal(evaluateDailyBasket({...base,effectiveDate:T}).global.due,due);
});
test('dodatnia i ujemna reszta części pozostają jawne, bez alokacji',()=>{
  for(const [month,T,old,next,residual] of [['2027-02','2027-02-18','0.04','0.01','0.01'],['2026-11','2026-11-16','0.03','0.01','-0.01']]){
    const p=buildInvoicePlan(evaluateDailyBasket({...base,month,effectiveDate:T,rows:[line(old,next)]}));
    assert.equal(p.rows[0].partResidual,residual);assert.equal(p.needsRoundingReview,true);
  }
});
test('kopiowany wynik wyjaśnia kwoty rzeczywistymi liczbami bez liter metod',()=>{
  const s=buildSummary(evaluateDailyBasket(base));
  assert.match(s,/100,00 zł × 3 dni ÷ 30 = 10,00 zł/);
  assert.match(s,/80,00 zł × 25 dni ÷ 30 = 66,67 zł/);
  assert.match(s,/po rabatach/);assert.match(s,/Zmniejszenie faktury o 23,33 zł/);
  assert.doesNotMatch(s,/Metoda globalna|Metoda A|Metoda B|F −|Oᵢ|Nᵢ|T\d{2}/);
});
test('dwie pozycje mają tę samą liczbę rzeczywistych dni i sumę145,67',()=>{
  const r=evaluateDailyBasket({...base,month:'2027-03',effectiveDate:'2027-03-18',rows:[line('100','60'),{...line('50','70'),service:'tv'}]}),p=buildInvoicePlan(r);
  assert.equal(r.global.due,'145.67');assert.equal(p.partsTotal,'145.67');
  assert.deepEqual(p.rows.map(x=>[x.oldCharge,x.newCharge]),[['56.67','28.00'],['28.33','32.67']]);
});
test('zmiana składników bez zmiany sumy wymaga uzgodnienia, nie arbitralnych części',()=>{
  const r=evaluateDailyBasket({...base,type:'NO_CHANGE',rows:[line('100','70'),{...line('50','80'),service:'tv'}]});
  assert.equal(r.global.due,'150.00');assert.equal(buildInvoicePlan(r).available,false);
});
for(const [T,due,oldCharge,newCharge,start] of [
  ['2027-02-01','180.00','0.00','180.00','2027-02-01'],
  ['2027-02-02','150.00','150.00','0.00','2027-03-01'],
  ['2027-02-18','150.00','150.00','0.00','2027-03-01'],
  ['2027-12-18','150.00','150.00','0.00','2028-01-01'],
])test(`potwierdzone zachowanie podwyżek: ${T}`,()=>{
  const r=evaluateDailyBasket({...base,type:'PODWYŻKA',effectiveDate:T,rows:[line('150','180')]}),p=buildInvoicePlan(r);
  assert.equal(r.global.due,due);assert.equal(p.rows[0].oldCharge,oldCharge);assert.equal(p.rows[0].newCharge,newCharge);
  assert.equal(p.higherPriceStart,start);
});
for(const [name,patch,code] of [
  ['brak deklaracji daty',{dateVerified:false},'DATE_NOT_VERIFIED'],
  ['nieistniejąca data',{effectiveDate:'2027-02-29'},'INVALID_DATE'],
  ['kierunek niezgodny',{rows:[line('80','100')]},'DIRECTION_MISMATCH'],
  ['kwota wykładnicza',{rows:[line('1e2','80')]},'INVALID_MONEY'],
  ['netto',{rows:[{...line(),basis:'net'}]},'UNSUPPORTED_BASIS'],
  ['wiele dat',{multipleDates:true},'MULTIPLE_DATES'],
  ['nieustalone rabaty',{unresolvedDiscounts:true},'UNRESOLVED_DISCOUNTS'],
])test(`zachowana walidacja: ${name}`,()=>{
  assert.throws(()=>evaluateDailyBasket({...base,...patch}),{code});
});
