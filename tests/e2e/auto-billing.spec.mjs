import { test, expect } from '@playwright/test';

async function fillTotals(page, { month = '2026-11', lastOldDate = '2026-11-15', old = '150', next = '120', invoiced } = {}) {
  await page.locator('#month').fill(month);
  await page.locator('#last-old-date').fill(lastOldDate);
  await page.locator('#basket-old').fill(old);
  await page.locator('#basket-new').fill(next);
  if (invoiced !== undefined) {
    await page.locator('#basket-invoiced').fill(invoiced);
  }
}

test('cztery pola podstawowe i brak wyboru metody', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('calculationMode', 'ACTUAL_DAYS'));
  await page.goto('/?calculationMode=ACTUAL_DAYS&policy=ACTUAL_DAYS');
  await expect(page.locator('#positions tbody tr')).toHaveCount(0);
  const inputs = await page.locator('#calculator-form input:visible:not([type=radio]):not([type=checkbox])')
    .evaluateAll(elements => elements.map(el => el.id));
  expect(inputs).toEqual(['last-old-date', 'month', 'basket-old', 'basket-new', 'basket-invoiced']);
  const invoice = page.locator('#document-state');
  await expect(invoice.getByRole('radio')).toHaveCount(3);
  for (const name of ['Nie wiem', 'Wpisz kwotę', 'Nie wystawiono']) {
    await expect(invoice.getByRole('radio', { name, exact: true })).toBeVisible();
  }
  await expect(page.locator('#training-mode')).not.toBeChecked();
  await expect(page.locator('#bok-details')).not.toHaveAttribute('open', '');
  const forbidden = page.locator('input[name="calculation-mode"], #calculation-actual-days, #calculation-ab-min');
  await expect(forbidden).toHaveCount(0);
  await page.locator('#bok-details > summary').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#bok-details')).toHaveAttribute('open', '');
  await expect(forbidden).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(page.locator('#use-lines')).toBeFocused();
  await fillTotals(page, { month: '2027-02', lastOldDate: '2027-02-03', old: '100', next: '80' });
  await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText('82,00 zł');
  await expect(page.locator('#delta')).toHaveText('+18,00 zł');
  await expect(page.locator('#copy-summary')).toBeEnabled();
  await expect(page.locator('#bok-result')).toBeHidden();
  await expect(page.locator('#document-state input:checked')).toHaveValue('UNKNOWN');
});
test('zmiana daty unieważnia wynik i dobiera pełną kwotę bez reguły częściowej', async ({ page }) => {
  await page.goto('/');
  await fillTotals(page);
  await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText('135,00 zł');
  await page.locator('#last-old-date').fill('2026-10-31');
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#copy-summary')).toBeDisabled();
  await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText('120,00 zł');
  await page.locator('.method-details > summary').click();
  await expect(page.locator('#method-explanation')).toContainText('od pierwszego dnia');
  await expect(page.locator('#formula-note')).toContainText('0.5.0-test-min-ab');
});


test('sumy i pozycje kontrolują jeden koszyk, a zwinięcie zachowuje źródło', async ({ page }) => {
  await page.goto('/');
  await fillTotals(page);
  await page.locator('#bok-details > summary').click();
  await page.locator('#use-lines').check();
  const rows = page.locator('#positions tbody tr');
  for (const [index, service, label, old, next] of [
    [0, 'internet', 'Abonament', '100', '80'],
    [1, 'tv', 'Telewizja', '40', '30'],
    [2, 'multiroom', 'Abonament', '10', '10'],
  ]) {
    if (index) await page.locator('#add-position').click();
    const row = rows.nth(index);
    await row.locator('[data-field=service]').selectOption(service);
    await row.locator('details > summary').click();
    await row.locator('[data-field=label]').fill(label);
    await row.locator('details > summary').click();
    await row.locator('[data-field=old]').fill(old);
    await row.locator('[data-field=new]').fill(next);
    await row.locator('[data-field=invoiced]').fill(old);
  }
  await expect(page.locator('#total-old')).toHaveText('150,00 zł');
  await expect(page.locator('#total-new')).toHaveText('120,00 zł');
  await expect(page.locator('#total-invoiced')).toHaveText('150,00 zł');
  const rowIds = await rows.evaluateAll(elements => elements.map(el => el.dataset.rowId));
  expect(new Set(rowIds).size).toBe(3);
  await page.locator('#bok-details > summary').click();
  await expect(page.locator('#use-lines')).toBeChecked();
  await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText('135,00 zł');
  await expect(page.locator('#line-results [data-field=label]')).toHaveText(['1. Internet','2. Telewizja','3. Multiroom']);

  await page.locator('#bok-details > summary').click();
  await rows.nth(1).locator('[data-field=new]').fill('31');
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#copy-summary')).toBeDisabled();
  await page.locator('#calculate').click();
  await expect(page.locator('#errors')).toContainText('Wpisana suma brutto różni się od sumy pozycji');
  await page.getByRole('button', { name: 'Przejdź do wskazanego pola' }).click();
  await expect(page.locator('#basket-new')).toBeFocused();
  await expect(page.locator('#basket-new')).toHaveValue('120');
  await page.locator('#use-lines').uncheck();
  await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText('135,00 zł');
  await expect(page.locator('#bok-result')).toBeHidden();
  await page.locator('#use-lines').check();
  await expect(rows.nth(1).locator('[data-field=new]')).toHaveValue('31');
  expect(await rows.evaluateAll(elements => elements.map(el => el.dataset.rowId))).toEqual(rowIds);
});

test('różne kategorie VAT wymagają kontroli także po wpisaniu sum', async ({ page }) => {
  await page.goto('/');
  await page.locator('#training-mode').check();
  await page.locator('#example-select').selectOption('VAT_REVIEW');
  await page.locator('#load-example').click();
  for (const declared of [false,true]) {
    if (declared) {
      await page.locator('#toggle-declared').click();
      await page.locator('#basket-old').fill('150');
      await page.locator('#basket-new').fill('100');
      await page.locator('#basket-invoiced').fill('150');
    }
    await page.locator('#calculate').click();
    await expect(page.locator('#result-heading')).toHaveAttribute('data-result-state','REVIEW');
    await expect(page.locator('#delta-explanation')).toContainText('różne stawki VAT');
    await expect(page.locator('#invoice-confirmed')).toBeDisabled();
    await expect(page.locator('#bok-result')).toBeHidden();
    await expect(page.locator('#result-main-amount')).toBeHidden();
    await expect(page.locator('#summary')).toHaveValue(/różne stawki VAT/);
  }
});

test('zbiorcze zero jest kwotą, a przyjęcie F = O jest jawne i odwracalne', async ({ page }) => {
  await page.goto('/');
  await fillTotals(page, { invoiced: '0' });
  await page.locator('#calculate').click();
  await expect(page.locator('#result-invoiced')).toHaveText('0,00 zł');
  await expect(page.locator('#result-heading')).toHaveAttribute('data-result-state','REVIEW');
  await page.locator('#document-state input[value="UNKNOWN"]').check();
  await expect(page.locator('#results')).toBeHidden();
  await page.locator('#calculate').click();
  await expect(page.locator('#delta')).toHaveText('+15,00 zł');
  await expect(page.locator('#invoiced-source')).toContainText('150,00 zł');
  await page.locator('#document-state input[value="AMOUNT"]').check();
  await expect(page.locator('#basket-invoiced')).toHaveValue('0');
  await expect(page.locator('#copy-summary')).toBeDisabled();
});

test('po zmianie miesiąca i daty resolver sam stosuje regułę 30 i 31 dni', async ({ page }) => {
  await page.goto('/');
  await fillTotals(page);
  await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText('135,00 zł');
  await page.locator('#month').fill('2026-12');
  await expect(page.locator('#copy-summary')).toBeDisabled();
  await page.locator('#last-old-date').fill('2026-12-15');
  await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText('134,00 zł');
  await expect(page.locator('#days-month')).toHaveText('31');
  await expect(page.locator('#global-method')).toHaveText('Porównanie A/B — wybrano B');
});

test('ekran zbiorczy mieści formularz i wynik przy szerokości 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/');
  await fillTotals(page);
  await page.locator('#calculate').click();
  await expect(page.locator('#results')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.locator('.method-details > summary').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});


test('zakończenie jednej usługi pozostawia pełną stawkę zachowanej usługi w koszyku', async ({ page }) => {
  await page.goto('/');
  await page.locator('#month').fill('2026-11');
  await page.locator('#last-old-date').fill('2026-11-17');
  await page.locator('#bok-details > summary').click();
  await page.locator('#use-lines').check();
  await page.locator('#add-position').click();
  const rows = page.locator('#positions tbody tr');
  for (const [index, service, old, next] of [[0, 'internet', '100', '100'], [1, 'tv', '50', '0']]) {
    const row = rows.nth(index);
    await row.locator('[data-field=service]').selectOption(service);
    await row.locator('[data-field=old]').fill(old);
    await row.locator('[data-field=new]').fill(next);
    await row.locator('[data-field=invoiced]').fill(old);
  }
  await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText('128,33 zł');
  await expect(page.locator('#nominal-price')).toHaveText('100,00 zł');
  await expect(page.locator('#line-results [data-field=due]').first()).toHaveText('100,00 zł');
});


test('przy stałej cenie faktura różna od O wymaga kontroli bez korekty abonamentowej', async ({ page }) => {
  await page.goto('/');
  await fillTotals(page, { old: '100', next: '100', invoiced: '110' });
  await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText('100,00 zł');
  await expect(page.locator('#result-heading')).toHaveAttribute('data-result-state','REVIEW');
  await expect(page.locator('#result-main-amount')).toBeHidden();
  await expect(page.locator('#delta-explanation')).toContainText('Różnica nie wynika ze zmiany abonamentu');
  await expect(page.locator('#summary')).toHaveValue(/Faktura różni się od abonamentu/);
});


test('BOK wybiera dodatki i od razu widzi rozbicie bez potwierdzania każdej pozycji', async ({ page }) => {
  await page.goto('/');
  await page.locator('#month').fill('2026-12');
  await page.locator('#last-old-date').fill('2026-12-10');
  await page.locator('#bok-details > summary').click();
  await page.locator('#use-lines').check();
  const rows = page.locator('#positions tbody tr');
  const first = rows.first();
  const select = first.locator('[data-field=service]');
  const options = await select.locator('option').allTextContents();
  expect(options).toEqual(expect.arrayContaining([
    'Internet+', 'Łącze symetryczne', 'Stały adres IP', 'WiFi Premium (MESH)',
    'Utrzymanie linii', 'TV MAX', 'C+ Super Sport', 'C+ Seriale i Filmy',
    'PVR M', 'PVR L', 'Multiroom', 'Telefon 60 minut', 'Telefon 300 minut',
    'Bitdefender Mobile Security', 'Bitdefender Family Pack', 'Dzierżawa routera', 'Inny abonament',
  ]));
  await select.selectOption({ label: 'C+ Super Sport' });
  await first.locator('[data-field=old]').fill('100');
  await first.locator('[data-field=new]').fill('80');
  await page.locator('#add-position').click();
  const second = rows.nth(1);
  await second.locator('[data-field=service]').selectOption({ label: 'Stały adres IP' });
  await second.locator('[data-field=old]').fill('50');
  await second.locator('[data-field=new]').fill('20');
  await second.locator('[data-field=invoiced]').fill('55');

  await page.locator('#basket-vat').selectOption('23');
  await expect(page.locator('#invoice-confirmed')).toBeDisabled();
  await page.locator('#calculate').click();
  await expect(page.locator('#result-heading')).toHaveAttribute('data-result-state','INVOICE_REQUIRED');
  await expect(page.locator('#bok-result')).toBeHidden();
  await first.locator('[data-field=invoiced]').fill('100');
  await expect(page.locator('#invoice-confirmed')).toBeEnabled();
  await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText('115,00 zł');
  await expect(page.locator('#delta')).toHaveText('+40,00 zł');
  await expect(page.locator('#invoiced-source')).toContainText('wpisana, niepotwierdzona');
  await expect(page.locator('#line-results tbody tr').first()).toContainText('C+ Super Sport');
  await expect(page.locator('#line-results tbody tr').nth(1)).toContainText('Stały adres IP');
  await expect(page.locator('#summary')).not.toHaveValue(/C\+ Super Sport|Stały adres IP/);
  await page.locator('#invoice-confirmed').check();
  await page.locator('#calculate').click();
  await expect(page.locator('#result-heading')).toHaveText('Faktura potwierdzona');
  await expect(page.locator('#summary')).toHaveValue(/Stały adres IP/);
});


test('UX-04: Enter dodaje pozycję i pozwala potwierdzić cztery wiersze M24', async ({ page }, testInfo) => {
  await page.goto('/');
  const actions = [];
  const choose = async (locator, choice) => {
    await locator.selectOption(choice);
    actions.push(choice);
  };
  const click = async (locator, label) => {
    await locator.click();
    actions.push(label);
  };
  const date = page.locator('#last-old-date');
  await click(date, 'Data');
  await date.fill('2027-03-17');
  await click(page.locator('#bok-details > summary'), 'Panel BOK');
  await click(page.locator('#use-lines'), 'Źródło BOK');

  const rows = page.locator('#positions tbody tr');
  for (const [i, [service, old, next]] of [
    ['internet', '100', '80'], ['tv', '60', '60'], ['multiroom', '20', '0'], ['routerRental', '10', '10'],
  ].entries()) {
    const row = rows.nth(i);
    const serviceInput = row.locator('[data-field=service]');
    if (i === 0) await serviceInput.focus();
    await expect(serviceInput).toBeFocused();
    await choose(serviceInput, service);
    for (const [field, value] of [['old', old], ['new', next], ['invoiced', old]]) {
      await page.keyboard.press('Tab');
      const input = row.locator('[data-field=' + field + ']');
      await expect(input).toBeFocused();
      await page.keyboard.insertText(value);
    }
    if (i < 3) {
      await page.keyboard.press('Enter');
      await expect(rows).toHaveCount(i + 2);
      await expect(page.locator('#results')).toBeHidden();
    }
  }
  await choose(page.locator('#basket-vat'), '23');
  await click(page.locator('#invoice-confirmed'), 'Potwierdzenie');
  await click(page.locator('#calculate'), 'Oblicz');
  await expect(page.locator('#result-heading')).toHaveText('Faktura potwierdzona');
  await expect(page.locator('#delta')).toHaveText('+18,67 zł');
  await expect(page.locator('#line-results tbody tr')).toHaveCount(4);
  await testInfo.attach('interakcje-bok', { body: JSON.stringify(actions), contentType: 'application/json' });
  expect(actions.length).toBeLessThanOrEqual(15);
});
