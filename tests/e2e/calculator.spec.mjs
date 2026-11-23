import { test as base, expect } from '@playwright/test';

const APP_ORIGIN = 'http://127.0.0.1:4173';

// Every scenario also checks that the local calculator remains self-contained.
const test = base.extend({
  browserDiagnostics: [async ({ context, page }, use, testInfo) => {
    const externalRequests = new Set();
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    const badResponses = [];

    context.on('request', request => {
      const url = new URL(request.url());
      if (['http:', 'https:'].includes(url.protocol) && url.origin !== APP_ORIGIN) {
        externalRequests.add(request.url());
      }
    });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return ['http:', 'https:'].includes(url.protocol) && url.origin !== APP_ORIGIN
        ? route.abort('blockedbyclient')
        : route.continue();
    });
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', error => pageErrors.push(error.message));
    context.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
    context.on('response', response => { if (response.status() >= 400) badResponses.push({ url: response.url(), status: response.status() }); });
    page.on('websocket', socket => {
      const url = new URL(socket.url());
      if (url.host !== new URL(APP_ORIGIN).host) externalRequests.add(socket.url());
    });

    await use();

    const diagnostics = { externalRequests: [...externalRequests], consoleErrors, pageErrors, failedRequests, badResponses };
    if (Object.values(diagnostics).some(values => values.length)) {
      await testInfo.attach('browser-diagnostics', {
        body: JSON.stringify(diagnostics, null, 2),
        contentType: 'application/json',
      });
    }
    expect(diagnostics.externalRequests, 'No requests may leave the local test server').toEqual([]);
    expect(consoleErrors, 'The browser console must contain no errors').toEqual([]);
    expect(pageErrors, 'The calculator must not raise uncaught errors').toEqual([]);
    expect(failedRequests, 'Every local app request must complete').toEqual([]);
    expect(badResponses, 'Every local asset must return a successful status').toEqual([]);
  }, { auto: true }],
});

const positions = page => page.locator('#positions tbody tr');
const positionField = (page, index, name) => positions(page).nth(index).locator(`[data-field="${name}"]`);
const resultField = (page, index, name) => page.locator('#line-results tbody tr').nth(index).locator(`[data-field="${name}"]`);
const invoiceOverride = (page, index) => positions(page).nth(index).locator('[data-invoice-override]');
const invoicePlanField = (page, index, name) => page.locator('#invoice-plan tbody tr').nth(index).locator(`[data-field="${name}"]`);

function moneyPattern(amount, signed = false) {
  const negative = amount.startsWith('-');
  const localized = amount.replace(/^-/, '').replace('.', ',');
  const sign = negative ? '[−-]' : signed && amount !== '0.00' ? '\\+' : '';
  return new RegExp(`${sign}${localized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+zł`);
}

async function expectMoney(locator, amount, signed = false) {
  await expect(locator).toHaveText(new RegExp(`^\\s*${moneyPattern(amount, signed).source}\\s*$`));
}

async function expectInvoiceSplit(page, index, amounts) {
  for (const [field, amount] of Object.entries(amounts)) {
    await expectMoney(invoicePlanField(page, index, field), amount, field === 'period-residual');
  }
}

async function expectNoResult(page) {
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#invoice-plan')).toBeHidden();
  await expect(page.locator('#copy-summary')).toBeDisabled();
  await expect(page.locator('#summary')).toHaveValue('');
}

async function loadExample(page, example) {
  await page.locator('#example-select').selectOption(example);
  await page.locator('#load-example').click();
  await expectNoResult(page);
}

async function calculateVerified(page) {
  await page.locator('#calculate').click();
  await expect(page.locator('#invoice-plan')).toBeVisible();
  await expect(page.locator('#copy-summary')).toBeEnabled();
}

async function setInvoiceOverride(page, index, value) {
  await invoiceOverride(page, index).check();
  await expect(positionField(page, index, 'invoiced')).toBeEnabled();
  await positionField(page, index, 'invoiced').fill(value);
}

async function setMetadata(page, index, field, value) {
  const input = positionField(page, index, field);
  if (!await input.isVisible()) {
    await positions(page).nth(index).locator('details.row-meta > summary').click();
  }
  await input.selectOption(value);
}

async function checkComplexity(page, selector) {
  const checkbox = page.locator(selector);
  if (!await checkbox.isVisible()) {
    await page.locator('details').filter({ has: checkbox }).locator('summary').click();
  }
  await checkbox.check();
}

async function fillManualCase(page, overrides = {}) {
  const input = {
    type: 'DOWNGRADE', month: '2026-11', effectiveDate: '2026-11-18',
    old: '150', new: '100', invoiced: '150', ...overrides,
  };
  if (!Object.hasOwn(overrides, 'invoiced')) input.invoiced = input.old;
  await page.locator('#event-type').selectOption(input.type);
  await page.locator('#month').fill(input.month);
  await page.locator('#effective-date').fill(input.effectiveDate);
  await positionField(page, 0, 'service').selectOption('internet');
  for (const field of ['old', 'new']) {
    await positionField(page, 0, field).fill(input[field]);
  }
  if (input.invoiced.replace(',', '.') !== input.old.replace(',', '.')) {
    await setInvoiceOverride(page, 0, input.invoiced);
  }
}

async function expectBlocked(page, explanation) {
  await page.locator('#calculate').click();
  await expect(page.locator('#errors')).toBeVisible();
  await expect(page.locator('#errors')).toHaveAttribute('role', 'alert');
  await expect(page.locator('#errors')).toContainText(explanation);
  await expectNoResult(page);
}

async function expectAccessibleControls(page) {
  const unnamed = await page.locator('input, select, textarea, button').evaluateAll(elements =>
    elements.filter(element => element.type !== 'hidden' && element.getClientRects().length).flatMap(element => {
      const referencedLabel = (element.getAttribute('aria-labelledby') || '')
        .split(/\s+/).filter(Boolean)
        .map(id => document.getElementById(id)?.textContent || '').join(' ');
      const labels = Array.from(element.labels || []).map(label => label.textContent || '').join(' ');
      const buttonText = element.tagName === 'BUTTON' ? element.textContent : '';
      const name = element.getAttribute('aria-label') || referencedLabel || labels || buttonText;
      return name?.trim() ? [] : [element.id || `${element.tagName}:${element.dataset.field || element.type}`];
    }));
  expect(unnamed, 'Every visible field and button needs a nonempty accessible label').toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#calculator-form')).toBeVisible();
});

test('starts with one blank service row and an informational date hint', async ({ page }) => {
  await expect(positions(page)).toHaveCount(1);
  for (const field of ['old', 'new', 'invoiced']) {
    await expect(positionField(page, 0, field)).toHaveValue('');
  }
  await expect(page.locator('#event-type')).toHaveValue('DOWNGRADE');
  await expect(page.locator('#date-verified')).toHaveCount(0);
  await expect(positions(page).locator('input[data-field="label"], input[data-field="description"]')).toHaveCount(0);
  await expect(invoiceOverride(page, 0)).not.toBeChecked();
  await expect(invoiceOverride(page, 0)).toHaveAccessibleName(/Na fakturze jest inna kwota/i);
  await expect(positionField(page, 0, 'invoiced')).toBeDisabled();
  await expect(positionField(page, 0, 'basis')).toBeHidden();
  await positions(page).nth(0).locator('details.row-meta > summary').click();
  await expect(positionField(page, 0, 'basis')).toBeVisible();
  await expectAccessibleControls(page);
  await positions(page).nth(0).locator('details.row-meta > summary').click();
  await expect(page.locator('#last-old-date')).toBeHidden();
  await expect(page.locator('#date-hint')).toContainText(/dat|dni|dnia|warunk/i);
  await expectNoResult(page);
  await expectAccessibleControls(page);

  await page.locator('#event-type').selectOption('WYPOWIEDZENIE');
  await expect(page.locator('#last-old-date')).toBeVisible();
  await expectAccessibleControls(page);
  await page.locator('#event-type').selectOption('DOWNGRADE');
  await expect(page.locator('#last-old-date')).toBeHidden();

  await fillManualCase(page);
  await calculateVerified(page);
  await expectMoney(page.locator('#due'), '128.33');
});

test('calculates manually entered comma and dot amounts using the real form', async ({ page }) => {
  await fillManualCase(page, { old: '150,00', new: '100.00', invoiced: '130,00' });
  await calculateVerified(page);
  await expectMoney(page.locator('#due'), '128.33');
  await expectMoney(page.locator('#delta'), '1.67', true);
  await expect(page.locator('#global-method')).toHaveText('Rzeczywiste dni ÷ 30');
  await expect(page.locator('#days-old')).toHaveText('17');
  await expect(page.locator('#days-new')).toHaveText('13');
  await expect(page.locator('#days-month')).toHaveText('30');
  await expect(page.locator('#line-results tbody tr')).toHaveCount(1);
  await expectMoney(resultField(page, 0, 'due'), '128.33');
  await expectMoney(resultField(page, 0, 'delta'), '1.67', true);
  await expect(page.locator('#messages')).toContainText(/księgow/);
  await expectAccessibleControls(page);
});

test('invoice amount mirrors old monthly charge until its row override is enabled', async ({ page }) => {
  await fillManualCase(page);
  await expect(invoiceOverride(page, 0)).not.toBeChecked();
  await expect(positionField(page, 0, 'invoiced')).toBeDisabled();
  await expect(positionField(page, 0, 'invoiced')).toHaveValue('150');
  await positionField(page, 0, 'old').fill('151,20');
  await expect(positionField(page, 0, 'invoiced')).toHaveValue('151,20');

  await setInvoiceOverride(page, 0, '140');
  await positionField(page, 0, 'old').fill('160');
  await expect(positionField(page, 0, 'invoiced')).toHaveValue('140');
  await calculateVerified(page);
  await expectMoney(page.locator('#due'), '134.00');
  await expectMoney(page.locator('#delta'), '6.00', true);

  await invoiceOverride(page, 0).uncheck();
  await expectNoResult(page);
  await expect(positionField(page, 0, 'invoiced')).toBeDisabled();
  await expect(positionField(page, 0, 'invoiced')).toHaveValue('160');
  await calculateVerified(page);
  await expectMoney(page.locator('#delta'), '26.00', true);
});

test('invoice override only unlocks the amount belonging to its service row', async ({ page }) => {
  await loadExample(page, 'T26');
  await invoiceOverride(page, 0).check();
  await expect(positionField(page, 0, 'invoiced')).toBeEnabled();
  await expect(positionField(page, 1, 'invoiced')).toBeDisabled();
  await expect(invoiceOverride(page, 1)).not.toBeChecked();
  await positionField(page, 0, 'invoiced').fill('99');
  await positionField(page, 1, 'old').fill('55');
  await expect(positionField(page, 0, 'invoiced')).toHaveValue('99');
  await expect(positionField(page, 1, 'invoiced')).toHaveValue('55');
});

for (const scenario of [
  { month: '2026-11', oldCharge: '85.00', newCharge: '43.33', adjustment: '-65.00', due: '128.33' },
  { month: '2027-03', oldCharge: '85.00', newCharge: '46.67', adjustment: '-65.00', due: '131.67' },
  { month: '2027-02', oldCharge: '85.00', newCharge: '36.67', adjustment: '-65.00', due: '121.67', modelNote: true },
  { month: '2028-02', oldCharge: '85.00', newCharge: '40.00', adjustment: '-65.00', due: '125.00', modelNote: true },
]) {
  test(`${scenario.month} shows old and new period charges as the primary invoice plan`, async ({ page }) => {
    await fillManualCase(page, { month: scenario.month, effectiveDate: `${scenario.month}-18` });
    await calculateVerified(page);
    await expect(page.locator('#invoice-plan tbody tr')).toHaveCount(1);
    await expectInvoiceSplit(page, 0, {
      'old-charge': scenario.oldCharge,
      'new-charge': scenario.newCharge,
      'old-adjustment': scenario.adjustment.replace(/^-/,''),
      'period-residual': '0.00',
    });
    await expectMoney(page.locator('#due'), scenario.due);
    await expect(page.locator('#invoice-plan')).toContainText(/weryfikacji księgowej/);
    if (scenario.modelNote) {
      await expect(page.locator('#invoice-model-note')).toBeVisible();
      await expect(page.locator('#invoice-model-note')).toContainText(/faktyczne dni/);
    }
  });
}

for (const fixture of [
  { id: 'T01', due: '121.67', delta: '28.33', method: 'Rzeczywiste dni ÷ 30', days: [17, 11, 28] },
  { id: 'T02', due: '125.00', delta: '25.00', method: 'Rzeczywiste dni ÷ 30', days: [17, 12, 29] },
  { id: 'T03', due: '128.33', delta: '21.67', method: 'Rzeczywiste dni ÷ 30', days: [17, 13, 30] },
  { id: 'T08', due: '5.00', delta: '145.00', method: 'Rzeczywiste dni ÷ 30', days: [1, 30, 31] },
  { id: 'T18', due: '180.00', delta: '-30.00', method: 'Pełny nowy abonament', days: [0, 31, 31] },
]) {
  test(`${fixture.id} loads without calculating and preserves its calendar and amount result`, async ({ page }) => {
    await loadExample(page, fixture.id);
    await calculateVerified(page);
    await expectMoney(page.locator('#due'), fixture.due);
    await expectMoney(page.locator('#delta'), fixture.delta, true);
    await expect(page.locator('#global-method')).toHaveText(fixture.method);
    for (const [index, selector] of ['#days-old', '#days-new', '#days-month'].entries()) {
      await expect(page.locator(selector)).toHaveText(String(fixture.days[index]));
    }
    if (fixture.id === 'T08') {
      await expectInvoiceSplit(page, 0, { 'old-charge': '5.00', 'new-charge': '0.00' });
    }
    if (fixture.id === 'T18') {
      await expect(page.locator('#messages')).toContainText(/ADDITIONAL_AMOUNT_REVIEW|dodatkow|ujemn/i);
    }
  });
}

test('two services use real calendar days and preserve the aggregate control', async ({ page }) => {
  await loadExample(page, 'T26');
  await expect(positions(page)).toHaveCount(2);
  await calculateVerified(page);
  await expect(page.locator('#global-method')).toHaveText('Rzeczywiste dni ÷ 30');
  await expectMoney(page.locator('#due'), '145.67');
  await expectMoney(page.locator('#delta'), '4.33', true);
  await expectMoney(resultField(page, 0, 'due'), '84.67');
  await expectMoney(resultField(page, 1, 'due'), '61.00');
  await expectMoney(resultField(page, 0, 'delta'), '15.33', true);
  await expectMoney(resultField(page, 1, 'delta'), '-11.00', true);
  await expectMoney(page.locator('#row-sum'), '145.67');
  await expectMoney(page.locator('#rounding-residual'), '0.00', true);
  await expectInvoiceSplit(page, 0, {
    'old-charge': '56.67', 'new-charge': '28.00', 'period-residual': '0.00',
  });
  await expectInvoiceSplit(page, 1, {
    'old-charge': '28.33', 'new-charge': '32.67', 'period-residual': '0.00',
  });
  await expectMoney(page.locator('#invoice-parts-total'), '145.67');
  await expect(page.locator('#messages')).toContainText(/księgow/);
  await expect(page.locator('#results')).toContainText(/nieprzypisan|niealokowan|bez alokacji|brak alokacji/i);
});

test('T27 keeps the unchanged basket at full O despite changed components', async ({ page }) => {
  await loadExample(page, 'T27');
  await calculateVerified(page);
  await expect(page.locator('#global-method')).toHaveText('Zmiana składników — do sprawdzenia');
  await expectMoney(page.locator('#due'), '150.00');
  await expectMoney(page.locator('#delta'), '0.00');
  await expectMoney(resultField(page, 0, 'due'), '100.00');
  await expectMoney(resultField(page, 1, 'due'), '50.00');
  await expectMoney(resultField(page, 0, 'delta'), '0.00');
  await expectMoney(resultField(page, 1, 'delta'), '0.00');
  await expect(page.locator('#invoice-plan')).toContainText(/rozbicie[\s\S]*do uzgodnienia/i);
  const numericSplitInstructions = await page.locator('#invoice-plan [data-field="old-charge"], #invoice-plan [data-field="new-charge"]')
    .evaluateAll(cells => cells.map(cell => cell.textContent).filter(text => /\d+[.,]\d{2}/.test(text || '')));
  expect(numericSplitInstructions, 'Unchanged basket components require an agreed split, not arbitrary A/B instructions').toEqual([]);
  await expect(page.locator('#messages')).toContainText(/COMPONENT|składnik|pozycj|element/i);
  await expect(page.locator('#messages')).toContainText(/rozliczeniami/);
});

test('an upgrade on day one uses N while day two retains full O', async ({ page }) => {
  await fillManualCase(page, {
    type: 'PODWYŻKA', month: '2027-03', effectiveDate: '2027-03-01', old: '150', new: '180',
  });
  await calculateVerified(page);
  await expect(page.locator('#effective-label')).toHaveText('Data zmiany warunków');
  await expect(page.locator('#date-hint')).toContainText('nowa od następnego miesiąca');
  await expect(page.locator('#global-method')).toHaveText('Pełny nowy abonament');
  await expectMoney(page.locator('#due'), '180.00');
  await expectMoney(page.locator('#delta'), '-30.00', true);
  await expectInvoiceSplit(page, 0, { 'old-charge': '0.00', 'new-charge': '180.00', 'period-residual': '0.00' });
  await expect(page.locator('#summary')).toHaveValue(/Pełny nowy abonament[^\n]+180,00 zł/);

  await page.locator('#effective-date').fill('2027-03-02');
  await expectNoResult(page);
  await calculateVerified(page);
  await expect(page.locator('#global-method')).toHaveText('Podwyżka od następnego miesiąca');
  await expectMoney(page.locator('#due'), '150.00');
  await expectMoney(page.locator('#delta'), '0.00');
  await expectInvoiceSplit(page, 0, { 'old-charge': '150.00', 'new-charge': '0.00', 'period-residual': '0.00' });
  await expect(page.locator('#days-old')).toHaveText('1');
  await expect(page.locator('#days-new')).toHaveText('30');
  await expect(page.locator('#invoice-model-note')).toContainText('01.04.2027');
});

test('old invoice row and complete invoice changes have explicit direction', async ({ page }) => {
  await fillManualCase(page);
  await calculateVerified(page);
  await expect(page.locator('#invoice-plan')).toContainText(/Zmniejsz starą pozycję o 65,00\s+zł/);
  await expect(page.locator('#summary')).toHaveValue(/Zmniejszenie faktury o 21,67 zł/);
  await setInvoiceOverride(page, 0, '70');
  await calculateVerified(page);
  await expect(page.locator('#invoice-plan')).toContainText(/Zwiększ starą pozycję o 15,00\s+zł/);
  await expect(page.locator('#summary')).toHaveValue(/Zwiększenie faktury o 58,33 zł/);
});

test('rounded zero retains the real new period and unsettled cent warning', async ({ page }) => {
  await fillManualCase(page, { month: '2027-02', effectiveDate: '2027-02-18', old: '0.04', new: '0.01' });
  await calculateVerified(page);
  await expectInvoiceSplit(page, 0, { 'old-charge': '0.02', 'new-charge': '0.00', 'period-residual': '0.01' });
  const newCell=page.locator('#invoice-plan tbody tr').first().locator('td').nth(2);
  await expect(newCell).toContainText('18.02.2027');
  await expect(newCell).toContainText('28.02.2027');
  await expect(newCell).toContainText(/testowym zaokrągleniu/);
  await expect(newCell).not.toContainText(/Nie naliczaj|Brak nowej opłaty/);
  await expect(page.locator('#summary')).toHaveValue(/reszta wymaga uzgodnienia/);
});

test('future upgrade explains its actual higher price date outside the analyzed month', async ({ page }) => {
  await fillManualCase(page, { type: 'PODWYŻKA', effectiveDate: '2027-02-18', new: '180' });
  await calculateVerified(page);
  await expectInvoiceSplit(page, 0, { 'old-charge': '150.00', 'new-charge': '0.00', 'period-residual': '0.00' });
  await expect(page.locator('#invoice-model-note')).toContainText(/poza analizowanym miesiącem/);
  await expect(page.locator('#invoice-model-note')).toContainText('01.03.2027');
  await expect(page.locator('#invoice-model-note')).not.toContainText(/w trakcie miesiąca|od następnego miesiąca/);
  await expect(page.locator('#summary')).toHaveValue(/od 01\.03\.2027/);
});

test('rejects inconsistent termination E and accepts the preceding day', async ({ page }) => {
  await loadExample(page, 'T08');
  await expect(page.locator('#last-old-date')).toBeVisible();
  await page.locator('#last-old-date').fill('2027-03-02');
  await expectBlocked(page, /INCONSISTENT_DATES|bezpośrednio|poprzed|E\b|dat/i);
  await page.locator('#last-old-date').fill('2027-03-01');
  await calculateVerified(page);
  await expectMoney(page.locator('#due'), '5.00');
  await page.locator('#last-old-date').fill('2027-02-28');
  await expectNoResult(page);
});

test('rejects missing dates without exposing an old or partial calculation', async ({ page }) => {
  for (const selector of ['#month', '#effective-date']) {
    await test.step(`missing ${selector}`, async () => {
      await fillManualCase(page);
      await page.locator(selector).fill('');
      await expectBlocked(page, /MONTH|DATE|miesią|dat/i);
    });
  }
});

test('rejects editable direction mismatches and fixes termination at zero', async ({ page }) => {
  for (const input of [
    { type: 'DOWNGRADE', new: '180' },
    { type: 'PODWYŻKA', new: '100' },
    { type: 'NO_CHANGE', new: '100' },
  ]) {
    await test.step(input.type, async () => {
      await fillManualCase(page, input);
      await expectBlocked(page, /DIRECTION_MISMATCH|kierun|scenariusz|cen|zer|N\s*=\s*0/i);
    });
  }
  await test.step('WYPOWIEDZENIE enforces zero and accepts consistent E', async () => {
    await page.locator('#event-type').selectOption('WYPOWIEDZENIE');
    await expect(positionField(page, 0, 'new')).toBeDisabled();
    await expect(positionField(page, 0, 'new')).toHaveValue(/^0(?:[.,]00)?$/);
    await page.locator('#last-old-date').fill('2026-11-17');
    await calculateVerified(page);
    await expect(page.locator('#global-method')).toHaveText('Rzeczywiste dni ÷ 30');
    await expectMoney(page.locator('#due'), '85.00');
    await expectMoney(page.locator('#delta'), '65.00', true);
  });
});

test('rejects malformed money instead of coercing or rounding the input', async ({ page }) => {
  for (const invalid of ['', '-1', '1e2', '1,001', '1 000,00', 'NaN', '1000000000000000']) {
    await test.step(`old=${JSON.stringify(invalid)}`, async () => {
      await fillManualCase(page, { old: invalid });
      await expectBlocked(page, /INVALID_MONEY|kwot|PLN|grosz|cyfr|miejsc/i);
    });
  }
});

test('blocks net amounts, mixed VAT, multiple dates and unresolved discounts', async ({ page }) => {
  for (const scenario of [
    { name: 'net basis', mutate: () => setMetadata(page, 0, 'basis', 'net'), message: /BASIS|netto|brutto|net/i },
    { name: 'mixed VAT', mutate: () => setMetadata(page, 1, 'vat', '8'), message: /VAT|stawk/i },
    { name: 'multiple dates', mutate: () => checkComplexity(page, '#multiple-dates'), message: /MULTIPLE|wiel|dat/i },
    { name: 'unresolved discounts', mutate: () => checkComplexity(page, '#unresolved-discounts'), message: /DISCOUNT|rabat|nieroz/i },
  ]) {
    await test.step(scenario.name, async () => {
      await loadExample(page, 'T26');
      await scenario.mutate();
      await expectBlocked(page, scenario.message);
    });
  }
});

test('adding and removing positions preserves the remaining editable row', async ({ page }) => {
  await fillManualCase(page);
  await page.locator('#add-position').click();
  await expect(positions(page)).toHaveCount(2);
  await positionField(page, 1, 'service').selectOption('tv');
  await positionField(page, 1, 'old').fill('50');
  await positionField(page, 1, 'new').fill('30');
  await expect(positionField(page, 1, 'invoiced')).toHaveValue('50');
  await expect(positionField(page, 1, 'invoiced')).toBeDisabled();
  await positions(page).nth(0).locator('[data-action="remove"]').click();
  await expect(positions(page)).toHaveCount(1);
  await expect(positionField(page, 0, 'service')).toHaveValue('tv');
  await expect(positionField(page, 0, 'old')).toHaveValue('50');
  await expectNoResult(page);
});

test('every edit and row mutation immediately invalidates the result and copy text', async ({ page }) => {
  test.slow();
  const mutations = [
    ['service', () => positionField(page, 0, 'service').selectOption('other')],
    ['old', () => positionField(page, 0, 'old').fill('101')],
    ['new', () => positionField(page, 0, 'new').fill('61')],
    ['invoice override enabled', () => invoiceOverride(page, 0).check()],
    ['invoice override disabled', () => invoiceOverride(page, 0).uncheck(), () => invoiceOverride(page, 0).check()],
    ['invoiced', () => positionField(page, 0, 'invoiced').fill('99'), () => invoiceOverride(page, 0).check()],
    ['basis', () => setMetadata(page, 0, 'basis', 'net')],
    ['VAT', () => setMetadata(page, 0, 'vat', '8')],
    ['event type', () => page.locator('#event-type').selectOption('PODWYŻKA')],
    ['month', () => page.locator('#month').fill('2027-04')],
    ['effective date', () => page.locator('#effective-date').fill('2027-03-19')],
    ['multiple dates', () => checkComplexity(page, '#multiple-dates')],
    ['unresolved discounts', () => checkComplexity(page, '#unresolved-discounts')],
    ['add row', () => page.locator('#add-position').click()],
    ['remove row', () => positions(page).nth(1).locator('[data-action="remove"]').click()],
  ];
  for (const [name, mutate, prepare] of mutations) {
    await test.step(name, async () => {
      await loadExample(page, 'T26');
      if (prepare) await prepare();
      await calculateVerified(page);
      await expect(page.locator('#summary')).not.toHaveValue('');
      await mutate();
      await expectNoResult(page);
    });
  }
});

test('reset clears the complete case, invoice overrides, warnings and results', async ({ page }) => {
  await loadExample(page, 'T26');
  await calculateVerified(page);
  await page.locator('#reset').click();
  await expect(positions(page)).toHaveCount(1);
  for (const field of ['old', 'new', 'invoiced']) {
    await expect(positionField(page, 0, field)).toHaveValue('');
  }
  for (const selector of ['#month', '#effective-date', '#last-old-date']) {
    await expect(page.locator(selector)).toHaveValue('');
  }
  for (const selector of ['#multiple-dates', '#unresolved-discounts']) {
    await expect(page.locator(selector)).not.toBeChecked();
  }
  await expect(page.locator('#event-type')).toHaveValue('DOWNGRADE');
  await expect(invoiceOverride(page, 0)).not.toBeChecked();
  await expect(positionField(page, 0, 'invoiced')).toBeDisabled();
  await expectNoResult(page);
  await expect(page.locator('#errors')).not.toContainText(/\S/);
  await expect(page.locator('#copy-feedback')).not.toContainText(/\S/);
});

async function prepareSafeSummary(page) {
  await loadExample(page, 'T26');
  await expect(page.locator('#date-verified')).toHaveCount(0);
  await expect(positions(page).locator('input[data-field="label"], input[data-field="description"]')).toHaveCount(0);
  for (let index = 0; index < 2; index++) {
    const categories = await positionField(page, index, 'service').locator('option')
      .evaluateAll(options => options.map(option => option.value));
    expect(categories).toEqual(['internet', 'tv', 'rental', 'other']);
  }
  const rowTextInputs = await positions(page).locator('input:not([type="checkbox"])')
    .evaluateAll(inputs => inputs.map(input => input.dataset.field));
  expect(rowTextInputs, 'Rows expose only money inputs and fixed service categories').toEqual([
    'old', 'new', 'invoiced', 'old', 'new', 'invoiced',
  ]);
  await calculateVerified(page);
  const summaryField = page.locator('#summary');
  await expect(summaryField).toHaveJSProperty('readOnly', true);
  const summary = await summaryField.inputValue();
  expect(summary).toMatch(/2027-03|03[./]2027/);
  expect(summary).toMatch(/2027-03-18|18[./]03[./]2027/);
  expect(summary).toMatch(/rzeczywiste dni korzystania ÷ 30/);
  expect(summary).toMatch(/(?:pozycj[aei]\s*1|\b1[.)])/i);
  expect(summary).toMatch(/(?:pozycj[aei]\s*2|\b2[.)])/i);
  expect(summary).toMatch(/pozycja\s*1\s*\(Internet\)/i);
  expect(summary).toMatch(/pozycja\s*2\s*\(Telewizja\)/i);
  for (const amount of ['145.67', '4.33', '84.67', '61.00'])expect(summary).toMatch(moneyPattern(amount));
  expect(summary).toMatch(/weryfikacji księgowej/);
  expect(summary).toMatch(/Reszta do uzgodnienia/);
  return summary;
}

test('copies only the safe generated summary through the native Chromium clipboard', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native clipboard read/write permissions are Chromium-specific.');
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP_ORIGIN });
  } catch {
    test.skip(true, 'This Chromium environment does not expose clipboard permissions.');
  }
  const clipboardAvailable = await page.evaluate(() => Boolean(navigator.clipboard?.writeText && navigator.clipboard?.readText));
  test.skip(!clipboardAvailable, 'This browser environment does not expose a native clipboard.');
  const summary = await prepareSafeSummary(page);
  await page.locator('#copy-summary').click();
  const normalizeNewlines = text => text.replace(/\r\n/g, '\n');
  await expect.poll(async () => normalizeNewlines(await page.evaluate(() => navigator.clipboard.readText())))
    .toBe(normalizeNewlines(summary));
  await expect(page.locator('#copy-feedback')).toHaveAttribute('role', 'status');
  await expect(page.locator('#copy-feedback')).toContainText(/skopi|schow/i);
});

test('clipboard denial selects the safe readonly summary for manual copying', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => { throw new DOMException('Clipboard denied by test', 'NotAllowedError'); },
      },
    });
  });
  await page.reload();
  const summary = await prepareSafeSummary(page);
  await page.locator('#copy-summary').click();
  await expect(page.locator('#summary')).toBeFocused();
  const selection = await page.locator('#summary').evaluate(element => ({
    start: element.selectionStart, end: element.selectionEnd, selected: element.value.slice(element.selectionStart, element.selectionEnd),
  }));
  expect(selection).toEqual({ start: 0, end: summary.length, selected: summary });
  await expect(page.locator('#copy-feedback')).toHaveAttribute('role', 'status');
  await expect(page.locator('#copy-feedback')).toContainText(/zaznacz|ręcz|kopi|schow/i);
});

test('supports keyboard activation and keeps meaningful focus on controls', async ({ page }) => {
  await page.locator('#example-select').selectOption('T03');
  await page.locator('#load-example').focus();
  await expect(page.locator('#load-example')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(positionField(page, 0, 'old')).toHaveValue(/150(?:[.,]00)?/);
  await invoiceOverride(page, 0).focus();
  await page.keyboard.press('Space');
  await expect(invoiceOverride(page, 0)).toBeChecked();
  await expect(positionField(page, 0, 'invoiced')).toBeEnabled();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => {
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body && active.getClientRects().length > 0;
  })).toBe(true);
  await page.locator('#calculate').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#invoice-plan')).toBeVisible();
  await expectMoney(page.locator('#due'), '128.33');
  await expectAccessibleControls(page);
});

test('keeps case data out of persistent browser storage and clears it on reload', async ({ page, context }) => {
  await prepareSafeSummary(page);
  const storage = await page.evaluate(async () => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    cookies: document.cookie,
    databases: typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).map(database => database.name) : [],
    caches: typeof caches !== 'undefined' ? await caches.keys() : [],
  }));
  expect(storage).toEqual({ local: [], session: [], cookies: '', databases: [], caches: [] });
  expect(await context.cookies()).toEqual([]);
  await page.reload();
  await expect(positions(page)).toHaveCount(1);
  await expect(positionField(page, 0, 'old')).toHaveValue('');
  await expect(positionField(page, 0, 'invoiced')).toBeDisabled();
  await expect(page.locator('#date-verified')).toHaveCount(0);
  await expectNoResult(page);
});

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`${viewport.name} layout contains the full case without document overflow`, async ({ page, browserName }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await loadExample(page, 'T26');
    await calculateVerified(page);
    if (viewport.name === 'mobile') {
      for (const [id, label] of [['total-old', 'Dotychczasowy abonament'], ['total-new', 'Nowy abonament'], ['total-invoiced', 'Naliczono na fakturze']]) {
        const visibleLabel=await page.locator(`#${id}`).evaluate(element => getComputedStyle(element,'::before').content);
        expect(visibleLabel).toContain(label);
      }
    }
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
    expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
    await page.locator('#calculate').scrollIntoViewIfNeeded();
    await expect(page.locator('#calculate')).toBeInViewport();
    await page.locator('#copy-summary').scrollIntoViewIfNeeded();
    await expect(page.locator('#copy-summary')).toBeInViewport();
    await expectAccessibleControls(page);
    const project = testInfo.project.name.replace(/[^a-z\d_-]/gi, '-');
    await page.screenshot({ path: testInfo.outputPath(`${browserName}-${project}-${viewport.name}-calculator.png`), fullPage: true });
  });
}
