const { test, expect } = require("@playwright/test");

const {
  completeRegistrationContact,
  mockPhoneVerificationApi,
  mockPhoneVerificationConfig,
  mockSchoolRegistrationApi
} = require('./helpers/school-registration');

test("تسجيل المدرسة وحفظ البيانات والانتقال للرئيسية", async ({ page }) => {
  test.setTimeout(15000);

  await mockSchoolRegistrationApi(page);
  await page.goto("http://127.0.0.1:4173/register.html");

  const schoolName = "مدرسة اختبار المنصة";

  await page.fill("#schoolName", schoolName);
  await page.selectOption("#schoolStage", { index: 1 });

  const selectedStage = await page
    .locator("#schoolStage")
    .inputValue();

  await page.selectOption(
    "#educationDepartment",
    "إدارة التعليم بمنطقة المدينة المنورة"
  );
  await expect(page.locator('#registrationSubmit')).toBeDisabled();
  await completeRegistrationContact(page);
  await expect(page.locator('#registrationSubmit')).toBeEnabled();

  await Promise.all([
    page.waitForURL("**/index.html", {
      timeout: 5000,
      waitUntil: "commit"
    }),
    page
      .locator('#schoolRegisterForm button[type="submit"]')
      .click()
  ]);
  await page.waitForLoadState('domcontentloaded', { timeout: 10000 });

  const storedProfile = await page.evaluate(() => {
    const value = localStorage.getItem(
      "registeredSchoolProfile"
    );

    return value ? JSON.parse(value) : null;
  });

  expect(storedProfile).not.toBeNull();
  expect(storedProfile.schoolName).toBe(schoolName);
  expect(storedProfile.schoolStage).toBe(selectedStage);
  expect(storedProfile.educationDepartment).toBe(
    "إدارة التعليم بمنطقة المدينة المنورة"
  );

  const legacyValues = await page.evaluate(() => ({
    schoolName: localStorage.getItem(
      "registeredSchoolName"
    ),
    schoolStage: localStorage.getItem(
      "registeredSchoolStage"
    ),
    allStorage: JSON.stringify(Object.fromEntries(
      Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])
    ))
  }));

  expect(legacyValues.schoolName).not.toBeNull();
  expect(legacyValues.schoolName).toContain(schoolName);
  expect(legacyValues.schoolName).toContain(selectedStage);
  expect(legacyValues.schoolStage).toBe(selectedStage);
  expect(legacyValues.allStorage).not.toContain('0500000000');
  expect(legacyValues.allStorage).not.toContain('test-phone-verification-token');
});

test("عرض رسالة واضحة عند تكرار هوية المدرسة دون حفظ محلي", async ({ page }) => {
  await mockPhoneVerificationApi(page);
  await page.route('**/api/schools/register', async route => {
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'هذه المدرسة مسجلة مسبقًا بنفس المرحلة وإدارة التعليم.',
        code: 'duplicate_school'
      })
    });
  });
  await page.goto("http://127.0.0.1:4173/register.html");

  await page.fill("#schoolName", "اختبار 2");
  await page.selectOption("#schoolStage", "متوسطة");
  await page.selectOption(
    "#educationDepartment",
    "إدارة التعليم بمنطقة المدينة المنورة"
  );
  await completeRegistrationContact(page);

  const dialogMessage = new Promise(resolve => {
    page.once('dialog', async dialog => {
      resolve(dialog.message());
      await dialog.accept();
    });
  });

  await page.locator('#schoolRegisterForm button[type="submit"]').click();

  await expect(dialogMessage).resolves.toBe(
    'هذه المدرسة مسجلة مسبقًا بنفس المرحلة وإدارة التعليم.'
  );
  await expect(page).toHaveURL(/\/register\.html$/);

  const storedProfile = await page.evaluate(() => (
    localStorage.getItem('registeredSchoolProfile')
  ));
  expect(storedProfile).toBeNull();
});

test("يخفي تحقق واتساب عندما يعطله الخادم ويسمح بالتسجيل العادي", async ({ page }) => {
  await mockPhoneVerificationConfig(page, false);
  await mockSchoolRegistrationApiWithoutVerification(page);
  await page.goto("http://127.0.0.1:4173/register.html");

  await expect(page.locator('#phoneVerification')).toBeHidden();
  await page.fill('#schoolName', 'مدرسة بلا تحقق واتساب');
  await page.selectOption('#schoolStage', 'ابتدائية');
  await page.selectOption(
    '#educationDepartment',
    'إدارة التعليم بمنطقة المدينة المنورة'
  );
  await page.fill('#registrationContactPhone', '0500000000');
  await page.check('#registrationConsent');
  await expect(page.locator('#registrationSubmit')).toBeEnabled();

  await Promise.all([
    page.waitForURL('**/index.html', { waitUntil: 'commit' }),
    page.locator('#registrationSubmit').click()
  ]);
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  expect(storage).not.toContain('0500000000');
});

async function mockSchoolRegistrationApiWithoutVerification(page){
  await page.route('**/api/schools/register', async route => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        school: { publicId: 'school-test-public-id', verificationStatus: 'unverified' },
        editToken: 'test-edit-token'
      })
    });
  });
}
