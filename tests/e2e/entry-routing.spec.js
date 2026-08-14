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

test('لا يعبئ نموذج إنشاء مدرسة من بيانات مدرسة محفوظة', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('registeredSchoolBaseName', 'مدرسة محفوظة');
    localStorage.setItem('registeredSchoolStage', 'ابتدائية');
    localStorage.setItem('registeredSchoolName', 'ابتدائية مدرسة محفوظة');
    localStorage.setItem('registeredSchoolProfile', JSON.stringify({
      schoolName: 'مدرسة محفوظة',
      schoolStage: 'ابتدائية',
      educationDepartment: 'إدارة التعليم بمنطقة المدينة المنورة'
    }));
  });

  await page.goto(`${baseUrl}/register.html`);

  await expect(page.locator('#schoolName')).toHaveValue('');
  await expect(page.locator('#schoolStage')).toHaveValue('');
  await expect(page.locator('#educationDepartment')).toHaveValue('');
  await expect(page.locator('body')).not.toContainText(
    'يمكن تعديل بيانات المدرسة لاحقًا من صفحة التسجيل.'
  );
});

test('لا يحول تغيير المرحلة أو الإدارة إلى تعديل وهمي', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('registeredSchoolProfile', JSON.stringify({
      schoolName: 'مدرسة محفوظة',
      schoolStage: 'ابتدائية',
      educationDepartment: 'إدارة التعليم بمنطقة المدينة المنورة'
    }));
  });
  let registrationRequests = 0;
  await page.route('**/api/register/verification-config', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ phoneVerificationRequired: false })
  }));
  await page.route('**/api/schools/register', route => {
    registrationRequests += 1;
    return route.abort();
  });

  await page.goto(`${baseUrl}/register.html`);
  await page.selectOption('#schoolStage', 'متوسطة');
  await page.selectOption(
    '#educationDepartment',
    'إدارة التعليم بمنطقة الرياض'
  );
  await page.fill('#registrationContactPhone', '0500000000');
  await page.check('#registrationConsent');
  await page.locator('#schoolRegisterForm').evaluate(form => form.requestSubmit());

  await expect(page.locator('#schoolName')).toHaveValue('');
  expect(registrationRequests).toBe(0);
});

test('يبقي مسار إنشاء مدرسة جديدة الصريح فارغًا', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('registeredSchoolProfile', JSON.stringify({
      schoolName: 'مدرسة محفوظة',
      schoolStage: 'ابتدائية',
      educationDepartment: 'إدارة التعليم بمنطقة المدينة المنورة'
    }));
  });

  await page.goto(`${baseUrl}/register.html?new=1`);

  await expect(page.locator('#schoolName')).toHaveValue('');
  await expect(page.locator('#schoolStage')).toHaveValue('');
  await expect(page.locator('#educationDepartment')).toHaveValue('');
});

test('لا يتأثر مسار لوحة إدارة المدارس', async ({ page }) => {
  await page.goto(`${baseUrl}/admin-schools.html`);

  await expect(page).toHaveURL(/\/admin-schools\.html$/);
  await expect(page.locator('body')).toBeVisible();
});
