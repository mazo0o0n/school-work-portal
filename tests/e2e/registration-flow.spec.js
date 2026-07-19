const { test, expect } = require("@playwright/test");

test("تسجيل المدرسة وحفظ البيانات والانتقال للرئيسية", async ({ page }) => {
  test.setTimeout(15000);

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

  await page
    .locator('#schoolRegisterForm button[type="submit"]')
    .click();

  await page.waitForURL("**/index.html", {
    timeout: 5000
  });

  const storedProfile = await page.evaluate(() => {
    const value = localStorage.getItem(
      "registeredSchoolProfile"
    );

    return value ? JSON.parse(value) : null;
  });

  expect(storedProfile).not.toBeNull();
  expect(storedProfile.schoolName).toBe(schoolName);
  expect(storedProfile.stage).toBe(selectedStage);
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
