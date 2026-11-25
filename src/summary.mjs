import { SERVICES, formatPln, formatDate } from './basket.mjs';
import { buildInvoicePlan } from './invoice-plan.mjs';
import { DAILY_RULE, billingLabel, buildDailySummary } from './daily-proration.mjs';

/** Wolne opisy/identyfikatory celowo nie są kopiowane — mogą zawierać dane klienta. */
export function buildSummary(result) {
  if(result.rule===DAILY_RULE)return buildDailySummary(result);
  const r=result,g=r.global;
  const text=[
    'MULTIPLAY BOK — PROPOZYCJA TESTOWA',
    'Wymaga weryfikacji księgowej. D11 pozostaje OTWARTE. Nie jest instrukcją księgowania.',
    `Okres: ${r.month.split('-').reverse().join('.')}; T: ${formatDate(r.effectiveDate)}${r.lastOldDate?`; E: ${formatDate(r.lastOldDate)}`:''}.`,
    `Datę zmiany wprowadził użytkownik; kalkulator nie ustala skuteczności oświadczenia.`,
    `Dni miesiąca: ${g.daysInMonth}; stare warunki: ${g.daysOld}; nowe warunki: ${g.daysNew}.`,
    `Sposób naliczenia: ${billingLabel(g.method)}.`,
    `Dotychczasowy abonament miesięczny: ${formatPln(r.totals.old)}; nowy miesięczny: ${formatPln(r.totals.new)}; już naliczono na fakturze: ${formatPln(r.totals.invoiced)}.`,
    `Należność za miesiąc: ${formatPln(g.due)}. Różnica F − należność: ${formatPln(g.delta,true)}.`,
    'Dla różnicy F − należność: plus oznacza zmniejszenie naliczenia, minus dodatkową należność do weryfikacji. Różnica nie jest kwotą zwrotu.',
    '', 'POZYCJE — PROPOZYCJA TESTOWA, D11 OTWARTE',
    ...r.rows.map(row=>`Pozycja ${row.number} (${SERVICES[row.service]}): O ${formatPln(row.old)}; N ${formatPln(row.new)}; F ${formatPln(row.invoiced)}; metoda ${row.method}; należność ${formatPln(row.due)}; różnica ${formatPln(row.delta,true)}; VAT: ${row.vat||'nieokreślony'} (informacyjnie).`),
    `Suma propozycji: ${formatPln(r.rowSum)}; suma różnic pozycji: ${formatPln(r.rowDeltaSum,true)}.`,
    `Reszta nieprzypisana do pozycji: ${formatPln(r.residual,true)}. Polityka groszy i VAT wymaga D11.`,
    `Kontrola: suma pozycji + reszta = należność koszyka. ${r.reconciled?'Brak rozbieżności groszowej.':'Suma samych pozycji różni się od koszyka — nie przepisywać bez uzgodnienia.'}`,
  ];
  if(g.method==='A'||g.method==='B'||g.method==='A=B') text.splice(6,0,'Porównanie A/B wykonano na całym koszyku przed zaokrągleniem; ten sam wybrany wariant zastosowano do wszystkich pozycji.');
  // W kopii najpierw konkretne kwoty do korekty, a niżej pomocnicza kontrola wzorów.
  const calculationDetails=text.splice(4);
  const plan=buildInvoicePlan(result);
  text.push('', 'STARY I NOWY ABONAMENT — ROBOCZE KWOTY DO KOREKTY');
  if(!plan.available) {
    text.push('Rozbicie starej i nowej części do uzgodnienia (D11): składniki zmieniły się przy stałej sumie koszyka. Nie wybrano samodzielnie nowej metody.');
  } else {
    const period=range=>range?`${formatDate(range.from)}–${formatDate(range.to)}`:'brak naliczenia w tym miesiącu';
    const oldChange=value=>value==='0.00'?'Stara pozycja bez zmiany.':`${value.startsWith('-')?'Zmniejsz':'Zwiększ'} starą pozycję o ${formatPln(value.replace(/^-/,''))}.`;
    const documentChange=value=>value==='0.00'?'Faktura bez zmiany.':`${value.startsWith('-')?'Zmniejszenie':'Zwiększenie'} faktury o ${formatPln(value.replace(/^-/,''))}.`;
    for(const row of plan.rows) text.push(
      `Pozycja ${row.number} (${SERVICES[row.service]}): stary abonament z ${formatPln(row.invoiced)} na ${formatPln(row.oldCharge)} (${period(row.oldPeriod)}). ${oldChange(row.oldAdjustment)}`,
      `${row.newPeriod?(plan.fullMonthlyPolicy?'Nowy abonament za cały miesiąc':'Nowy abonament cząstkowy'):'Brak nowej opłaty w tym miesiącu'}: ${formatPln(row.newCharge)} (${period(row.newPeriod)}). Razem części: ${formatPln(row.partsTotal)}. ${documentChange(row.documentChange)}`,
      ...(row.newPeriod&&row.newCharge==='0.00'&&row.newNumerator!=='0'?['Nowa część wynosi 0,00 zł po testowym zaokrągleniu; zachowano jej okres, a reszta wymaga uzgodnienia.']:[]),
      `Reszta między częściami a należnością pozycji: ${formatPln(row.partResidual,true)} — nieprzypisana, D11 otwarte.`,
    );
    text.push(`Suma starych i nowych części: ${formatPln(plan.partsTotal)}; reszta podziału do wyniku koszyka: ${formatPln(plan.totalResidual,true)}.`);
    if(plan.adjustedModel) text.push(`Daty i dni kalendarzowe nie są współczynnikami modelu: stara część ${plan.oldUnits}/30, nowa ${plan.newUnits}/30. Uwzględniono wyrównanie przyjętej metody 1/30 dla miesiąca ${g.daysInMonth}-dniowego.`);
    if(plan.needsRoundingReview) text.push('KONTROLA: reszty wierszy i koszyka wymagają uzgodnienia nawet wtedy, gdy końcowa suma części jest zgodna.');
    if(plan.higherPriceStart) text.push(`Wyższa cena obowiązuje według przyjętej zasady od ${formatDate(plan.higherPriceStart)}. ${result.effectiveDate.startsWith(result.month)&&g.method==='Pełna O'?'Podwyżka w trakcie miesiąca: pozostaje stara cena za miesiąc, bez cząstkowej dopłaty.':!result.effectiveDate.startsWith(result.month)?'Data zmiany leży poza analizowanym miesiącem.':''}`.trim());
  }
  text.push('',...calculationDetails);
  if(r.warnings.includes('COMPONENTS_CHANGED_SAME_TOTAL')) text.push('UWAGA: składniki zmienione przy stałej sumie. Pełna O jest jedynie prezentacją testową; przesunięcia między pozycjami wymagają D11.');
  if(r.warnings.includes('ZERO_FOR_ONE_SERVICE_DAY')) text.push('Informacja: 0 zł za jedyny dzień świadczenia w miesiącu 31-dniowym wynika z biznesowo przyjętej metody B.');
  if(r.warnings.includes('INVOICE_DIFFERS_FROM_OLD')) text.push('Kontrola: faktura F różni się od starego abonamentu O (D12).');
  if(r.warnings.includes('LINE_INCREASE_REVIEW')) text.push('Kontrola: występuje ujemna różnica pozycji — sprawdzić zwiększenie naliczenia i możliwości MMS.');
  if(r.warnings.includes('NEGATIVE_LINE_PROPOSAL')) text.push('Eskalacja: ujemna propozycja należności pozycji wymaga indywidualnej analizy księgowej.');
  text.push('Otwarte: D05 podstawa umowna; D11 VAT, grosze i księgowanie; D18/D19/D22 przed produkcją.',`Algorytm: ${g.algorithmVersion}; ekran: etap 2, 13.11.2026.`,'Etykiety własne i opisy pominięto w kopii dla ochrony danych.');
  return text.join('\n');
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
  AGGREGATE_TAX_REVIEW: ['VAT lub podstawa pozycji wymaga weryfikacji. Wynik poglądowy opiera się na niezależnie potwierdzonych sumach brutto.', 'escalation'],
};

export function correctionWarnings(result) {
  return result.warnings.map(code => policyWarnings[code]).filter(Boolean);
}

export function invoiceAssumption(result) {
  if (result.invoiceAssumed) return 'Przyjęto dotychczasowy abonament. Różnica jest orientacyjna.';
  if (result.assumedInvoiceRows) {
    return `W ${result.assumedInvoiceRows} z ${result.rows.length} pozycji przyjęto dotychczasowy abonament jako kwotę faktury.`;
  }
  return '';
}

const decisionTitles = {
  NO_CORRECTION_EXPECTED: 'Nie przewidujemy korekty', NO_CORRECTION: 'Bez korekty',
  NOT_APPLICABLE: 'Korekta nie dotyczy', INVOICE_REQUIRED: 'Kwota z faktury wymagana',
  REVIEW: 'Weryfikacja', REFER: 'Przekaż do rozliczeń', ERROR: 'Błąd danych',
};
const confirmationWarning = 'Potwierdzenie danych nie zatwierdza metody księgowej. Nie przepisuj pozycji do MMS jako wartości księgowych do czasu decyzji D11.';

function explainCalculation(result) {
  const { appliedMethod, daysOld, daysNew, oldMonthlyAmount, newMonthlyAmount, amountDue } = result;
  const old = formatPln(oldMonthlyAmount).replace(/ zł$/, '');
  const next = formatPln(newMonthlyAmount).replace(/ zł$/, '');
  const total = formatPln(amountDue);
  if (appliedMethod === 'B') return `Metoda B: ${old} + (${next} − ${old}) × ${daysNew}/30 = ${total} po zaokrągleniu.`;
  if (appliedMethod === 'A' || appliedMethod === 'A=B') {
    return `Metoda ${appliedMethod}: ${next} + (${old} − ${next}) × ${daysOld}/30 = ${total} po zaokrągleniu.`;
  }
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
  const amount = correction ? formatPln(result.correctionAmount, true) : null;
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
    label: `${row.number}. ${SERVICES[row.service]}`,
    invoiced: formatPln(row.invoiced), due: formatPln(row.due), delta: formatPln(row.delta, true),
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
    ? `Reszta korekty koszyka ${formatPln(result.correctionRemainder, true)} do uzgodnienia.` : '';
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
      : variant.correctionAmount ? `zmniejszenie ${formatPln(variant.correctionAmount)}` : decisionTitles[variant.decision].toLowerCase();
    return `${variantLabel[variant.key]}${value} → ${action}.`;
  });
  return {
    decision, title, amount, message: correction ? '' : result.calculationReason, dateDetails, dataNote, fields, explanation, rows, parts, remainder, warnings, variants,
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
    view.title, view.amount && `${view.amount} — zmniejszenie`, view.message, view.dateDetails, view.dataNote,
    ...view.fields.map(({label, value}) => `${label}: ${value}`),
    ...view.variants,
    ...(view.copyRows && view.rows.length ? [
      'Pozycja · Na fakturze · Należność · Różnica (poglądowo)',
      ...view.rows.map(row => [row.label, row.invoiced, row.due, row.delta, row.note].filter(Boolean).join(' · ')),
      view.remainder,
    ] : []),
    ...(explanation ? [explanation.method, explanation.reason,
      `Dni miesiąca: ${days}. Dni starej ceny: ${old}. Dni nowej ceny: ${next}.`, explanation.formula, explanation.note] : []),
    ...(view.copyRows ? view.parts.map(({label, old, next, remainder}) => [label, old, next, remainder].filter(Boolean).join(' ')) : []),
    ...view.warnings.map(([message]) => message),
  ].filter(Boolean).join('\n');
}

export function buildCorrectionSummary(result) {
  if (result.status !== 'TEST_ONLY') return '';
  const period = month => month.slice(0, 7).split('-').reverse().join('.');
  const delta = result.invoiceDifference;
  const invoiceNote = invoiceAssumption(result);
  const invoiceLabel = invoiceNote ? 'Poglądowa kwota faktury' : 'Naliczono na fakturze';
  const difference = result.ruleId === 'R05'
    ? `Brak korekty abonamentowej.${delta === '0.00' ? '' : ` Różnica względem faktury do sprawdzenia: ${formatPln(delta, true)}.`}`
    : delta === '0.00' ? 'Brak różnicy względem faktury.'
    : `${delta.startsWith('-') ? 'Zwiększenie wymagające weryfikacji' : 'Zmniejszenie faktury'}: ${formatPln(delta.replace(/^-/, ''))}.`;
  return [
    'MULTIPLAY BOK/SUD — PODSUMOWANIE POGLĄDOWE · TEST_ONLY',
    'Wykorzystanie w rozliczeniach wymaga weryfikacji podstawy umownej i zatwierdzenia księgowego.',
    `Miesiąc: ${period(result.month)}. Data zmiany: ${formatDate(result.effectiveDate)}.`,
    ...(result.lastOldDate ? [`Ostatni dzień starych warunków: ${formatDate(result.lastOldDate)}.`] : []),
    `Dotychczasowy abonament: ${formatPln(result.oldMonthlyAmount)}. Nowy abonament: ${formatPln(result.newMonthlyAmount)}.`,
    `${invoiceLabel}: ${formatPln(result.invoicedAmount)}. Należność: ${formatPln(result.amountDue)}.`,
    ...(invoiceNote ? [invoiceNote] : []),
    difference,
    ...(result.nextMonth ? [`Pełny abonament (${period(result.nextMonth)}): ${result.nextMonthAmount ? formatPln(result.nextMonthAmount) : 'zmiana w trakcie miesiąca'}.`] : []),
    ...(result.effectiveBillingDate ? [`Data naliczania nowej ceny: ${formatDate(result.effectiveBillingDate)}.`] : []),
    `Reguła ${result.ruleId}: ${result.calculationReason} Sposób naliczenia: ${billingLabel(result.appliedMethod)}.`,
    `Polityka ${result.policyVersion}. Dni miesiąca: ${result.daysInMonth} (${result.daysOld} starej ceny, ${result.daysNew} nowej ceny).`,
    ...correctionWarnings(result).map(([message]) => message),
  ].join('\n');
}
