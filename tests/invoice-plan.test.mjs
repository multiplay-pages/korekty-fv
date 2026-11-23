import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateBasket } from '../src/basket.mjs';
import { buildInvoicePlan } from '../src/invoice-plan.mjs';
import { buildSummary } from '../src/summary.mjs';

const row=(old='150',next='100',invoiced=old)=>({service:'internet',old,new:next,invoiced,basis:'gross',vat:''});
const base={type:'DOWNGRADE',month:'2026-11',effectiveDate:'2026-11-18',dateVerified:true,rows:[row()]};
for(const [month,T,oldCharge,newCharge,method,oldUnits,newUnits] of [
  ['2027-02','2027-02-18','85.00','43.33','A',17,13],
  ['2028-02','2028-02-18','85.00','43.33','A',17,13],
  ['2026-11','2026-11-18','85.00','43.33','A=B',17,13],
  ['2027-03','2027-03-18','80.00','46.67','B',16,14],
])test(`${month}: stara i nowa część zachowują globalną ${method}`,()=>{
  const result=evaluateBasket({...base,month,effectiveDate:T}),plan=buildInvoicePlan(result);
  assert.equal(plan.available,true);
  assert.equal(plan.rows[0].oldCharge,oldCharge);assert.equal(plan.rows[0].newCharge,newCharge);
  assert.equal(plan.oldUnits,oldUnits);assert.equal(plan.newUnits,newUnits);
  assert.equal(plan.rows[0].partResidual,'0.00');
  assert.equal(plan.totalResidual,'0.00');
  assert.equal(plan.rows[0].oldAdjustment,month==='2027-03'?'-70.00':'-65.00');
  assert.equal(plan.calendarOld.days,17);assert.equal(plan.calendarOld.to,T.slice(0,8)+'17');
});
test('listopad: konkretne kwoty F→stare85 i nowe43,33, korekta−21,67',()=>{
  const plan=buildInvoicePlan(evaluateBasket(base));
  assert.equal(plan.rows[0].oldCharge,'85.00');assert.equal(plan.rows[0].newCharge,'43.33');
  assert.equal(plan.rows[0].documentChange,'-21.67');assert.equal(plan.rows[0].partsTotal,'128.33');
  assert.equal(plan.rows[0].oldPeriod.from,'2026-11-01');assert.equal(plan.rows[0].oldPeriod.to,'2026-11-17');
  assert.equal(plan.rows[0].newPeriod.from,'2026-11-18');assert.equal(plan.rows[0].newPeriod.to,'2026-11-30');
});
test('T26: zgodność sumy części nie ukrywa przeciwnych reszt groszowych',()=>{
  const result=evaluateBasket({...base,month:'2027-03',effectiveDate:'2027-03-18',rows:[row('100','60'),row('50','70')]});
  const plan=buildInvoicePlan(result);
  assert.deepEqual(plan.rows.map(x=>[x.oldCharge,x.newCharge,x.partResidual]),[['53.33','28.00','0.00'],['26.67','32.67','-0.01']]);
  assert.deepEqual(plan.rows.map(x=>x.documentChange),['-18.67','9.34']);
  assert.equal(plan.partsTotal,'140.67');assert.equal(plan.totalResidual,'0.00');
  assert.equal(plan.rowResidualSum,'-0.01');assert.equal(plan.basketResidual,'0.01');
  assert.equal(plan.needsRoundingReview,true);
});
test('T27: brak samodzielnego wyboru nowej polityki podziału',()=>{
  const result=evaluateBasket({...base,type:'NO_CHANGE',month:'2027-03',effectiveDate:'2027-03-18',rows:[row('100','70'),row('50','80')]});
  const plan=buildInvoicePlan(result);
  assert.equal(plan.available,false);assert.equal(plan.status,'UNAVAILABLE_SAME_TOTAL_CHANGED_COMPONENTS');
  assert.equal(plan.rows[0].oldCharge,null);assert.equal(plan.rows[0].newCharge,null);
  assert.equal(result.global.due,'150.00');
});
for(const [T,oldCharge,newCharge] of [['2026-11-01','0.00','180.00'],['2026-11-02','150.00','0.00']])test(`podwyżka${T}: pełna cena ma pierwszeństwo przed proporcją`,()=>{
  const plan=buildInvoicePlan(evaluateBasket({...base,type:'PODWYŻKA',effectiveDate:T,rows:[row('150','180')]}));
  assert.equal(plan.rows[0].oldCharge,oldCharge);assert.equal(plan.rows[0].newCharge,newCharge);
  assert.equal(plan.totalResidual,'0.00');
  assert.equal(plan.rows[0][T.endsWith('01')?'newPeriod':'oldPeriod'].days,30);
});
test('T08: dzień usługi jest rzeczywisty, ale stara opłata B=0',()=>{
  const p=buildInvoicePlan(evaluateBasket({...base,type:'WYPOWIEDZENIE',month:'2027-03',effectiveDate:'2027-03-02',rows:[row('150','0')]}));
  assert.equal(p.calendarOld.days,1);assert.equal(p.oldUnits,0);
  assert.equal(p.rows[0].oldCharge,'0.00');assert.equal(p.rows[0].newCharge,'0.00');
  assert.equal(p.rows[0].newPeriod,null);
});
for(const [month,effectiveDate,old,next,oldPart,newPart,residual] of [
  ['2027-02','2027-02-18','0.04','0.01','0.02','0.00','0.01'],
  ['2026-11','2026-11-16','0.03','0.01','0.02','0.01','-0.01'],
])test(`reszta części ${residual}: brak ukrytego przypisania grosza`,()=>{
  const p=buildInvoicePlan(evaluateBasket({...base,month,effectiveDate,rows:[row(old,next)]}));
  assert.equal(p.rows[0].oldCharge,oldPart);assert.equal(p.rows[0].newCharge,newPart);
  assert.equal(p.rows[0].partResidual,residual);assert.equal(p.needsRoundingReview,true);
});
test('F mniejsze od starej części: zwiększenie starej pozycji zachowane',()=>{
  const p=buildInvoicePlan(evaluateBasket({...base,rows:[row('150','100','70')]}));
  assert.equal(p.rows[0].oldAdjustment,'15.00');assert.equal(p.rows[0].documentChange,'58.33');
});
test('kopia odróżnia zmniejszenie starej pozycji i zmniejszenie całej faktury',()=>{
  const text=buildSummary(evaluateBasket(base));
  assert.match(text,/Zmniejsz starą pozycję o 65,00 zł/);
  assert.match(text,/Zmniejszenie faktury o 21,67 zł/);
});
test('kopia jawnie opisuje zwiększenie przy F niższym od starej części',()=>{
  const text=buildSummary(evaluateBasket({...base,rows:[row('150','100','70')]}));
  assert.match(text,/Zwiększ starą pozycję o 15,00 zł/);
  assert.match(text,/Zwiększenie faktury o 58,33 zł/);
});
test('podwyżka w przyszłym miesiącu: data wyższej ceny nie jest liczona od miesiąca analizy',()=>{
  const p=buildInvoicePlan(evaluateBasket({...base,type:'PODWYŻKA',effectiveDate:'2027-02-18',rows:[row('150','180')]}));
  assert.equal(p.higherPriceStart,'2027-03-01');
  assert.equal(p.rows[0].oldCharge,'150.00');
});
test('kopia pełnej nowej ceny nie nazywa jej opłatą cząstkową',()=>{
  const text=buildSummary(evaluateBasket({...base,type:'PODWYŻKA',effectiveDate:'2026-11-01',rows:[row('150','180')]}));
  assert.match(text,/Nowy abonament za cały miesiąc: 180,00 zł/);
  assert.doesNotMatch(text,/Nowy abonament cząstkowy:/);
});
test('dodatnia nowa część zaokrąglona do zera zachowuje okres i kontrolę',()=>{
  const result=evaluateBasket({...base,month:'2027-02',effectiveDate:'2027-02-18',rows:[row('0.04','0.01')]});
  const p=buildInvoicePlan(result),text=buildSummary(result);
  assert.equal(p.rows[0].newPeriod.from,'2027-02-18');
  assert.equal(p.rows[0].newNumerator,'13');
  assert.match(text,/18\.02\.2027–28\.02\.2027/);
  assert.match(text,/0,00 zł po testowym zaokrągleniu/);
  assert.match(text,/reszta wymaga uzgodnienia/);
});
test('data wyższej ceny przechodzi przez koniec roku',()=>{
  const p=buildInvoicePlan(evaluateBasket({...base,type:'PODWYŻKA',effectiveDate:'2026-12-18',rows:[row('150','180')]}));
  assert.equal(p.higherPriceStart,'2027-01-01');
});
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/reference.json',import.meta.url)));
for(const fixture of fixtures)test(`${fixture.id}: dokładne stare+nowe = istniejący licznik wiersza`,()=>{
  const {old,new:next,invoiced,basis,...rest}=fixture.input;
  const r=evaluateBasket({...rest,rows:[row(old,next,invoiced)]}),p=buildInvoicePlan(r);
  assert.equal(BigInt(p.rows[0].oldNumerator)+BigInt(p.rows[0].newNumerator),BigInt(r.rows[0].exactNumerator));
  assert.doesNotThrow(()=>JSON.stringify(p));
});
