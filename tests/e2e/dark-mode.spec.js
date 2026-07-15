const { test, expect } = require("@playwright/test");

test("تفعيل الوضع الداكن وحفظه بعد إعادة تحميل الصفحة", async ({ page }) => {
  test.setTimeout(15000);

  // ضمان الدخول للصفحة الرئيسية كضيف.
  await page.addInitScript(() => {
    localStorage.setItem("schoolGuestMode", "1");
  });

  await page.goto("http://127.0.0.1:4173/index.html");

  // إنشاء حالة بداية ثابتة بالوضع الفاتح.
  await page.evaluate(() => {
    localStorage.setItem("preferredTheme", "light");
  });

  await page.reload();

  const body = page.locator("body");
  const themeButton = page.locator("[data-theme-toggle]").first();

  await expect(themeButton).toBeVisible();
  await expect(body).not.toHaveClass(/dark/);

  // التحويل إلى الوضع الداكن.
  await themeButton.click();

  await expect(body).toHaveClass(/dark/);

  const savedDarkTheme = await page.evaluate(() =>
    localStorage.getItem("preferredTheme")
  );

  expect(savedDarkTheme).toBe("dark");

  // التأكد أن الوضع الداكن يبقى بعد تحديث الصفحة.
  await page.reload();

  await expect(body).toHaveClass(/dark/);

  const themeAfterReload = await page.evaluate(() =>
    localStorage.getItem("preferredTheme")
  );

  expect(themeAfterReload).toBe("dark");

  // العودة إلى الوضع الفاتح.
  await page.locator("[data-theme-toggle]").first().click();

  await expect(body).not.toHaveClass(/dark/);

  const savedLightTheme = await page.evaluate(() =>
    localStorage.getItem("preferredTheme")
  );

  expect(savedLightTheme).toBe("light");
});
