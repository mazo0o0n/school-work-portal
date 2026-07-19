const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

async function openRealHomePage(page, theme = "light") {
  await page.addInitScript((selectedTheme) => {
    localStorage.setItem("schoolGuestMode", "1");
    localStorage.setItem("preferredTheme", selectedTheme);
  }, theme);
  await page.goto(
    "http://127.0.0.1:4173/index.html",
    { waitUntil: "domcontentloaded" }
  );
  await page.addStyleTag({
    content: "*,*::before,*::after{animation:none!important;transition:none!important;}"
  });
  await expect(page).toHaveURL(/\/index\.html$/);
  await expect(page.locator("#academy-platforms")).toBeVisible();
}

async function expectNoAccessibilityViolations(page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  expect(results.violations).toEqual([]);
}

test("فحص إمكانية الوصول للصفحة الرئيسية", async ({ page }) => {
  await openRealHomePage(page);
  await expectNoAccessibilityViolations(page);
});

test("فحص إمكانية الوصول للصفحة الرئيسية في الوضع الداكن", async ({ page }) => {
  await openRealHomePage(page, "dark");
  await expect(page.locator("body")).toHaveClass(/(?:^|\s)dark(?:\s|$)/);
  await expectNoAccessibilityViolations(page);
});

test("تحافظ القائمة الجانبية على مسار لوحة المفاتيح", async ({ page }) => {
  await openRealHomePage(page);

  const trigger = page.getByRole("button", { name: "فتح القائمة" });
  const drawer = page.locator("#sideDrawer");
  const closeButton = drawer.getByRole("button", { name: "إغلاق القائمة" });

  await trigger.click();
  await expect(drawer).toHaveAttribute("aria-hidden", "false");
  await expect(closeButton).toBeFocused();
  await expectNoAccessibilityViolations(page);

  await page.keyboard.press("Escape");
  await expect(drawer).toHaveAttribute("aria-hidden", "true");
  await expect(drawer).toHaveAttribute("inert", "");
  await expect(trigger).toBeFocused();
});

test("فحص إمكانية الوصول لصانع التقارير", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/1.html", {
    waitUntil: "domcontentloaded"
  });
  await expect(page.locator("#sheet")).toBeVisible();
  await expectNoAccessibilityViolations(page);
});

test("فحص نافذة أعمال الاختبارات وإدارة التركيز", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/2.html", {
    waitUntil: "domcontentloaded"
  });

  const trigger = page.locator(".link-trigger").first();
  const backdrop = page.locator("#modalBackdrop");
  const closeButton = backdrop.locator(".modal-close");

  await expect(backdrop).toHaveAttribute("inert", "");
  await expectNoAccessibilityViolations(page);

  await trigger.click();
  await expect(backdrop).toHaveAttribute("aria-hidden", "false");
  await expect(closeButton).toBeFocused();
  await expectNoAccessibilityViolations(page);

  await page.keyboard.press("Escape");
  await expect(backdrop).toHaveAttribute("aria-hidden", "true");
  await expect(backdrop).toHaveAttribute("inert", "");
  await expect(trigger).toBeFocused();
});

test("فحص نافذة تحليل النتائج وإدارة التركيز", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/3.html", {
    waitUntil: "domcontentloaded"
  });

  const trigger = page.locator("#openModal");
  const dialog = page.locator("#ov");

  await expect(dialog).toHaveAttribute("inert", "");
  await trigger.click();
  await expect(dialog).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#inEdu")).toBeFocused();
  await expectNoAccessibilityViolations(page);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveAttribute("aria-hidden", "true");
  await expect(dialog).toHaveAttribute("inert", "");
  await expect(trigger).toBeFocused();
});
