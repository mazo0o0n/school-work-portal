const { test, expect } = require('@playwright/test');

const pageUrl = 'http://127.0.0.1:4173/index.html';
const fallbackAnswer =
  'ما عندي معلومة مؤكدة عن هذا السؤال حاليًا، تقدر تعيد صياغته أو تراجع الجهة المختصة.';

async function openAssistant(page){
  await page.addInitScript(() => {
    localStorage.setItem('schoolGuestMode', '1');
  });
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#aiToggle').click();
  await expect(page.locator('#aiPanel')).toBeVisible();
}

test('يفتح المساعد ويرسل سؤالًا ويحفظ المحادثة في sessionStorage', async ({ page }) => {
  const question = 'سؤال اختبار واجهة المساعد';
  const answer = 'إجابة اختبار آمنة';
  const source = 'مصدر اختبار';

  await page.route('**/api/chat', async (route) => {
    const body = route.request().postDataJSON();
    expect(body.question).toBe(question);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ answer, source })
    });
  });

  await openAssistant(page);
  await page.locator('#aiQuestion').fill(question);
  await page.locator('#aiSubmit').click();
  await expect(page.locator('.ai-loading')).toBeVisible();
  const answerMessage = page.locator('.ai-message.bot', { hasText: answer });
  await expect(answerMessage).toBeVisible();
  await expect(answerMessage).toHaveAttribute('data-message-source', source);

  const storedMessages = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('platformAiConversationSession') || '[]')
  );
  expect(storedMessages.some((message) => message.text === question)).toBe(true);
  expect(storedMessages.some((message) => message.text === answer)).toBe(true);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#aiPanel')).toBeVisible();
  await expect(page.locator('.ai-message.user', { hasText: question })).toBeVisible();
  await expect(page.locator('.ai-message.bot', { hasText: answer })).toBeVisible();
});

test('يعرض fallback الطبيعي دون مسار اتصال شخصي أو تخزين مراجعة محلي', async ({ page }) => {
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answer: fallbackAnswer,
        source: 'قاعدة معرفة المنصة',
        notFound: true
      })
    });
  });

  await openAssistant(page);
  await page.locator('#aiQuestion').fill('سؤال خارج نطاق اختبار الواجهة');
  await page.locator('#aiSubmit').click();
  await expect(page.locator('.ai-message.bot', { hasText: fallbackAnswer })).toBeVisible();
  await expect(page.locator('#aiPanel a[href*="wa.me"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() =>
    localStorage.getItem('platformAiUnansweredQuestions')
  )).toBeNull();
});

test('تنهي مهلة المساعد الطلب وتعيد الواجهة إلى حالتها الطبيعية', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, options = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      if(url !== '/api/chat') return nativeFetch(input, options);

      return new Promise((_resolve, reject) => {
        const signal = options.signal;
        const rejectAsAborted = () => {
          reject(new DOMException('The request was aborted.', 'AbortError'));
        };
        if(signal?.aborted){
          rejectAsAborted();
          return;
        }
        signal?.addEventListener('abort', rejectAsAborted, { once: true });
      });
    };
  });

  await openAssistant(page);
  await page.locator('#aiQuestion').fill('سؤال لاختبار مهلة المساعد');
  await page.locator('#aiSubmit').click();
  await expect(page.locator('.ai-loading')).toBeVisible();

  await page.clock.fastForward(30001);

  await expect(
    page.locator('.ai-message.ai-error', {
      hasText: 'انتهت مهلة طلب المساعد بعد 30 ثانية'
    })
  ).toBeVisible();
  await expect(page.locator('.ai-loading')).toHaveCount(0);
  await expect(page.locator('#aiSubmit')).toBeEnabled();
  await expect(page.locator('#aiQuestion')).not.toHaveAttribute('readonly', '');
  await expect(page.locator('#aiForm')).toHaveAttribute('aria-busy', 'false');
});
