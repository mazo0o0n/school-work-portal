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

  await page.fill(
    "#educationDepartment",
    "إدارة تعليم المدينة المنورة"
  );
  await page.fill("#ministryNumber", "123456789");
  await page.fill("#principalName", "مدير الاختبار");
  await page.fill(
    "#educationalAffairsAgent",
    "وكيل الشؤون التعليمية"
  );
  await page.fill(
    "#studentAffairsAgent",
    "وكيل شؤون الطلاب"
  );
  await page.fill(
    "#schoolAffairsAgent",
    "وكيل الشؤون المدرسية"
  );

  await page
    .locator('#schoolRegisterForm button[type="submit"]')
    .click();

  await page.waitForURL("**/index.html", {
    timeout: 5000
  });

  await expect(page.locator("body")).toContainText(schoolName);
  await expect(page.locator("body")).toContainText(selectedStage);
});
