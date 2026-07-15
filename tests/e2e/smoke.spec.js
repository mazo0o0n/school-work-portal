const { test, expect } = require("@playwright/test");

test("تحميل الصفحة الرئيسية دون أخطاء تشغيل", async ({ page }) => {
  const pageErrors = [];

  page.on("pageerror", error => {
    pageErrors.push(error.message);
  });

  const response = await page.goto(
    "http://127.0.0.1:4173/index.html",
    { waitUntil: "networkidle" }
  );

  expect(response).not.toBeNull();
  expect(response.ok()).toBeTruthy();
  await expect(page.locator("body")).toBeVisible();
  expect(pageErrors).toEqual([]);
});
