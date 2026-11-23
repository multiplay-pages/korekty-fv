Attempting to perform the InitializeDefaultDrives operation on the 'FileSystem' provider failed.
import {test,expect} from '@playwright/test';

test.beforeEach(async ({page})=>{await page.goto('/');});

test('zmiana na zakończenie i z powrotem zachowuje wpisaną cenę',async({page})=>{
  const price=page.locator('[data-field=new]').first();
  await price.fill('80');
  await page.locator('[data-scenario=WYPOWIEDZENIE]').click();
  await expect(price).toHaveValue('0,00');
  await page.locator('[data-scenario=DOWNGRADE]').click();
  await expect(price).toHaveValue('80');
});

test('brakujące pola i potwierdzenie faktury są pokazane razem',async({page})=>{
  await page.locator('#calculate').click();
  await expect(page.locator('#errors')).toContainText('Miesiąc rozliczeniowy');
  await expect(page.locator('#errors')).toContainText('data zmiany');
  await expect(page.locator('#errors')).toContainText('Dotychczasowy abonament');
  await expect(page.locator('#errors')).toContainText('Nowy abonament');
  await expect(page.locator('#errors')).toContainText('Sprawdź kwotę na fakturze');
  await expect(page.locator('#errors').getByRole('button',{name:'Pozycja 1 — Kwota na fakturze',exact:true})).toHaveCount(0);
});

test('zakończenie wymaga jednej daty, następny dzień jest wyliczany',async({page})=>{
  await page.locator('[data-scenario=WYPOWIEDZENIE]').click();
  await page.locator('#last-old-date').fill('2028-02-29');
  await expect(page.locator('#effective-date')).toHaveValue('2028-03-01');
  await expect(page.locator('#effective-date')).not.toBeEditable();
});

test('użytkownik potwierdza kwotę faktury osobno dla każdej pozycji',async({page})=>{
  await page.locator('#month').fill('2027-02');await page.locator('#effective-date').fill('2027-02-04');
  await page.locator('[data-field=old]').fill('100');await page.locator('[data-field=new]').fill('80');
  await page.locator('#calculate').click();await expect(page.locator('#errors')).toContainText('Sprawdź kwotę na fakturze');
  await page.locator('[data-invoice-confirm]').check();await page.locator('#calculate').click();
  await expect(page.locator('#due')).toContainText('76,67');
  await page.locator('[data-field=old]').fill('110');await page.locator('#calculate').click();
  await expect(page.locator('#errors')).toContainText('Sprawdź kwotę na fakturze');
});

test('wynik podaje kwotę z faktury i należność po korekcie',async({page})=>{
  await page.locator('#example-select').selectOption('FEB_CHANGE');
  await page.locator('#load-example').click();await page.locator('#calculate').click();
  await expect(page.locator('#invoice-comparison')).toContainText('100,00 zł');
  await expect(page.locator('#invoice-comparison')).toContainText('76,67 zł');
  await expect(page.locator('#residual-heading')).toBeHidden();
});

test('wynik podpowiada zmniejszenie faktury bez mylącego znaku plus',async({page})=>{
  await page.locator('#example-select').selectOption('FEB_CHANGE');
  await page.locator('#load-example').click();await page.locator('#calculate').click();
  await expect(page.locator('#delta-action')).toHaveText('Zmniejsz fakturę o');
  await expect(page.locator('#delta')).toHaveText('23,33 zł');
  await expect(page.locator('.amount-delta')).not.toContainText('Zmniejszenie (+)');
});

test('zmiana usługi wymaga ponownego sprawdzenia kwoty faktury',async({page})=>{
  await page.locator('[data-field=old]').fill('100');
  await page.locator('[data-invoice-confirm]').check();
  await page.locator('[data-field=service]').selectOption('tv');
  await expect(page.locator('[data-invoice-confirm]')).not.toBeChecked();
});

test('zmiana miesiąca wymaga ponownego sprawdzenia kwot faktury',async({page})=>{
  await page.locator('#example-select').selectOption('FEB_CHANGE');await page.locator('#load-example').click();
  await expect(page.locator('[data-invoice-confirm]')).toBeChecked();
  await page.locator('#month').fill('2027-03');
  await expect(page.locator('[data-invoice-confirm]')).not.toBeChecked();
});

