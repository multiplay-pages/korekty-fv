import {test,expect} from '@playwright/test';

test.beforeEach(async ({page})=>{await page.goto('/');});

test('cenę zerową wpisuje się w pole nowego abonamentu', async ({page}) => {
  await page.locator('#month').fill('2026-11');
  await page.locator('#last-old-date').fill('2026-11-17');
  await page.locator('#basket-old').fill('150');
  await page.locator('#basket-new').fill('0');
  await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText('85,00 zł');
  await expect(page.locator('#basket-new')).toBeEditable();
});

test('brakujące kwoty zbiorcze prowadzą do właściwych pól', async ({page}) => {
  await page.locator('#calculate').click();
  const errors = page.locator('#errors');
  await expect(errors).toContainText('Miesiąc i rok rozliczeniowy');
  await expect(errors).toContainText('Ostatni dzień starych warunków');
  await expect(errors).toContainText('Dotychczasowy abonament');
  await expect(errors).toContainText('Nowy abonament');
  await errors.getByRole('button', {name: 'Nowy abonament', exact: true}).click();
  await expect(page.locator('#basket-new')).toBeFocused();
});

test('zakończenie wymaga jednej daty, następny dzień jest wyliczany',async({page})=>{
  await page.locator('#last-old-date').fill('2028-02-29');
  await expect(page.locator('#date-preview')).toContainText('01.03.2028');
  await expect(page.locator('#effective-date')).toHaveCount(0);
});

test('faktyczna kwota faktury wymaga podania przy włączonej opcji innej kwoty', async ({page}) => {
  await page.locator('#bok-details > summary').click();
  await page.locator('#use-lines').check();
  await page.locator('#month').fill('2027-02');
  await page.locator('#last-old-date').fill('2027-02-03');
  await page.locator('[data-field=old]').fill('100');
  await page.locator('[data-field=new]').fill('80');
  await page.locator('#document-state input[value="AMOUNT"]').check();
  const invoice = page.locator('[data-field=invoiced]');
  await invoice.clear();
  await page.locator('#calculate').click();
  await expect(page.locator('#result-heading')).toHaveAttribute('data-result-state','INVOICE_REQUIRED');
  await expect(page.locator('#document-state input:checked')).toBeFocused();
  await expect(invoice).toHaveValue('');
  await expect(page.locator('#result-main-amount')).toBeHidden();
  await invoice.fill('95');
  await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText('82,00 zł');
  await expect(page.locator('#delta')).toHaveText('+13,00 zł');
  await expect(page.locator('#invoiced-source')).toContainText('wpisana, niepotwierdzona');
});

test('wynik podaje kwotę z faktury i należność po korekcie',async({page})=>{
  await page.locator('#training-mode').check();
  await page.locator('#example-select').selectOption('FEB_CHANGE');
  await page.locator('#load-example').click();await page.locator('#calculate').click();
  await expect(page.locator('#invoiced-source')).toContainText('Założono kwotę faktury');
  await expect(page.locator('#invoiced-source')).toContainText('100,00 zł');
  await expect(page.locator('#due')).toHaveText('82,00 zł');
  await expect(page.locator('#remainder-row')).toBeHidden();
});

test('wynik podaje dodatnią różnicę z opisem zmniejszenia',async({page})=>{
  await page.locator('#training-mode').check();
  await page.locator('#example-select').selectOption('FEB_CHANGE');
  await page.locator('#load-example').click();await page.locator('#calculate').click();
  await expect(page.locator('#result-main-amount')).toHaveText('+18,00 zł — zmniejszenie');
});

test('zmiana usługi lub miesiąca unieważnia wynik i zachowuje wpisane dane', async ({page}) => {
  await page.locator('#training-mode').check();
  await page.locator('#example-select').selectOption('T26');
  await page.locator('#load-example').click();
  const row = page.locator('#positions tbody tr').first();
  await row.locator('[data-field=invoiced]').fill('110');
  await page.locator('#calculate').click();
  await expect(page.locator('#line-results')).toBeVisible();
  await row.locator('[data-field=service]').selectOption({label: 'Internet+'});
  await expect(page.locator('#results')).toBeHidden();
  await page.locator('#month').fill('2027-04');
  await expect(row.locator('[data-field=invoiced]')).toHaveValue('110');
  await page.locator('#calculate').click();
  await expect(page.locator('#result-heading')).toHaveAttribute('data-result-state','REVIEW');
  await expect(page.locator('#result-invoiced')).toHaveText('160,00 zł');
  await expect(page.locator('#bok-result')).toBeHidden();
});
