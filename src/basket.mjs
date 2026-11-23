import { calculate } from './calculator.mjs';

export const SERVICES = Object.freeze({ internet: 'Internet', tv: 'Telewizja', rental: 'Dzierżawa', other: 'Inny abonament' });
const FORM_FIELDS = new Set(['month','effectiveDate','lastOldDate','type','dateVerified','paid','multipleDates','unresolvedDiscounts','rows']);
const ROW_FIELDS = new Set(['label','description','service','old','new','invoiced','basis','vat']);
function fail(code, message, field) { throw Object.assign(new Error(message), { code, field }); }
function cents(value, field) {
  if (typeof value !== 'string' || !/^\d{1,15}(?:[.,]\d{1,2})?$/.test(value)) {
    fail('INVALID_MONEY', 'Wpisz nieujemną kwotę do 2 miejsc po przecinku (maks. 15 cyfr przed przecinkiem).', field);
  }
  const [whole, fraction=''] = value.replace(',','.').split('.');
  return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
}
function amount(value) {
  const abs=value<0n?-value:value;
  return `${value<0n?'-':''}${abs/100n}.${String(abs%100n).padStart(2,'0')}`;
}
function round30(value) { return value<0n?-((-value+15n)/30n):(value+15n)/30n; }
function unknownFields(object, allowed) {
  for (const key of Object.keys(object)) if (!allowed.has(key)) fail('UNSUPPORTED_FIELD','Nieobsługiwane pole; sprawdź zakres jednej zmiany.',key);
}

/** Adapter zachowuje API calculate; propozycje nie są dokumentem księgowym. */
export function evaluateBasket(form) {
  if(!form||typeof form!=='object'||Array.isArray(form)) fail('INVALID_INPUT','Wymagane dane formularza.');
  unknownFields(form,FORM_FIELDS);
  if(form.multipleDates) fail('MULTIPLE_DATES','Wiele niezależnych dat zmian — skieruj przypadek do rozliczeń (D13).','multipleDates');
  if(form.unresolvedDiscounts) fail('UNRESOLVED_DISCOUNTS','Nieuzgodnione rabaty lub ich znaki — wymagana kontrola księgowa (D11).','unresolvedDiscounts');
  if(!Array.isArray(form.rows)||!form.rows.length) fail('ROWS_REQUIRED','Dodaj przynajmniej jedną pozycję abonamentową.','rows');
  if(form.rows.length>50) fail('ROW_LIMIT','Prototyp obsługuje maksymalnie 50 pozycji.','rows');
  const sums={old:0n,new:0n,invoiced:0n};
  const categories=new Set();
  const rows=form.rows.map((row,index)=>{
    if(!row||typeof row!=='object'||Array.isArray(row)) fail('INVALID_INPUT','Nieprawidłowy wiersz abonamentu.',`rows.${index}`);
    unknownFields(row,ROW_FIELDS);
    if(row.basis!=='gross') fail('UNSUPPORTED_BASIS','Obsługujemy wyłącznie porównywalne kwoty brutto. Netto lub mieszane podstawy wymagają kontroli.',`rows.${index}.basis`);
    if(!Object.hasOwn(SERVICES,row.service)) fail('INVALID_SERVICE','Wybierz typ usługi z listy.',`rows.${index}.service`);
    const vat=row.vat??'';
    if(!['','23','8','5','0','zw'].includes(vat)) fail('INVALID_VAT','Nieobsługiwana kategoria VAT.',`rows.${index}.vat`);
    categories.add(vat);
    for(const key of ['label','description']) if(row[key]!==undefined&&(typeof row[key]!=='string'||row[key].length>160)) fail('INVALID_LABEL','Etykieta lub opis jest zbyt długi.',`rows.${index}.${key}`);
    const values={};
    for(const key of ['old','new','invoiced']) { values[key]=cents(row[key],`rows.${index}.${key}`); sums[key]+=values[key]; }
    return {...row,vat,values};
  });
  if(categories.size>1) fail('MIXED_VAT','Różne lub częściowo nieznane kategorie VAT — wymagana kontrola księgowa. Nie łącz ich w tym prototypie.','rows');
  const limit=99999999999999999n;
  if(Object.values(sums).some(value=>value>limit)) fail('TOTAL_TOO_LARGE','Suma koszyka przekracza limit 15 cyfr w złotych.','rows');
  const input={month:form.month,effectiveDate:form.effectiveDate,type:form.type,dateVerified:form.dateVerified,basis:'gross',old:amount(sums.old),new:amount(sums.new),invoiced:amount(sums.invoiced)};
  if(form.lastOldDate) input.lastOldDate=form.lastOldDate;
  if(form.paid!==undefined&&form.paid!=='') input.paid=form.paid;
  const global=calculate(input);
  let rowSum=0n, rowDeltaSum=0n;
  const proposals=rows.map((row,index)=>{
    const {old:o,new:n,invoiced:f}=row.values;
    let numerator;
    switch(global.method) {
      case 'Pełna O': numerator=o*30n; break;
      case 'Pełna N': numerator=n*30n; break;
      case 'B': numerator=o*30n+(n-o)*BigInt(global.daysNew); break;
      default: numerator=n*30n+(o-n)*BigInt(global.daysOld); // A lub A=B
    }
    const due=round30(numerator),delta=f-due;
    rowSum+=due; rowDeltaSum+=delta;
    return {number:index+1,label:row.label??'',description:row.description??'',service:row.service,vat:row.vat,old:amount(o),new:amount(n),invoiced:amount(f),method:global.method,due:amount(due),delta:amount(delta),exactNumerator:String(numerator)};
  });
  const residual=BigInt(global.dueCents)-rowSum;
  const warnings=[...global.warnings];
  if(sums.old===sums.new&&rows.some(row=>row.values.old!==row.values.new)) warnings.push('COMPONENTS_CHANGED_SAME_TOTAL');
  if(residual!==0n) warnings.push('UNALLOCATED_ROUNDING');
  if(proposals.some(row=>row.delta.startsWith('-'))) warnings.push('LINE_INCREASE_REVIEW');
  if(proposals.some(row=>row.due.startsWith('-'))) warnings.push('NEGATIVE_LINE_PROPOSAL');
  return {status:'TEST_ONLY_D11_OPEN',month:form.month,effectiveDate:form.effectiveDate,lastOldDate:form.lastOldDate??'',type:form.type,global,totals:{old:input.old,new:input.new,invoiced:input.invoiced},rows:proposals,rowSum:amount(rowSum),rowDeltaSum:amount(rowDeltaSum),residual:amount(residual),reconciled:residual===0n,warnings};
}

/** Formatowanie bez konwersji pieniędzy na Number. */
export function formatPln(value, signed=false) {
  const sign=value.startsWith('-')?'−':signed&&value!=='0.00'?'+':'';
  const [whole,part]=value.replace(/^-/,'').split('.');
  return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g,' ' )},${part} zł`;
}
export function formatDate(value) { return value?value.split('-').reverse().join('.'):''; }
