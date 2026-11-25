// Wyłącznie dane syntetyczne z testów referencyjnych; brak cen ofertowych klientów.
const line=(service,old,next,invoiced=old)=>({label:service==='tv'?'TV-02':'INT-01',description:service==='tv'?'Abonament telewizyjny':'Abonament internetowy',service,old,new:next,invoiced,basis:'gross',vat:''});
const common={month:'2027-03',lastOldDate:'2027-03-17'};
export function example(id) {
  switch(id) {
    case 'FEB_CHANGE': return {...common,month:'2027-02',lastOldDate:'2027-02-03',rows:[line('internet','100,00','80,00')]};
    case 'UPGRADE_LATER': return {...common,month:'2026-11',lastOldDate:'2026-11-01',rows:[line('internet','100,00','130,00')]};
    case 'INVOICE_DIFFERS': return {...common,month:'2026-11',lastOldDate:'2026-11-15',rows:[line('internet','150,00','120,00','160,00')]};
    case 'VAT_REVIEW': return {...common,rows:[{...line('internet','100,00','60,00'),vat:'23'},{...line('tv','50,00','40,00'),vat:'8'}]};
    case 'T27': return {...common,rows:[line('internet','100,00','70,00'),line('tv','50,00','80,00')]};
    case 'T08': return {...common,lastOldDate:'2027-03-01',rows:[line('internet','150,00','0,00')]};
    case 'T01': return {...common,month:'2027-02',lastOldDate:'2027-02-17',rows:[line('internet','150,00','100,00')]};
    case 'T02': return {...common,month:'2028-02',lastOldDate:'2028-02-17',rows:[line('internet','150,00','100,00')]};
    case 'T03': return {...common,month:'2026-11',lastOldDate:'2026-11-17',rows:[line('internet','150,00','100,00')]};
    case 'T18': return {...common,lastOldDate:'2027-02-28',rows:[line('internet','150,00','180,00')]};
    default: return {...common,rows:[line('internet','100,00','60,00'),line('tv','50,00','70,00')]};
  }
}
