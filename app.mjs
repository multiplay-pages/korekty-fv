import { formatPln, formatDate, SERVICES } from './src/basket.mjs';
import { evaluateDailyBasket, billingLabel, calculationSteps } from './src/daily-proration.mjs';
import { buildSummary } from './src/summary.mjs';
import { example } from './src/examples.mjs';
import { buildInvoicePlan } from './src/invoice-plan.mjs';

const $=id=>document.getElementById(id);
const form=$('calculator-form'),tbody=$('positions').tBodies[0];
let nextRowId=1, revision=0;
const text=(id,value)=>{$(id).textContent=value;};
function nextDay(value) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return '';
  const [year,month,day]=value.split('-').map(Number);
  const date=new Date(0);date.setUTCHours(0,0,0,0);date.setUTCFullYear(year,month-1,day);
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return '';
  date.setUTCDate(date.getUTCDate()+1);
  const nextYear=date.getUTCFullYear();if(nextYear>9999)return '';
  return `${String(nextYear).padStart(4,'0')}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
}
function datePreviews() {
  text('month-preview',$('month').value?`Okres: ${$('month').value.split('-').reverse().join('.')}`:'');
  text('date-preview',$('effective-date').value?`Data: ${formatDate($('effective-date').value)}`:'');
  text('end-date-preview',$('last-old-date').value?`Data: ${formatDate($('last-old-date').value)}`:'');
}
function invalidate(message='Dane zmienione — oblicz ponownie, aby otrzymać aktualny wynik.') {
  revision++;
  $('results').hidden=true;
  $('summary').value=''; $('copy-summary').disabled=true;
  text('copy-feedback',''); text('form-feedback',message);
  $('errors').hidden=true;$('errors').replaceChildren();
  for(const el of form.querySelectorAll('[aria-invalid]')) {
    el.removeAttribute('aria-invalid');
    if((el.getAttribute('aria-describedby')??'').startsWith('error-description'))el.removeAttribute('aria-describedby');
  }
  for(const id of ['total-old','total-new','total-invoiced']) text(id,'—');
  datePreviews();
}
function syncScenario() {
  document.querySelectorAll('[data-scenario]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.scenario===$('event-type').value)));
  const termination=$('event-type').value==='WYPOWIEDZENIE';
  const increase=$('event-type').value==='PODWYŻKA';
  $('end-date-field').hidden=!termination;
  $('last-old-date').required=termination;
  $('effective-date').readOnly=termination;
  $('effective-required').hidden=termination;
  if(termination)$('effective-date').value=nextDay($('last-old-date').value);
  text('effective-label',termination?'Pierwszy dzień bez usługi':increase?'Data zmiany warunków':'Od kiedy obowiązuje nowy abonament?');
  text('date-hint',termination?'Obliczamy automatycznie jako dzień po ostatnim dniu usługi.':increase?'Od 1. dnia miesiąca naliczamy nową cenę. Zmiana od 2. dnia lub później: stara cena do końca miesiąca, nowa od następnego miesiąca.':'Nowe warunki obowiązują od tego dnia włącznie.');
  $('termination-note').hidden=!termination;
  for(const el of tbody.querySelectorAll('[data-field="new"]')) {
    if(termination&&!el.disabled){el.dataset.previousPrice=el.value;el.value='0,00';}
    if(!termination&&el.disabled){el.value=el.dataset.previousPrice??'';delete el.dataset.previousPrice;}
    el.disabled=termination;
  }
}
function updateCount() { text('row-count',`${tbody.rows.length} ${tbody.rows.length===1?'pozycja':'pozycji'}`); $('add-position').disabled=tbody.rows.length>=50; }
function addRow(values={}) {
  if(tbody.rows.length>=50) return;
  const id=nextRowId++,tr=document.createElement('tr');
  const fields=[
    ['Usługa',`<select data-field="service" aria-label="Usługa pozycji ${id}">${Object.entries(SERVICES).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select>`],
    ...[['old','Dotychczasowy abonament miesięczny'],['new','Nowy abonament miesięczny']].map(([key,label])=>[label,`<input data-field="${key}" inputmode="decimal" type="text" maxlength="64" aria-label="${label} pozycji ${id}" placeholder="Wpisz kwotę w zł" required><small>Wymagane</small>`]),
    ['Już naliczono na fakturze',`<input data-field="invoiced" inputmode="decimal" type="text" maxlength="64" aria-label="Kwota na fakturze pozycji ${id}" placeholder="Jak dotychczasowy abonament" disabled required><label class="invoice-toggle"><input data-invoice-override type="checkbox"> Na fakturze jest inna kwota</label><label class="invoice-toggle confirm-invoice"><input data-invoice-confirm type="checkbox"> Sprawdziłem kwotę na fakturze dla tej usługi</label>`],
    ['Szczegóły',`<details class="row-meta"><summary>Podstawa i VAT</summary><label>Podstawa<select data-field="basis" aria-label="Podstawa pozycji ${id}"><option value="gross">Brutto</option><option value="net">Netto</option></select></label><label>VAT (informacja)<select data-field="vat" aria-label="VAT pozycji ${id}"><option value="">Nieokreśl.</option><option value="23">23%</option><option value="8">8%</option><option value="5">5%</option><option value="0">0%</option><option value="zw">Zw.</option></select></label></details>`],
    ['',`<button type="button" class="remove-row" data-action="remove" aria-label="Usuń pozycję ${id}">×</button>`],
  ];
  for(const [label,markup] of fields) { const td=document.createElement('td'); td.dataset.label=label; td.innerHTML=markup; tr.append(td); }
  for(const input of tr.querySelectorAll('[data-field]')) {
    if(values[input.dataset.field]!==undefined) input.value=values[input.dataset.field];
  }
  tr.querySelector('[data-invoice-override]').checked=values.invoiced!==undefined&&values.invoiced!==values.old;
  syncInvoice(tr);
  tr.querySelector('[data-invoice-confirm]').checked=values.confirmed===true;
  tbody.append(tr); syncScenario(); updateCount();
}
function syncInvoice(tr) {
  const override=tr.querySelector('[data-invoice-override]').checked;
  const invoiced=tr.querySelector('[data-field="invoiced"]');
  invoiced.disabled=!override;
  if(!override)invoiced.value=tr.querySelector('[data-field="old"]').value;
}
function readForm() {
  return {
    month:$('month').value,effectiveDate:$('effective-date').value,type:$('event-type').value,
    lastOldDate:$('event-type').value==='WYPOWIEDZENIE'?$('last-old-date').value:'',
    dateVerified:true,multipleDates:$('multiple-dates').checked,unresolvedDiscounts:$('unresolved-discounts').checked,
    rows:Array.from(tbody.rows,tr=>Object.fromEntries(Array.from(tr.querySelectorAll('[data-field]'),el=>[el.dataset.field,el.value.trim()]))),
  };
}
const errorCopy={
  DATE_NOT_VERIFIED:'Potwierdź, że skuteczna data została ustalona poza kalkulatorem.',
  INVALID_MONTH:'Wybierz poprawny miesiąc rozliczeniowy.',INVALID_DATE:'Wpisz poprawną datę kalendarzową.',
  INCONSISTENT_DATES:'Pierwszy dzień bez usługi musi przypadać po ostatnim dniu świadczenia. Sprawdź ostatni dzień usługi.',
  END_DATE_REQUIRED:'Wpisz ostatni dzień świadczenia usługi.',
  DIRECTION_MISMATCH:'Wybrany scenariusz nie odpowiada zmianie SUMY koszyka. Sprawdź stary i nowy abonament wszystkich pozycji.',
};
function showError(error) {
  const box=$('errors');box.replaceChildren();
  const title=document.createElement('strong');title.textContent='Obliczenie zatrzymane';
  const parts=error.field?.startsWith('rows.')?error.field.split('.'):null;
  const target=parts?Array.from(tbody.rows[Number(parts[1])]?.querySelectorAll('[data-field]')??[]).find(el=>el.dataset.field===parts[2]):null;
  const lookup={DATE_NOT_VERIFIED:'date-verified',INVALID_MONTH:'month',INVALID_DATE:'effective-date',INCONSISTENT_DATES:'last-old-date',END_DATE_REQUIRED:'last-old-date',DIRECTION_MISMATCH:'event-type'};
  const field=target??(error.code==='DIRECTION_MISMATCH'?document.querySelector('[data-scenario][aria-pressed="true"]'):$(lookup[error.code]??'month'));
  const fieldNames={old:'Dotychczasowy abonament miesięczny',new:'Nowy abonament miesięczny',invoiced:'Kwota na fakturze',basis:'Podstawa kwoty',vat:'Kategoria VAT'};
  const prefix=parts?`Pozycja ${Number(parts[1])+1} — ${fieldNames[parts[2]]??'dane pozycji'}: `:'';
  const description=document.createElement('p');description.id='error-description';
  description.textContent=prefix+(errorCopy[error.code]??error.message??'Sprawdź dane formularza.');
  box.append(title,description);
  if(field){
    const details=field.closest('details');if(details)details.open=true;
    field.setAttribute('aria-invalid','true');field.setAttribute('aria-describedby','error-description');
    const jump=document.createElement('button');jump.type='button';jump.className='button quiet';jump.textContent='Przejdź do błędnego pola';
    jump.addEventListener('click',()=>field.focus());box.append(jump);
  }
  box.hidden=false;box.focus();
  text('form-feedback','Nie utworzono wyniku. Popraw wskazane dane i oblicz ponownie.');
}
const warningCopy={
  D11_ACCOUNTING_GATE_OPEN:['Weryfikacja księgowa · Kwoty są robocze. VAT, sposób zapisu korekty i zaokrąglenia wymagają potwierdzenia przez rozliczenia.','warning'],
  INVOICE_DIFFERS_FROM_OLD:['Sprawdź fakturę · Już naliczona kwota różni się od dotychczasowego abonamentu. Upewnij się, że porównujesz ten sam okres i te same opłaty.','warning'],
  ADDITIONAL_AMOUNT_REVIEW:['Sprawdź zwiększenie · Należność przekracza kwotę na fakturze. Dodatkowe naliczenie wymaga weryfikacji w uprawnionym systemie.','escalation'],
  NO_PRICE_CHANGE:['Informacja · Brak zmiany sumy abonamentu. Długość miesiąca sama w sobie nie tworzy rabatu.','info'],
  ZERO_FOR_ONE_SERVICE_DAY:['Informacja · 0 zł za pierwszy i jedyny dzień usługi w miesiącu 31-dniowym wynika z biznesowo przyjętej metody B. Nie blokujemy tego wyniku.','info'],
  COMPONENTS_CHANGED_SAME_TOTAL:['Sprawdź składniki · Ceny usług zmieniły się, choć ich łączna cena pozostała taka sama. Rozbicie pozycji wymaga uzgodnienia z rozliczeniami.','warning'],
  UNALLOCATED_ROUNDING:['Sprawdź grosze · Suma zaokrąglonych pozycji różni się od wyniku łącznego. Reszta jest nieprzypisana; jej rozliczenie wymaga uzgodnienia.','warning'],
  LINE_INCREASE_REVIEW:['Sprawdź pozycję · Co najmniej jedna usługa wymaga zwiększenia naliczenia. Sprawdź obsługę takiej zmiany w MMS.','warning'],
  NEGATIVE_LINE_PROPOSAL:['Eskalacja · Ujemna propozycja należności pozycji. Ten podział wymaga indywidualnej kontroli księgowej.','escalation'],
};
function renderInvoicePlan(result) {
  const plan=buildInvoicePlan(result),body=$('invoice-plan').querySelector('tbody');
  body.replaceChildren();$('invoice-plan').hidden=false;
  text('invoice-comparison',`Na fakturze było ${formatPln(result.totals.invoiced)}. Należność po korekcie: ${formatPln(result.global.due)}.`);
  const period=range=>range?`${formatDate(range.from)} – ${formatDate(range.to)}`:'Brak naliczenia w tym miesiącu';
  if(!plan.available) {
    text('invoice-plan-status','Rozbicie starego i nowego abonamentu do uzgodnienia: składniki zmieniły się przy stałej sumie. Sposób rozpisania pozycji wymaga kontroli rozliczeń.');
    text('invoice-parts-total','Do uzgodnienia');text('invoice-model-note','');
    text('invoice-plan-control','Zachowano należność koszyka. Nie ustalono rozbicia między stary i nowy abonament; wymagana decyzja dla kompensujących się zmian pozycji.');
    $('invoice-plan-status').className='message escalation';
    return;
  }
  $('invoice-plan-status').className='message info';
  $('residual-heading').hidden=!plan.needsRoundingReview;
  text('invoice-plan-status',plan.needsRoundingReview?'Sprawdź kwoty poniżej. Występują reszty groszowe — wymagają uzgodnienia przed przepisaniem pozycji.':'Poniżej: kwota, do której skorygować stary abonament, oraz nowa część do dodania. Kwoty robocze wymagają weryfikacji księgowej.');
  for(const row of plan.rows) {
    const tr=document.createElement('tr');
    const service=document.createElement('td');service.textContent=`${row.number}. ${SERVICES[row.service]}`;tr.append(service);
    const old=document.createElement('td');old.dataset.label='Stary abonament po korekcie';
    const oldAmount=document.createElement('strong');oldAmount.dataset.field='old-charge';oldAmount.textContent=formatPln(row.oldCharge);old.append(oldAmount);
    const oldPeriod=document.createElement('small');oldPeriod.textContent=period(row.oldPeriod);old.append(oldPeriod);
    const adjustment=document.createElement('span');adjustment.textContent=`Było ${formatPln(row.invoiced)}. ${row.oldAdjustment==='0.00'?'Bez zmiany:':row.oldAdjustment.startsWith('-')?'Zmniejsz starą pozycję o':'Zwiększ starą pozycję o'} `;
    const adjustmentAmount=document.createElement('span');adjustmentAmount.dataset.field='old-adjustment';adjustmentAmount.textContent=formatPln(row.oldAdjustment.replace(/^-/,''));adjustment.append(adjustmentAmount);old.append(adjustment);tr.append(old);
    const next=document.createElement('td');next.dataset.label='Nowy abonament do dodania';
    const newAmount=document.createElement('strong');newAmount.dataset.field='new-charge';newAmount.textContent=formatPln(row.newCharge);next.append(newAmount);
    const newPeriod=document.createElement('small');newPeriod.textContent=row.newPeriod?`${period(row.newPeriod)}${row.newCharge==='0.00'&&row.newNumerator!=='0'?'. 0,00 zł po testowym zaokrągleniu; reszta wymaga uzgodnienia.':''}`:'Brak nowej opłaty w tym miesiącu.';next.append(newPeriod);tr.append(next);
    const sum=document.createElement('td');sum.dataset.label='Razem części';sum.textContent=formatPln(row.partsTotal);tr.append(sum);
    const residual=document.createElement('td');residual.dataset.label='Reszta do uzgodnienia';residual.hidden=!plan.needsRoundingReview;
    const residualAmount=document.createElement('strong');residualAmount.dataset.field='period-residual';residualAmount.textContent=formatPln(row.partResidual,true);residual.append(residualAmount);tr.append(residual);
    body.append(tr);
  }
  text('invoice-parts-total',formatPln(plan.partsTotal));
  text('invoice-plan-control',`Reszta podziału do wyniku koszyka: ${formatPln(plan.totalResidual,true)}. Reszty między częściami a wierszami: ${formatPln(plan.rowResidualSum,true)}; reszta między wierszami a koszykiem: ${formatPln(plan.basketResidual,true)}. Nie przydzielono ich do żadnej pozycji.`);
  if(plan.fullMonthlyPolicy) {
    let note='Obowiązuje pełna cena miesięczna, bez naliczania cząstkowego.';
    if(result.global.method==='NO_SERVICE')note='Przez cały analizowany miesiąc usługa jest zakończona. Należność wynosi 0,00 zł.';
    if(plan.higherPriceStart)note=`${!result.effectiveDate.startsWith(result.month)?'Data zmiany leży poza analizowanym miesiącem. ':''}${result.global.method==='UPGRADE_NEXT_MONTH'?'Podwyżka w trakcie miesiąca: dotychczasowa cena do końca miesiąca, bez cząstkowej dopłaty.':note} Wyższy abonament od ${formatDate(plan.higherPriceStart)}.`;
    text('invoice-model-note',note);
  } else text('invoice-model-note',`Liczymy faktyczne dni obu okresów: ${plan.calendarOld?.days??0} dni dotychczasowego i ${plan.calendarNew?.days??0} dni nowego abonamentu. Każdą część mnożymy przez cenę po rabatach i dzielimy przez 30. Nie dodajemy ani nie odejmujemy dni, aby wyrównać miesiąc do 30.`);
}
function render(result) {
  const r=result,g=r.global;
  renderInvoicePlan(result);
  text('total-old',formatPln(r.totals.old));text('total-new',formatPln(r.totals.new));text('total-invoiced',formatPln(r.totals.invoiced));
  text('due',formatPln(g.due)); text('delta',formatPln(g.delta,true)); text('global-method',billingLabel(g.method));
  text('nominal-price',formatPln(r.totals.new));
  text('result-period',`${r.month.split('-').reverse().join('.')} · zmiana od ${formatDate(r.effectiveDate)}${r.lastOldDate?` · ostatni dzień usługi: ${formatDate(r.lastOldDate)}`:''}`);
  text('delta-explanation',g.delta.startsWith('-')?'Dodatkowa należność do weryfikacji. Nie wystawiaj automatycznej dopłaty.':g.delta==='0.00'?'Brak różnicy łącznej względem faktury.':'Dodatnia różnica zmniejsza naliczenie na fakturze.');
  text('method-explanation',g.method==='PARTIAL_DAYS_30'?'Ceny po rabatach × dni korzystania ÷ 30.':'Szczegóły naliczenia i daty poniżej.');
  text('days-month',g.daysInMonth);text('days-old',g.daysOld);text('days-new',g.daysNew);
  const steps=$('calculation-steps');steps.replaceChildren();
  if(r.invoicePlan.available)for(const row of r.invoicePlan.rows) {
    const article=document.createElement('article');article.className='calculation-step';
    const heading=document.createElement('h3');heading.textContent=`${row.number}. ${SERVICES[row.service]}`;article.append(heading);
    for(const step of calculationSteps(row)){const p=document.createElement('p');p.textContent=step;article.append(p);}
    const sum=document.createElement('p');sum.className='step-sum';sum.textContent=`Razem: ${formatPln(row.oldCharge)} + ${formatPln(row.newCharge)} = ${formatPln(row.partsTotal)}.`;article.append(sum);steps.append(article);
  } else {const p=document.createElement('p');p.textContent='Rozbicie zmienionych składników wymaga uzgodnienia z rozliczeniami.';steps.append(p);}
  text('formula-note','Część miesiąca: cena po rabatach × rzeczywista liczba dni ÷ 30. Zaokrąglamy dopiero wynik części do groszy, nie stawkę dzienną. Pełny miesiąc bez zmiany ceny zachowuje pełny abonament.');
  const body=$('line-results').tBodies[0];body.replaceChildren();
  for(const row of r.rows) {
    const tr=document.createElement('tr');
    const values=[['Pozycja',`${row.label||`Pozycja ${row.number}`} · ${SERVICES[row.service]}`,'label'],['Sposób naliczenia',billingLabel(row.method),'method'],['Naliczono na fakturze',formatPln(row.invoiced),'invoiced'],['Należność — testowa',formatPln(row.due),'due'],['Zmniejszenie (+) / zwiększenie (−)',formatPln(row.delta,true),'delta']];
    for(const [label,value,key] of values) {const td=document.createElement('td');td.dataset.label=label;td.dataset.field=key;td.textContent=value;if(key==='label'&&row.description){const small=document.createElement('span');small.textContent=row.description;td.append(small);}tr.append(td);}
    body.append(tr);
  }
  text('row-sum',formatPln(r.rowSum));text('rounding-residual',formatPln(r.residual,true));
  text('reconciliation-status',r.reconciled?'Kontrola sum: propozycje pozycji są równe należności łącznej. Kwoty nadal wymagają weryfikacji księgowej.':`Rozbieżność: ${formatPln(r.rowSum)} + (${formatPln(r.residual,true)}) = ${formatPln(g.due)}. Grosze wymagają uzgodnienia z rozliczeniami.`);
  const messages=$('messages');messages.replaceChildren();
  for(const code of r.warnings) if(warningCopy[code]) {const [message,kind]=warningCopy[code];const p=document.createElement('p');p.className=`message ${kind}`;p.textContent=message;messages.append(p);}
  $('summary').value=buildSummary(r);$('copy-summary').disabled=false;
  $('results').hidden=false; text('form-feedback','Obliczono. Wynik jest propozycją testową wymagającą kontroli.');
  $('result-heading').focus({preventScroll:true});$('results').scrollIntoView({behavior:'instant',block:'start'});
}
function changed(event) {
  if(event.target===$('example-select'))$('load-example').disabled=!event.target.value;
  if(event.target===$('month'))tbody.querySelectorAll('[data-invoice-confirm]').forEach(input=>{input.checked=false;});
  if(event.target===$('last-old-date')&&$('event-type').value==='WYPOWIEDZENIE')$('effective-date').value=nextDay(event.target.value);
  if(event.target.matches('[data-field="old"], [data-field="invoiced"], [data-field="service"], [data-invoice-override]'))event.target.closest('tr').querySelector('[data-invoice-confirm]').checked=false;
  if(event.target.matches('[data-field="old"], [data-invoice-override]'))syncInvoice(event.target.closest('tr'));
  if(event.target===$('event-type'))syncScenario();
  invalidate();
}
form.addEventListener('input',changed);
form.addEventListener('change',changed);
for (const button of document.querySelectorAll('[data-scenario]')) button.addEventListener('click',()=>{
  $('event-type').value=button.dataset.scenario;
  syncScenario();
  invalidate();
});
form.addEventListener('submit',event=>{
  event.preventDefault(); invalidate('Sprawdzam dane formularza.');
  try {
    const missing=[];
    if(!$('month').value)missing.push(['Miesiąc rozliczeniowy',$('month')]);
    const termination=$('event-type').value==='WYPOWIEDZENIE';
    if(termination&&!$('last-old-date').value)missing.push(['Ostatni dzień usługi',$('last-old-date')]);
    if(!termination&&!$('effective-date').value)missing.push(['data zmiany',$('effective-date')]);
    if(termination&&$('last-old-date').value&&!$('effective-date').value)missing.push(['Nie można wyliczyć następnego dnia — sprawdź ostatni dzień usługi',$('last-old-date')]);
    Array.from(tbody.rows).forEach((tr,index)=>{
      const prefix=`Pozycja ${index+1} — `;
      for(const [key,label] of [['old','Dotychczasowy abonament'],['new','Nowy abonament'],['invoiced','Kwota na fakturze']]) {
        const field=tr.querySelector(`[data-field="${key}"]`);
        if(!field.value.trim()&&!field.disabled)missing.push([prefix+label,field]);
      }
      const confirm=tr.querySelector('[data-invoice-confirm]');
      if(!confirm.checked)missing.push([prefix+'Sprawdź kwotę na fakturze i potwierdź',confirm]);
    });
    if(missing.length){
      const box=$('errors');const heading=document.createElement('strong');heading.textContent='Uzupełnij brakujące informacje';box.replaceChildren(heading);
      const list=document.createElement('ul');
      missing.forEach(([label,field],index)=>{const li=document.createElement('li'),button=document.createElement('button');li.id=`error-description-${index}`;button.type='button';button.className='missing-link';button.textContent=label;button.addEventListener('click',()=>field.focus());li.append(button);list.append(li);field.setAttribute('aria-invalid','true');field.setAttribute('aria-describedby',li.id);});
      box.append(list);box.hidden=false;box.focus();text('form-feedback','Uzupełnij wskazane pola i oblicz ponownie.');return;
    }
    render(evaluateDailyBasket(readForm()));
  } catch(error) {showError(error);}
});
$('add-position').addEventListener('click',()=>{invalidate();addRow();tbody.lastElementChild.querySelector('input').focus();});
tbody.addEventListener('click',event=>{const button=event.target.closest('[data-action="remove"]');if(!button)return;invalidate();button.closest('tr').remove();updateCount();if(tbody.rows.length)tbody.rows[0].querySelector('input').focus();else $('add-position').focus();});
$('load-example').addEventListener('click',()=>{
  if(!$('example-select').value)return;
  const data=example($('example-select').value);invalidate('Wczytano przykład testowy. Sprawdź datę i pełne ceny miesięczne, a następnie oblicz korektę.');
  $('event-type').value=data.type;$('month').value=data.month;$('effective-date').value=data.effectiveDate;$('last-old-date').value=data.lastOldDate;
  for(const id of ['multiple-dates','unresolved-discounts'])$(id).checked=false;
  tbody.replaceChildren();nextRowId=1;data.rows.forEach(row=>addRow({...row,confirmed:true}));syncScenario();datePreviews();(data.type==='WYPOWIEDZENIE'?$('last-old-date'):$('effective-date')).focus();
});
function resetCalculator() {
  HTMLFormElement.prototype.reset.call(form);$('month').value='';$('effective-date').value='';$('last-old-date').value='';
  $('example-select').value='';$('load-example').disabled=true;
  tbody.replaceChildren();nextRowId=1;addRow();syncScenario();invalidate('Formularz wyczyszczony. Wpisz dane lub wczytaj przykład testowy.');document.querySelector('[data-scenario][aria-pressed="true"]').focus();
  for(const details of document.querySelectorAll('main details'))details.open=false;
  $('messages').replaceChildren();$('calculation-steps').replaceChildren();
  $('invoice-plan').hidden=true;$('invoice-plan').querySelector('tbody').replaceChildren();$('line-results').tBodies[0].replaceChildren();
}
for(const id of ['reset','reset-result'])$(id).addEventListener('click',resetCalculator);
$('copy-summary').addEventListener('click',async()=>{
  const token=revision,summary=$('summary').value;
  if(!summary||$('copy-summary').disabled)return;
  try {
    if(!navigator.clipboard?.writeText)throw new Error('Brak dostępu do schowka');
    await navigator.clipboard.writeText(summary);
    if(token===revision)text('copy-feedback','Skopiowano robocze podsumowanie. Wymaga weryfikacji księgowej (D11).');
  } catch {
    if(token!==revision)return;
    $('summary').focus();$('summary').select();
    text('copy-feedback','Nie udało się użyć schowka. Zaznaczono podsumowanie — skopiuj je skrótem Ctrl+C (na Macu ⌘C).');
  }
});
addRow();
