import { test, expect } from '@playwright/test';

test.beforeEach(async({page})=>{await page.goto('/');});
test('przykłady mają opisowe nazwy bez kodów testowych',async({page})=>{
  const options=await page.locator('#example-select option').allTextContents();
  expect(options.join('\n')).not.toMatch(/\bT\d{2}\b/);
  expect(options.join('\n')).toMatch(/Luty.*100.*80/);
  await expect(page.locator('#example-select')).toHaveValue('');
  await expect(page.locator('#load-example')).toBeDisabled();
});
test('miesiąc rozliczeniowy wyjaśnia, że trzeba wybrać też rok',async({page})=>{
  await expect(page.locator('#month-hint')).toContainText('miesiąc i rok');
  await expect(page.locator('#month-hint')).toContainText('11.2026');
});
test('przykład lutowy ma konkretne wyjaśnienie liczenia10+66,67',async({page},testInfo)=>{
  await page.locator('#example-select').selectOption('FEB_CHANGE');
  await page.locator('#load-example').click();await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText(/76,67\s+zł/);
  await expect(page.locator('#global-method')).toHaveText(/Rzeczywiste dni.*30/);
  await page.locator('.method-details > summary').click();
  await expect(page.locator('.method-details')).toContainText('100,00 zł × 3 dni ÷ 30 = 10,00 zł');
  await expect(page.locator('.method-details')).toContainText('80,00 zł × 25 dni ÷ 30 = 66,67 zł');
  await expect(page.locator('.method-details')).not.toContainText(/Metoda [AB]|N \+|O \+/);
  await expect(page.locator('#summary')).toHaveValue(/Zmniejszenie faktury o 23,33 zł/);
  await page.screenshot({path:testInfo.outputPath('daily-explained.png'),fullPage:true});
});
test('wariant A/B wybiera niższą należność dla całego koszyka',async({page})=>{
  await page.locator('#example-select').selectOption('FEB_CHANGE');
  await page.locator('#load-example').click();
  await page.locator('#calculation-ab-min').check();
  await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText(/82,00\s+zł/);
  await expect(page.locator('#global-method')).toHaveText('Porównanie A/B — wybrano A');
  await expect(page.locator('#method-explanation')).toContainText('niższą należność dla całego koszyka');
});
test('reset formularza usuwa także błędy i zmienione opcje rozliczenia',async({page})=>{
  await page.locator('#example-select').selectOption('T26');await page.locator('#load-example').click();
  const row=page.locator('#positions tbody tr').first();
  await row.locator('[data-invoice-override]').check();await row.locator('[data-field=invoiced]').fill('70');
  await row.locator('details > summary').click();await row.locator('[data-field=basis]').selectOption('net');
  await row.locator('[data-field=vat]').selectOption('23');
  await page.locator('.complexity > summary').click();
  await page.locator('#multiple-dates').check();await page.locator('#unresolved-discounts').check();
  await page.locator('#calculate').click();await expect(page.locator('#errors')).toBeVisible();
  await page.locator('#reset').click();
  await expect(page.locator('#positions tbody tr')).toHaveCount(1);
  for(const [name,value] of [['service','internet'],['basis','gross'],['vat',''],['old',''],['new',''],['invoiced','']])await expect(page.locator(`#positions [data-field=${name}]`)).toHaveValue(value);
  await expect(page.locator('#positions [data-invoice-override]')).not.toBeChecked();
  await expect(page.locator('#positions [data-field=invoiced]')).toBeDisabled();
  for(const id of ['multiple-dates','unresolved-discounts'])await expect(page.locator(`#${id}`)).not.toBeChecked();
  await expect(page.locator('#example-select')).toHaveValue('');
  await expect(page.locator('details[open]')).toHaveCount(0);
  await expect(page.locator('#errors')).toBeHidden();await expect(page.locator('#summary')).toHaveValue('');
});
test('zakończenie przed miesiącem pokazuje brak opłaty i nie sugeruje nowego abonamentu',async({page})=>{
  await page.locator('#example-select').selectOption('T08');await page.locator('#load-example').click();
  await page.locator('#last-old-date').fill('2027-02-28');await expect(page.locator('#effective-date')).toHaveValue('2027-03-01');
  await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText(/0,00\s+zł/);
  await expect(page.locator('#global-method')).toHaveText('Brak opłaty — usługa zakończona');
  await page.locator('.method-details > summary').click();
  await expect(page.locator('#calculation-steps')).toContainText('usługa jest zakończona');
  await expect(page.locator('#calculation-steps')).not.toContainText('Pełny nowy abonament');
});
test('reset przy wyniku przywraca cały początkowy ekran i pozwala liczyć od nowa',async({page})=>{
  await page.locator('#example-select').selectOption('T26');
  await page.locator('#load-example').click();await page.locator('#calculate').click();
  await page.locator('.method-details > summary').click();
  await page.locator('.technical-rows > summary').click();
  await page.locator('details.row-meta').first().locator('summary').click();
  await page.locator('#reset-result').click();
  await expect(page.locator('#positions tbody tr')).toHaveCount(1);
  for(const field of ['old','new','invoiced'])await expect(page.locator(`#positions [data-field="${field}"]`)).toHaveValue('');
  for(const id of ['month','effective-date','last-old-date','example-select'])await expect(page.locator(`#${id}`)).toHaveValue('');
  await expect(page.locator('#event-type')).toHaveValue('DOWNGRADE');
  await expect(page.locator('#load-example')).toBeDisabled();
  await expect(page.locator('details[open]')).toHaveCount(0);
  await expect(page.locator('#summary')).toHaveValue('');
  await expect(page.locator('#results')).toBeHidden();await expect(page.locator('#copy-summary')).toBeDisabled();
  await page.locator('#example-select').selectOption('FEB_CHANGE');await page.locator('#load-example').click();await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText(/76,67\s+zł/);
});
