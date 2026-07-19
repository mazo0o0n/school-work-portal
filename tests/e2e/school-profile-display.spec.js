const { test, expect } = require("@playwright/test");

test("ظهور بيانات المدرسة في الصفحة الرئيسية بعد التسجيل", async ({ page }) => {
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

  await Promise.all([
    page.waitForURL("**/index.html", {
      timeout: 5000,
      waitUntil: "domcontentloaded"
    }),
    page
      .locator('#schoolRegisterForm button[type="submit"]')
      .click()
  ]);

  await expect(page.locator("body")).toContainText(schoolName);
  await expect(page.locator("body")).toContainText(selectedStage);
});
