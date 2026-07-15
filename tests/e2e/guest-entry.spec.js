const { test, expect } = require("@playwright/test");

test("الدخول كضيف والانتقال للصفحة الرئيسية", async ({ page }) => {
  test.setTimeout(15000);

  await page.goto("http://127.0.0.1:4173/register.html");

  await page.locator("#guestEntry").click();

  await page.waitForURL("**/index.html", {
    timeout: 5000
  });

  const values = await page.evaluate(() => ({
    guestMode: localStorage.getItem("schoolGuestMode"),
    schoolName: localStorage.getItem("registeredSchoolName"),
    schoolStage: localStorage.getItem("registeredSchoolStage"),
    profile: localStorage.getItem("registeredSchoolProfile")
  }));

  expect(values.guestMode).toBe("1");
  expect(values.schoolName).toBeNull();
  expect(values.schoolStage).toBeNull();
  expect(values.profile).toBeNull();

  await expect(page.locator("body")).toBeVisible();
});
