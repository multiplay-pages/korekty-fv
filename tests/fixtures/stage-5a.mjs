const aggregate = (month, lastOldDate, old, next, invoiced, documentState) => ({
  month, lastOldDate, dateVerified: true, totals: { old, new: next, invoiced },
  documentState: documentState ?? (invoiced === undefined ? 'UNKNOWN' : 'AMOUNT'),
});

export const line = (service, old, next, invoiced = old, fields = {}) => ({
  service, old, new: next, invoiced, basis: 'gross', vat: '23', ...fields,
});

const bok = (input, rows, fields = {}) => ({ ...input, source:'lines', totals:{}, rows, documentState:'AMOUNT', invoiceConfirmed:true, ...fields });
const lower = (f, month='2026-11') => aggregate(month, '2026-11-15', '150', '120', f);
const onFirst = (f, state) => aggregate('2026-11', '2026-10-31', '150', '120', f, state);
const increase = (f, month='2026-11') => aggregate(month, '2026-11-17', '150', '180', f);
const increaseOnFirst = f => aggregate('2026-12', '2026-11-30', '150', '180', f);
const end = (f, state) => aggregate('2027-04', '2027-03-31', '150', '0', f, state);
const same = f => aggregate('2026-11', '2026-11-15', '150', '150', f);
const march = aggregate('2027-03', '2027-03-17', '150', '0');
const fourLines = [line('internet','100','80'), line('tv','60','60'), line('multiroom','20','0'), line('rental','10','10')];
const lowerBok = (f, month='2026-11') => bok(lower(f,month), [line('internet','150','120',f)]);

// Id · argumenty resolvera · decyzja · stan danych · kwota korekty · należność informacyjna.
export const matrix = [
  ['M01', lower(), 'CORRECTION', 'ASSUMED', '15.00', '135.00'],
  ['M02', lowerBok('150'), 'CORRECTION', 'CONFIRMED', '15.00', '135.00'],
  ['M03', lowerBok('160'), 'CORRECTION', 'CONFIRMED', '25.00', '135.00'],
  ['M03-SUD', lower('160'), 'CORRECTION', 'ENTERED', '25.00', '135.00'],
  ['M04', lower('120'), 'REVIEW', 'ENTERED', null, '135.00'],
  ['M04-zero', lower('0'), 'REVIEW', 'ENTERED', null, '135.00'],
  ['M05', onFirst(), 'CORRECTION', 'ASSUMED', '30.00', '120.00'],
  ['M05-stara', onFirst('150'), 'CORRECTION', 'ENTERED', '30.00', '120.00'],
  ['M06', onFirst('120'), 'NO_CORRECTION', 'ENTERED', null, '120.00'],
  ['M06b', onFirst(undefined,'NOT_ISSUED'), 'NOT_APPLICABLE', 'MISSING', null, '120.00'],
  ['M06c', onFirst('0'), 'REVIEW', 'ENTERED', null, '120.00'],
  ['M07', lower(undefined,'2026-12'), 'INVOICE_REQUIRED', 'MISSING', null, '120.00'],
  ['M08', lowerBok('150','2026-12'), 'CORRECTION', 'CONFIRMED', '30.00', '120.00'],
  ['M09', lower('120','2026-12'), 'NO_CORRECTION', 'ENTERED', null, '120.00'],
  ['M09-nietypowa', lower('160','2026-12'), 'REVIEW', 'ENTERED', null, '120.00'],
  ['M10-brak', lower(undefined,'2026-10'), 'INVOICE_REQUIRED', 'MISSING', null, '150.00'],
  ['M10-zgodna', lower('150','2026-10'), 'NO_CORRECTION', 'ENTERED', null, '150.00'],
  ['M10-nietypowa', lower('140','2026-10'), 'REVIEW', 'ENTERED', null, '150.00'],
  ['M11', increase(), 'NO_CORRECTION_EXPECTED', 'ASSUMED', null, '150.00'],
  ['M12', increase('150'), 'NO_CORRECTION', 'ENTERED', null, '150.00'],
  ['M13', increase('180'), 'REVIEW', 'ENTERED', null, '150.00'],
  ['M14', increase('165'), 'REVIEW', 'ENTERED', null, '150.00'],
  ['M14-zero', increase('0'), 'REVIEW', 'ENTERED', null, '150.00'],
  // P-08 (CB-2026-11-25): przy podwyżce od dnia 1 należność = N (180,00); decyzje dotyczące faktury bez zmian.
  ['M15', increaseOnFirst(), 'NO_CORRECTION_EXPECTED', 'ASSUMED', null, '180.00'],
  ['M15b-stara', increaseOnFirst('150'), 'NO_CORRECTION', 'ENTERED', null, '180.00'],
  ['M15b-nowa', increaseOnFirst('180'), 'NO_CORRECTION', 'ENTERED', null, '180.00'],
  ['M15-inna', increaseOnFirst('165'), 'REVIEW', 'ENTERED', null, '180.00'],
  ['M16', increase(undefined,'2026-12'), 'INVOICE_REQUIRED', 'MISSING', null, '180.00'],
  ['M17', increase('180','2026-12'), 'NO_CORRECTION', 'ENTERED', null, '180.00'],
  ['M18', increase('150','2026-12'), 'REVIEW', 'ENTERED', null, '180.00'],
  ['M18-inna', increase('200','2026-12'), 'REVIEW', 'ENTERED', null, '180.00'],
  ['M19', march, 'CORRECTION', 'ASSUMED', '70.00', '80.00'],
  ['M20', {...march,lastOldDate:'2027-03-01'}, 'CORRECTION', 'ASSUMED', '150.00', '0.00'],
  ['M21', end(), 'CORRECTION', 'ASSUMED', '150.00', '0.00'],
  ['M21b', end(undefined,'NOT_ISSUED'), 'NOT_APPLICABLE', 'MISSING', null, '0.00'],
  ['M21c', bok(end('0'),[line('internet','150','0','0')]), 'NO_CORRECTION', 'CONFIRMED', null, '0.00'],
  ['M21d', bok(end('150'),[line('internet','150','0')]), 'CORRECTION', 'CONFIRMED', '150.00', '0.00'],
  ['M22-brak', same(), 'NO_CORRECTION', 'MISSING', null, '150.00'],
  ['M22-zgodna', same('150'), 'NO_CORRECTION', 'ENTERED', null, '150.00'],
  ['M23', same('160'), 'REVIEW', 'ENTERED', null, '150.00'],
  ['M24', bok(march,fourLines), 'CORRECTION', 'CONFIRMED', '18.67', '171.33'],
  ['M25', bok(march,fourLines,{invoiceConfirmed:false}), 'CORRECTION', 'ENTERED', '18.67', '171.33'],
  ['M25-brak-VAT', bok(march,[{...fourLines[0],vat:''},...fourLines.slice(1)]), 'CORRECTION', 'ENTERED', '18.67', '171.33'],
  ['M25-brak-F', bok(march,[...fourLines.slice(0,3),{...fourLines[3],invoiced:''}]), 'INVOICE_REQUIRED', 'MISSING', null, '171.33'],
  // 26.11.2026: Internet 23% + telewizja 8% to zwykły koszyk — poglądowy wynik brutto wg reguły CB (B, 31 dni), bez wartości netto/VAT (D11).
  ['M26', bok(march,[fourLines[0],{...fourLines[1],vat:'8'}]), 'CORRECTION', 'CONFIRMED', '9.33', '150.67'],
  ['M27-netto', bok(march,[{...fourLines[0],basis:'net'}]), 'REVIEW', 'ENTERED', null, null],
  ['M27-B2B', bok(march,[fourLines[0]],{scope:'B2B'}), 'REVIEW', 'ENTERED', null, null],
  ['M28', bok(march,[line('internet','100','80'),line('tv','50','70')]), 'REVIEW', 'ENTERED', null, null],
  ['M29-rabat', {...increase('150'),unresolvedDiscounts:true}, 'REFER', 'ENTERED', null, null],
  ['M29-daty', {...lower('150'),multipleDates:true}, 'REFER', 'ENTERED', null, null],
  ['M29-niepewna', {...lower('150'),dateVerified:false}, 'REFER', 'ENTERED', null, null],
  ['M29-zakres', {...lower('150'),nonComparableScope:true}, 'REFER', 'ENTERED', null, null],
  ['R2a-ujemny-wiersz', bok(march,[line('internet','100','60'),line('tv','50','70')]), 'CORRECTION', 'CONFIRMED', '9.33', '140.67'],
  ['R2a-wzrost-sumy', bok(march,[line('internet','100','90'),line('tv','50','70')]), 'REFER', 'ENTERED', null, null],
  ['R2a-brak-dokumentu', bok(march,[line('internet','100','60'),line('tv','50','70')],{documentState:'NOT_ISSUED'}), 'NOT_APPLICABLE', 'MISSING', null, '140.67'],
  ['R2a-przed-nietypowa', bok({...march,month:'2027-02'},[line('internet','100','60','95'),line('tv','50','70')]), 'REVIEW', 'CONFIRMED', null, '150.00'],
  ['R2a-zero', bok(march,[line('internet','100','60','0'),line('tv','50','70','0')]), 'REVIEW', 'CONFIRMED', null, '140.67'],
  ['R0', {...lower('150'),totals:{old:'-150',new:'120'},unresolvedDiscounts:true}, 'ERROR', 'MISSING', null, null],
];

export const references = [
  ...[
    // Wartości CB-2026-11-25 wpisane ręcznie (niezależnie od testowanej funkcji).
    ['2027-02','2027-02-17','150','100','C','121.67'],
    ['2028-02','2028-02-17','150','100','C','125.00'],
    ['2026-11','2026-11-17','150','100','C','128.33'],
    ['2027-03','2027-03-17','150','100','B','126.67'],
    ['2027-03','2027-03-17','150','0','B','80.00'],
    ['2027-03','2027-03-01','150','0','B','0.00'],
    ['2027-02','2027-02-27','150','100','C','138.33'],
    ['2027-02','2027-02-03','100','80','C','76.67'],
    ['2027-02','2027-01-31','100','80','Pełna N','80.00'],
    ['2026-11','2026-11-15','150','150','Pełna O','150.00'],
    ['2026-11','2026-11-17','150','180','Pełna O','150.00'],
    // P-08: podwyżka od pierwszego dnia miesiąca analizowanego — cena N od dnia 1 (CB-2026-11-25), nie od następnego miesiąca.
    ['2027-03','2027-02-28','150','180','Pełna N','180.00'],
    ['2026-12','2026-11-30','150','180','Pełna N','180.00'],
  ].map(([month,date,old,next,method,due]) => [aggregate(month,date,old,next),method,due]),
  [matrix.find(([id]) => id === 'R2a-ujemny-wiersz')[1], 'B','140.67'],
];
