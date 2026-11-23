import { test, expect } from '@playwright/test';

test('błąd kwoty wskazuje pozycję i pole, wiąże opis i przenosi fokus',async({page})=>{
  await page.goto('/');await page.locator('#example-select').selectOption('T26');await page.locator('#load-example').click();
  const field=page.locator('#positions tbody tr').nth(1).locator('[data-field="invoiced"]');
  await page.locator('#positions tbody tr').nth(1).locator('[data-invoice-override]').check();
  await field.fill('-1');await page.locator('#calculate').click();
  await expect(page.locator('#errors')).toContainText('Pozycja 2');
  await expect(page.locator('#errors')).toContainText(/faktur/i);
  await expect(field).toHaveAttribute('aria-describedby','error-description');
  await page.getByRole('button',{name:'Przejdź do błędnego pola'}).click();
  await expect(field).toBeFocused();
  await field.fill('50');
  await expect(page.locator('#errors')).toBeHidden();
  await expect(field).not.toHaveAttribute('aria-invalid','true');
  await expect(field).not.toHaveAttribute('aria-describedby','error-description');
});

test('zmiana daty lub zdarzenia unieważnia wynik bez zbędnego checkboxa',async({page})=>{
  await page.goto('/');await page.locator('#example-select').selectOption('T26');await page.locator('#load-example').click();
  await page.locator('#calculate').click();
  await expect(page.locator('#results')).toBeVisible();
  await page.locator('#effective-date').fill('2027-03-19');
  await expect(page.locator('#date-verified')).toHaveCount(0);
  await expect(page.locator('#copy-summary')).toBeDisabled();
  await page.locator('#calculate').click();
  await expect(page.locator('#invoice-plan')).toBeVisible();
  await page.locator('#event-type').selectOption('NO_CHANGE');
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#date-verified')).toHaveCount(0);
});

test('długie kwoty nie są obcinane do pozornie poprawnej ceny',async({page})=>{
  await page.goto('/');await page.locator('#example-select').selectOption('T26');await page.locator('#load-example').click();
  const old=page.locator('#positions tbody tr').first().locator('[data-field="old"]');
  const invalid='100000000000000.001';
  await old.fill(invalid);
  await expect(old).toHaveValue(invalid);
  await page.locator('#calculate').click();
  await expect(page.locator('#errors')).toBeVisible();
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#copy-summary')).toBeDisabled();
});
