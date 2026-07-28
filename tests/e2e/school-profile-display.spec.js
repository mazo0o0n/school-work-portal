const { test, expect } = require("@playwright/test");

const {
  completeRegistrationContact,
  mockSchoolRegistrationApi
} = require('./helpers/school-registration');

test("ظهور بيانات المدرسة في الصفحة الرئيسية بعد التسجيل", async ({ page }) => {
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
  await completeRegistrationContact(page);

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

  await expect(page.locator("body")).toContainText(schoolName);
  await expect(page.locator("body")).toContainText(selectedStage);
});
