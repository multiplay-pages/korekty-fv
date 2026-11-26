import { test, expect } from '@playwright/test';
import { formatPln } from '../../src/basket.mjs';
import { matrix } from '../fixtures/stage-5a.mjs';
import { readFileSync } from 'node:fs';

const goldenCopies = JSON.parse(readFileSync(new URL('../fixtures/stage-5a-copy.json', import.meta.url), 'utf8'));

const states = {
  NO_CORRECTION: 'Bez korekty', NO_CORRECTION_EXPECTED: 'Nie przewidujemy korekty',
  INVOICE_REQUIRED: 'Kwota z faktury wymagana', NOT_APPLICABLE: 'Korekta nie dotyczy',
  REVIEW: 'Weryfikacja', REFER: 'Przekaż do rozliczeń',
};

async function fillCase(page, input) {
  await page.goto('/');
  await page.locator('#last-old-date').fill(input.lastOldDate);
  if (await page.locator('#month').inputValue() !== input.month) await page.locator('#month').fill(input.month);
  if (input.source === 'lines') {
    await page.locator('input[name=calc-mode][value=BOK]').check();
    for (const [index, values] of input.rows.entries()) {
      if (index > 0) await page.locator('#add-position').click();
      const row = page.locator('#positions tbody tr').nth(index);
      await row.locator('[data-field=service]').selectOption(values.service);
      // VAT pozycji: domyślny ze słownika usług, nadpisany wartością z przypadku (pole edytowalne).
      if (values.vat) await row.locator('[data-field=vat]').selectOption(values.vat);
      await row.locator('[data-field=old]').fill(values.old);
      await row.locator('[data-field=new]').fill(values.new);
      if (values.invoiced) await row.locator('[data-field=invoiced]').fill(values.invoiced);
      if (values.basis !== 'gross') {
        await row.locator('summary').click();
        await row.locator('[data-field=basis]').selectOption(values.basis);
      }
    }
  } else {
    await page.locator('#basket-old').fill(input.totals.old);
    await page.locator('#basket-new').fill(input.totals.new);
    if (input.totals.invoiced !== undefined) await page.locator('#basket-invoiced').fill(input.totals.invoiced);
  }
  await page.locator(`#document-state input[value="${input.documentState}"]`).check();
  const flags = [
    [input.unresolvedDiscounts,'#unresolved-discounts'], [input.multipleDates,'#multiple-dates'],
    [input.dateVerified === false,'#date-uncertain'], [input.nonComparableScope,'#non-comparable'],
  ];
  if (input.scope || flags.some(([flag])=>flag)) {
    await page.locator('.complexity > summary').click();
    if (input.scope) await page.locator('#billing-scope').selectOption(input.scope);
    for (const [flag, selector] of flags) if (flag) await page.locator(selector).check();
  }
  const confirmation = page.locator('#invoice-confirmed');
  if (input.invoiceConfirmed && await confirmation.isEnabled()) await confirmation.check();
}

// Pozycja bez VAT (M25-brak-VAT) nie powstanie w formularzu: słownik usług zawsze podstawia stawkę. Blokadę potwierdzenia
// bez VAT sprawdza test jednostkowy macierzy 5A, a podstawianie VAT — test E2E „słownik usług podstawia VAT…”.
const uiMatrix = matrix.filter(([, input]) => !input.rows?.some(row => row.vat === ''));
for (const [id,input,decision,dataStatus,amount,due] of uiMatrix) {
  test(`5A ${id}: stan, kwota i kopia`, async ({page}, testInfo) => {
    await fillCase(page,input);
    await page.locator('#calculate').click();
    const copy = await page.locator('#summary').inputValue();
    expect(Buffer.from(copy)).toEqual(Buffer.from(goldenCopies[id]));
    const state = page.locator('[data-result-state]');
    await expect(state).toHaveCount(1);
    await expect(state).toHaveAttribute('data-result-state',decision);
    if (decision === 'ERROR') {
      await expect(page.locator('#errors')).toHaveAttribute('role','alert');
      await expect(page.locator('#basket-old')).toBeFocused();
      await expect(page.locator('#summary')).toHaveValue('');
      return;
    }
    const title = decision === 'CORRECTION' ? dataStatus === 'CONFIRMED' ? 'Faktura potwierdzona' : 'Szacunek' : states[decision];
    await expect(state).toHaveText(title);
    await expect(state).toHaveAttribute('data-data-status',dataStatus);
    await expect(state).toHaveAttribute('data-document-state',input.documentState);
    await expect(page.locator('#decision-feedback')).toHaveAttribute('role','status');
    expect(copy.split('\n')).toContain(title);
    expect(copy).toMatch(/TEST_ONLY/);
    expect(copy).not.toMatch(/zwiększenie|do dodania|zmniejsz starą pozycję/i);
    if (amount !== null) {
      await expect(page.locator('#result-main-amount')).toBeVisible();
      // 26.11.2026: zmniejszenie faktury prezentowane ze znakiem minus (należność − F).
      await expect(page.locator('#delta')).toHaveText(formatPln(`-${amount}`, true));
      expect(copy).toContain(`Korekta faktury: ${formatPln(`-${amount}`, true)} (zmniejszenie)`);
    } else {
      await expect(page.locator('#result-main-amount')).toBeHidden();
      expect(copy).not.toContain('(zmniejszenie)');
    }
    const increaseInChange = /^M(11|12|13|14|15)/.test(id);
    if (due !== null && !increaseInChange) {
      await expect(page.locator('#due')).toHaveText(formatPln(due));
      expect(copy).toContain(formatPln(due));
    } else await expect(page.locator('#due')).toHaveCount(0);
    if (['M05','M15','M21'].includes(id)) {
      const variantRows = page.locator('#document-variants li');
      await expect(variantRows).toHaveCount(4);
      const variants = await variantRows.allTextContents();
      const zero = variantRows.filter({hasText:/\b0,00 zł/});
      await expect(zero).toHaveCount(1);
      if (id === 'M21') {
        await expect(zero).toHaveText('Wystawiona według nowego abonamentu (0,00 zł) → bez korekty.');
        await expect(variantRows.filter({hasText:'Inna kwota'})).toHaveText('Inna kwota → wpisz kwotę.');
      } else {
        const action = id === 'M05' ? 'wpisz kwotę' : 'wpisz kwotę do weryfikacji';
        await expect(zero).toHaveText(`Inna kwota (w tym 0,00 zł) → ${action}.`);
      }
      for (const variant of variants) expect(copy.split('\n')).toContain(variant);
    } else await expect(page.locator('#document-variants li')).toHaveCount(0);
    if (['M24','R2a-ujemny-wiersz'].includes(id)) {
      await expect(page.locator('#bok-result table')).toHaveCount(1);
      const rows = await page.locator('#line-results tbody tr').evaluateAll(rows => rows.map(row =>
        Array.from(row.cells, cell => cell.firstChild.textContent.trim()).join(' · ')));
      expect(rows).toHaveLength(input.rows.length);
      for (const row of rows) expect(copy).toContain(row);
      const remainder = id === 'M24' ? '−0,01' : '+0,01';
      const remainderLabel = `Reszta korekty koszyka ${remainder} zł do uzgodnienia.`;
      await expect(page.locator('#rounding-residual')).toHaveText(remainderLabel);
      expect(copy.split('\n')).toContain(remainderLabel);
      if (id === 'R2a-ujemny-wiersz') {
        await page.locator('#calculation-details > summary').click();
        const partRemainder = 'Reszta zaokrąglenia części pozycji: −0,01 zł.';
        await expect(page.locator('#calculation-parts [data-field=remainder]')).toHaveText(partRemainder);
        expect(copy).toContain(partRemainder);
      }
      expect(copy).toMatch(/do MMS.*D11/);
    }
    if (id.startsWith('M25')) {
      await expect(page.locator('#invoice-confirmed')).not.toBeChecked();
      if (id === 'M25') await expect(page.locator('#invoice-confirmed')).toBeEnabled();
      else await expect(page.locator('#invoice-confirmed')).toBeDisabled();
      expect(copy).not.toMatch(/1\. Internet|Reszta korekty koszyka −0,01 zł/);
    }
    if (['M01','M11','M24','R2a-ujemny-wiersz'].includes(id) && testInfo.project.name.startsWith('chromium')) {
      await page.screenshot({ path:testInfo.outputPath(`5A-${id}.png`), fullPage:true });
    }
  });
}

test('5A U7: propozycja miesiąca, ręczna zmiana i powrót', async ({page}) => {
  await page.goto('/');
  for (const [lastOldDate,month] of [['2026-10-31','2026-11'],['2026-11-30','2026-12'],['2026-12-31','2027-01'],
    ['2027-02-28','2027-03'],['2028-02-28','2028-02'],['2028-02-29','2028-03']]) {
    await page.locator('#last-old-date').fill(lastOldDate);
    await expect(page.locator('#month')).toHaveValue(month);
  }
  await page.locator('#month').fill('2028-04');
  await expect(page.locator('#month-preview')).toContainText('zmieniono ręcznie');
  await page.locator('#last-old-date').fill('2028-03-31');
  await page.locator('#last-old-date').fill('2028-02-28');
  await expect(page.locator('#month')).toHaveValue('2028-04');
  await page.locator('#restore-month').click();
  await expect(page.locator('#month')).toHaveValue('2028-02');
});

test('5A U7: edycja w BOK usuwa potwierdzenie i podsumowanie', async ({page}) => {
  const input = matrix.find(([id]) => id === 'M02')[1];
  for (const edit of [
    () => page.locator('#month').fill('2026-10'),
    () => page.locator('#last-old-date').fill('2026-11-16'),
    () => page.locator('#positions [data-field=invoiced]').fill('160'),
    () => page.locator('#positions [data-field=vat]').first().selectOption('8'),
    () => page.locator('#add-position').click(),
    () => page.locator('[data-action=remove]').click(),
    () => page.locator('#document-state input[value="NOT_ISSUED"]').check(),
  ]) {
    await fillCase(page,input);
    await page.locator('#calculate').click();
    await expect(page.locator('#result-heading')).toHaveText('Faktura potwierdzona');
    await edit();
    await expect(page.locator('#results')).toBeHidden();
    await expect(page.locator('#invoice-confirmed')).not.toBeChecked();
    await expect(page.locator('#copy-summary')).toBeDisabled();
    await expect(page.locator('#summary')).toHaveValue('');
  }
});

test('5A Q-06: kontrast tekstu, granic pól i wskaźnika fokusu', async ({page}, testInfo) => {
  const input = matrix.find(([id]) => id === 'M24')[1];
  await fillCase(page,input);
  await page.locator('#calculate').click();
  await page.locator('#document-state input:checked').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#document-state input:checked')).toBeFocused();
  const measurements = await page.evaluate(() => {
    const rgb = color => color.match(/[\d.]+/g).map(Number);
    const luminance = color => rgb(color).slice(0,3).map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((total,value,index) => total + value * [0.2126,0.7152,0.0722][index],0);
    const background = element => {
      for (let current = element; current; current = current.parentElement) {
        const color = getComputedStyle(current).backgroundColor;
        const gradient = getComputedStyle(current).backgroundImage.match(/rgba?\([^)]+\)/g);
        if (gradient) return gradient;
        if (rgb(color)[3] !== 0) return [color];
      }
      return ['rgb(255,255,255)'];
    };
    const contrast = (first,second) => {
      const [dark,light] = [luminance(first),luminance(second)].sort((a,b) => a-b);
      return (light+0.05)/(dark+0.05);
    };
    const against = (color, backgrounds) => Math.min(...backgrounds.map(backdrop => contrast(color, backdrop)));
    return ['#result-heading','#delta','#rounding-residual','#messages .message','#document-state input:checked + .invoice-card','#positions [data-field=vat]','#positions .vat-draft:not([hidden])'].map(selector => {
      const element = document.querySelector(selector);
      const style = getComputedStyle(element);
      const focused = element.matches('.invoice-card') && document.activeElement === element.previousElementSibling;
      return {
        selector, text:against(style.color,background(element)),
        border:element.matches('select, .invoice-card') ? against(style.borderTopColor,background(element.parentElement)) : null,
        outline:focused ? against(style.outlineColor,background(element.parentElement)) : null,
        outlineWidth:focused ? parseFloat(style.outlineWidth) : null,
      };
    });
  });
  await testInfo.attach('kontrast-w-renderze', {body:JSON.stringify(measurements,null,2),contentType:'application/json'});
  for (const entry of measurements) {
    expect(entry.text,entry.selector).toBeGreaterThanOrEqual(4.5);
    if (entry.border !== null) expect(entry.border,entry.selector).toBeGreaterThanOrEqual(3);
  }
  expect(measurements.find(entry => entry.selector.endsWith('.invoice-card'))).toMatchObject({ outline:expect.any(Number), outlineWidth:3 });
  expect(measurements.find(entry => entry.selector.endsWith('.invoice-card')).outline).toBeGreaterThanOrEqual(3);
});
