import { evaluateBasket, SERVICES, formatPln, formatDate } from './basket.mjs';

export const DAILY_RULE='ACTUAL_DAYS_OVER_30_AFTER_DISCOUNTS';
const cents=value=>BigInt(value.replace('.',''));
const amount=value=>{const a=value<0n?-value:value;return `${value<0n?'-':''}${a/100n}.${String(a%100n).padStart(2,'0')}`;};
const round30=value=>value<0n?-((-value+15n)/30n):(value+15n)/30n;
const rangeText=range=>range?`${formatDate(range.from)}–${formatDate(range.to)}`:'brak opłaty w tym miesiącu';

export function billingLabel(mode) {
  return ({PARTIAL_DAYS_30:'Rzeczywiste dni ÷ 30',MONTHLY_OLD:'Pełny dotychczasowy abonament',MONTHLY_NEW:'Pełny nowy abonament',NO_SERVICE:'Brak opłaty — usługa zakończona',UNCHANGED:'Cena miesięczna bez zmian',UPGRADE_NEXT_MONTH:'Podwyżka od następnego miesiąca',COMPONENT_REVIEW:'Zmiana składników — do sprawdzenia',A:'Porównanie A/B — wybrano A',B:'Porównanie A/B — wybrano B','A=B':'Porównanie A/B — oba warianty są równe','Pełna O':'Pełny dotychczasowy abonament','Pełna N':'Pełny nowy abonament'})[mode]??'Pełny miesiąc';
}

/** Nowa reguła właściciela; dotychczasowy adapter dostarcza tylko walidację i kalendarz.
 * Historyczne wyniki MIN(A,B) nie są używane do naliczeń tej reguły.
 */
export function evaluateDailyBasket(form) {
  const validated=evaluateBasket(form),oldGlobal=validated.global;
  const {daysOld:d,daysNew:r,daysInMonth:length}=oldGlobal;
  const date=day=>`${form.month}-${String(day).padStart(2,'0')}`;
  const full={from:date(1),to:date(length),days:length};
  const calendarOld=d?{from:date(1),to:date(d),days:d}:null;
  const calendarNew=r?{from:date(d+1),to:date(length),days:r}:null;
  const componentsReview=validated.warnings.includes('COMPONENTS_CHANGED_SAME_TOTAL');
  let mode;
  if(form.type==='WYPOWIEDZENIE'&&d===0)mode='NO_SERVICE';
  else if(componentsReview)mode='COMPONENT_REVIEW';
  else if(validated.totals.old===validated.totals.new)mode='UNCHANGED';
  else if(d===0)mode='MONTHLY_NEW';
  else if(r===0)mode='MONTHLY_OLD';
  else if(form.type==='PODWYŻKA')mode='UPGRADE_NEXT_MONTH';
  else mode='PARTIAL_DAYS_30';
  let higherPriceStart=null;
  if(form.type==='PODWYŻKA') {
    const [year,month,day]=form.effectiveDate.split('-').map(Number);
    higherPriceStart=day===1?form.effectiveDate:`${String(year+(month===12?1:0)).padStart(4,'0')}-${String(month===12?1:month+1).padStart(2,'0')}-01`;
  }
  let exact=0n,rowSum=0n,rowDeltaSum=0n,partsTotal=0n,rowResidualSum=0n;
  const planRows=[];
  const rows=validated.rows.map(row=>{
    const o=cents(row.old),n=cents(row.new),f=cents(row.invoiced);
    const rowMode=mode==='PARTIAL_DAYS_30'&&o===n?'UNCHANGED':mode;
    const fullNew=rowMode==='MONTHLY_NEW'||rowMode==='NO_SERVICE',partial=rowMode==='PARTIAL_DAYS_30';
    const oldUnits=fullNew?0:partial?d:30,newUnits=fullNew?30:partial?r:0;
    const oldNumerator=o*BigInt(oldUnits),newNumerator=n*BigInt(newUnits),numerator=oldNumerator+newNumerator;
    const oldCharge=round30(oldNumerator),newCharge=round30(newNumerator),due=round30(numerator);
    const sum=oldCharge+newCharge,residual=due-sum;
    exact+=numerator;rowSum+=due;rowDeltaSum+=f-due;partsTotal+=sum;rowResidualSum+=residual;
    planRows.push({number:row.number,service:row.service,invoiced:row.invoiced,
      oldCharge:amount(oldCharge),newCharge:amount(newCharge),partsTotal:amount(sum),
      oldAdjustment:amount(oldCharge-f),documentChange:amount(sum-f),partResidual:amount(residual),
      oldNumerator:String(oldNumerator),newNumerator:String(newNumerator),oldUnits,newUnits,billingMode:rowMode,
      oldMonthly:row.old,newMonthly:row.new,
      oldPeriod:fullNew?null:partial?calendarOld:full,
      newPeriod:form.type==='WYPOWIEDZENIE'?null:fullNew?full:partial?calendarNew:null,
    });
    return {...row,method:rowMode,due:amount(due),delta:amount(f-due),exactNumerator:String(numerator)};
  });
  const due=round30(exact),delta=cents(validated.totals.invoiced)-due,residual=due-rowSum;
  const warnings=['D05_CONTRACT_GATE_OPEN','D11_ACCOUNTING_GATE_OPEN'];
  if(validated.totals.invoiced!==validated.totals.old)warnings.push('INVOICE_DIFFERS_FROM_OLD');
  if(delta<0n)warnings.push('ADDITIONAL_AMOUNT_REVIEW');
  if(validated.totals.old===validated.totals.new)warnings.push('NO_PRICE_CHANGE');
  if(componentsReview)warnings.push('COMPONENTS_CHANGED_SAME_TOTAL');
  if(residual!==0n)warnings.push('UNALLOCATED_ROUNDING');
  if(rows.some(row=>row.delta.startsWith('-')))warnings.push('LINE_INCREASE_REVIEW');
  const needsRoundingReview=residual!==0n||planRows.some(row=>row.partResidual!=='0.00');
  const invoicePlan={method:mode,available:!componentsReview,status:componentsReview?'UNAVAILABLE_SAME_TOTAL_CHANGED_COMPONENTS':'TEST_ONLY_D11_OPEN',
    calendarOld,calendarNew,higherPriceStart,basketResidual:amount(residual),
    oldUnits:mode==='MONTHLY_NEW'||mode==='NO_SERVICE'?0:mode==='PARTIAL_DAYS_30'?d:30,
    newUnits:mode==='MONTHLY_NEW'?30:mode==='PARTIAL_DAYS_30'?r:0,
    fullMonthlyPolicy:mode!=='PARTIAL_DAYS_30',adjustedModel:false,
    rows:componentsReview?planRows.map(row=>({...row,oldCharge:null,newCharge:null,oldAdjustment:null,partResidual:null})):planRows,
    partsTotal:componentsReview?null:amount(partsTotal),totalResidual:componentsReview?null:amount(due-partsTotal),
    rowResidualSum:componentsReview?null:amount(rowResidualSum),needsRoundingReview:componentsReview||needsRoundingReview,
  };
  return {...validated,rule:DAILY_RULE,global:{status:'TEST_ONLY',algorithmVersion:'0.2.0-calendar-days',basis:'gross',
    roundingPolicy:'HALF_UP_TEST_ONLY_D11_OPEN',classification:oldGlobal.classification,method:mode,
    daysInMonth:length,daysOld:d,daysNew:r,due:amount(due),delta:amount(delta),dueCents:String(due),deltaCents:String(delta),
    exact:{due:{numerator:String(exact),denominator:'30'}},warnings},
    rows,rowSum:amount(rowSum),rowDeltaSum:amount(rowDeltaSum),residual:amount(residual),reconciled:residual===0n,warnings,invoicePlan};
}

export function calculationSteps(row) {
  if(row.billingMode==='NO_SERVICE')return ['Przez cały analizowany miesiąc usługa jest zakończona. Należność: 0,00 zł.'];
  const partial=row.billingMode==='PARTIAL_DAYS_30',fullNew=row.billingMode==='MONTHLY_NEW';
  return partial?[
    `Stary abonament: ${formatPln(row.oldMonthly)} × ${row.oldUnits} dni ÷ 30 = ${formatPln(row.oldCharge)} (${rangeText(row.oldPeriod)}).`,
    row.newPeriod?`Nowy abonament: ${formatPln(row.newMonthly)} × ${row.newUnits} dni ÷ 30 = ${formatPln(row.newCharge)} (${rangeText(row.newPeriod)}).`:'Po zakończeniu usługi nie naliczamy nowego abonamentu.',
  ]:[fullNew?`Pełny nowy abonament za ${rangeText(row.newPeriod)}: ${formatPln(row.newCharge)}.`:`Pełny dotychczasowy abonament za ${rangeText(row.oldPeriod)}: ${formatPln(row.oldCharge)}.`];
}

export function buildDailySummary(result) {
  const plan=result.invoicePlan,g=result.global;
  const text=['MULTIPLAY BOK — PROPOZYCJA TESTOWA','Kwoty robocze wymagają weryfikacji księgowej. Nie jest to dokument księgowy.',
    `Miesiąc: ${result.month.split('-').reverse().join('.')}. Data zmiany: ${formatDate(result.effectiveDate)}${result.lastOldDate?`; ostatni dzień usługi: ${formatDate(result.lastOldDate)}`:''}.`,
    'Ceny miesięczne brutto po rabatach. Część miesiąca: cena × rzeczywiste dni korzystania ÷ 30. Nie zaokrąglamy wcześniej stawki dziennej.',
    `Sposób naliczenia: ${billingLabel(g.method)}.`];
  if(plan.available) {
    for(const row of plan.rows) {
      const operation=row.oldAdjustment==='0.00'?'Stara pozycja bez zmiany.':`${row.oldAdjustment.startsWith('-')?'Zmniejsz':'Zwiększ'} starą pozycję o ${formatPln(row.oldAdjustment.replace(/^-/,''))}.`;
      text.push('',`Pozycja ${row.number} (${SERVICES[row.service]}):`,...calculationSteps(row),
        `Stara pozycja: z ${formatPln(row.invoiced)} na ${formatPln(row.oldCharge)}. ${operation}`,
        row.newPeriod?`Dodaj nowy abonament: ${formatPln(row.newCharge)}.`:'Brak nowej opłaty w tym miesiącu.',
        `Razem części tej pozycji: ${formatPln(row.partsTotal)}. Reszta do uzgodnienia: ${formatPln(row.partResidual,true)}.`);
      if(row.newPeriod&&row.newCharge==='0.00'&&row.newNumerator!=='0')text.push('Nowa część wynosi 0,00 zł po testowym zaokrągleniu; jej okres pozostaje ważny, a reszta wymaga uzgodnienia.');
    }
    text.push(`Suma starych i nowych części: ${formatPln(plan.partsTotal)}. Reszta podziału do należności: ${formatPln(plan.totalResidual,true)}.`);
  } else text.push('Zmiana składników przy stałej sumie: rozbicie starej i nowej części wymaga uzgodnienia z rozliczeniami.');
  text.push(`Należność za miesiąc: ${formatPln(g.due)}. Na fakturze naliczono: ${formatPln(result.totals.invoiced)}.`);
  text.push(g.delta==='0.00'?'Brak różnicy łącznej względem faktury.':`${g.delta.startsWith('-')?'Zwiększenie':'Zmniejszenie'} faktury o ${formatPln(g.delta.replace(/^-/,''))}.`);
  if(plan.higherPriceStart)text.push(`Wyższa cena obowiązuje od ${formatDate(plan.higherPriceStart)}; podwyżka w trakcie miesiąca nie tworzy cząstkowej dopłaty.`);
  if(plan.needsRoundingReview)text.push('Reszty groszowe pozostają nieprzypisane; wymagają uzgodnienia z rozliczeniami.');
  text.push('Różnica faktury nie jest wyliczeniem zwrotu ani salda klienta. VAT i sposób księgowania wymagają zatwierdzenia.',`Reguła: ${g.algorithmVersion}.`);
  return text.join('\n');
}
