/** Lokalny model roboczy. Nie jest zatwierdzonym silnikiem księgowym. */
const FIELDS = new Set(['month', 'effectiveDate', 'lastOldDate', 'type', 'old', 'new', 'invoiced', 'paid', 'basis', 'dateVerified']);
const TYPES = new Set(['DOWNGRADE', 'WYPOWIEDZENIE', 'PODWYŻKA', 'NO_CHANGE']);

function reject(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function money(value) {
  if (typeof value !== 'string' || !/^\d{1,15}(?:[.,]\d{1,2})?$/.test(value)) {
    reject('INVALID_MONEY', 'Kwota musi być nieujemnym tekstem PLN, maksymalnie 15 cyfr i 2 miejsca dziesiętne.');
  }
  const [whole, fraction = ''] = value.replace(',', '.').split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function format(cents) {
  const abs = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

// Dokładna testowa reguła half-up, również dla wartości ujemnych (od zera).
function round30(numerator) {
  return numerator < 0n ? -((-numerator + 15n) / 30n) : (numerator + 15n) / 30n;
}

function monthLength(year, month) {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function calendar(value, isMonth = false) {
  const code = isMonth ? 'INVALID_MONTH' : 'INVALID_DATE';
  const pattern = isMonth ? /^(\d{4})-(\d{2})$/ : /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = typeof value === 'string' && pattern.exec(value);
  if (!match) reject(code, 'Wymagana poprawna data ISO bez godziny.');
  const year = Number(match[1]), month = Number(match[2]), day = isMonth ? 1 : Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthLength(year, month)) {
    reject(code, 'Data nie istnieje w kalendarzu gregoriańskim.');
  }
  return { year, month, day, key: year * 10000 + month * 100 + day };
}

function nextDayKey(date) {
  if (date.day < monthLength(date.year, date.month)) return date.key + 1;
  if (date.month < 12) return date.year * 10000 + (date.month + 1) * 100 + 1;
  return (date.year + 1) * 10000 + 101;
}

/**
 * Jedna zmiana porównywalnego koszyka brutto. Kwoty wejściowe: tekst PLN.
 * Zwraca tekst PLN, grosze i dokładne liczniki /30 (w groszach), bez BigInt w JSON.
 * dateVerified jest deklaracją wywołującego; funkcja nie weryfikuje dokumentów.
 */
export const CB_RULE = 'CB-2026-11-25';

/**
 * Jedyna reguła: CB-2026-11-25 — dla miesiąca 28/29/30-dniowego C=(O×d+N×r)/30, dla 31-dniowego B=O+(N−O)×r/30.
 * Wartości a i b zwracane są wyłącznie informacyjnie (przypadki referencyjne).
 */
export function calculate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) reject('INVALID_INPUT', 'Wymagany obiekt danych.');
  for (const key of Object.keys(input)) if (!FIELDS.has(key)) reject('UNSUPPORTED_FIELD', `Nieobsługiwane pole: ${key}`);
  if (input.basis !== 'gross') reject('UNSUPPORTED_BASIS', 'Etap 1 obsługuje wyłącznie porównywalny koszyk brutto.');
  if (input.dateVerified !== true) reject('DATE_NOT_VERIFIED', 'Najpierw zweryfikuj skuteczną datę na podstawie dokumentów.');
  if (!TYPES.has(input.type)) reject('INVALID_TYPE', 'Nieobsługiwany typ zdarzenia.');
  const period = calendar(input.month, true), t = calendar(input.effectiveDate);
  if (input.lastOldDate !== undefined && nextDayKey(calendar(input.lastOldDate)) !== t.key) {
    reject('INCONSISTENT_DATES', 'Pierwszy dzień nowych warunków musi następować bezpośrednio po E.');
  }
  const o = money(input.old), n = money(input.new), f = money(input.invoiced);
  if (input.paid !== undefined) money(input.paid); // Wpłata nie wpływa na korektę dokumentu.
  if ((input.type === 'DOWNGRADE' && n > o) ||
      (input.type === 'WYPOWIEDZENIE' && n !== 0n) ||
      (input.type === 'PODWYŻKA' && n <= o) ||
      (input.type === 'NO_CHANGE' && n !== o)) reject('DIRECTION_MISMATCH', 'Scenariusz nie odpowiada kierunkowi ceny koszyka.');

  const length = monthLength(period.year, period.month);
  const end = period.key + length - 1;
  const d = t.key <= period.key ? 0 : t.key > end ? length : t.day - 1;
  const r = length - d;
  const a = n * 30n + (o - n) * BigInt(d);
  const b = o * 30n + (n - o) * BigInt(r);
  const c = o * BigInt(d) + n * BigInt(r); // C = (O×d + N×r)/30, w groszach ×30
  let method, dueExact;
  if (n === o) { method = 'Pełna O'; dueExact = o * 30n; }
  else if (t.key <= period.key) { method = 'Pełna N'; dueExact = n * 30n; }
  else if (t.key > end || input.type === 'PODWYŻKA') { method = 'Pełna O'; dueExact = o * 30n; }
  else if (length === 31) { method = 'B'; dueExact = b; }
  else { method = 'C'; dueExact = c; }
  const due = round30(dueExact), delta = f - due;
  const warnings = ['D05_CONTRACT_GATE_OPEN', 'D11_ACCOUNTING_GATE_OPEN'];
  if (f !== o) warnings.push('INVOICE_DIFFERS_FROM_OLD');
  if (delta < 0n) warnings.push('ADDITIONAL_AMOUNT_REVIEW');
  if (n === o) warnings.push('NO_PRICE_CHANGE');
  if (length === 31 && d === 1 && n === 0n && due === 0n) warnings.push('ZERO_FOR_ONE_SERVICE_DAY');
  const rational = numerator => ({ numerator: String(numerator), denominator: '30' });
  return {
    status: 'TEST_ONLY', rule: CB_RULE, algorithmVersion: '0.2.0-cb-2026-11-25', basis: 'gross',
    roundingPolicy: 'HALF_UP_TEST_ONLY_D11_OPEN', lineAllocationStatus: 'NOT_IMPLEMENTED_D11',
    classification: n === o ? 'NO_CHANGE' : input.type,
    method, daysInMonth: length, daysOld: d, daysNew: r,
    a: format(round30(a)), b: format(round30(b)), c: format(round30(c)), due: format(due), delta: format(delta),
    dueCents: String(due), deltaCents: String(delta),
    exact: { a: rational(a), b: rational(b), c: rational(c), due: rational(dueExact) }, warnings,
  };
}
