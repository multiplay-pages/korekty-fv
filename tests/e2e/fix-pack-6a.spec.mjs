import { test, expect } from '@playwright/test';

// FIX_PACK_6A — uzgodnienie groszowe w BOK (FIX-01) i cena umowna przy podwyżce (FIX-02), na ekranie i w kopii.
// Oczekiwane kwoty wyliczono ręcznie (BigInt, grosze), nie funkcją testowaną. Dane wyłącznie syntetyczne.

async function fillRows(page, lastOldDate, rows, month) {
  await page.goto('/');
  await page.locator('#last-old-date').fill(lastOldDate);
  if (month && await page.locator('#month').inputValue() !== month) await page.locator('#month').fill(month);
  await page.locator('input[name=calc-mode][value=BOK]').check();
  for (const [index, [service, old, next, invoiced]] of rows.entries()) {
    if (index > 0) await page.locator('#add-position').click();
    const row = page.locator('#positions tbody tr').nth(index);
    await row.locator('[data-field=service]').selectOption(service);
    await row.locator('[data-field=old]').fill(old);
    await row.locator('[data-field=new]').fill(next);
    await row.locator('[data-field=invoiced]').fill(invoiced);
  }
  await page.locator('#document-state input[value=AMOUNT]').check();
  if (await page.locator('#invoice-confirmed').isEnabled()) await page.locator('#invoice-confirmed').check();
  await page.locator('#calculate').click();
}

async function fillTotals(page, lastOldDate, old, next, invoiced, month) {
  await page.goto('/');
  await page.locator('#last-old-date').fill(lastOldDate);
  if (month && await page.locator('#month').inputValue() !== month) await page.locator('#month').fill(month);
  await page.locator('#basket-old').fill(old);
  await page.locator('#basket-new').fill(next);
  if (invoiced !== undefined) {
    await page.locator('#basket-invoiced').fill(invoiced);
    await page.locator('#document-state input[value=AMOUNT]').check();
  }
  await page.locator('#calculate').click();
}

const reconciliation = page => page.locator('#reconciliation-lines li');

test('FIX-01 przypadek A: luty 2027, 60→40 i 40→40 — dwie osobne reszty na ekranie i w kopii', async ({ page }) => {
  await fillRows(page, '2027-02-03', [['internet', '60', '40', '60'], ['tv', '40', '40', '40']], '2027-02');
  await expect(page.locator('[data-result-state]')).toHaveAttribute('data-result-state', 'CORRECTION');
  await expect(page.locator('#due')).toHaveText('76,67 zł');
  await expect(page.locator('#delta')).toHaveText('−23,33 zł');
  await expect(page.locator('#line-results tbody tr:nth-child(1) [data-field=due]')).toHaveText('39,33 zł');
  await expect(page.locator('#line-results tbody tr:nth-child(2) [data-field=due]')).toHaveText('37,33 zł');
  await expect(reconciliation(page)).toHaveText(['Należność koszyka: 76,67 zł', 'Suma należności pozycji: 76,66 zł', 'Reszta należności koszyka +0,01 zł do uzgodnienia.']);
  await expect(page.locator('#rounding-residual')).toHaveText('Reszta korekty koszyka +0,01 zł do uzgodnienia.');
  const copy = (await page.locator('#summary').inputValue()).split('\n');
  for (const line of ['Należność koszyka: 76,67 zł', 'Suma należności pozycji: 76,66 zł', 'Reszta należności koszyka +0,01 zł do uzgodnienia.',
    'Reszta korekty koszyka +0,01 zł do uzgodnienia.', 'Korekta faktury: −23,33 zł (zmniejszenie)']) expect(copy).toContain(line);
});

test('FIX-01 przypadek B (T26): marzec 2027 — B, 140,67; pozycje 81,33 + 59,33 = 140,66', async ({ page }, testInfo) => {
  await fillRows(page, '2027-03-17', [['internet', '100', '60', '100'], ['tv', '50', '70', '50']], '2027-03');
  await expect(page.locator('#due')).toHaveText('140,67 zł');
  await expect(page.locator('#line-results tbody tr:nth-child(1) [data-field=due]')).toHaveText('81,33 zł');
  await expect(page.locator('#line-results tbody tr:nth-child(2) [data-field=due]')).toHaveText('59,33 zł');
  await expect(reconciliation(page)).toHaveText(['Należność koszyka: 140,67 zł', 'Suma należności pozycji: 140,66 zł', 'Reszta należności koszyka +0,01 zł do uzgodnienia.']);
  await expect(page.locator('#rounding-residual')).toHaveText('Reszta korekty koszyka +0,01 zł do uzgodnienia.');
  const copy = await page.locator('#summary').inputValue();
  expect(copy.split('\n')).toContain('Suma należności pozycji: 140,66 zł');
  if (testInfo.project.name.startsWith('chromium')) await page.screenshot({ path: testInfo.outputPath('FIX01-T26.png'), fullPage: true });
});

test('FIX-01 reszta zerowa: obie reszty 0,00 zł, bez zdania „do uzgodnienia”', async ({ page }) => {
  await fillRows(page, '2026-11-15', [['internet', '100', '80', '100'], ['tv', '50', '40', '50']], '2026-11');
  await expect(reconciliation(page)).toHaveText(['Należność koszyka: 135,00 zł', 'Suma należności pozycji: 135,00 zł', 'Reszta należności koszyka 0,00 zł.', 'Reszta korekty koszyka 0,00 zł.']);
  await expect(page.locator('#remainder-row')).toBeHidden();
  expect(await page.locator('#summary').inputValue()).not.toMatch(/do uzgodnienia/);
});

test('FIX-01 przeciwny znak: luty 2027, 30→20 i 3→2 — reszta należności −0,01, reszta korekty (na ekranie) −0,01', async ({ page }) => {
  await fillRows(page, '2027-02-03', [['internet', '30', '20', '30'], ['tv', '3', '2', '3']], '2027-02');
  await expect(page.locator('#due')).toHaveText('21,63 zł');
  await expect(reconciliation(page).nth(2)).toHaveText('Reszta należności koszyka −0,01 zł do uzgodnienia.');
  await expect(page.locator('#rounding-residual')).toHaveText('Reszta korekty koszyka −0,01 zł do uzgodnienia.');
  const copy = (await page.locator('#summary').inputValue()).split('\n');
  expect(copy).toContain('Reszta należności koszyka −0,01 zł do uzgodnienia.');
  expect(copy).toContain('Reszta korekty koszyka −0,01 zł do uzgodnienia.');
});

test('FIX-01 tryb zbiorczy nie pokazuje uzgodnienia pozycji', async ({ page }) => {
  await fillTotals(page, '2027-02-03', '100', '80', '100', '2027-02');
  await expect(page.locator('#due')).toHaveText('76,67 zł');
  await expect(page.locator('#reconciliation-row')).toBeHidden();
  await expect(page.locator('#remainder-row')).toBeHidden();
  expect(await page.locator('#summary').inputValue()).not.toMatch(/Suma należności pozycji|Reszta należności/);
});

test('FIX-02 podwyżka 150→180, marzec 2027, T=01.03: cena umowna 180, nowa cena od 01.03.2027, bez korekty', async ({ page }, testInfo) => {
  for (const invoiced of ['150', '180']) {
    await fillTotals(page, '2027-02-28', '150', '180', invoiced, '2027-03');
    await expect(page.locator('[data-result-state]')).toHaveAttribute('data-result-state', 'NO_CORRECTION');
    await expect(page.locator('#contract-price')).toHaveText('180,00 zł');
    await expect(page.locator('#contract-price-label')).toHaveText('Cena umowna za 03.2027');
    await expect(page.locator('#next-month-label')).toHaveText('Abonament od 01.03.2027');
    await expect(page.locator('#nominal-price')).toHaveText('180,00 zł');
    const copy = (await page.locator('#summary').inputValue()).split('\n');
    expect(copy).toContain('Cena umowna za 03.2027: 180,00 zł');
    expect(copy).toContain('Abonament od 01.03.2027: 180,00 zł');
    expect(copy.some(line => /zmniejszenie|Zwiększenie/.test(line))).toBe(false);
  }
  if (testInfo.project.name.startsWith('chromium')) await page.screenshot({ path: testInfo.outputPath('FIX02-T01.png'), fullPage: true });
});

test('FIX-02 podwyżka 150→180, T=02.03: cena umowna za marzec 150, nowa cena od 01.04.2027; F=150 zostaje, F=180 → weryfikacja', async ({ page }, testInfo) => {
  await fillTotals(page, '2027-03-01', '150', '180', '150', '2027-03');
  await expect(page.locator('[data-result-state]')).toHaveAttribute('data-result-state', 'NO_CORRECTION');
  await expect(page.locator('#contract-price')).toHaveText('150,00 zł');
  await expect(page.locator('#result-invoiced-label')).toHaveText('Faktura pozostaje');
  await expect(page.locator('#next-month-label')).toHaveText('Abonament od 01.04.2027');
  await expect(page.locator('#nominal-price')).toHaveText('180,00 zł');
  expect(await page.locator('#summary').inputValue()).toContain('Cena umowna za 03.2027: 150,00 zł');

  await page.locator('#basket-invoiced').fill('180');
  await page.locator('#calculate').click();
  await expect(page.locator('[data-result-state]')).toHaveAttribute('data-result-state', 'REVIEW');
  await expect(page.locator('#contract-price')).toHaveText('150,00 zł');
  await expect(page.locator('#result-main-amount')).toBeHidden();
  const copy = await page.locator('#summary').inputValue();
  expect(copy).toContain('Cena umowna za 03.2027: 150,00 zł');
  expect(copy).not.toMatch(/zmniejszenie|Zwiększenie/);
  if (testInfo.project.name.startsWith('chromium')) await page.screenshot({ path: testInfo.outputPath('FIX02-T02-review.png'), fullPage: true });
});

test('FIX-02 F nieznane: cena umowna widoczna, brak wymyślonej faktury', async ({ page }) => {
  await fillTotals(page, '2027-03-01', '150', '180', undefined, '2027-03');
  await expect(page.locator('[data-result-state]')).toHaveAttribute('data-result-state', 'NO_CORRECTION_EXPECTED');
  await expect(page.locator('#contract-price')).toHaveText('150,00 zł');
  await expect(page.locator('#result-invoiced')).toHaveCount(0);
});
