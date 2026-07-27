const { test, expect } = require('@playwright/test');

const baseUrl = 'http://127.0.0.1:4173';
const adminToken = 'temporary-test-token';

function schoolItem(){
  return {
    id: 7,
    public_id: 'school_test_7',
    school_name: 'مدرسة الاختبار الإدارية',
    school_stage: 'متوسطة',
    education_department: 'إدارة التعليم بمنطقة المدينة المنورة',
    verification_status: 'pending',
    created_at: '2026-07-26 10:00:00',
    updated_at: '2026-07-26 10:00:00'
  };
}

async function mockAdminApi(page){
  let deleted = false;
  let deleteRequests = 0;
  let currentStatus = 'pending';

  await page.route('**/api/admin/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    expect(request.headers()['x-admin-token']).toBe(adminToken);

    if(url.pathname === '/api/admin/audit-logs'){
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          limit: 50,
          items: [{
            id: 1,
            action: 'school_status_changed',
            entity_type: 'school',
            entity_id: '7',
            result: 'success',
            metadata: { previous_status: 'unverified', new_status: 'pending' },
            created_at: '2026-07-26 10:00:00'
          }]
        })
      });
      return;
    }

    if(url.pathname === '/api/admin/schools/7' && request.method() === 'DELETE'){
      deleted = true;
      deleteRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, id: 7, deleted: 1 })
      });
      return;
    }

    if(url.pathname === '/api/admin/schools/7' && request.method() === 'PATCH'){
      const payload = JSON.parse(request.postData() || '{}');
      currentStatus = payload.verificationStatus;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          id: 7,
          verification_status: currentStatus,
          changed: 1
        })
      });
      return;
    }

    if(url.pathname === '/api/admin/schools' && url.searchParams.get('summary') === '1'){
      const total = deleted ? 0 : 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status_counts: {
            all: total,
            unverified: currentStatus === 'unverified' ? total : 0,
            pending: currentStatus === 'pending' ? total : 0,
            verified: currentStatus === 'verified' ? total : 0,
            suspended: currentStatus === 'suspended' ? total : 0
          },
          stage_counts: { ابتدائية: 0, متوسطة: total, ثانوية: 0 }
        })
      });
      return;
    }

    if(url.pathname === '/api/admin/schools'){
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total: deleted ? 0 : 1,
          items: deleted ? [] : [{ ...schoolItem(), verification_status: currentStatus }],
          pagination: {
            page: 1,
            limit: 25,
            pages: 1,
            has_previous: false,
            has_next: false
          }
        })
      });
      return;
    }

    await route.abort();
  });

  return {
    getDeleteRequests: () => deleteRequests
  };
}

test('requires typed confirmation, shows audit entries, and clears the admin session on logout', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeSetInterval = window.setInterval.bind(window);
    const nativeClearInterval = window.clearInterval.bind(window);
    const activeIntervals = new Set();
    window.__adminActiveIntervals = activeIntervals;
    window.setInterval = (...args) => {
      const intervalId = nativeSetInterval(...args);
      activeIntervals.add(intervalId);
      return intervalId;
    };
    window.clearInterval = (intervalId) => {
      activeIntervals.delete(intervalId);
      return nativeClearInterval(intervalId);
    };
  });
  const api = await mockAdminApi(page);
  await page.goto(`${baseUrl}/admin-schools.html`);

  await page.getByLabel('رمز الإدارة').fill(adminToken);
  await page.getByRole('button', { name: 'دخول' }).click();

  await expect(page.getByRole('heading', { name: 'جلسة الإدارة' })).toBeVisible();
  await expect(page.getByText('مدرسة الاختبار الإدارية')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'سجل العمليات الإدارية' })).toBeVisible();
  await expect(page.getByText('تغيير حالة مدرسة')).toBeVisible();
  await expect(page.getByLabel('رمز الإدارة')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__adminActiveIntervals.size)).toBe(1);

  const storedToken = await page.evaluate((token) => ({
    local: Object.values(localStorage).includes(token),
    session: Object.values(sessionStorage).includes(token)
  }), adminToken);
  expect(storedToken).toEqual({ local: false, session: false });

  const statusSelect = page.locator('.status-action');
  expect(await statusSelect.count()).toBe(1);
  await statusSelect.selectOption('verified');
  await page.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تم تحديث حالة المدرسة إلى «متحققة».')).toBeVisible();

  await page.getByRole('button', { name: 'حذف', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'تأكيد حذف المدرسة' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('مدرسة الاختبار الإدارية')).toBeVisible();
  await expect(dialog.getByText('متوسطة', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'حذف المدرسة نهائيًا' })).toBeDisabled();
  expect(api.getDeleteRequests()).toBe(0);

  await page.getByLabel('اكتب كلمة حذف للتأكيد').fill('حذف');
  await dialog.getByRole('button', { name: 'حذف المدرسة نهائيًا' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(api.getDeleteRequests).toBe(1);
  await expect(page.getByText('تم حذف سجل المدرسة.')).toBeVisible();

  await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
  await expect(page.getByRole('heading', { name: 'الدخول الإداري' })).toBeVisible();
  await expect(page.getByLabel('رمز الإدارة')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'سجل العمليات الإدارية' })).toBeHidden();
  await expect(page.locator('#schoolsTableBody')).toBeEmpty();
  await expect(page.locator('#auditTableBody')).toBeEmpty();
  await expect.poll(() => page.evaluate(() => window.__adminActiveIntervals.size)).toBe(0);
});

test('admin layout has no horizontal overflow at 390 by 844', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAdminApi(page);
  await page.goto(`${baseUrl}/admin-schools.html`);
  await page.getByLabel('رمز الإدارة').fill(adminToken);
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page.getByRole('heading', { name: 'سجل العمليات الإدارية' })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(() => (
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  ));
  expect(hasHorizontalOverflow).toBe(false);
});
