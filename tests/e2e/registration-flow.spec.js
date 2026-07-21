const { test, expect } = require("@playwright/test");

const { mockSchoolRegistrationApi } = require('./helpers/school-registration');

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

  await Promise.all([
    page.waitForURL("**/index.html", {
      timeout: 5000,
      waitUntil: "domcontentloaded"
    }),
    page
      .locator('#schoolRegisterForm button[type="submit"]')
      .click()
  ]);

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
    )
  }));

  expect(legacyValues.schoolName).not.toBeNull();
  expect(legacyValues.schoolName).toContain(schoolName);
  expect(legacyValues.schoolName).toContain(selectedStage);
  expect(legacyValues.schoolStage).toBe(selectedStage);
});

test("عرض رسالة واضحة عند تكرار هوية المدرسة دون حفظ محلي", async ({ page }) => {
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
