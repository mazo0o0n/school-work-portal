const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

test("فحص إمكانية الوصول", async ({ page }) => {
  await page.goto(
    "http://127.0.0.1:4173/index.html",
    { waitUntil: "networkidle" }
  );

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
