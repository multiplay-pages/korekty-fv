import { test as base, expect } from '@playwright/test';

const APP_ORIGIN = new URL(process.env.BOK_E2E_URL || 'http://127.0.0.1:4173').origin;

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
const parts = page => page.locator('#calculation-parts article');
const partField = (page, index, field) => parts(page).nth(index).locator(`[data-field="${field}"]`);

function moneyPattern(amount, signed = false) {
  const negative = amount.startsWith('-');
  const localized = amount.replace(/^-/, '').replace('.', ',');
  const sign = negative ? '[−-]' : signed && amount !== '0.00' ? '\\+' : '';
  return new RegExp(`${sign}${localized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+zł`);
}

async function expectMoney(locator, amount, signed = false) {
  await expect(locator).toHaveText(new RegExp(`^\\s*${moneyPattern(amount, signed).source}\\s*$`));
}

async function expectCorrectionAmount(page, amount) {
  await expectMoney(page.locator('#delta'), amount, true);
}

async function expectParts(page, index, old, next) {
  await expect(partField(page,index,'old')).toContainText(moneyPattern(old));
  await expect(partField(page,index,'next')).toContainText(moneyPattern(next));
}

async function expectNoResult(page) {
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('[data-result-state]')).toHaveCount(0);
  await expect(page.locator('#copy-summary')).toBeDisabled();
  await expect(page.locator('#summary')).toHaveValue('');
}

async function loadExample(page, example) {
  await page.locator('#training-mode').check();
  await page.locator('#example-select').selectOption(example);
  await page.locator('#load-example').click();
  await expectNoResult(page);
}

async function calculate(page) {
  await page.locator('#calculate').click();
  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('#copy-summary')).toBeEnabled();
}

async function setInvoiceAmount(page, index, value) {
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
  if (await page.locator('#bok-details').getAttribute('open') === null) await page.locator('#bok-details > summary').click();
  await page.locator('#use-lines').check();
  const input = {
    month: '2026-11', effectiveDate: '2026-11-18',
    old: '150', new: '100', invoiced: '150', ...overrides,
  };
  if (!Object.hasOwn(overrides, 'invoiced')) input.invoiced = input.old;
  await page.locator('#month').fill(input.month);
  const previous = new Date(`${input.effectiveDate}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  await page.locator('#last-old-date').fill(previous.toISOString().slice(0, 10));
  await positionField(page, 0, 'service').selectOption('internet');
  for (const field of ['old', 'new']) {
    await positionField(page, 0, field).fill(input[field]);
  }
  await setInvoiceAmount(page, 0, input.invoiced);
}

async function expectBlocked(page, explanation) {
  await page.locator('#calculate').click();
  await expect(page.locator('#errors')).toBeVisible();
  await expect(page.locator('#errors')).toHaveAttribute('role', 'alert');
  await expect(page.locator('#errors')).toContainText(explanation);
  await expect(page.locator('[data-result-state]')).toHaveAttribute('data-result-state','ERROR');
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#copy-summary')).toBeDisabled();
  await expect(page.locator('#summary')).toHaveValue('');
}

async function expectReview(page, decision, explanation) {
  await calculate(page);
  await expect(page.locator('[data-result-state]')).toHaveAttribute('data-result-state',decision);
  await expect(page.locator('#delta-explanation')).toContainText(explanation);
  await expect(page.locator('#result-main-amount')).toBeHidden();
  await expect(page.locator('#bok-result')).toBeHidden();
  await expect(page.locator('#summary')).toHaveValue(explanation);
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

test('starts with empty basket totals and optionally opens an editable row', async ({ page }) => {
  await expect(positions(page)).toHaveCount(0);
  await expect(page.locator('#basket-old')).toBeVisible();
  await expect(page.locator('#position-editor')).toBeHidden();
  await page.locator('#bok-details > summary').click();
  await page.locator('#use-lines').check();
  await expect(positions(page)).toHaveCount(1);
  for (const field of ['old', 'new', 'invoiced']) {
    await expect(positionField(page, 0, field)).toHaveValue('');
  }
  await expect(page.locator('#event-type')).toHaveCount(0);
  await expect(page.locator('#date-verified')).toHaveCount(0);
  await expect(positionField(page, 0, 'label')).toHaveValue('');
  await expect(positionField(page, 0, 'invoiced')).toHaveAccessibleName(/Kwota na fakturze/i);
  await expect(positionField(page, 0, 'invoiced')).toBeEnabled();
  await expect(page.locator('#invoice-confirmed')).toBeDisabled();
  await expect(positionField(page, 0, 'basis')).toBeHidden();
  await positions(page).nth(0).locator('details.row-meta > summary').click();
  await expect(positionField(page, 0, 'basis')).toBeVisible();
  await expectAccessibleControls(page);
  await positions(page).nth(0).locator('details.row-meta > summary').click();
  await expect(page.locator('#last-old-date')).toBeVisible();
  await expect(page.locator('#date-hint')).toContainText(/dat|dni|dnia|warunk/i);
  await expectNoResult(page);
  await expectAccessibleControls(page);

  await fillManualCase(page);
  await calculate(page);
  await expectMoney(page.locator('#due'), '128.33');
});

test('calculates manually entered comma and dot amounts using the real form', async ({ page }) => {
  await fillManualCase(page, { old: '150,00', new: '100.00', invoiced: '130,00' });
  await calculate(page);
  await expectMoney(page.locator('#due'), '128.33');
  await expectCorrectionAmount(page, '1.67');
  await expect(page.locator('#global-method')).toHaveText('Porównanie A/B — oba warianty są równe');
  await expect(page.locator('#days-old')).toHaveText('17');
  await expect(page.locator('#days-new')).toHaveText('13');
  await expect(page.locator('#days-month')).toHaveText('30');
  await expect(page.locator('#line-results tbody tr')).toHaveCount(1);
  await expectMoney(resultField(page, 0, 'due'), '128.33');
  await expect(resultField(page, 0, 'delta')).toContainText(/\+1,67 zł/);
  await expect(page.locator('#messages')).toContainText(/księgow/);
  await expectAccessibleControls(page);
});

test('F pozycji pozostaje niezależne od starej ceny i ma trzy stany dokumentu', async ({ page }) => {
  await fillManualCase(page);
  await expect(positionField(page, 0, 'invoiced')).toHaveValue('150');
  await positionField(page, 0, 'old').fill('151,20');
  await expect(positionField(page, 0, 'invoiced')).toHaveValue('150');
  await setInvoiceAmount(page, 0, '140');
  await positionField(page, 0, 'old').fill('160');
  await calculate(page);
  await expectMoney(page.locator('#due'), '134.00');
  await expectCorrectionAmount(page, '6.00');

  await page.locator('#document-state input[value="NOT_ISSUED"]').check();
  await expectNoResult(page);
  await expect(positionField(page, 0, 'invoiced')).toBeDisabled();
  await calculate(page);
  await expect(page.locator('#result-heading')).toHaveAttribute('data-result-state','NOT_APPLICABLE');
  await page.locator('#document-state input[value="AMOUNT"]').check();
  await expect(positionField(page, 0, 'invoiced')).toHaveValue('140');
});

test('edycja rzeczywistej kwoty faktury dotyczy tylko wskazanej pozycji', async ({ page }) => {
  await loadExample(page, 'T26');
  await expect(positionField(page, 0, 'invoiced')).toBeEnabled();
  await expect(positionField(page, 1, 'invoiced')).toBeEnabled();
  await positionField(page, 0, 'invoiced').fill('99');
  await positionField(page, 1, 'old').fill('55');
  await expect(positionField(page, 0, 'invoiced')).toHaveValue('99');
  await expect(positionField(page, 1, 'invoiced')).toHaveValue('50,00');
});

for (const scenario of [
  { month: '2026-11', oldCharge: '85.00', newCharge: '43.33', due: '128.33', fraction:'17/30' },
  { month: '2027-03', oldCharge: '80.00', newCharge: '46.67', due: '126.67', fraction:'14/30' },
  { month: '2027-02', oldCharge: '85.00', newCharge: '43.33', due: '128.33', fraction:'17/30' },
  { month: '2028-02', oldCharge: '85.00', newCharge: '43.33', due: '128.33', fraction:'17/30' },
]) {
  test(`${scenario.month} pokazuje części i wzór zastosowanej metody w objaśnieniu`, async ({ page }) => {
    await fillManualCase(page, { month: scenario.month, effectiveDate: `${scenario.month}-18` });
    await page.locator('#basket-vat').selectOption('23');
    await page.locator('#invoice-confirmed').check();
    await calculate(page);
    await page.locator('#calculation-details > summary').click();
    await expect(parts(page)).toHaveCount(1);
    await expectParts(page, 0, scenario.oldCharge, scenario.newCharge);
    await expectMoney(page.locator('#due'), scenario.due);
    await expect(page.locator('#calculation-steps')).toContainText(scenario.fraction);
    await expect(page.locator('#calculation-steps')).toContainText(moneyPattern(scenario.due));
    expect(await page.locator('#summary').inputValue()).toContain(await page.locator('#calculation-steps').textContent());
    await expect(page.locator('#messages')).toContainText(/D11/);
  });
}

for (const fixture of [
  { id: 'T01', due: '128.33', delta: '21.67', method: 'Porównanie A/B — wybrano A', days: [17, 11, 28] },
  { id: 'T02', due: '128.33', delta: '21.67', method: 'Porównanie A/B — wybrano A', days: [17, 12, 29] },
  { id: 'T03', due: '128.33', delta: '21.67', method: 'Porównanie A/B — oba warianty są równe', days: [17, 13, 30] },
  { id: 'T08', due: '0.00', delta: '150.00', method: 'Porównanie A/B — wybrano B', days: [1, 30, 31] },
  { id: 'T18', due: '150.00', delta: '0.00', method: 'Podwyżka od następnego miesiąca', days: [31, 0, 31] },
]) {
  test(`${fixture.id} loads without calculating and preserves its calendar and amount result`, async ({ page }) => {
    await loadExample(page, fixture.id);
    await calculate(page);
    if (fixture.id === 'T18') {
      await expect(page.locator('#result-heading')).toHaveAttribute('data-result-state','NO_CORRECTION_EXPECTED');
      await expect(page.locator('#due')).toHaveCount(0);
      await expect(page.locator('#next-month-label')).toHaveText('Abonament od 01.04.2027');
      await expect(page.locator('#nominal-price')).toHaveText('180,00 zł');
      await expect(page.locator('#document-variants li')).toHaveCount(4);
      return;
    }
    await expectMoney(page.locator('#due'), fixture.due);
    await expectCorrectionAmount(page, fixture.delta);
    await expect(page.locator('#global-method')).toHaveText(fixture.method);
    for (const [index, selector] of ['#days-old', '#days-new', '#days-month'].entries()) {
      await expect(page.locator(selector)).toHaveText(String(fixture.days[index]));
    }
    if (fixture.id === 'T08') {
      await expect(page.locator('#messages')).toContainText('jeden dzień usługi');
    }
  });
}

test('two services share global B and show both directions and cent controls', async ({ page }) => {
  await loadExample(page, 'T26');
  await expect(positions(page)).toHaveCount(2);
  await calculate(page);
  await expect(page.locator('#global-method')).toHaveText('Porównanie A/B — wybrano B');
  await expectMoney(page.locator('#due'), '140.67');
  await expectCorrectionAmount(page, '9.33');
  await expectMoney(resultField(page, 0, 'due'), '81.33');
  await expectMoney(resultField(page, 1, 'due'), '59.33');
  await expect(resultField(page, 1, 'delta')).toContainText(/−9,33 zł/);
  await expect(page.locator('#line-results thead th')).toHaveCount(4);
  await expect(page.locator('#rounding-residual')).toHaveText('Reszta korekty koszyka −0,01 zł do uzgodnienia.');
  await page.locator('#calculation-details > summary').click();
  await expectParts(page, 0, '53.33', '28.00');
  await expectParts(page, 1, '26.67', '32.67');
  await expect(partField(page, 1, 'remainder')).toHaveText('Reszta zaokrąglenia części pozycji: −0,01 zł.');
  await expect(page.locator('#messages')).toContainText(/różnych kierunkach/);
});

test('T27 requires review for changed components at the same total', async ({ page }) => {
  await loadExample(page, 'T27');
  await expectReview(page, 'REVIEW', /tej samej sumie/);
});

test('podwyżka w dniu 1 i 2 zachowuje fakturę według O', async ({ page }) => {
  await fillManualCase(page, { month: '2027-03', effectiveDate: '2027-03-01', old: '150', new: '180' });
  for (const lastOldDate of ['2027-02-28', '2027-03-01']) {
    await page.locator('#last-old-date').fill(lastOldDate);
    await expectNoResult(page);
    await calculate(page);
    await expect(page.locator('#result-heading')).toHaveAttribute('data-result-state','NO_CORRECTION');
    await expect(page.locator('#due')).toHaveCount(0);
    await expect(page.locator('#result-main-amount')).toBeHidden();
    await expect(page.locator('#next-month-label')).toHaveText('Abonament od 01.04.2027');
    await expectMoney(page.locator('#nominal-price'), '180.00');
    await expect(page.locator('#summary')).toHaveValue(/Faktura pozostaje: 150,00 zł/);
  }
});

test('różnica dodatnia jest zmniejszeniem, a F mniejsze od należności wymaga weryfikacji', async ({ page }) => {
  await fillManualCase(page);
  await calculate(page);
  await expectCorrectionAmount(page,'21.67');
  await expect(page.locator('#summary')).toHaveValue(/\+21,67 zł — zmniejszenie/);
  await setInvoiceAmount(page, 0, '70');
  await expectReview(page, 'REVIEW', /Należność jest wyższa/);
  await expect(page.locator('#summary')).not.toHaveValue(/58,33 zł|Zwiększenie/i);
});

test('zaokrąglenie nowej części do zera zachowuje jej okres w objaśnieniu', async ({ page }) => {
  await fillManualCase(page, { month: '2027-02', effectiveDate: '2027-02-18', old: '0.04', new: '0.01' });
  await page.locator('#basket-vat').selectOption('23');
  await page.locator('#invoice-confirmed').check();
  await calculate(page);
  await page.locator('#calculation-details > summary').click();
  await expectParts(page, 0, '0.02','0.00');
  await expect(partField(page,0,'next')).toContainText('18.02.2027 – 28.02.2027');
  await expect(partField(page,0,'remainder')).toContainText('+0,01 zł');
  await expect(page.locator('#summary')).toHaveValue(/Reszta zaokrąglenia części pozycji: \+0,01 zł/);
});

test('future upgrade explains its actual higher price date outside the analyzed month', async ({ page }) => {
  await fillManualCase(page, { effectiveDate: '2027-02-18', new: '180' });
  await calculate(page);
  await expect(page.locator('#result-heading')).toHaveAttribute('data-result-state','NO_CORRECTION');
  await expect(page.locator('#method-explanation')).toContainText(/po analizowanym miesiącu/);
  await expect(page.locator('#billing-start')).toHaveText('01.03.2027');
  await expect(page.locator('#nominal-price')).toHaveText('150,00 zł');
  await expect(page.locator('#summary')).toHaveValue(/Wyższy abonament od: 01\.03\.2027/);
});

test('termination derives the first day without service from the last service day', async ({ page }) => {
  await loadExample(page, 'T08');
  await expect(page.locator('#last-old-date')).toBeVisible();
  await page.locator('#last-old-date').fill('2027-03-02');
  await expect(page.locator('#date-preview')).toContainText('03.03.2027');
  await page.locator('#last-old-date').fill('2027-03-01');
  await calculate(page);
  await expectMoney(page.locator('#due'), '0.00');
  await page.locator('#last-old-date').fill('2027-02-28');
  await expectNoResult(page);
});

test('rejects missing dates without exposing an old or partial calculation', async ({ page }) => {
  for (const selector of ['#month', '#last-old-date']) {
    await test.step(`missing ${selector}`, async () => {
      await fillManualCase(page);
      await page.locator(selector).fill('');
      await expectBlocked(page, /miesią|warunk/i);
    });
  }
});

test('auto classifier infers discount and zero-priced outcome from the entered prices', async ({ page }) => {
  await fillManualCase(page);
  await calculate(page);
  await expectMoney(page.locator('#due'), '128.33');
  await positionField(page, 0, 'new').fill('0');
  await expectNoResult(page);
  await calculate(page);
  await expectMoney(page.locator('#due'), '85.00');
  await expectCorrectionAmount(page, '65.00');
});

test('UX-07: grouped amounts and PLN suffix preserve the result and copy in both modes', async ({ page }) => {
  const readResult = async () => {
    await page.locator('#calculate').click();
    await expect(page.locator('#result-heading')).toHaveAttribute('data-result-state', 'CORRECTION');
    return {
      due: await page.locator('#due').textContent(),
      correction: await page.locator('#delta').textContent(),
      copy: await page.locator('#summary').inputValue(),
    };
  };
  const formats = ['1000,00', '1 000,00', '1 000,00 zł', '1\u00a0000,00', ' 1\u202f000.00\u202fzł '];
  for (const mode of ['aggregate', 'lines']) {
    let expected;
    for (const amount of formats) {
      await page.goto('/');
      if (mode === 'lines') {
        await fillManualCase(page, { old: amount, new: '500', invoiced: amount });
      } else {
        await page.locator('#last-old-date').fill('2026-11-17');
        await page.locator('#basket-old').fill(amount);
        await page.locator('#basket-new').fill('500');
        await page.locator('#basket-invoiced').fill(amount);
      }
      const result = await readResult();
      expected ??= result;
      expect(result).toEqual(expected);
    }
  }
});

test('rejects malformed money instead of coercing or rounding the input', async ({ page }) => {
  for (const invalid of ['', '-1', '1e2', '1,001', '1 20,00', '12 3456,00', '1  000,00', '1 000 000,00', '1 000 000 000 000 000', 'zł', 'NaN', '1000000000000000']) {
    await test.step(`old=${JSON.stringify(invalid)}`, async () => {
      await fillManualCase(page, { old: invalid });
      await expectBlocked(page, invalid==='' ? /Dotychczasowy abonament/i : /INVALID_MONEY|kwot|PLN|grosz|cyfr|miejsc/i);
    });
  }
});

test('blocks net amounts, mixed VAT, multiple dates and unresolved discounts', async ({ page }) => {
  for (const scenario of [
    { name: 'net basis', mutate: () => setMetadata(page, 0, 'basis', 'net'), message: /BASIS|netto|brutto|net/i },
    { name: 'mixed VAT', mutate: () => setMetadata(page, 1, 'vat', '8'), message: /VAT|stawk/i },

    { name: 'multiple dates', mutate: () => checkComplexity(page, '#multiple-dates'), message: /kilka|wiel|dat/i },
    { name: 'unresolved discounts', mutate: () => checkComplexity(page, '#unresolved-discounts'), message: /DISCOUNT|rabat|nieroz/i },
  ]) {
    await test.step(scenario.name, async () => {
      await loadExample(page, 'T26');
      await page.locator('#basket-vat').selectOption('23');
      await scenario.mutate();
      await expectReview(page, ['net basis','mixed VAT'].includes(scenario.name) ? 'REVIEW' : 'REFER', scenario.message);
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
  await expect(positionField(page, 1, 'invoiced')).toHaveValue('');
  await expect(positionField(page, 1, 'invoiced')).toBeEnabled();
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
    ['unknown document', () => page.locator('#document-state input[value="UNKNOWN"]').check()],
    ['invoice not issued', () => page.locator('#document-state input[value="NOT_ISSUED"]').check()],
    ['invoiced', () => positionField(page, 0, 'invoiced').fill('99')],
    ['basis', () => setMetadata(page, 0, 'basis', 'net')],
    ['VAT', () => setMetadata(page, 0, 'vat', '8')],
    ['month', () => page.locator('#month').fill('2027-04')],
    ['effective date', () => page.locator('#last-old-date').fill('2027-03-18')],
    ['multiple dates', () => checkComplexity(page, '#multiple-dates')],
    ['unresolved discounts', () => checkComplexity(page, '#unresolved-discounts')],
    ['add row', () => page.locator('#add-position').click()],
    ['remove row', () => positions(page).nth(1).locator('[data-action="remove"]').click()],
  ];
  for (const [name, mutate, prepare] of mutations) {
    await test.step(name, async () => {
      await loadExample(page, 'T26');
      if (prepare) await prepare();
      await calculate(page);
      await expect(page.locator('#summary')).not.toHaveValue('');
      await mutate();
      await expectNoResult(page);
    });
  }
});

test('reset clears the complete case, invoice overrides, warnings and results', async ({ page }) => {
  await loadExample(page, 'T26');
  await calculate(page);
  await page.locator('#reset').click();
  await expect(positions(page)).toHaveCount(0);
  for (const field of ['old', 'new', 'invoiced']) {
    await expect(page.locator(`#basket-${field}`)).toHaveValue('');
  }
  for (const selector of ['#month', '#last-old-date']) {
    await expect(page.locator(selector)).toHaveValue('');
  }
  for (const selector of ['#multiple-dates', '#unresolved-discounts']) {
    await expect(page.locator(selector)).not.toBeChecked();
  }
  await expect(page.locator('#event-type')).toHaveCount(0);
  await expect(page.locator('#document-state input:checked')).toHaveValue('UNKNOWN');
  await expect(page.locator('#bok-details')).not.toHaveAttribute('open', '');
  await expectNoResult(page);
  await expect(page.locator('#errors')).not.toContainText(/\S/);
  await expect(page.locator('#copy-feedback')).not.toContainText(/\S/);
});

async function prepareSafeSummary(page) {
  await loadExample(page, 'T26');
  const rowDetails = positions(page).first().locator('.row-meta > summary');
  await rowDetails.click();
  await positionField(page, 0, 'label').fill('NIE KOPIUJ TEJ ETYKIETY');
  await rowDetails.click();
  await calculate(page);
  const summaryField = page.locator('#summary');
  await expect(summaryField).toHaveJSProperty('readOnly', true);
  const summary = await summaryField.inputValue();
  expect(summary).toMatch(/03\.2027/);
  expect(summary).toMatch(/18\.03\.2027/);
  expect(summary).toMatch(/0\.5\.0-test-min-ab/);
  expect(summary).toMatch(/TEST_ONLY/);
  for (const amount of ['150.00', '130.00', '140.67', '9.33']) expect(summary).toMatch(moneyPattern(amount));
  expect(summary).toMatch(/weryfikacja księgowa|D11/i);
  expect(summary).not.toContain('NIE KOPIUJ TEJ ETYKIETY');
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
  await page.locator('#training-mode').check();
  await page.locator('#example-select').selectOption('T03');
  await page.locator('#load-example').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#basket-old')).toHaveValue(/150(?:[.,]00)?/);
  await page.locator('#basket-invoiced').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#bok-details > summary')).toBeFocused();
  await page.locator('#calculate').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#result-heading')).toBeFocused();
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
  await expect(positions(page)).toHaveCount(0);
  await expect(page.locator('#basket-old')).toHaveValue('');
  await expect(page.locator('#document-state input:checked')).toHaveValue('UNKNOWN');
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
    await calculate(page);
    if (viewport.name === 'mobile') {
      for (const [id, label] of [['total-old', 'Dotychczasowy abonament'], ['total-new', 'Nowy abonament'], ['total-invoiced', 'Kwota faktury']]) {
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
