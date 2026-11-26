import { test, expect } from '@playwright/test';

test.beforeEach(async({page})=>{await page.goto('/');});
test('przykłady mają opisowe nazwy bez kodów testowych',async({page})=>{
  await expect(page.locator('#example-select')).toBeHidden();
  await page.locator('#training-mode').check();
  await expect(page.locator('#example-select')).toBeVisible();
  const options=await page.locator('#example-select option').allTextContents();
  expect(options.join('\n')).not.toMatch(/\bT\d{2}\b/);
  expect(options.join('\n')).toMatch(/Luty.*100.*80/);
  await expect(page.locator('#example-select')).toHaveValue('');
  await expect(page.locator('#load-example')).toBeDisabled();
});
test('miesiąc rozliczeniowy wyjaśnia, że trzeba wybrać też rok',async({page})=>{
  await expect(page.locator('#month-hint')).toContainText('miesiąc i rok');
  await expect(page.locator('#month-hint')).not.toContainText('RRRR-MM');
});
test('lutowe wyjaśnienie pokazuje automatycznie dobrany sposób i konkretne działanie', async ({page}) => {
  await page.locator('#training-mode').check();
  await page.locator('#example-select').selectOption('FEB_CHANGE');
  await page.locator('#load-example').click();
  await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText('76,67 zł');
  await page.locator('.method-details > summary').click();
  await expect(page.locator('#global-method')).toHaveText('Reguła CB — miesiąc 28/29/30-dniowy: (stara cena × dni + nowa cena × dni) ÷ 30');
  await expect(page.locator('#calculation-steps')).toContainText('(100,00 × 3 + 80,00 × 25) ÷ 30 = 76,67 zł');
  await expect(page.locator('.method-details input, .method-details select')).toHaveCount(0);
  await expect(page.locator('#summary')).toHaveValue(/Korekta faktury: −23,33 zł \(zmniejszenie\)/);
});
test('reset formularza usuwa także błędy i zmienione opcje rozliczenia',async({page})=>{
  await page.locator('#training-mode').check();
  await page.locator('#example-select').selectOption('T26');await page.locator('#load-example').click();
  const row=page.locator('#positions tbody tr').first();
  await row.locator('[data-field=invoiced]').fill('70');
  await row.locator('details > summary').click();await row.locator('[data-field=basis]').selectOption('net');
  await row.locator('[data-field=vat]').selectOption('23');
  await page.locator('.complexity > summary').click();
  await page.locator('#multiple-dates').check();await page.locator('#unresolved-discounts').check();
  await page.locator('#calculate').click();await expect(page.locator('#result-heading')).toHaveAttribute('data-result-state','REFER');
  await page.locator('#reset').click();
  await expect(page.locator('#positions tbody tr')).toHaveCount(0);
  await expect(page.locator('#bok-details')).toBeHidden();
  await expect(page.locator('input[name=calc-mode][value=SUD]')).toBeChecked();
  await expect(page.locator('#basket-invoiced')).toHaveValue('');
  for(const id of ['multiple-dates','unresolved-discounts'])await expect(page.locator(`#${id}`)).not.toBeChecked();
  await expect(page.locator('#example-select')).toHaveValue('');
  await expect(page.locator('details[open]')).toHaveCount(0);
  await expect(page.locator('#errors')).toBeHidden();await expect(page.locator('#summary')).toHaveValue('');
});
test('zakończenie przed miesiącem pokazuje brak opłaty i nie sugeruje nowego abonamentu',async({page})=>{
  await page.locator('#training-mode').check();
  await page.locator('#example-select').selectOption('T08');await page.locator('#load-example').click();
  await page.locator('#last-old-date').fill('2027-02-28');await expect(page.locator('#date-preview')).toContainText('01.03.2027');
  await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText(/0,00\s+zł/);
  await page.locator('.method-details > summary').click();
  await expect(page.locator('#method-explanation')).toContainText('abonament wynosi 0,00 zł');

});
test('Nowa sprawa przy wyniku przywraca cały początkowy ekran i pozwala liczyć od nowa',async({page})=>{
  await page.locator('#training-mode').check();
  await page.locator('#example-select').selectOption('T26');
  await page.locator('#load-example').click();await page.locator('#calculate').click();
  await page.locator('.method-details > summary').click();
  await expect(page.locator('#line-results')).toBeVisible();
  await page.locator('details.row-meta').first().locator('summary').click();
  const reset = page.getByRole('button', { name: 'Nowa sprawa', exact: true });
  await expect(reset).toHaveCount(1);
  await reset.click();
  await expect(page.locator('#last-old-date')).toBeFocused();
  await expect(page.locator('#example-select')).toBeHidden();
  await expect(page.locator('#positions tbody tr')).toHaveCount(0);
  for(const field of ['old','new','invoiced'])await expect(page.locator(`#basket-${field}`)).toHaveValue('');
  for(const id of ['month','last-old-date','example-select'])await expect(page.locator(`#${id}`)).toHaveValue('');
  await expect(page.locator('#event-type')).toHaveCount(0);
  await expect(page.locator('#load-example')).toBeDisabled();
  await expect(page.locator('details[open]')).toHaveCount(0);
  await expect(page.locator('#summary')).toHaveValue('');
  await expect(page.locator('#results')).toBeHidden();await expect(page.locator('#copy-summary')).toBeDisabled();
  await page.locator('#training-mode').check();
  await page.locator('#example-select').selectOption('FEB_CHANGE');await page.locator('#load-example').click();await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText(/76,67\s+zł/);
});
