const { test, expect } = require("@playwright/test");

test("تسجيل المدرسة وحفظ البيانات", async ({ page }) => {
  test.setTimeout(15000);

  await page.goto("http://127.0.0.1:4173/register.html");

  await page.fill("#schoolName", "مدرسة اختبار المنصة");
  await page.selectOption("#schoolStage", "ابتدائي");

  await page.selectOption(
    "#educationDepartment",
    "إدارة التعليم بمنطقة المدينة المنورة"
  );

  const formValidity = await page.locator("#schoolRegisterForm").evaluate(
    form => form.checkValidity()
  );

  expect(formValidity).toBe(true);

  await page.locator("#schoolRegisterForm").evaluate(form => {
    form.requestSubmit();
  });

  await page.waitForURL("**/index.html", {
    timeout: 5000
  });

  const storedProfile = await page.evaluate(() => {
    const value = localStorage.getItem("registeredSchoolProfile");
    return value ? JSON.parse(value) : null;
  });

  expect(storedProfile).not.toBeNull();
  expect(storedProfile.schoolName).toBe("مدرسة اختبار المنصة");
  expect(storedProfile.schoolStage).toBe("ابتدائية");
  expect(storedProfile.educationDepartment).toBe(
    "إدارة التعليم بمنطقة المدينة المنورة"
  );
});
