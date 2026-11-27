import { evaluateBasket, parseAmount, formatAmount, SERVICES } from './basket.mjs';
import { buildInvoicePlan } from './invoice-plan.mjs';

// Jedyna polityka: reguła CB-2026-11-25 (28/29/30 dni → C, 31 dni → B, jedna metoda dla koszyka; podwyżka od dnia 1 → pełna N).
// Dawne reguły (MIN(A,B), rzeczywiste dni ÷ 30) usunięto z kodu; inna wartość partialRule daje POLICY_UNRESOLVED.
export const ACTIVE_DEMO_POLICY = Object.freeze({
  version: '0.6.0-test-cb-2026-11-25', rule: 'CB-2026-11-25', partialRule: 'CB', assumeMissingInvoice: true,
});

const moneyFields = ['old', 'new', 'invoiced'];
const vatCategories = ['', '23', '8', '5', '0', 'zw'];
const reviewCodes = new Set([
  'MULTIPLE_DATES', 'UNRESOLVED_DISCOUNTS', 'NON_COMPARABLE_SCOPE', 'DATE_NOT_VERIFIED',
  'COMPONENTS_CHANGED_SAME_TOTAL', 'OPPOSING_LINE_CHANGES', 'MIXED_VAT', 'UNSUPPORTED_BASIS',
  'POLICY_UNRESOLVED', 'LINES_NEEDED',
]);
const reasons = {
  R02: 'Data zmiany przypada przed analizowanym miesiącem. Zastosowano pełny nowy abonament.',
  R03: 'Zmiana nastąpiła od pierwszego dnia miesiąca, dlatego zastosowano pełny nowy abonament.',
  R04: 'Zmiana nastąpi po analizowanym miesiącu. Za cały analizowany miesiąc obowiązuje dotychczasowy abonament.',
  R05: 'Cena i skład koszyka się nie zmieniły. Należność to pełny abonament.',
  R06: 'Za miesiąc zmiany obowiązuje dotychczasowy abonament. Wyższa cena jest naliczana od pierwszego dnia następnego miesiąca.',
  R07: 'Obniżenie w trakcie miesiąca rozliczono automatycznie jedną metodą dla całego koszyka (reguła CB-2026-11-25).',
  R08: 'Należność po zakończeniu usługi ustalono według reguły CB-2026-11-25 i ostatniego dnia świadczenia.',
};

/** Dni naliczenia podwyżki wynikają z daty naliczania nowej ceny (nie z podziału kalendarzowego po dacie zdarzenia T). */
function increaseBillingDays(month, daysInMonth, billingDate) {
  if (!billingDate) return null;
  if (billingDate <= `${month}-01`) return { daysOld: 0, daysNew: daysInMonth };
  if (billingDate > `${month}-${String(daysInMonth).padStart(2, '0')}`) return { daysOld: daysInMonth, daysNew: 0 };
  return null;
}

function fail(code, message, field) {
  throw Object.assign(new Error(message), { code, field });
}

export function nextCalendarDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return '';
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return '';
  date.setUTCDate(date.getUTCDate() + 1);
  return date.getUTCFullYear() <= 9999 ? date.toISOString().slice(0, 10) : '';
}

function nextMonthStart(month) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.getUTCFullYear() <= 9999 ? date.toISOString().slice(0, 10) : null;
}

export function summarizeGrossRows(rows) {
  const comparable = rows.length > 0 && rows.every(row => row.basis === 'gross');
  return Object.fromEntries(moneyFields.map(key => {
    if (!comparable) return [key, null];
    try {
      return [key, formatAmount(rows.reduce((sum, row) => sum + parseAmount(row[key]), 0n))];
    } catch (error) {
      if (error.code !== 'INVALID_MONEY') throw error;
      return [key, null];
    }
  }));
}

function readAmounts(values, prefix, termination, invoiceEqualsOld = false) {
  const amounts = {
    old: values.old,
    new: termination && (values.new === '' || values.new === undefined) ? '0' : values.new,
    invoiced: invoiceEqualsOld ? values.old : values.invoiced,
  };
  for (const key of moneyFields) {
    parseAmount(amounts[key], `${prefix}.${key}`);
  }
  if (termination && parseAmount(amounts.new) !== 0n) {
    fail('DIRECTION_MISMATCH', 'Przy zakończeniu całego zakresu nowy abonament musi wynosić zero.', `${prefix}.new`);
  }
  return amounts;
}

function aggregateRow(amounts) {
  return { ...amounts, service: 'other', basis: 'gross', vat: '' };
}

const hasAmount = value => value !== undefined && value !== '';

function inferEvent(rows) {
  const change = rows.reduce((sum, row) => sum + parseAmount(row.new) - parseAmount(row.old), 0n);
  return change > 0n ? 'PODWYŻKA' : change < 0n ? 'DOWNGRADE' : 'NO_CHANGE';
}

function validateInput(input, policy) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_INPUT', 'Wymagane dane formularza.');
  if (input.nonComparableScope) fail('NON_COMPARABLE_SCOPE', 'Zakres na fakturze i w koszyku musi być porównywalny.', 'nonComparableScope');
  if (input.dateVerified !== true) fail('DATE_NOT_VERIFIED', 'Ustal skuteczną datę na podstawie dokumentów lub uzgodnienia (D05).', 'effectiveDate');
  if (input.multipleDates) fail('MULTIPLE_DATES', 'Kilka niezależnych dat zmiany. Przekaż sprawę do rozliczeń (D13).', 'multipleDates');
  if (input.unresolvedDiscounts) fail('UNRESOLVED_DISCOUNTS', 'Rabaty lub ich znaki wymagają uzgodnienia z rozliczeniami (D11).', 'unresolvedDiscounts');

  const termination = input.type === 'WYPOWIEDZENIE';
  let effectiveDate = input.effectiveDate;
  if (termination && !input.lastOldDate) fail('END_DATE_REQUIRED', 'Wpisz ostatni dzień usługi.', 'lastOldDate');
  if (input.lastOldDate) {
    const derivedDate = nextCalendarDay(input.lastOldDate);
    if (!derivedDate) fail('INVALID_DATE', 'Sprawdź ostatni dzień starych warunków. Następna data musi mieścić się w kalendarzu.', 'lastOldDate');
    if (effectiveDate && effectiveDate !== derivedDate) {
      fail('INCONSISTENT_DATES', 'Pierwszy dzień nowych warunków przypada bezpośrednio po ostatnim dniu starej ceny.', 'lastOldDate');
    }
    effectiveDate = derivedDate;
  }

  const form = { month: input.month, effectiveDate, type: input.type, dateVerified: input.dateVerified };
  if (input.lastOldDate) form.lastOldDate = input.lastOldDate;
  if (input.paid !== undefined) form.paid = input.paid;
  const source = input.source ?? 'aggregate';
  const totals = input.totals ?? {};
  if (source === 'aggregate') {
    if (input.basis !== undefined && input.basis !== 'gross') {
      fail('UNSUPPORTED_BASIS', 'Podaj porównywalne sumy brutto dla całego koszyka.', 'totals');
    }
    const invoiceAssumed = Boolean(input.invoiceEqualsOld || (policy?.assumeMissingInvoice && !hasAmount(totals.invoiced)));
    return { form: { ...form, rows: [aggregateRow(readAmounts(totals, 'totals', termination, invoiceAssumed))] }, source, invoiceAssumed };
  }
  if (source !== 'lines') fail('INVALID_INPUT', 'Wybierz źródło danych do kalkulacji.', 'source');
  if (!Array.isArray(input.rows) || !input.rows.length) fail('ROWS_REQUIRED', 'Dodaj przynajmniej jedną pozycję abonamentową.', 'rows');
  if (input.rows.length > 50) fail('ROW_LIMIT', 'Prototyp obsługuje maksymalnie 50 pozycji.', 'rows');

  const rows = input.rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail('INVALID_INPUT', 'Nieprawidłowe dane pozycji.', `rows.${index}`);
    const { id, invoiceAssumed, ...data } = row;
    return { ...data, ...readAmounts(data, `rows.${index}`, termination) };
  });
  const netIndex = rows.findIndex(row => row.basis !== 'gross');
  const vat = new Set(rows.map(row => row.vat ?? ''));
  if (rows.some(row => !vatCategories.includes(row.vat ?? ''))) {
    fail('INVALID_VAT', 'Wybierz kategorię VAT z listy.', 'rows');
  }
  if (netIndex !== -1 && !input.grossTotalsVerified) {
    fail('UNSUPPORTED_BASIS', 'Kwoty netto lub mieszane podstawy wymagają kontroli. Podaj niezależnie potwierdzone sumy brutto, aby uzyskać poglądowy wynik.', `rows.${netIndex}.basis`);
  }
  const declared = moneyFields.some(key => hasAmount(totals[key]));
  let gross;
  if (declared || input.grossTotalsVerified) {
    const sums = netIndex === -1 ? summarizeGrossRows(rows) : null;
    // Porównanie O i N może nie zawierać kwoty faktury. Wtedy F pochodzi wyłącznie z pozycji.
    const comparePricesOnly = policy?.assumeMissingInvoice && !input.grossTotalsVerified
      && !hasAmount(totals.invoiced) && !input.invoiceEqualsOld;
    gross = readAmounts(comparePricesOnly ? { ...totals, invoiced: sums.invoiced } : totals,
      'totals', termination, input.invoiceEqualsOld && !input.grossTotalsVerified);
    if (sums) {
      for (const key of moneyFields) {
        if (parseAmount(gross[key]) !== parseAmount(sums[key])) {
          fail('TOTAL_MISMATCH', 'Wpisana suma brutto różni się od sumy pozycji. Sprawdź kwoty w obu źródłach.', `totals.${key}`);
        }
      }
    }
  }
  if (netIndex !== -1 || vat.size > 1) {
    if (input.grossTotalsVerified) return { form: { ...form, rows: [aggregateRow(gross)] }, source: 'aggregate', taxReview: true, originalRows: rows };
    fail('MIXED_VAT', 'Różne lub częściowo nieznane kategorie VAT wymagają kontroli. Podaj niezależnie potwierdzone sumy brutto, aby uzyskać poglądowy wynik.', 'rows');
  }
  return { form: { ...form, rows }, source, originalRows: rows, vatUnknown: vat.has('') };
}

function classify(result, type, effectiveBillingDate) {
  const start = `${result.month}-01`;
  const end = `${result.month}-${result.global.daysInMonth}`;
  if (type === 'NO_CHANGE') return 'R05';
  if (result.effectiveDate < start) return 'R02';
  if (result.effectiveDate > end) return 'R04';
  if (type === 'PODWYŻKA' && effectiveBillingDate > end) return 'R06';
  if (result.effectiveDate === start) return 'R03';
  return type === 'WYPOWIEDZENIE' ? 'R08' : 'R07';
}

/** Polityka jest argumentem dla wywołań technicznych. Formularz używa profilu aplikacji. */
function evaluateLegacyCorrection(input, policy) {
  const policyVersion = policy?.version ?? 'unresolved';
  const partialRule = policy?.version ? policy.partialRule : null;
  try {
    const { form, source, taxReview, originalRows, vatUnknown, invoiceAssumed = false } = validateInput(input, policy);
    const type = form.type ?? inferEvent(form.rows);
    const result = evaluateBasket({ ...form, type });
    const { old, new: next, invoiced } = result.totals;
    const directions = originalRows?.map(row => parseAmount(row.new) - parseAmount(row.old)) ?? [];
    const oppositeChanges = directions.some(value => value < 0n) && directions.some(value => value > 0n);
    if (old === next && (input.componentsChanged || directions.some(value => value !== 0n))) {
      fail('COMPONENTS_CHANGED_SAME_TOTAL', 'Ceny lub skład pozycji zmieniły się przy tej samej sumie. Uzgodnij rozliczenie z BOK.', 'componentsChanged');
    }
    if (type === 'DOWNGRADE' && old === next) {
      fail('DIRECTION_MISMATCH', 'Przy obniżeniu nowy abonament musi być niższy od dotychczasowego.', 'type');
    }
    if (oppositeChanges && type !== 'DOWNGRADE') {
      fail('OPPOSING_LINE_CHANGES', 'Ceny pozycji zmieniają się w różnych kierunkach. Przekaż sprawę do rozliczeń.', 'rows');
    }
    // Podwyżka w trakcie miesiąca: nowa cena od pierwszego dnia następnego miesiąca.
    const increaseDeferred = type === 'PODWYŻKA' && !form.effectiveDate.endsWith('-01');
    const effectiveBillingDate = type === 'NO_CHANGE' ? null
      : increaseDeferred ? nextMonthStart(form.effectiveDate.slice(0, 7)) : form.effectiveDate;
    if (type === 'PODWYŻKA' && !effectiveBillingDate) fail('INVALID_DATE', 'Data naliczania podwyżki wykracza poza obsługiwany kalendarz.', 'lastOldDate');

    const ruleId = classify(result, type, effectiveBillingDate);
    const partial = ruleId === 'R07' || ruleId === 'R08';
    if (partial && partialRule !== 'CB') {
      fail('POLICY_UNRESOLVED', 'Brak reguły testowej dla części tego miesiąca. Przekaż sprawę do rozliczeń.', 'type');
    }

    const plan = buildInvoicePlan(result);
    const rows = source === 'lines' ? result.rows.map((row, index) => ({
      ...row,
      id: input.rows[index].id ?? row.number,
      invoiceAssumed: input.rows[index].invoiceAssumed === true,
      ...plan.rows[index],
      documentChange: formatAmount(-BigInt(row.delta.replace('.', ''))),
    })) : [];
    const warnings = result.warnings.filter(code => source === 'lines' || !['LINE_INCREASE_REVIEW', 'NEGATIVE_LINE_PROPOSAL'].includes(code));
    if (oppositeChanges) warnings.push('OPPOSING_LINE_CHANGES');
    if (vatUnknown) warnings.push('VAT_UNKNOWN');
    if (taxReview) warnings.push('AGGREGATE_TAX_REVIEW');
    if (source === 'lines' && plan.needsRoundingReview && !warnings.includes('UNALLOCATED_ROUNDING')) warnings.push('UNALLOCATED_ROUNDING');

    const nextMonth = nextMonthStart(result.month);
    const followingMonth = nextMonth && nextMonthStart(nextMonth.slice(0, 7));
    let nextMonthAmount = null;
    if (nextMonth) {
      if (!effectiveBillingDate || (followingMonth && effectiveBillingDate >= followingMonth)) nextMonthAmount = old;
      else if (effectiveBillingDate <= nextMonth) nextMonthAmount = next;
    }
    const endDescription = next === '0.00' && type !== 'NO_CHANGE' && result.global.daysOld === 0
      ? 'Od początku analizowanego miesiąca abonament wynosi 0,00 zł.' : reasons[ruleId];
    // Dni naliczenia podwyżki odpowiadają polityce cenowej: T = 1. dnia → cała nowa cena, inaczej cała stara w miesiącu zmiany.
    const billing = type === 'PODWYŻKA' ? increaseBillingDays(result.month, result.global.daysInMonth, effectiveBillingDate) : null;
    const global = billing ? { ...result.global, ...billing } : result.global;

    return {
      ...result, global, status: 'TEST_ONLY', policyVersion, ruleId,
      effectiveDate: form.effectiveDate, lastOldDate: form.lastOldDate ?? '',
      calculationReason: endDescription, appliedMethod: global.method,
      daysInMonth: global.daysInMonth, daysOld: global.daysOld, daysNew: global.daysNew,
      oldMonthlyAmount: old, newMonthlyAmount: next, invoicedAmount: invoiced,
      amountDue: result.global.due, invoiceDifference: result.global.delta, invoiceAssumed,
      assumedInvoiceRows: rows.filter(row => row.invoiceAssumed).length,
      priceCorrection: type === 'NO_CHANGE' ? '0.00' : result.global.delta,
      nextMonth, nextMonthAmount, effectiveBillingDate, source, plan,
      rows, lineBreakdown: rows, warnings, accountingAllowed: false,
    };
  } catch (error) {
    if (!error.code) throw error;
    return {
      status: reviewCodes.has(error.code) ? 'REVIEW' : 'INVALID',
      policyVersion, ruleId: reviewCodes.has(error.code) ? 'R09' : 'R01',
      code: error.code, field: error.field, calculationReason: error.message,
      amountDue: null, lineBreakdown: [], warnings: [error.code], accountingAllowed: false,
    };
  }
}

const documentStates = new Set(['UNKNOWN', 'NOT_ISSUED', 'AMOUNT']);
const invoiceRequired = ['INVOICE_REQUIRED', 'INVOICE_REQUIRED', 'Podaj kwotę abonamentu z faktury za analizowany miesiąc.'];
const noCorrection = ['NO_CORRECTION', null, 'Brak korekty z tytułu zmiany abonamentu.'];
const atypicalInvoice = ['REVIEW', 'ATYPICAL_INVOICE', 'Faktura różni się od abonamentu właściwego dla analizowanego miesiąca. Sprawdź naliczenie (D12).'];
const belowDue = ['REVIEW', 'INVOICE_BELOW_DUE', 'Należność jest wyższa niż kwota na fakturze. Sprawdź naliczenie. Kalkulator nie wylicza korekty na plus.'];
const correction = ['CORRECTION', null, 'Poglądowe zmniejszenie faktury.'];

function collectProtectedInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_INPUT', 'Wymagane dane formularza.');
  if (typeof input.month !== 'string' || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) {
    fail('INVALID_MONTH', 'Wybierz miesiąc i rok rozliczeniowy.', 'month');
  }
  const effectiveDate = input.lastOldDate ? nextCalendarDay(input.lastOldDate) : input.effectiveDate;
  if (!nextCalendarDay(effectiveDate) && effectiveDate !== '9999-12-31') {
    fail('INVALID_DATE', 'Wpisz poprawny ostatni dzień starych warunków.', 'lastOldDate');
  }
  if (input.effectiveDate && input.effectiveDate !== effectiveDate) {
    fail('INCONSISTENT_DATES', 'Pierwszy dzień nowych warunków musi następować po ostatnim dniu starej ceny.', 'lastOldDate');
  }
  const source = input.source ?? 'aggregate';
  const isBok = source === 'lines';
  if (!isBok && source !== 'aggregate') fail('INVALID_INPUT', 'Wybierz źródło danych do kalkulacji.', 'source');
  const entries = isBok ? input.rows : [aggregateRow(input.totals ?? {})];
  if (!Array.isArray(entries) || !entries.length) fail('ROWS_REQUIRED', 'Dodaj przynajmniej jedną pozycję.', 'rows');
  if (entries.length > 50) fail('ROW_LIMIT', 'Kalkulator obsługuje maksymalnie 50 pozycji.', 'rows');
  const documentState = input.documentState ?? (entries.some(row => hasAmount(row?.invoiced) && !row?.invoiceAssumed) ? 'AMOUNT' : 'UNKNOWN');
  if (!documentStates.has(documentState)) fail('INVALID_DOCUMENT_STATE', 'Wybierz stan faktury.', 'documentState');
  const invoiceEntered = documentState === 'AMOUNT';
  const vats = new Set();
  const rowChanges = [];
  let old = 0n, next = 0n, invoiced = 0n;
  let amountsComplete = invoiceEntered;
  let scopeSupported = (input.scope === undefined || input.scope === 'B2C') && (input.basis === undefined || input.basis === 'gross');
  const rows = entries.map((row, index) => {
    const field = isBok ? `rows.${index}` : 'totals';
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail('INVALID_INPUT', 'Nieprawidłowe dane pozycji.', field);
    const { id, label, description, service, vat = '', basis, scope } = row;
    if (!Object.hasOwn(SERVICES, service)) fail('INVALID_SERVICE', 'Wybierz typ usługi z listy.', `${field}.service`);
    if (!vatCategories.includes(vat)) fail('INVALID_VAT', 'Wybierz stawkę VAT pozycji.', `${field}.vat`);
    if (vat) vats.add(vat);
    if (basis !== 'gross' || (scope !== undefined && scope !== 'B2C')) scopeSupported = false;
    for (const [key, value] of [['label', label], ['description', description]]) {
      if (value !== undefined && (typeof value !== 'string' || value.length > 160)) {
        fail('INVALID_LABEL', 'Opis pozycji jest zbyt długi.', `${field}.${key}`);
      }
    }
    const newPrice = input.type === 'WYPOWIEDZENIE' && !hasAmount(row.new) ? '0' : row.new;
    const rowOld = parseAmount(row.old, `${field}.old`);
    const rowNext = parseAmount(newPrice, `${field}.new`);
    const actual = invoiceEntered && !row.invoiceAssumed && hasAmount(row.invoiced);
    if (!actual && !isBok && invoiceEntered) fail('INVALID_MONEY', 'Wpisz kwotę z faktury.', 'totals.invoiced');
    if (!actual) amountsComplete = false;
    const rowInvoice = actual ? parseAmount(row.invoiced, `${field}.invoiced`) : rowOld;
    old += rowOld;
    next += rowNext;
    invoiced += rowInvoice;
    rowChanges.push(rowNext - rowOld);
    return { id, label, description, service, basis: 'gross', vat,
      old: row.old, new: newPrice, invoiced: formatAmount(rowInvoice) };
  });
  const type = input.type ?? (next > old ? 'PODWYŻKA' : next < old ? 'DOWNGRADE' : 'NO_CHANGE');
  if (!['PODWYŻKA', 'DOWNGRADE', 'WYPOWIEDZENIE', 'NO_CHANGE'].includes(type)) fail('INVALID_TYPE', 'Nieobsługiwany typ zmiany.', 'type');
  if ((type === 'WYPOWIEDZENIE' && (!input.lastOldDate || next !== 0n)) ||
      (type === 'PODWYŻKA' && next <= old) || (type === 'DOWNGRADE' && next >= old) || (type === 'NO_CHANGE' && next !== old)) {
    fail('DIRECTION_MISMATCH', 'Typ zdarzenia musi odpowiadać zmianie ceny.', 'type');
  }
  if (type === 'PODWYŻKA' && !nextMonthStart(effectiveDate.slice(0, 7))) {
    fail('INVALID_DATE', 'Data naliczania podwyżki wykracza poza obsługiwany kalendarz.', 'lastOldDate');
  }
  if (input.paid !== undefined && input.paid !== '') parseAmount(input.paid, 'paid');
  if ([old, next, invoiced].some(value => value > 99999999999999999n)) fail('TOTAL_TOO_LARGE', 'Suma koszyka przekracza limit 15 cyfr w złotych.', 'rows');
  // BOK liczy O, N i F wyłącznie z pozycji; sumy koszyka (SUD) nie biorą udziału w wyniku ani w kontrolach (26.11.2026).
  const changeMonth = effectiveDate.slice(0, 7);
  const monthRelation = input.month < changeMonth ? 'BEFORE' : input.month > changeMonth ? 'AFTER' : 'CHANGE';
  return { rows, source, type, effectiveDate, monthRelation, documentState, amountsComplete,
    old, next, invoiced, isBok, scopeSupported, mixedVat: vats.size > 1, rowChanges };
}

function decideInvoice(data, state, invoice, due) {
  const { old, next, monthRelation, effectiveDate } = data;
  if (state === 'NOT_ISSUED') return ['NOT_APPLICABLE', null, 'Brak faktury do korekty.'];
  if (old === next) {
    return invoice === null || invoice === old ? noCorrection
      : ['REVIEW', 'UNCHANGED_PRICE_INVOICE_MISMATCH', 'Faktura różni się od abonamentu. Różnica nie wynika ze zmiany abonamentu (D12).'];
  }
  if (monthRelation === 'BEFORE') return invoice === null ? invoiceRequired : invoice === old ? noCorrection : atypicalInvoice;
  if (next > old && monthRelation === 'CHANGE') {
    if (invoice === null) return state === 'UNKNOWN'
      ? ['NO_CORRECTION_EXPECTED', null, 'Nie przewidujemy korekty faktury. Sprawdź fakturę w MMS.'] : invoiceRequired;
    if (invoice === old || (invoice === next && effectiveDate.endsWith('-01'))) {
      return ['NO_CORRECTION', null, 'Bez korekty faktury za miesiąc zmiany.'];
    }
    return invoice === next ? ['REVIEW', 'EARLY_INCREASE_ON_INVOICE', 'Na fakturze naliczono nową cenę przy podwyżce w trakcie miesiąca. Sprawdź fakturę w MMS.'] : atypicalInvoice;
  }
  if (invoice === null) return invoiceRequired;
  if (invoice === due) return noCorrection;
  if (invoice < due) return belowDue;
  if (monthRelation === 'AFTER' && (next > old || invoice !== old)) return atypicalInvoice;
  return correction;
}

function evaluateProtectedCorrection(input) {
  const result = {
    status: 'TEST_ONLY', accountingAllowed: false, policyVersion: ACTIVE_DEMO_POLICY.version,
    documentState: 'UNKNOWN', dataStatus: 'MISSING', correctionAmount: null, correctionRemainder: null,
    amountDue: null, invoicedAmount: null, lineBreakdown: [], variants: [], warnings: [],
    rowsDueTotal: null, dueRemainder: null, contractPrice: null,
    confirmation: { allowed: false, reason: 'Uzupełnij wymagane dane.' },
  };
  const outcome = ([decision, code, calculationReason], field) => ({ ...result, decision, code, calculationReason, field });
  let data;
  try {
    data = collectProtectedInput(input);
  } catch (error) {
    if (!error.code) throw error;
    if (documentStates.has(input?.documentState)) result.documentState = input.documentState;
    return outcome(['ERROR', error.code, error.message], error.field);
  }
  const { isBok, documentState, effectiveDate, monthRelation, amountsComplete, old, next, invoiced } = data;
  Object.assign(result, { month: input.month, lastOldDate: input.lastOldDate, effectiveDate, monthRelation, documentState,
    source: data.source, type: data.type, dataStatus: amountsComplete ? 'ENTERED' : 'MISSING',
    oldMonthlyAmount: formatAmount(old), newMonthlyAmount: formatAmount(next) });
  const exceptional = [
    [input.unresolvedDiscounts, 'UNRESOLVED_DISCOUNTS', 'Rabaty lub ich znaki wymagają uzgodnienia z rozliczeniami (D11).'],
    [input.multipleDates, 'MULTIPLE_DATES', 'W sprawie jest kilka niezależnych dat zmiany (D13).'],
    [input.dateVerified !== true, 'DATE_NOT_VERIFIED', 'Ustal skuteczną datę na podstawie dokumentów (D05).'],
    [input.nonComparableScope, 'NON_COMPARABLE_SCOPE', 'Zakres na fakturze i w koszyku jest nieporównywalny.'],
  ].find(([flag]) => flag);
  if (exceptional) return outcome(['REFER', ...exceptional.slice(1)]);
  if (!data.scopeSupported) return outcome(['REVIEW', 'UNSUPPORTED_SCOPE', 'Kalkulacja obejmuje B2C i porównywalne kwoty brutto. Przekaż sprawę do weryfikacji.']);
  if (next === old && (input.componentsChanged || data.rowChanges.some(value => value !== 0n))) {
    return outcome(['REVIEW', 'COMPONENTS_CHANGED_SAME_TOTAL', 'Ceny lub skład koszyka zmieniły się przy tej samej sumie. Uzgodnij rozliczenie (D11).']);
  }
  if (next > old && data.rowChanges.some(value => value < 0n) && data.rowChanges.some(value => value > 0n)) {
    result.warnings = ['OPPOSING_LINE_CHANGES', 'D11_ACCOUNTING_GATE_OPEN'];
    return outcome(['REFER', 'OPPOSING_LINE_CHANGES', 'Ceny pozycji zmieniają się w różnych kierunkach. Przekaż sprawę do rozliczeń (D23).']);
  }

  if (isBok) {
    const vatComplete = data.rows.every(row => row.vat);
    result.confirmation = { allowed: amountsComplete && vatComplete, reason: !amountsComplete
      ? 'Wpisz rzeczywistą kwotę z faktury dla każdej pozycji.' : !vatComplete ? 'Wybierz stawkę VAT każdej pozycji.' : '' };
  }
  const assumed = !isBok && documentState === 'UNKNOWN' && monthRelation === 'CHANGE' && old !== next;
  const invoice = amountsComplete || assumed ? invoiced : null;
  const invoiceForDecision = assumed && next > old ? null : invoice;
  result.dataStatus = result.confirmation.allowed && input.invoiceConfirmed === true ? 'CONFIRMED'
    : amountsComplete ? 'ENTERED' : assumed ? 'ASSUMED' : 'MISSING';
  const normalized = { source: data.source, month: input.month, lastOldDate: input.lastOldDate, effectiveDate,
    dateVerified: true, paid: input.paid, type: data.type };
  // VAT pozycji nie wpływa na obliczenie brutto (C/B); mieszany VAT daje wyłącznie wynik poglądowy brutto (D11 otwarte).
  if (isBok) normalized.rows = data.rows.map(row => ({ ...row, vat: '' }));
  else normalized.totals = { old: formatAmount(old), new: formatAmount(next), invoiced: formatAmount(invoiced) };
  // Aktywna ścieżka UI liczy wyłącznie według polityki CB (P-05: wcześniej była tu na stałe zaszyta polityka historyczna).
  const calculated = evaluateLegacyCorrection(normalized, ACTIVE_DEMO_POLICY);
  if (calculated.status !== 'TEST_ONLY') {
    result.confirmation = { allowed: false, reason: 'Sprawdź dane koszyka.' };
    result.dataStatus = amountsComplete ? 'ENTERED' : 'MISSING';
    return outcome(['ERROR', calculated.code, calculated.calculationReason], calculated.field);
  }
  const due = BigInt(calculated.global.dueCents);
  Object.assign(result, { amountDue: calculated.amountDue, invoicedAmount: invoice === null ? null : formatAmount(invoice),
    nextMonth: calculated.nextMonth, nextMonthAmount: calculated.nextMonthAmount, effectiveBillingDate: calculated.effectiveBillingDate,
    appliedMethod: calculated.appliedMethod, daysOld: calculated.daysOld, daysNew: calculated.daysNew,
    daysInMonth: calculated.daysInMonth, ruleId: calculated.ruleId, formulaReason: calculated.calculationReason });
  const resolution = decideInvoice(data, documentState, invoiceForDecision, due);
  result.warnings = calculated.warnings.filter(code => {
    if (code === 'INVOICE_DIFFERS_FROM_OLD') return resolution[0] === 'CORRECTION' && invoice !== old && invoice !== next;
    if (['LINE_INCREASE_REVIEW', 'NEGATIVE_LINE_PROPOSAL', 'UNALLOCATED_ROUNDING'].includes(code)) return resolution[0] === 'CORRECTION';
    return !['ADDITIONAL_AMOUNT_REVIEW', 'VAT_UNKNOWN'].includes(code);
  });
  if (data.mixedVat) result.warnings.push('MIXED_VAT_GROSS_ONLY');
  if (resolution[0] === 'CORRECTION') {
    result.correctionAmount = formatAmount(invoice - due);
    result.lineBreakdown = calculated.rows.map((row, index) => ({ ...row, vat: data.rows[index].vat }));
    if (isBok) {
      // Dwie niezależne reszty (bez automatycznej alokacji groszy, D11 otwarte):
      // reszta należności = należność koszyka − suma należności pozycji; reszta korekty = (F − należność) − suma różnic pozycji.
      result.rowsDueTotal = calculated.rowSum;
      result.dueRemainder = calculated.residual;
      result.correctionRemainder = formatAmount(invoice - due - BigInt(calculated.rowDeltaSum.replace('.', '')));
      result.parts = calculated.plan;
    }
  }
  // Cena umowna za analizowany miesiąc przy podwyżce (osobno od kwoty faktury i od abonamentu w kolejnych miesiącach).
  // Ustalona tylko wtedy, gdy kalkulacja się odbyła; przy REFER/ERROR/REVIEW bez kwot wcześniej zwrócono wynik bez tej wartości.
  if (data.type === 'PODWYŻKA' && monthRelation === 'CHANGE') {
    result.contractPrice = calculated.daysNew === calculated.daysInMonth ? formatAmount(next) : formatAmount(old);
  }
  if (documentState === 'UNKNOWN' && monthRelation === 'CHANGE' && effectiveDate.endsWith('-01') && old !== next) {
    const observed = (key, value) => {
      const [decision] = decideInvoice(data, 'AMOUNT', value, due);
      return { key, amount: formatAmount(value), decision, correctionAmount: decision === 'CORRECTION' ? formatAmount(value - due) : null };
    };
    result.variants = [observed('OLD', old), observed('NEW', next),
      { key: 'NOT_ISSUED', decision: decideInvoice(data, 'NOT_ISSUED', null, due)[0] },
      { key: 'OTHER', decision: next > old ? 'REVIEW' : 'INVOICE_REQUIRED' }];
  }
  return outcome(resolution);
}

export function evaluateCorrection(input, policy = ACTIVE_DEMO_POLICY) {
  return policy?.version === ACTIVE_DEMO_POLICY.version
    ? evaluateProtectedCorrection(input)
    : evaluateLegacyCorrection(input, policy);
}
