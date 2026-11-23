// Wyłącznie dane syntetyczne z testów referencyjnych; brak cen ofertowych klientów.
const line=(service,old,next,invoiced=old)=>({label:service==='tv'?'TV-02':'INT-01',description:service==='tv'?'Abonament telewizyjny':'Abonament internetowy',service,old,new:next,invoiced,basis:'gross',vat:''});
const common={month:'2027-03',effectiveDate:'2027-03-18',lastOldDate:'',type:'DOWNGRADE',dateVerified:false,multipleDates:false,unresolvedDiscounts:false};
export function example(id) {
  switch(id) {
    case 'FEB_CHANGE': return {...common,month:'2027-02',effectiveDate:'2027-02-04',rows:[line('internet','100,00','80,00')]};
    case 'T27': return {...common,type:'NO_CHANGE',rows:[line('internet','100,00','70,00'),line('tv','50,00','80,00')]};
    case 'T08': return {...common,type:'WYPOWIEDZENIE',effectiveDate:'2027-03-02',lastOldDate:'2027-03-01',rows:[line('internet','150,00','0,00')]};
    case 'T01': return {...common,month:'2027-02',effectiveDate:'2027-02-18',rows:[line('internet','150,00','100,00')]};
    case 'T02': return {...common,month:'2028-02',effectiveDate:'2028-02-18',rows:[line('internet','150,00','100,00')]};
    case 'T03': return {...common,month:'2026-11',effectiveDate:'2026-11-18',rows:[line('internet','150,00','100,00')]};
    case 'T18': return {...common,type:'PODWYŻKA',effectiveDate:'2027-03-01',rows:[line('internet','150,00','180,00')]};
    default: return {...common,rows:[line('internet','100,00','60,00'),line('tv','50,00','70,00')]};
  }
}
