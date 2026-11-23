// Dodatkowa prezentacja części starej/nowej; nie zmienia silnika ani podziału groszy.
const toCents=value=>BigInt(value.replace('.',''));
function amount(value) {
  const absolute=value<0n?-value:value;
  return `${value<0n?'-':''}${absolute/100n}.${String(absolute%100n).padStart(2,'0')}`;
}
const round30=value=>value<0n?-((-value+15n)/30n):(value+15n)/30n;

/** Przyjmuje wyłącznie zweryfikowany wynik evaluateBasket(). Wszystkie kwoty PLN. */
export function buildInvoicePlan(result) {
  if(result.rule==='ACTUAL_DAYS_OVER_30_AFTER_DISCOUNTS')return result.invoicePlan;
  const g=result.global, first=`${result.month}-01`;
  const date=day=>`${result.month}-${String(day).padStart(2,'0')}`;
  const calendarOld=g.daysOld?{from:first,to:date(g.daysOld),days:g.daysOld}:null;
  const calendarNew=g.daysNew?{from:date(g.daysOld+1),to:date(g.daysInMonth),days:g.daysNew}:null;
  const full={from:first,to:date(g.daysInMonth),days:g.daysInMonth};
  let higherPriceStart=null;
  if(result.type==='PODWYŻKA') {
    const [year,month,day]=result.effectiveDate.split('-').map(Number);
    higherPriceStart=day===1?result.effectiveDate:`${String(year+(month===12?1:0)).padStart(4,'0')}-${String(month===12?1:month+1).padStart(2,'0')}-01`;
  }
  const common={method:g.method,calendarOld,calendarNew,higherPriceStart,basketResidual:result.residual};
  if(result.warnings.includes('COMPONENTS_CHANGED_SAME_TOTAL')) {
    return {...common,available:false,status:'UNAVAILABLE_SAME_TOTAL_CHANGED_COMPONENTS',oldUnits:null,newUnits:null,
      rows:result.rows.map(row=>({number:row.number,service:row.service,oldCharge:null,newCharge:null,oldAdjustment:null,partResidual:null})),
      partsTotal:null,totalResidual:null,rowResidualSum:null,needsRoundingReview:true};
  }
  let oldUnits,newUnits;
  if(g.method==='Pełna O'){oldUnits=30;newUnits=0;}
  else if(g.method==='Pełna N'){oldUnits=0;newUnits=30;}
  else if(g.method==='B'){oldUnits=30-g.daysNew;newUnits=g.daysNew;}
  else {oldUnits=g.daysOld;newUnits=30-g.daysOld;}
  let total=0n,rowResidualSum=0n;
  const rows=result.rows.map(row=>{
    const old=toCents(row.old),next=toCents(row.new),invoiced=toCents(row.invoiced);
    const oldNumerator=old*BigInt(oldUnits),newNumerator=next*BigInt(newUnits);
    if(oldNumerator+newNumerator!==BigInt(row.exactNumerator)) throw new Error('Rozbicie nie odpowiada wybranej metodzie globalnej.');
    const oldCharge=round30(oldNumerator),newCharge=round30(newNumerator);
    const partsTotal=oldCharge+newCharge,partResidual=toCents(row.due)-partsTotal;
    total+=partsTotal;rowResidualSum+=partResidual;
    const fullOld=g.method==='Pełna O',fullNew=g.method==='Pełna N';
    return {number:row.number,service:row.service,invoiced:row.invoiced,
      oldCharge:amount(oldCharge),newCharge:amount(newCharge),partsTotal:amount(partsTotal),
      oldAdjustment:amount(oldCharge-invoiced),documentChange:amount(partsTotal-invoiced),
      partResidual:amount(partResidual),oldNumerator:String(oldNumerator),newNumerator:String(newNumerator),
      oldPeriod:fullOld?full:fullNew?null:calendarOld,
      newPeriod:result.type==='WYPOWIEDZENIE'||fullOld?null:fullNew?full:calendarNew,
    };
  });
  const totalResidual=BigInt(g.dueCents)-total;
  return {...common,available:true,status:'TEST_ONLY_D11_OPEN',oldUnits,newUnits,rows,
    fullMonthlyPolicy:g.method.startsWith('Pełna'),
    adjustedModel:!g.method.startsWith('Pełna')&&g.daysInMonth!==30,
    partsTotal:amount(total),totalResidual:amount(totalResidual),rowResidualSum:amount(rowResidualSum),
    needsRoundingReview:result.residual!=='0.00'||rows.some(row=>row.partResidual!=='0.00'),
  };
}
