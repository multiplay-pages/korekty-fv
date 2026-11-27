import { SERVICES, formatPln, formatDate } from './basket.mjs';

/** Etykieta sposobu naliczenia (reguła CB-2026-11-25). */
export function billingLabel(mode) {
  return ({
    C: 'Reguła CB — miesiąc 28/29/30-dniowy: (stara cena × dni + nowa cena × dni) ÷ 30',
    B: 'Reguła CB — miesiąc 31-dniowy: stara cena + (nowa − stara) × dni nowej ceny ÷ 30',
    'Pełna O': 'Pełny dotychczasowy abonament', 'Pełna N': 'Pełny nowy abonament',
  })[mode] ?? 'Pełny miesiąc';
}

const policyWarnings = {
  D05_CONTRACT_GATE_OPEN: ['Sprawdź podstawę umowną i skuteczną datę na podstawie dokumentów (D05).', 'warning'],
  D11_ACCOUNTING_GATE_OPEN: ['Weryfikacja księgowa · VAT, sposób zapisu korekty i zaokrąglenia wymagają potwierdzenia (D11).', 'warning'],
  INVOICE_DIFFERS_FROM_OLD: ['Kwota na fakturze różni się od dotychczasowego abonamentu. Sprawdź okres oraz zakres opłat.', 'warning'],
  ADDITIONAL_AMOUNT_REVIEW: ['Należność przekracza kwotę na fakturze. Dodatkowe naliczenie wymaga weryfikacji.', 'escalation'],
  ZERO_FOR_ONE_SERVICE_DAY: ['Wynik 0,00 zł za jeden dzień usługi w miesiącu 31-dniowym wynika z zastosowanego wariantu B.', 'info'],
  UNALLOCATED_ROUNDING: ['Sprawdź reszty groszowe między częściami, wierszami i wynikiem koszyka. Wymagają uzgodnienia.', 'warning'],
  LINE_INCREASE_REVIEW: ['Co najmniej jedna pozycja ma wyższą należność niż na fakturze. Wymaga to kontroli.', 'warning'],
  NEGATIVE_LINE_PROPOSAL: ['Ujemna należność pozycji wymaga indywidualnej kontroli rozliczeń.', 'escalation'],
  OPPOSING_LINE_CHANGES: ['Ceny pozycji zmieniają się w różnych kierunkach. Sprawdź szczegóły korekty z rozliczeniami (D23).', 'warning'],
  VAT_UNKNOWN: ['Kategoria VAT co najmniej jednej pozycji wymaga potwierdzenia.', 'warning'],
  MIXED_VAT_GROSS_ONLY: ['Pozycje mają różne stawki VAT. Wynik i rozbicie są poglądowe w kwotach brutto; wartości netto/VAT i zapis korekty w MMS czekają na decyzję D11 — nie przepisuj ich do MMS.', 'warning'],
  AGGREGATE_TAX_REVIEW: ['VAT lub podstawa pozycji wymaga weryfikacji. Wynik poglądowy opiera się na niezależnie potwierdzonych sumach brutto.', 'escalation'],
};

export function correctionWarnings(result) {
  return result.warnings.map(code => policyWarnings[code]).filter(Boolean);
}

const decisionTitles = {
  NO_CORRECTION_EXPECTED: 'Nie przewidujemy korekty', NO_CORRECTION: 'Bez korekty',
  NOT_APPLICABLE: 'Korekta nie dotyczy', INVOICE_REQUIRED: 'Kwota z faktury wymagana',
  REVIEW: 'Weryfikacja', REFER: 'Przekaż do rozliczeń', ERROR: 'Błąd danych',
};
const confirmationWarning = 'Potwierdzenie danych nie zatwierdza metody księgowej. Nie przepisuj pozycji do MMS jako wartości księgowych do czasu decyzji D11.';

// Prezentacja korekty: należność − F (zmniejszenie faktury ze znakiem minus). Wewnętrznie wynik pozostaje F − należność.
const presented = value => value.startsWith('-') ? value.slice(1) : value === '0.00' ? value : `-${value}`;
const vatLabel = vat => vat === 'zw' ? 'zw.' : `${vat}%`;

function explainCalculation(result) {
  const { appliedMethod, daysOld, daysNew, oldMonthlyAmount, newMonthlyAmount, amountDue } = result;
  const old = formatPln(oldMonthlyAmount).replace(/ zł$/, '');
  const next = formatPln(newMonthlyAmount).replace(/ zł$/, '');
  const total = formatPln(amountDue);
  if (appliedMethod === 'C') return `Miesiąc ${result.daysInMonth}-dniowy (reguła CB): (${old} × ${daysOld} + ${next} × ${daysNew}) ÷ 30 = ${total} po zaokrągleniu.`;
  if (appliedMethod === 'B') return `Miesiąc 31-dniowy (reguła CB): ${old} + (${next} − ${old}) × ${daysNew}/30 = ${total} po zaokrągleniu.`;
  return `${appliedMethod === 'Pełna O' ? 'Pełny dotychczasowy abonament' : 'Pełny nowy abonament'}: ${total}.`;
}

/** Sformatowane pola i pozycje są używane na ekranie i w kopii. */
export function buildResultPresentation(result) {
  const { decision, dataStatus, documentState, month, effectiveDate, lastOldDate } = result;
  const confirmed = dataStatus === 'CONFIRMED';
  const correction = decision === 'CORRECTION';
  const noCorrection = decision === 'NO_CORRECTION';
  const period = value => value?.slice(0, 7).split('-').reverse().join('.');
  const isIncrease = result.type === 'PODWYŻKA';
  const increaseInChange = isIncrease && result.monthRelation === 'CHANGE';
  const title = correction ? confirmed ? 'Faktura potwierdzona' : 'Szacunek' : decisionTitles[decision];
  const reviewWithoutAmounts = decision === 'REFER' || (decision === 'REVIEW' && result.amountDue === null);
  const amount = correction ? formatPln(presented(result.correctionAmount), true) : null;
  const fields = [];
  const addField = (id, label, value) => fields.push({ id, label, value });
  const hasInvoice = result.invoicedAmount !== null;
  const dateDetails = month ? `Miesiąc: ${period(month)}. Zmiana od ${formatDate(effectiveDate)}.${lastOldDate ? ` Ostatni dzień starych warunków: ${formatDate(lastOldDate)}.` : ''}` : '';
  const dataNote = dataStatus === 'ASSUMED' ? `Założono kwotę faktury równą dotychczasowemu abonamentowi (${formatPln(result.oldMonthlyAmount)}). Wynik poglądowy.`
    : dataStatus === 'ENTERED' ? 'Kwota faktury wpisana, niepotwierdzona. Wynik poglądowy.'
    : decision === 'NO_CORRECTION_EXPECTED' ? `Poglądowo przyjęto fakturowanie z góry według dotychczasowego abonamentu (${formatPln(result.oldMonthlyAmount)}).`
    : noCorrection && documentState === 'UNKNOWN' ? 'Kwota faktury nieznana. Wynik dotyczy wyłącznie zmiany abonamentu.' : '';
  if (result.amountDue !== null && !increaseInChange && !reviewWithoutAmounts) {
    addField('due', isIncrease ? 'Abonament za miesiąc' : 'Należność za miesiąc', formatPln(result.amountDue));
  }
  // Podwyżka w miesiącu zmiany: cena umowna za ten miesiąc to osobna informacja od kwoty faktury i od abonamentu w kolejnych miesiącach.
  if (increaseInChange && result.contractPrice && !reviewWithoutAmounts) {
    addField('contract-price', `Cena umowna za ${period(month)}`, formatPln(result.contractPrice));
  }
  if (hasInvoice && dataStatus !== 'ASSUMED' && !reviewWithoutAmounts) {
    addField('result-invoiced', increaseInChange && noCorrection ? 'Faktura pozostaje' : 'Kwota na fakturze', formatPln(result.invoicedAmount));
  }
  if (increaseInChange && !reviewWithoutAmounts && result.effectiveBillingDate) {
    addField('nominal-price', `Abonament od ${formatDate(result.effectiveBillingDate)}`, formatPln(result.newMonthlyAmount));
  } else if (result.nextMonth && result.nextMonthAmount && result.newMonthlyAmount !== '0.00' && !reviewWithoutAmounts && decision !== 'REVIEW') {
    addField('nominal-price', `Pełny abonament · ${period(result.nextMonth)}`, formatPln(result.nextMonthAmount));
  }
  if (result.newMonthlyAmount === '0.00' && result.oldMonthlyAmount !== '0.00' && !reviewWithoutAmounts) {
    addField('billing-start', 'Brak opłaty od', formatDate(result.effectiveBillingDate));
  } else if (isIncrease && !increaseInChange && !reviewWithoutAmounts && result.effectiveBillingDate) {
    addField('billing-start', 'Wyższy abonament od', formatDate(result.effectiveBillingDate));
  }
  const showCalculation = !increaseInChange && !reviewWithoutAmounts && result.amountDue !== null;
  if (showCalculation && correction) {
    addField('old-price', 'Dotychczasowy abonament', formatPln(result.oldMonthlyAmount));
    if (result.newMonthlyAmount !== '0.00') addField('new-price', 'Nowy abonament', formatPln(result.newMonthlyAmount));
  }
  const explanation = showCalculation ? {
    method: billingLabel(result.appliedMethod), reason: result.formulaReason,
    days: [result.daysInMonth, result.daysOld, result.daysNew],
    formula: explainCalculation(result),
    note: `Podstawa obliczenia części miesiąca to 30 jednostek. Dni kalendarzowe podano osobno. Polityka ${result.policyVersion} · TEST_ONLY.`,
  } : null;
  const rows = result.lineBreakdown.map(row => ({
    label: `${row.number}. ${SERVICES[row.service]}${row.vat ? ` · VAT ${vatLabel(row.vat)}` : ''}`,
    invoiced: formatPln(row.invoiced), due: formatPln(row.due), delta: formatPln(presented(row.delta), true),
    note: row.delta.startsWith('-') ? 'Należność pozycji wyższa niż kwota na fakturze (poglądowo).'
      : row.delta === '0.00' ? '' : 'Zmniejszenie (poglądowo).',
  }));
  const calendarPeriod = value => value ? ` (${formatDate(value.from)} – ${formatDate(value.to)})` : '';
  const parts = result.parts?.rows.map((row, index) => ({
    label: rows[index].label,
    old: `Część dotychczasowego abonamentu: ${formatPln(row.oldCharge)}${calendarPeriod(row.oldPeriod)}.`,
    next: `Część nowego abonamentu: ${formatPln(row.newCharge)}${calendarPeriod(row.newPeriod)}.`,
    remainder: row.partResidual === '0.00' ? '' : `Reszta zaokrąglenia części pozycji: ${formatPln(row.partResidual,true)}.`,
  })) ?? [];
  const remainder = result.correctionRemainder && result.correctionRemainder !== '0.00'
    ? `Reszta korekty koszyka ${formatPln(presented(result.correctionRemainder), true)} do uzgodnienia.` : '';
  // Uzgodnienie groszowe trybu pozycji: dwie osobne reszty, bez automatycznej alokacji (D11 otwarte).
  const reconciliation = result.rowsDueTotal ? [
    `Należność koszyka: ${formatPln(result.amountDue)}`,
    `Suma należności pozycji: ${formatPln(result.rowsDueTotal)}`,
    result.dueRemainder === '0.00' ? 'Reszta należności koszyka 0,00 zł.'
      : `Reszta należności koszyka ${formatPln(result.dueRemainder, true)} do uzgodnienia.`,
    ...(result.correctionRemainder === '0.00' ? ['Reszta korekty koszyka 0,00 zł.'] : []),
  ] : [];
  const warnings = correctionWarnings(result);
  if (confirmed) warnings.push([confirmationWarning, 'warning']);
  const hasZeroVariant = result.variants.some(variant => variant.amount === '0.00');
  const variantLabel = {
    OLD: 'Wystawiona według dotychczasowego abonamentu', NEW: 'Wystawiona według nowego abonamentu',
    NOT_ISSUED: 'Nie wystawiono', OTHER: hasZeroVariant ? 'Inna kwota' : 'Inna kwota (w tym 0,00 zł)',
  };
  const variants = result.variants.map(variant => {
    const value = variant.amount !== undefined ? ` (${formatPln(variant.amount)})` : '';
    const action = variant.key === 'OTHER' ? variant.decision === 'REVIEW' ? 'wpisz kwotę do weryfikacji' : 'wpisz kwotę'
      : variant.correctionAmount ? `korekta ${formatPln(presented(variant.correctionAmount), true)}` : decisionTitles[variant.decision].toLowerCase();
    return `${variantLabel[variant.key]}${value} → ${action}.`;
  });
  return {
    decision, title, amount, message: correction ? '' : result.calculationReason, dateDetails, dataNote, fields, explanation, rows, parts, remainder, reconciliation, warnings, variants,
    copyAllowed: decision !== 'ERROR', copyRows: confirmed,
    status: result.status, accountingAllowed: result.accountingAllowed,
  };
}

export function copyResultPresentation(view) {
  if (!view.copyAllowed) return '';
  const { explanation } = view;
  const [days, old, next] = explanation?.days ?? [];
  return [
    'MULTIPLAY BOK/SUD — PODSUMOWANIE POGLĄDOWE · TEST_ONLY',
    view.title, view.amount && `Korekta faktury: ${view.amount} (zmniejszenie)`, view.message, view.dateDetails, view.dataNote,
    ...view.fields.map(({label, value}) => `${label}: ${value}`),
    ...view.variants,
    ...(view.copyRows && view.rows.length ? [
      'Pozycja · Na fakturze · Należność · Korekta (poglądowo)',
      ...view.rows.map(row => [row.label, row.invoiced, row.due, row.delta, row.note].filter(Boolean).join(' · ')),
      ...view.reconciliation,
      view.remainder,
    ] : []),
    ...(explanation ? [explanation.method, explanation.reason,
      `Dni miesiąca: ${days}. Dni starej ceny: ${old}. Dni nowej ceny: ${next}.`, explanation.formula, explanation.note] : []),
    ...(view.copyRows ? view.parts.map(({label, old, next, remainder}) => [label, old, next, remainder].filter(Boolean).join(' ')) : []),
    ...view.warnings.map(([message]) => message),
  ].filter(Boolean).join('\n');
}
