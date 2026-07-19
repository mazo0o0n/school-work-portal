const { test, expect } = require("@playwright/test");

test("تحميل الصفحة الرئيسية دون أخطاء تشغيل", async ({ page }) => {
  const pageErrors = [];

  await page.addInitScript(() => {
    localStorage.setItem("schoolGuestMode", "1");
  });
  page.on("pageerror", error => {
    pageErrors.push(error.message);
  });

  const response = await page.goto(
    "http://127.0.0.1:4173/index.html",
    { waitUntil: "domcontentloaded" }
  );

  expect(response).not.toBeNull();
  expect(response.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/index\.html$/);
  await expect(page.locator("#academy-platforms")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "تعلم وأدِر مواردك التعليمية في مكان واحد"
    })
  ).toBeVisible();
  expect(pageErrors).toEqual([]);
});
