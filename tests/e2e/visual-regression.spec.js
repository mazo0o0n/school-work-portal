const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("schoolGuestMode", "1");
    localStorage.setItem("preferredTheme", "light");
  });
});

test("الصورة المرجعية للصفحة الرئيسية - Desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://127.0.0.1:4173/index.html", {
    waitUntil: "networkidle"
  });

  await page.evaluate(() => {
    document.querySelectorAll("video, iframe").forEach(el => el.remove());
  });

  await expect(page).toHaveScreenshot("home-desktop.png", {
    fullPage: true,
    animations: "disabled"
  });
});

test("الصورة المرجعية للصفحة الرئيسية - Mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:4173/index.html", {
    waitUntil: "networkidle"
  });

  await page.evaluate(() => {
    document.querySelectorAll("video, iframe").forEach(el => el.remove());
  });

  await expect(page).toHaveScreenshot("home-mobile.png", {
    fullPage: true,
    animations: "disabled"
  });
});
