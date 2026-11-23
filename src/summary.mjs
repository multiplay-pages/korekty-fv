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
