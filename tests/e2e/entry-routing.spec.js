const { test, expect } = require('@playwright/test');

const baseUrl = 'http://127.0.0.1:4173';

async function resetRegistrationState(page){
  await page.goto(`${baseUrl}/register.html`);
  await page.evaluate(() => localStorage.clear());
}

test.beforeEach(async ({ page }) => {
  await resetRegistrationState(page);
});

test('يوجه المستخدم الجديد إلى صفحة التسجيل', async ({ page }) => {
  await page.goto(`${baseUrl}/index.html`);
  await expect(page).toHaveURL(/\/register\.html$/);
});

test('يوجه المستخدم الجديد من المسار الرئيسي إلى صفحة التسجيل', async ({ page }) => {
  await page.goto(`${baseUrl}/`);
  await expect(page).toHaveURL(/\/register\.html$/);
});

test('يسمح للضيف بفتح الصفحة الرئيسية دون حلقة تحويل', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('schoolGuestMode', '1'));
  await page.goto(`${baseUrl}/index.html`);

  await expect(page).toHaveURL(/\/index\.html$/);
  await expect(page.locator('body')).toBeVisible();
});

test('يسمح لملف مدرسة محفوظ بفتح الصفحة الرئيسية', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('registeredSchoolProfile', JSON.stringify({
      schoolName: 'مدرسة الاختبار',
      schoolStage: 'ابتدائية',
      educationDepartment: 'إدارة التعليم بمنطقة المدينة المنورة'
    }));
  });
  await page.goto(`${baseUrl}/index.html`);

  await expect(page).toHaveURL(/\/index\.html$/);
});

test('يحافظ على توافق اسم المدرسة القديم', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('registeredSchoolName', 'ابتدائية مدرسة الاختبار');
  });
  await page.goto(`${baseUrl}/index.html`);

  await expect(page).toHaveURL(/\/index\.html$/);
});

test('لا تعتبر البيانات الجزئية القديمة تسجيلًا مكتملًا', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('registeredSchoolBaseName', 'مدرسة قديمة');
  });
  await page.goto(`${baseUrl}/index.html`);

  await expect(page).toHaveURL(/\/register\.html$/);
});

test('لا يتأثر مسار لوحة إدارة المدارس', async ({ page }) => {
  await page.goto(`${baseUrl}/admin-schools.html`);

  await expect(page).toHaveURL(/\/admin-schools\.html$/);
  await expect(page.locator('body')).toBeVisible();
});
