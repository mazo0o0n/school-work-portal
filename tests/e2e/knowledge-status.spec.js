const { test, expect } = require('@playwright/test');

test('تعرض لوحة حالة المعرفة العدد الكلي من summary بطلب واحد', async ({ page }) => {
  const expectedTotal = 137;
  let adminRequestCount = 0;

  await page.route('**/api/admin/unanswered**', async (route) => {
    adminRequestCount += 1;
    const requestUrl = new URL(route.request().url());
    expect(requestUrl.searchParams.get('summary')).toBe('1');
    expect(route.request().headers()['x-admin-token']).toBe('test-admin-token');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        counts: {
          all: expectedTotal,
          new: 80,
          reviewed: 31,
          added_to_knowledge: 16,
          ignored: 10
        }
      })
    });
  });

  await page.goto('http://127.0.0.1:4173/knowledge-status.html', {
    waitUntil: 'domcontentloaded'
  });
  await page.locator('#adminToken').fill('test-admin-token');
  await page.locator('#loadUnanswered').click();

  await expect(page.locator('#unansweredCount')).toHaveText(
    expectedTotal.toLocaleString('ar-SA')
  );
  await expect(page.locator('#adminMessage')).toContainText('تم تحميل العدد');
  expect(adminRequestCount).toBe(1);
});
