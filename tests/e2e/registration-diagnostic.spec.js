const { test, expect } = require("@playwright/test");

test("تسجيل المدرسة وحفظ البيانات", async ({ page }) => {
  test.setTimeout(15000);

  await page.goto("http://127.0.0.1:4173/register.html");

  await page.fill("#schoolName", "مدرسة اختبار المنصة");
  await page.selectOption("#schoolStage", "ابتدائي");

  await page.fill("#educationDepartment", "إدارة تعليم المدينة المنورة");
  await page.fill("#ministryNumber", "123456789");
  await page.fill("#principalName", "مدير الاختبار");
  await page.fill("#educationalAffairsAgent", "وكيل الشؤون التعليمية");
  await page.fill("#studentAffairsAgent", "وكيل شؤون الطلاب");
  await page.fill("#schoolAffairsAgent", "وكيل الشؤون المدرسية");

  const buttons = await page.locator("button").evaluateAll(items =>
    items.map(button => ({
      id: button.id,
      type: button.type,
      text: button.textContent.trim(),
      visible: Boolean(button.offsetWidth || button.offsetHeight)
    }))
  );

  console.log("BUTTONS:", buttons);

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
  expect(storedProfile.schoolStage).toBe("ابتدائي");
  expect(storedProfile.educationDepartment).toBe(
    "إدارة تعليم المدينة المنورة"
  );
  expect(storedProfile.ministryNumber).toBe("123456789");
  expect(storedProfile.principalName).toBe("مدير الاختبار");
});
