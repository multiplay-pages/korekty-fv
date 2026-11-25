import { formatPln, formatDate, SERVICE_GROUPS } from './src/basket.mjs';
import { ACTIVE_DEMO_POLICY, evaluateCorrection, nextCalendarDay, summarizeGrossRows } from './src/billing-policy.mjs';
import { buildResultPresentation, copyResultPresentation } from './src/summary.mjs';
import { example } from './src/examples.mjs';

const $=id=>document.getElementById(id);
const form=$('calculator-form'),tbody=$('positions').tBodies[0];
let nextRowId=1, revision=0;
const text=(id,value)=>{$(id).textContent=value;};
const validMonth=value=>/^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const formatPeriod = value => value.split('-').reverse().join('.');
const moneyFields = ['old', 'new', 'invoiced'];
const polishMonth = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const currencyInput = /^(\d{1,15}|\d{1,3}([ \u00a0\u202f])\d{3}(?:\2\d{3})*)([.,]\d{1,2})?(?:[ \u00a0\u202f]?zł)?$/u;
const clientNotes = {
  CORRECTION: 'Zmiana abonamentu może wpłynąć na opłatę za wskazany miesiąc.',
  CONFIRMED: 'Po zmianie abonamentu przewidujemy zmniejszenie opłaty za wskazany miesiąc.',
  NO_CORRECTION: 'Opłata za wskazany okres pozostaje bez zmian.',
  NO_CORRECTION_EXPECTED: 'Za ten miesiąc nie przewidujemy korekty abonamentu.',
  NOT_APPLICABLE: 'Korekta nie dotyczy wskazanego miesiąca i faktury.',
  INVOICE_REQUIRED: 'Aby ustalić wynik, potrzebujemy kwoty abonamentu z faktury.',
  REVIEW: 'Szczegóły opłaty wymagają sprawdzenia.',
  REFER: 'Sprawę sprawdzi zespół rozliczeń.',
  ERROR: 'Do sprawdzenia opłaty potrzebne są poprawne dane.',
};

function normalizeMoney(input) {
  const value = input.trim();
  const match = currencyInput.exec(value);
  if (!value) return '';
  // Null represents an invalid entry; the resolver keeps its validation order and field errors.
  if (!match) return null;
  const integer = match[1].replace(/[ \u00a0\u202f]/gu, '');
  return integer.length <= 15 ? integer + (match[3] ?? '') : null;
}

function documentStateControl() {
  return form.querySelector('input[name="document-state"]:checked');
}

function setDocumentState(value) {
  form.querySelector('input[name="document-state"][value="' + value + '"]').checked = true;
}

function resultPill(label, tone) {
  const pill = document.createElement('span');
  pill.className = 'result-pill';
  pill.setAttribute('aria-hidden', 'true');
  pill.dataset.tone = tone;
  pill.textContent = label;
  return pill;
}

function clientNote(decision) {
  return 'Dla klienta: ' + clientNotes[decision];
}
const serviceOptions = Object.entries(SERVICE_GROUPS).map(([group, services]) => {
  const options = Object.entries(services).map(([key, label]) => `<option value="${key}">${label}</option>`).join('');
  return `<optgroup label="${group}">${options}</optgroup>`;
}).join('');
const problemFlags = ['multiple-dates', 'unresolved-discounts', 'non-comparable', 'components-changed', 'date-uncertain'];
let comparingTotals = false;
let monthEdited = false, aggregateDocumentState = 'UNKNOWN', linesDocumentState = 'UNKNOWN';

function readRows() {
  return Array.from(tbody.rows, tr => ({
    id: tr.dataset.rowId,
    ...Object.fromEntries(Array.from(tr.querySelectorAll('[data-field]'), el => [el.dataset.field, moneyFields.includes(el.dataset.field) ? normalizeMoney(el.value) : el.value.trim()])),
  }));
}

function updateGrossSums() {
  const sums = summarizeGrossRows(readRows());
  if (documentStateControl().value !== 'AMOUNT') sums.invoiced = null;
  for (const output of form.querySelectorAll('[data-basket-total]')) {
    const value = sums[output.dataset.basketTotal];
    output.textContent = value === null ? '—' : formatPln(value);
  }
}

function syncSource() {
  const lines = $('use-lines').checked;
  $('derived-overview').hidden = !lines;
  $('aggregate-invoice-field').hidden = lines && !comparingTotals;
  $('position-editor').hidden = !lines;
  $('declared-note').hidden = !lines;
  $('aggregate-values').hidden = lines && !comparingTotals;
  $('toggle-declared').setAttribute('aria-expanded', String(lines && comparingTotals));
  text('toggle-declared', comparingTotals ? 'Ukryj sumy wpisane do porównania' : 'Pokaż sumy wpisane do porównania');
  text('source-status', lines
    ? 'Źródło kalkulacji: pozycje BOK. Wcześniej wpisane sumy brutto służą do porównania.'
    : 'Źródło kalkulacji: kwoty całego koszyka. Wpisane pozycje pozostają zapisane w formularzu do końca sprawy.');
}

function syncDocumentFields() {
  const disabled = documentStateControl().value === 'NOT_ISSUED';
  $('basket-invoiced').disabled = disabled;
  for (const field of tbody.querySelectorAll('[data-field="invoiced"]')) field.disabled = disabled;
}

function proposedMonth() {
  return nextCalendarDay($('last-old-date').value).slice(0, 7);
}

function datePreviews() {
  const suggested = proposedMonth();
  const manual = monthEdited && suggested && $('month').value !== suggested;
  const restore = $('restore-month');
  if (!monthEdited) $('month').value = suggested;
  restore.hidden = !manual;
  restore.textContent = manual ? `Wróć do ${formatPeriod(suggested)}` : '';
  const month = $('month').value;
  const preview = validMonth(month) ? polishMonth.format(new Date(month + '-01T00:00:00Z')) : '';
  text('month-preview', manual ? preview + ' · Miesiąc zmieniono ręcznie.' : preview);
  const change = nextCalendarDay($('last-old-date').value);
  text('date-preview', change ? `Zmiana warunków od ${formatDate(change)}.` : '');
}

function updateConfirmation() {
  const checkbox = $('invoice-confirmed');
  const data = readForm();
  const month = validMonth(data.month) ? formatPeriod(data.month) : 'wybranego miesiąca';
  text('confirm-label', `Kwoty „Na fakturze” sprawdziłem w MMS dla ${month}.`);
  const confirmation = data.source === 'lines' ? evaluateCorrection(data).confirmation : { allowed: false, reason: '' };
  checkbox.disabled = !confirmation.allowed;
  if (!confirmation.allowed) checkbox.checked = false;
  text('confirmation-hint', confirmation.reason);
}

function invalidate(message='Dane zmienione — oblicz ponownie, aby otrzymać aktualny wynik.', clearConfirmation=true) {
  revision++;
  if (clearConfirmation) $('invoice-confirmed').checked = false;
  $('results').hidden = true;
  $('result-empty').hidden = false;
  $('copy-preview').open = false;
  $('result-heading').removeAttribute('data-result-state');
  $('summary').value = '';
  $('copy-summary').disabled = true;
  text('copy-scope', ''); text('copy-feedback', ''); text('form-feedback', message);
  $('errors').hidden = true; $('errors').replaceChildren();
  for (const el of form.querySelectorAll('[aria-invalid]')) {
    el.removeAttribute('aria-invalid');
    if (el.dataset.previousDescription) el.setAttribute('aria-describedby', el.dataset.previousDescription);
    else el.removeAttribute('aria-describedby');
    delete el.dataset.previousDescription;
  }
  datePreviews();
  syncDocumentFields();
  updateGrossSums();
  updateConfirmation();
}
function updateCount() { text('row-count',`${tbody.rows.length} ${tbody.rows.length===1?'pozycja':'pozycji'}`); $('add-position').disabled=tbody.rows.length>=50; }
function addRow(values={}) {
  if(tbody.rows.length>=50) return;
  const id=nextRowId++,tr=document.createElement('tr');
  tr.dataset.rowId = String(id);
  const fields=[
    ['Pozycja / usługa',`<select data-field="service" aria-label="Usługa pozycji ${id}">${serviceOptions}</select>`],
    ...[['old','Dotychczasowy abonament miesięczny'],['new','Nowy abonament miesięczny']].map(([key,label])=>[label,`<input data-field="${key}" inputmode="decimal" type="text" maxlength="64" aria-label="${label} pozycji ${id}" placeholder="0,00 zł" required>`]),
    ['Na fakturze',`<input data-field="invoiced" inputmode="decimal" type="text" maxlength="64" aria-label="Kwota na fakturze pozycji ${id}" placeholder="0,00 zł">`],
    ['Szczegóły',`<details class="row-meta"><summary>Dane pozycji</summary><label>Opcjonalna nazwa<input data-field="label" type="text" maxlength="160" aria-label="Nazwa pozycji ${id}" placeholder="Nazwa pozycji (opcjonalna)"></label><label>Podstawa<select data-field="basis" aria-label="Podstawa pozycji ${id}"><option value="gross">Brutto</option><option value="net">Netto</option></select></label><label>VAT (informacja)<select data-field="vat" aria-label="VAT pozycji ${id}"><option value="">Nieokreśl.</option><option value="23">23%</option><option value="8">8%</option><option value="5">5%</option><option value="0">0%</option><option value="zw">Zw.</option></select></label></details>`],
    ['',`<button type="button" class="remove-row" data-action="remove" aria-label="Usuń pozycję ${id}">×</button>`],
  ];
  for(const [label,markup] of fields) { const td=document.createElement('td'); td.dataset.label=label; td.innerHTML=markup; tr.append(td); }
  for(const input of tr.querySelectorAll('[data-field]')) {
    if(values[input.dataset.field]!==undefined) input.value=values[input.dataset.field];
  }
  tbody.append(tr); updateCount();
}
function readForm() {
  return {
    source: $('use-lines').checked ? 'lines' : 'aggregate',
    month: $('month').value,
    lastOldDate: $('last-old-date').value,
    totals: {
      old: normalizeMoney($('basket-old').value),
      new: normalizeMoney($('basket-new').value),
      invoiced: normalizeMoney($('basket-invoiced').value),
    },
    rows: readRows(),
    documentState: documentStateControl().value,
    invoiceConfirmed: $('invoice-confirmed').checked,
    basketVat: $('use-lines').checked ? $('basket-vat').value : '',
    scope: $('billing-scope').value,
    dateVerified: !$('date-uncertain').checked,
    multipleDates: $('multiple-dates').checked,
    unresolvedDiscounts: $('unresolved-discounts').checked,
    nonComparableScope: $('non-comparable').checked,
    componentsChanged: $('components-changed').checked,
  };
}

const fieldNames = {
  old: 'Dotychczasowy abonament', new: 'Nowy abonament', invoiced: 'Kwota na fakturze',
  basis: 'Podstawa kwoty', vat: 'Kategoria VAT',
};
const problemField = {
  DATE_NOT_VERIFIED: 'date-uncertain', INVALID_MONTH: 'month',
  INVALID_DATE: 'last-old-date', INCONSISTENT_DATES: 'last-old-date',
  END_DATE_REQUIRED: 'last-old-date', MULTIPLE_DATES: 'multiple-dates',
  UNRESOLVED_DISCOUNTS: 'unresolved-discounts', NON_COMPARABLE_SCOPE: 'non-comparable',
  COMPONENTS_CHANGED_SAME_TOTAL: 'components-changed',
};

function revealField(field) {
  if (!field) return;
  if (field.closest('#aggregate-values')) {
    comparingTotals = true;
    syncSource();
  }
  for (let details = field.closest('details'); details; details = details.parentElement.closest('details')) details.open = true;
}

function markField(field, description) {
  field.dataset.previousDescription = field.getAttribute('aria-describedby') ?? '';
  field.setAttribute('aria-invalid', 'true');
  field.setAttribute('aria-describedby', description);
}

function errorField(result) {
  const [group, index, key] = result.field?.split('.') ?? [];
  const rowField = group === 'rows' && index !== undefined
    ? tbody.rows[Number(index)]?.querySelector(`[data-field="${key}"]`) : null;
  return rowField ?? (group === 'totals' ? $(`basket-${index}`)
    : group === 'rows' ? $('use-lines')
    : group === 'lastOldDate' ? $('last-old-date')
    : group === 'basketVat' ? $('basket-vat')
    : group === 'documentState' ? documentStateControl()
    : $(problemField[result.code] ?? 'calculate'));
}

function renderErrorHeading(box, title) {
  const head = document.createElement('div');
  head.className = 'error-heading';
  head.append(resultPill('Błąd danych', 'error'), title);
  const client = document.createElement('p');
  client.className = 'section-copy';
  client.textContent = clientNote('ERROR');
  $('result-empty').hidden = true;
  box.replaceChildren(head, client);
}

function showError(result) {
  const box = $('errors'), title = document.createElement('h2');
  title.textContent = 'Błąd danych';
  title.dataset.resultState = 'ERROR';
  const description = document.createElement('p');
  description.id = 'error-description';
  const [group, index, key] = result.field?.split('.') ?? [];
  const field = errorField(result);
  const prefix = group === 'rows' && index !== undefined ? `Pozycja ${Number(index) + 1} — ${fieldNames[key] ?? 'dane pozycji'}: `
    : group === 'totals' ? `${fieldNames[index]}: ` : '';
  description.textContent = prefix + (result.code === 'INVALID_MONTH'
    ? 'Wybierz miesiąc i rok rozliczeniowy.' : result.calculationReason);
  renderErrorHeading(box, title);
  box.append(description);
  if (field && field !== $('calculate')) {
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'button quiet';
    jump.textContent = 'Przejdź do wskazanego pola';
    jump.addEventListener('click', () => { revealField(field); field.focus(); });
    markField(field, description.id);
    box.append(jump);
  }
  box.hidden = false;
  if (field && field !== $('calculate')) { revealField(field); field.focus(); }
  else box.focus();
  text('form-feedback', 'Sprawdź komunikat przed ponownym obliczeniem.');
}

function renderExplanation(explanation, parts) {
  const details = $('calculation-details');
  details.hidden = !explanation;
  details.open = false;
  if (!explanation) return;
  text('global-method', explanation.method);
  text('method-explanation', explanation.reason);
  text('calculation-steps', explanation.formula);
  text('formula-note', explanation.note);
  const [days, old, next] = explanation.days;
  text('days-month', days);
  text('days-old', old);
  text('days-new', next);
  const container = $('calculation-parts');
  container.replaceChildren();
  for (const part of parts) {
    const block = document.createElement('article');
    block.className = 'calculation-step';
    const heading = document.createElement('h4');
    heading.textContent = part.label;
    block.append(heading);
    for (const key of ['old', 'next', 'remainder']) {
      if (!part[key]) continue;
      const paragraph = document.createElement('p');
      paragraph.dataset.field = key;
      paragraph.textContent = part[key];
      block.append(paragraph);
    }
    container.append(block);
  }
}

function renderBreakdown(view) {
  const labels = { label: 'Pozycja', invoiced: 'Na fakturze', due: 'Należność', delta: 'Różnica (poglądowo)' };
  const body = $('line-results').tBodies[0];
  body.replaceChildren();
  $('bok-result').hidden = !view.rows.length;
  for (const row of view.rows) {
    const tr = body.insertRow();
    for (const [key, label] of Object.entries(labels)) {
      const td = tr.insertCell();
      td.dataset.label = label;
      td.dataset.field = key;
      td.textContent = row[key];
      if (key === 'delta' && row.note) {
        const note = document.createElement('small');
        note.textContent = row.note;
        td.append(note);
      }
    }
  }
  $('remainder-row').hidden = !view.remainder;
  text('rounding-residual', view.remainder);
}

function render(result) {
  const view = buildResultPresentation(result);
  const heading = $('result-heading');
  heading.dataset.resultState = result.decision;
  heading.dataset.dataStatus = result.dataStatus;
  heading.dataset.documentState = result.documentState;
  text('result-heading', view.title);
  const tone = result.dataStatus === 'CONFIRMED' && result.decision === 'CORRECTION' ? 'success'
    : ['REVIEW', 'REFER', 'INVOICE_REQUIRED'].includes(result.decision) ? 'caution' : 'info';
  $('result-pill').replaceWith(Object.assign(resultPill(view.title, tone), { id: 'result-pill' }));
  text('client-note', clientNote(tone === 'success' ? 'CONFIRMED' : result.decision));
  text('result-period', view.dateDetails);
  text('delta-explanation', view.message);
  text('invoiced-source', view.dataNote);
  text('delta', view.amount ?? '');
  $('result-main-amount').hidden = view.amount === null;

  const fields = $('result-fields');
  fields.replaceChildren();
  fields.hidden = !view.fields.length;
  for (const { id, label, value } of view.fields) {
    const group = document.createElement('div');
    const term = document.createElement('dt');
    const definition = document.createElement('dd');
    term.id = id === 'nominal-price' ? 'next-month-label' : `${id}-label`;
    term.textContent = id === 'due' && result.type === 'PODWYŻKA'
      ? 'Abonament za ' + polishMonth.format(new Date(result.month + '-01T00:00:00Z')) : label;
    if ((id === 'due' && result.decision === 'INVOICE_REQUIRED')
      || (id === 'result-invoiced' && result.decision === 'NO_CORRECTION')) group.classList.add('featured-amount');
    definition.id = id;
    definition.textContent = value;
    group.append(term, definition);
    fields.append(group);
  }

  const variants = $('document-variants');
  variants.replaceChildren();
  variants.hidden = !view.variants.length;
  for (const description of view.variants) {
    const item = document.createElement('li');
    item.textContent = description;
    variants.append(item);
  }
  renderExplanation(view.explanation, view.parts);
  renderBreakdown(view);

  const list = $('scenario-warnings');
  const warnings = new Set(view.warnings.map(([message]) => message)
    .filter(message => !message.endsWith('(D05).') && !message.endsWith('(D11).')));
  list.replaceChildren(...Array.from(warnings, message => {
    const item = document.createElement('li');
    item.textContent = message;
    return item;
  }));
  $('warning-details').hidden = !list.childElementCount;
  $('warning-details').open = false;
  $('summary').value = copyResultPresentation(view);
  $('copy-summary').disabled = !view.copyAllowed;
  text('copy-scope', view.rows.length && !view.copyRows ? 'Kopia obejmuje wynik koszyka. Pozycje będą dostępne po potwierdzeniu danych.' : '');
  $('results').hidden = false;
  $('result-empty').hidden = true;
  text('form-feedback', '');
  const rect = heading.getBoundingClientRect();
  const headingVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
  if (result.decision === 'INVOICE_REQUIRED') {
    documentStateControl().focus({ preventScroll: headingVisible });
  } else {
    heading.focus({ preventScroll: true });
    if (!headingVisible) heading.scrollIntoView({ block: 'center' });
  }
}

function saveDocumentState() {
  if ($('use-lines').checked) linesDocumentState = documentStateControl().value;
  else aggregateDocumentState = documentStateControl().value;
}

function changed(event) {
  const target = event.target;
  if (target === $('training-mode')) {
    $('training-examples').hidden = !target.checked;
    return;
  }
  if (target === $('example-select')) {
    $('load-example').disabled = !target.value;
    return;
  }
  if (target === $('month')) monthEdited = true;
  if (target === $('use-lines')) {
    if (target.checked && !tbody.rows.length) addRow();
    if (!target.checked) comparingTotals = false;
    setDocumentState(target.checked ? linesDocumentState : aggregateDocumentState);
    syncSource();
  }
  if (target.matches('#basket-invoiced, [data-field="invoiced"]') && target.value.trim()) setDocumentState('AMOUNT');
  saveDocumentState();
  invalidate(undefined, target !== $('invoice-confirmed'));
}
form.addEventListener('input', changed);
$('restore-month').addEventListener('click', () => {
  monthEdited = false;
  invalidate();
  $('month').focus();
});

function missingFields(data) {
  const missing = [];
  if (!data.month) missing.push(['Miesiąc i rok rozliczeniowy', $('month')]);
  if (!data.lastOldDate) missing.push(['Ostatni dzień starych warunków', $('last-old-date')]);

  if (data.source === 'aggregate') {
    const required = data.documentState === 'AMOUNT' ? moneyFields : ['old', 'new'];
    for (const key of required) {
      if (data.totals[key] === '') missing.push([fieldNames[key], $(`basket-${key}`)]);
    }
  } else {
    Array.from(tbody.rows).forEach((tr, index) => {
      const prefix = `Pozycja ${index + 1} — `;
      for (const key of ['old', 'new']) {
        const field = tr.querySelector(`[data-field="${key}"]`);
        if (!field.value.trim() && !field.disabled) missing.push([prefix + fieldNames[key], field]);
      }
    });
  }
  return missing;
}

function showMissing(fields) {
  const box = $('errors'), heading = document.createElement('h2');
  heading.textContent = 'Błąd danych — uzupełnij brakujące informacje';
  heading.dataset.resultState = 'ERROR';
  const list = document.createElement('ul');
  fields.forEach(([label, field], index) => {
    const item = document.createElement('li'), button = document.createElement('button');
    item.id = `error-description-${index}`;
    button.type = 'button';
    button.className = 'missing-link';
    button.textContent = label;
    button.addEventListener('click', () => { revealField(field); field.focus(); });
    item.append(button);
    list.append(item);
    markField(field, item.id);
  });
  renderErrorHeading(box, heading);
  box.append(list);
  box.hidden = false;
  revealField(fields[0][1]);
  fields[0][1].focus();
  text('form-feedback', 'Uzupełnij wskazane pola i oblicz ponownie.');
}

form.addEventListener('submit', event => {
  event.preventDefault();
  invalidate('Sprawdzam dane formularza.', false);
  const data = readForm();
  const result = evaluateCorrection(data);
  if (result.decision === 'ERROR') {
    const first = errorField(result);
    const missing = missingFields(data);
    if (missing.some(([,field]) => field === first)) showMissing(missing);
    else showError(result);
    return;
  }
  render(result);
});

$('toggle-declared').addEventListener('click', () => {
  comparingTotals = !comparingTotals;
  syncSource();
});
function appendPosition(field) {
  addRow();
  invalidate();
  tbody.lastElementChild.querySelector(field).focus();
}

$('add-position').addEventListener('click', () => appendPosition('input'));
tbody.addEventListener('keydown', event => {
  const field = event.target;
  if (event.key !== 'Enter' || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
    || !field.matches('input[data-field]')) return;
  event.preventDefault();
  const lastMoney = tbody.lastElementChild?.querySelectorAll('input[inputmode="decimal"]:not(:disabled)');
  if (field !== lastMoney?.[lastMoney.length - 1] || $('add-position').disabled) return;
  appendPosition('[data-field="service"]');
});
tbody.addEventListener('click', event => {
  const button = event.target.closest('[data-action="remove"]');
  if (!button) return;
  const row = button.closest('tr');
  (row.nextElementSibling ?? row.previousElementSibling)?.querySelector('input').focus();
  if (tbody.rows.length === 1) $('add-position').focus();
  row.remove();
  updateCount();
  invalidate();
});

function clearBasket() {
  for (const id of [...problemFlags, 'use-lines', 'invoice-confirmed']) $(id).checked = false;
  $('basket-vat').value = '';
  $('billing-scope').value = 'B2C';
  setDocumentState('UNKNOWN');
  aggregateDocumentState = 'UNKNOWN';
  linesDocumentState = 'UNKNOWN';
  monthEdited = false;
  for (const key of moneyFields) {
    const input = $(`basket-${key}`);
    input.value = '';
    input.readOnly = false;
    input.disabled = false;
  }
  comparingTotals = false;
  tbody.replaceChildren();
  nextRowId = 1;
  updateCount();
  for (const details of document.querySelectorAll('main details')) details.open = false;
}

$('load-example').addEventListener('click', () => {
  const data = example($('example-select').value);
  if (!data || !$('training-mode').checked) return;
  clearBasket();
  $('month').value = data.month;
  $('last-old-date').value = data.lastOldDate;
  monthEdited = data.month !== proposedMonth();
  if (data.rows.length > 1) {
    $('use-lines').checked = true;
    $('bok-details').open = true;
    for (const row of data.rows) addRow(row);
    setDocumentState('AMOUNT');
  } else {
    const { old, new: next, invoiced } = data.rows[0];
    $('basket-old').value = old;
    $('basket-new').value = next;
    if (invoiced !== old) {
      $('basket-invoiced').value = invoiced;
      setDocumentState('AMOUNT');
    }
  }
  saveDocumentState();
  syncSource();
  invalidate('Wczytano przykład testowy. Sprawdź dane i oblicz korektę.');
  $('last-old-date').focus();
});

function resetCalculator() {
  HTMLFormElement.prototype.reset.call(form);
  clearBasket();
  $('load-example').disabled = true;
  $('training-examples').hidden = true;
  syncSource();
  invalidate('Formularz wyczyszczony.');
  $('scenario-warnings').replaceChildren();
  $('warning-details').hidden = true;
  $('calculation-steps').replaceChildren();
  $('line-results').tBodies[0].replaceChildren();
  $('last-old-date').focus();
}
$('reset').addEventListener('click', resetCalculator);
$('copy-summary').addEventListener('click',async()=>{
  const token=revision,summary=$('summary').value;
  if(!summary||$('copy-summary').disabled)return;
  try {
    if(!navigator.clipboard?.writeText)throw new Error('Brak dostępu do schowka');
    await navigator.clipboard.writeText(summary);
    if(token===revision)text('copy-feedback','Skopiowano robocze podsumowanie. Wymaga weryfikacji księgowej (D11).');
  } catch {
    if(token!==revision)return;
    $('copy-preview').open = true;
    $('summary').focus();$('summary').select();
    text('copy-feedback','Nie udało się użyć schowka. Zaznaczono podsumowanie — skopiuj je skrótem Ctrl+C (na Macu ⌘C).');
  }
});
text('policy-version', ACTIVE_DEMO_POLICY.version);
syncSource();
datePreviews();
syncDocumentFields();
