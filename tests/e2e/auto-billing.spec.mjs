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
  await expect(page.locator('#bok-details')).toBeHidden();
  await expect(page.locator('input[name=calc-mode][value=SUD]')).toBeChecked();
  const forbidden = page.locator('input[name="calculation-mode"], #calculation-actual-days, #calculation-ab-min');
  await expect(forbidden).toHaveCount(0);
  // Jawny przełącznik SUD/BOK (radio — strzałki): BOK pokazuje tabelę pozycji od razu, bez checkboxa „Oblicz na podstawie pozycji”.
  await page.locator('input[name=calc-mode][value=SUD]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('input[name=calc-mode][value=BOK]')).toBeChecked();
  await expect(page.locator('#bok-details')).toBeVisible();
  await expect(forbidden).toHaveCount(0);
  await expect(page.locator('#use-lines')).toHaveCount(0);
  await expect(page.locator('#positions tbody tr')).toHaveCount(1);
  await expect(page.locator('#source-status')).toContainText('pozycje BOK');
  // Powrót do SUD tylko przełącznikiem.
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('input[name=calc-mode][value=SUD]')).toBeChecked();
  await expect(page.locator('#bok-details')).toBeHidden();
  await fillTotals(page, { month: '2027-02', lastOldDate: '2027-02-03', old: '100', next: '80' });
  await page.locator('#calculate').click();
  // CB-2026-11-25, luty 2027 (28 dni): C = (100 × 3 + 80 × 25) ÷ 30 = 76,67; F = O = 100,00.
  await expect(page.locator('#due')).toHaveText('76,67 zł');
  await expect(page.locator('#delta')).toHaveText('−23,33 zł');
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
  await expect(page.locator('#formula-note')).toContainText('0.6.0-test-cb-2026-11-25');
});


test('pozycje BOK i sumy SUD są niezależne; przełącznik SUD/BOK zachowuje pozycje i sumy', async ({ page }) => {
  await page.goto('/');
  await fillTotals(page);
  await page.locator('input[name=calc-mode][value=BOK]').check();
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
  await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText('135,00 zł');
  await expect(page.locator('#line-results [data-field=label]')).toHaveText(['1. Internet · VAT 23%','2. Telewizja · VAT 8%','3. Multiroom · VAT 8%']);

  await rows.nth(1).locator('[data-field=new]').fill('31');
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#copy-summary')).toBeDisabled();
  await page.locator('#calculate').click();
  // Pozycje różnią się teraz od sum SUD (121 ≠ 120) — BOK liczy wyłącznie z pozycji, bez porównania sum.
  // TV (40 × 15 + 31 × 15) ÷ 30 = 35,50 → 90,00 + 35,50 + 10,00 = 135,50.
  await expect(page.locator('#errors')).toBeHidden();
  await expect(page.locator('#due')).toHaveText('135,50 zł');
  await page.locator('input[name=calc-mode][value=SUD]').check();
  await expect(page.locator('#basket-new')).toHaveValue('120');
  await expect(page.locator('#bok-details')).toBeHidden();
  await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText('135,00 zł');
  await expect(page.locator('#bok-result')).toBeHidden();
  await page.locator('input[name=calc-mode][value=BOK]').check();
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#source-status')).toContainText('pozycje BOK');
  await expect(rows.nth(1).locator('[data-field=new]')).toHaveValue('31');
  expect(await rows.evaluateAll(elements => elements.map(el => el.dataset.rowId))).toEqual(rowIds);
});

test('Internet 23% i telewizja 8%: poglądowy wynik brutto wg reguły CB, bez wartości księgowych', async ({ page }) => {
  await page.goto('/');
  await page.locator('#training-mode').check();
  await page.locator('#example-select').selectOption('VAT_REVIEW');
  await page.locator('#load-example').click();
  const rows = page.locator('#positions tbody tr');
  expect(await rows.locator('[data-field=vat]').evaluateAll(els => els.map(el => el.value))).toEqual(['23', '8']);
  await page.locator('#calculate').click();
  // Marzec 2027 (31 dni), d = 17, r = 14: B = 150 + (100 − 150) × 14/30 = 126,67; F = 150 → korekta −23,33.
  await expect(page.locator('#result-heading')).toHaveAttribute('data-result-state','CORRECTION');
  await expect(page.locator('#due')).toHaveText('126,67 zł');
  await expect(page.locator('#delta')).toHaveText('−23,33 zł');
  await expect(page.locator('#line-results [data-field=label]')).toHaveText(['1. Internet · VAT 23%', '2. Telewizja · VAT 8%']);
  await expect(page.locator('#line-results [data-field=due]')).toHaveText(['81,33 zł', '45,33 zł']);
  await expect(page.locator('#line-results [data-field=delta]')).toHaveText([/^−18,67 zł/, /^−4,67 zł/]);
  await expect(page.locator('#rounding-residual')).toHaveText('Reszta korekty koszyka +0,01 zł do uzgodnienia.');
  await expect(page.locator('#scenario-warnings')).toContainText('różne stawki VAT');
  await expect(page.locator('#invoice-confirmed')).toBeEnabled();
  await page.locator('#invoice-confirmed').check();
  await page.locator('#calculate').click();
  await expect(page.locator('#result-heading')).toHaveText('Faktura potwierdzona');
  const copy = (await page.locator('#summary').inputValue()).split('\n');
  for (const line of ['Korekta faktury: −23,33 zł (zmniejszenie)', 'Należność za miesiąc: 126,67 zł',
    '1. Internet · VAT 23% · 100,00 zł · 81,33 zł · −18,67 zł · Zmniejszenie (poglądowo).',
    '2. Telewizja · VAT 8% · 50,00 zł · 45,33 zł · −4,67 zł · Zmniejszenie (poglądowo).',
    'Reszta korekty koszyka +0,01 zł do uzgodnienia.']) expect(copy).toContain(line);
  expect(copy.some(line => /różne stawki VAT.*D11/.test(line))).toBe(true);
  expect(copy.join('\n')).not.toMatch(/netto:|kwota VAT/i);
});

test('słownik usług podstawia VAT, VAT jest edytowalny, a pozycje aktualizują sumy', async ({ page }) => {
  await page.goto('/');
  await page.locator('#month').fill('2026-11');
  await page.locator('#last-old-date').fill('2026-11-15');
  await page.locator('input[name=calc-mode][value=BOK]').check();
  const rows = page.locator('#positions tbody tr');
  const vat = index => rows.nth(index).locator('[data-field=vat]');
  await expect(rows).toHaveCount(1);
  await rows.first().locator('[data-field=service]').selectOption({ label: 'Internet' });
  await expect(vat(0)).toHaveValue('23');
  await rows.first().locator('[data-field=service]').selectOption({ label: 'Telewizja' });
  await expect(vat(0)).toHaveValue('8');
  await rows.first().locator('[data-field=service]').selectOption({ label: 'Internet' });
  await expect(vat(0)).toHaveValue('23');
  await vat(0).selectOption('8');
  await expect(vat(0)).toHaveValue('8');
  await rows.first().locator('[data-field=service]').selectOption({ label: 'Multiroom' });
  await expect(vat(0)).toHaveValue('8');
  await expect(rows.first().locator('.vat-draft')).toBeVisible();
  await rows.first().locator('[data-field=service]').selectOption({ label: 'Internet' });
  await expect(rows.first().locator('.vat-draft')).toBeHidden();
  await rows.first().locator('[data-field=old]').fill('100');
  await rows.first().locator('[data-field=new]').fill('80');
  await page.locator('#add-position').click();
  await rows.nth(1).locator('[data-field=service]').selectOption({ label: 'Telewizja' });
  await expect(vat(1)).toHaveValue('8');
  await rows.nth(1).locator('[data-field=old]').fill('50');
  await rows.nth(1).locator('[data-field=new]').fill('40');
  await expect(page.locator('#total-old')).toHaveText('150,00 zł');
  await expect(page.locator('#total-new')).toHaveText('120,00 zł');
  await page.locator('#add-position').click();
  await rows.nth(2).locator('[data-field=service]').selectOption({ label: 'Telewizja' });
  await rows.nth(2).locator('[data-field=old]').fill('10');
  await rows.nth(2).locator('[data-field=new]').fill('5');
  await expect(page.locator('#total-old')).toHaveText('160,00 zł');
  await expect(page.locator('#total-new')).toHaveText('125,00 zł');
  await rows.nth(0).locator('[data-action=remove]').click();
  await expect(rows).toHaveCount(2);
  await expect(page.locator('#total-old')).toHaveText('60,00 zł');
  await expect(page.locator('#total-new')).toHaveText('45,00 zł');
  await expect(page.locator('#basket-vat')).toHaveCount(0);
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
  await expect(page.locator('#delta')).toHaveText('−15,00 zł');
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
  await expect(page.locator('#global-method')).toHaveText('Reguła CB — miesiąc 31-dniowy: stara cena + (nowa − stara) × dni nowej ceny ÷ 30');
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
  await page.locator('input[name=calc-mode][value=BOK]').check();
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
  await page.locator('input[name=calc-mode][value=BOK]').check();
  const rows = page.locator('#positions tbody tr');
  const first = rows.first();
  const select = first.locator('[data-field=service]');
  const options = await select.locator('option').allTextContents();
  expect(options).toEqual([
    'Internet', 'Telewizja', 'Telefon', 'Multiroom', 'CANAL+ — pakiety kanałów', 'Dodatkowy pakiet TV',
    'Jeszcze Raz / PVR', 'Wi-Fi Premium / MESH', 'Internet Plus / stały IP', 'Internet symetryczny',
    'Bezpieczny Internet', 'Utrzymanie linii', 'Dzierżawa urządzenia', 'VOD — odrębna usługa', 'Inna usługa',
  ]);
  await select.selectOption({ label: 'CANAL+ — pakiety kanałów' });
  await expect(first.locator('[data-field=vat]')).toHaveValue('8');
  await first.locator('[data-field=old]').fill('100');
  await first.locator('[data-field=new]').fill('80');
  await page.locator('#add-position').click();
  const second = rows.nth(1);
  await second.locator('[data-field=service]').selectOption({ label: 'Internet Plus / stały IP' });
  await expect(second.locator('[data-field=vat]')).toHaveValue('23');
  await second.locator('[data-field=old]').fill('50');
  await second.locator('[data-field=new]').fill('20');
  await second.locator('[data-field=invoiced]').fill('55');

  await expect(page.locator('#invoice-confirmed')).toBeDisabled();
  await page.locator('#calculate').click();
  await expect(page.locator('#result-heading')).toHaveAttribute('data-result-state','INVOICE_REQUIRED');
  await expect(page.locator('#bok-result')).toBeHidden();
  await first.locator('[data-field=invoiced]').fill('100');
  await expect(page.locator('#invoice-confirmed')).toBeEnabled();
  await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText('115,00 zł');
  await expect(page.locator('#delta')).toHaveText('−40,00 zł');
  await expect(page.locator('#invoiced-source')).toContainText('wpisana, niepotwierdzona');
  await expect(page.locator('#line-results tbody tr').first()).toContainText('CANAL+ — pakiety kanałów · VAT 8%');
  await expect(page.locator('#line-results tbody tr').nth(1)).toContainText('Internet Plus / stały IP · VAT 23%');
  await expect(page.locator('#summary')).not.toHaveValue(/CANAL\+|Internet Plus/);
  await page.locator('#invoice-confirmed').check();
  await page.locator('#calculate').click();
  await expect(page.locator('#result-heading')).toHaveText('Faktura potwierdzona');
  await expect(page.locator('#summary')).toHaveValue(/Internet Plus \/ stały IP/);
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
  await click(page.locator('input[name=calc-mode][value=BOK]'), 'Tryb BOK');

  const rows = page.locator('#positions tbody tr');
  for (const [i, [service, old, next]] of [
    ['internet', '100', '80'], ['tv', '60', '60'], ['multiroom', '20', '0'], ['rental', '10', '10'],
  ].entries()) {
    const row = rows.nth(i);
    const serviceInput = row.locator('[data-field=service]');
    if (i === 0) await serviceInput.focus();
    await expect(serviceInput).toBeFocused();
    await choose(serviceInput, service);
    // Kolumna VAT (podstawiona ze słownika) leży między usługą a kwotami — Tab ją przechodzi bez zmiany.
    await page.keyboard.press('Tab');
    await expect(row.locator('[data-field=vat]')).toBeFocused();
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
  await click(page.locator('#invoice-confirmed'), 'Potwierdzenie');
  await click(page.locator('#calculate'), 'Oblicz');
  await expect(page.locator('#result-heading')).toHaveText('Faktura potwierdzona');
  await expect(page.locator('#delta')).toHaveText('−18,67 zł');
  await expect(page.locator('#line-results tbody tr')).toHaveCount(4);
  await testInfo.attach('interakcje-bok', { body: JSON.stringify(actions), contentType: 'application/json' });
  expect(actions.length).toBeLessThanOrEqual(15);
});

test('przełącznik SUD → BOK → SUD: dane zostają, wynik i potwierdzenie nie przechodzą między trybami, „Nowa sprawa” wraca do SUD', async ({ page }) => {
  const sud = page.locator('input[name=calc-mode][value=SUD]');
  const bok = page.locator('input[name=calc-mode][value=BOK]');
  const rows = page.locator('#positions tbody tr');
  await page.goto('/');
  await expect(sud).toBeChecked();
  await expect(page.locator('#bok-details')).toBeHidden();
  // SUD: listopad 2026 (30 dni), zmiana po 15.11 — C = (150 × 15 + 120 × 15) ÷ 30 = 135,00; F nieznane = O.
  await fillTotals(page);
  await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText('135,00 zł');
  await expect(page.locator('#delta')).toHaveText('−15,00 zł');

  // SUD → BOK: tabela od razu, bez kopiowania sum do pozycji; poprzedni wynik i kopia unieważnione.
  await bok.check();
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#copy-summary')).toBeDisabled();
  await expect(page.locator('#basket-old')).toBeHidden();
  await expect(rows).toHaveCount(1);
  for (const field of ['old', 'new', 'invoiced']) await expect(rows.first().locator(`[data-field=${field}]`)).toHaveValue('');
  for (const [index, service, old, next] of [[0, 'internet', '100', '80'], [1, 'tv', '50', '40']]) {
    if (index) await page.locator('#add-position').click();
    const row = rows.nth(index);
    await row.locator('[data-field=service]').selectOption(service);
    await row.locator('[data-field=old]').fill(old);
    await row.locator('[data-field=new]').fill(next);
    await row.locator('[data-field=invoiced]').fill(old);
  }
  await page.locator('#invoice-confirmed').check();
  await page.locator('#calculate').click();
  await expect(page.locator('#result-heading')).toHaveText('Faktura potwierdzona');
  // Internet (100 × 15 + 80 × 15) ÷ 30 = 90,00; TV (50 × 15 + 40 × 15) ÷ 30 = 45,00.
  await expect(page.locator('#due')).toHaveText('135,00 zł');
  await expect(page.locator('#delta')).toHaveText('−15,00 zł');
  // Rozwijanie i zwijanie paneli nie zmienia trybu ani wyniku.
  await page.locator('.complexity > summary').click();
  await page.locator('.complexity > summary').click();
  await expect(bok).toBeChecked();
  await expect(page.locator('#results')).toBeVisible();

  // BOK → SUD: sumy SUD wracają bez zmian, potwierdzenie BOK nie przechodzi.
  await sud.check();
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#invoice-confirmed')).not.toBeChecked();
  await expect(page.locator('#bok-details')).toBeHidden();
  await expect(page.locator('#basket-old')).toHaveValue('150');
  await expect(page.locator('#basket-new')).toHaveValue('120');
  await expect(page.locator('#document-state input:checked')).toHaveValue('UNKNOWN');
  await expect(page.locator('#source-status')).toContainText('Wpisane pozycje BOK pozostają zapisane');
  await page.locator('#calculate').click();
  await expect(page.locator('#result-heading')).toHaveText('Szacunek');
  await expect(page.locator('#due')).toHaveText('135,00 zł');
  await expect(page.locator('#bok-result')).toBeHidden();

  // SUD → BOK ponownie: pozycje zachowane, potwierdzenie trzeba złożyć od nowa.
  await bok.check();
  await expect(page.locator('#results')).toBeHidden();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('[data-field=new]')).toHaveValue('80');
  await expect(rows.nth(1).locator('[data-field=vat]')).toHaveValue('8');
  await expect(page.locator('#document-state input:checked')).toHaveValue('AMOUNT');
  await expect(page.locator('#invoice-confirmed')).not.toBeChecked();
  await expect(page.locator('#invoice-confirmed')).toBeEnabled();

  await page.locator('#reset').click();
  await expect(sud).toBeChecked();
  await expect(page.locator('#bok-details')).toBeHidden();
  await expect(rows).toHaveCount(0);
  await expect(page.locator('#basket-old')).toHaveValue('');
  await expect(page.locator('#results')).toBeHidden();
});

test('BOK liczy wyłącznie z pozycji: inne kwoty wpisane w SUD nie wpływają na wynik, ostrzeżenia ani kopię', async ({ page }) => {
  const bok = page.locator('input[name=calc-mode][value=BOK]');
  const rows = page.locator('#positions tbody tr');
  await page.goto('/');
  // SUD: celowo inne kwoty niż w pozycjach BOK (999 → 500, faktura 700).
  await fillTotals(page, { old: '999', next: '500', invoiced: '700' });
  await bok.check();
  await expect(page.locator('#toggle-declared, #declared-note, #derived-overview')).toHaveCount(0);
  await expect(page.locator('#aggregate-values')).toBeHidden();
  await expect(page.locator('#source-status')).toHaveText('Źródło kalkulacji: pozycje BOK.');
  for (const [index, service, old, next] of [[0, 'internet', '100', '80'], [1, 'tv', '50', '40']]) {
    if (index) await page.locator('#add-position').click();
    const row = rows.nth(index);
    await row.locator('[data-field=service]').selectOption(service);
    await row.locator('[data-field=old]').fill(old);
    await row.locator('[data-field=new]').fill(next);
    await row.locator('[data-field=invoiced]').fill(old);
  }
  await expect(page.locator('#total-old')).toHaveText('150,00 zł');
  await page.locator('#invoice-confirmed').check();
  await page.locator('#calculate').click();
  await expect(page.locator('#errors')).toBeHidden();
  await expect(page.locator('#result-heading')).toHaveText('Faktura potwierdzona');
  // Internet (100 × 15 + 80 × 15) ÷ 30 = 90,00; TV (50 × 15 + 40 × 15) ÷ 30 = 45,00; F z pozycji = 150,00.
  await expect(page.locator('#due')).toHaveText('135,00 zł');
  await expect(page.locator('#delta')).toHaveText('−15,00 zł');
  const copy = await page.locator('#summary').inputValue();
  expect(copy).not.toMatch(/999|700|500,00/);

  // Dane SUD zostały w formularzu i wracają po przełączeniu; SUD liczy z własnych sum: (999 × 15 + 500 × 15) ÷ 30 = 749,50.
  await page.locator('input[name=calc-mode][value=SUD]').check();
  await expect(page.locator('#basket-old')).toHaveValue('999');
  await expect(page.locator('#basket-invoiced')).toHaveValue('700');
  await page.locator('#calculate').click();
  await expect(page.locator('#due')).toHaveText('749,50 zł');
});
