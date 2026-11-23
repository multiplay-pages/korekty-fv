import { calculate } from './src/calculator.mjs';

const result = calculate({
  month: '2026-11', effectiveDate: '2026-11-18', lastOldDate: '2026-11-17',
  type: 'DOWNGRADE', old: '150,00', new: '100,00', invoiced: '150,00',
  basis: 'gross', dateVerified: true,
});
console.log('Multiplay BOK — przykład testowy; D05 i D11 pozostają otwarte.');
console.log(`Należność: ${result.due} PLN; różnica F − należność: ${result.delta} PLN; metoda: ${result.method}`);
console.log(JSON.stringify(result, null, 2));
