const { test, expect } = require("@playwright/test");

const REPORT_STORAGE_KEY = "report_v15_headerPDF_chip";
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_DATA_FILE_SIZE_BYTES = 5 * 1024 * 1024;

async function blockOptionalReportResources(page) {
  await page.route("https://**", route => {
    const contentType = route.request().resourceType() === "stylesheet"
      ? "text/css"
      : "text/javascript";
    return route.fulfill({ status: 200, contentType, body: "" });
  });
}

async function prepareReportPage(page, storedReport) {
  await blockOptionalReportResources(page);
  await page.addInitScript(({ storageKey, report }) => {
    window.__toolAlerts = [];
    window.alert = message => window.__toolAlerts.push(String(message));
    if (report) localStorage.setItem(storageKey, JSON.stringify(report));
  }, { storageKey: REPORT_STORAGE_KEY, report: storedReport || null });
  await page.goto("http://127.0.0.1:4173/1.html", { waitUntil: "domcontentloaded" });
}

async function prepareAnalysisPage(page) {
  await page.addInitScript(() => {
    window.__toolAlerts = [];
    window.alert = message => window.__toolAlerts.push(String(message));
  });

  await page.route("https://fonts.googleapis.com/**", route =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" })
  );
  await page.route("https://cdn.jsdelivr.net/npm/xlsx@*/**", route =>
    route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: `
        window.__xlsxReadCalls = 0;
        window.__sheetToJsonCalls = 0;
        window.XLSX = {
          read() {
            window.__xlsxReadCalls += 1;
            const sheetName = window.__mockSheetName || "درجات";
            return {
              SheetNames: [sheetName],
              Sheets: { [sheetName]: { "!ref": "A1:C3" } }
            };
          },
          utils: {
            decode_range() {
              return window.__mockRange || {
                s: { r: 0, c: 0 },
                e: { r: 2, c: 2 }
              };
            },
            sheet_to_json() {
              window.__sheetToJsonCalls += 1;
              return window.__mockRows || [
                ["اسم الطالب", "الشعبة", "الدرجة"],
                ["طالب تجريبي", "1", 5],
                ["طالب ناجح", "1", 35]
              ];
            },
            aoa_to_sheet() { return {}; },
            book_new() { return {}; },
            book_append_sheet() {}
          },
          writeFile() {}
        };
      `
    })
  );
  await page.route("https://cdn.jsdelivr.net/npm/chart.js@*/**", route =>
    route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: `
        class MockChart {
          static defaults = { plugins: {} };
          static register() {}
          constructor(context, config) {
            this.context = context;
            this.data = config.data;
            this.options = config.options;
            this.chartArea = { left: 0, right: 100, top: 0, bottom: 100 };
          }
          update() {}
          getDatasetMeta() { return { data: [] }; }
        }
        window.Chart = MockChart;
      `
    })
  );

  await page.goto("http://127.0.0.1:4173/3.html", { waitUntil: "domcontentloaded" });
}

async function fillAnalysisFields(page) {
  await page.locator("#openModal").click();
  await page.locator("#inEdu").fill("إدارة التعليم");
  await page.locator("#inSchool").fill("مدرسة الاختبار");
  await page.locator("#inPrincipal").fill("مدير المدرسة");
  await page.locator("#inTeacher").fill("معلم المادة");
  await page.locator("#inSubject").fill("الرياضيات");
  await page.locator("#inStage").fill("الصف الأول");
}

async function selectSmallWorkbook(page) {
  await page.locator("#file").setInputFiles({
    name: "درجات.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from([1, 2, 3])
  });
}

test("الأداة 1 تستعيد HTML قديمًا كنص فقط دون إنشاء عناصر", async ({ page }) => {
  const imagePayload = "<img src=x onerror=alert(1)>";
  const scriptPayload = "<script>alert(1)</script>";
  await prepareReportPage(page, {
    title: imagePayload,
    h: scriptPayload,
    g: imagePayload,
    a: scriptPayload,
    cells: [imagePayload, scriptPayload],
    photos: ["javascript:alert(1)"]
  });

  await expect(page.locator("#reportTitle")).toHaveText(imagePayload);
  await expect(page.locator("#hijriDate")).toHaveText(scriptPayload);
  await expect(page.locator("#infoTable img, #infoTable script")).toHaveCount(0);
  await expect(page.locator("#reportTitle img, #hijriDate script")).toHaveCount(0);
  await expect(page.locator(".gallery .photo img")).toHaveCount(0);
});

test("الأداة 1 تحفظ النص وتستعيده مع استمرار الاستخدام الطبيعي", async ({ page }) => {
  await prepareReportPage(page);
  const literalText = "<b>تقرير مدرسي آمن</b>";

  await page.evaluate(text => {
    document.getElementById("reportTitle").textContent = text;
    document.getElementById("goals").textContent = "هدف مدرسي طبيعي";
    document.querySelector("#infoTable td").textContent = "قيمة محفوظة";
    window.save();
  }, literalText);

  const stored = await page.evaluate(storageKey =>
    JSON.parse(localStorage.getItem(storageKey)), REPORT_STORAGE_KEY
  );
  expect(stored.version).toBe(2);
  expect(stored.title).toBe(literalText);
  expect(stored.g).toBe("هدف مدرسي طبيعي");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#reportTitle")).toHaveText(literalText);
  await expect(page.locator("#reportTitle b")).toHaveCount(0);
  await expect(page.locator("#goals")).toHaveText("هدف مدرسي طبيعي");
  await expect(page.locator("#infoTable td").first()).toHaveText("قيمة محفوظة");
});

test("الأداة 1 ترفض الصورة الأكبر من 10MB قبل فكها", async ({ page }) => {
  await prepareReportPage(page);
  await page.evaluate(() => {
    window.__objectUrlCalls = 0;
    URL.createObjectURL = () => {
      window.__objectUrlCalls += 1;
      return "blob:should-not-be-created";
    };
  });

  await page.locator(".gallery .photo input[type=file]").first().setInputFiles({
    name: "صورة-كبيرة.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.alloc(MAX_IMAGE_SIZE_BYTES + 1)
  });

  await expect.poll(() => page.evaluate(() => window.__toolAlerts.join("\n")))
    .toContain("10MB");
  expect(await page.evaluate(() => window.__objectUrlCalls)).toBe(0);
  await expect(page.locator(".gallery .photo img")).toHaveCount(0);
});

test("الأداة 3 تعرض أسماء الطلاب والشعب الخبيثة كنص فقط", async ({ page }) => {
  await prepareAnalysisPage(page);
  await fillAnalysisFields(page);
  const imagePayload = "<img src=x onerror=alert(1)>";
  const scriptPayload = "<script>alert(1)</script>";

  await page.evaluate(({ imageValue, scriptValue }) => {
    window.__mockRows = [
      [`${imageValue} اسم الطالب`, `${scriptValue} الشعبة`, "الدرجة"],
      [imageValue, scriptValue, 5]
    ];
  }, { imageValue: imagePayload, scriptValue: scriptPayload });
  await page.locator("#inFullMode").selectOption("40");
  await selectSmallWorkbook(page);
  await page.locator("#doAnalyze").click();

  await expect(page.locator("#statusPill")).toHaveText("تم التحليل بنجاح");
  await expect(page.locator("#weakBody .nameCell")).toHaveText(imagePayload);
  await expect(page.locator("#weakBody .center").first()).toHaveText(scriptPayload);
  await expect(page.locator("#weakBody img, #weakBody script")).toHaveCount(0);
  expect(await page.evaluate(() => window.__toolAlerts)).toEqual([]);
});

for (const fileType of [
  {
    label: "Excel",
    name: "درجات-كبيرة.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  },
  {
    label: "CSV",
    name: "درجات-كبيرة.csv",
    mimeType: "text/csv"
  }
]) {
  test(`الأداة 3 ترفض ملف ${fileType.label} الأكبر من 5MB قبل القراءة`, async ({ page }) => {
    await prepareAnalysisPage(page);
    await page.locator("#file").setInputFiles({
      name: fileType.name,
      mimeType: fileType.mimeType,
      buffer: Buffer.alloc(MAX_DATA_FILE_SIZE_BYTES + 1)
    });

    await expect.poll(() => page.evaluate(() => window.__toolAlerts.join("\n")))
      .toContain("5 MB");
    await expect(page.locator("#doAnalyze")).toBeDisabled();
    expect(await page.evaluate(() => window.__xlsxReadCalls)).toBe(0);
  });
}

for (const dimension of [
  {
    label: "الصفوف",
    range: { s: { r: 0, c: 0 }, e: { r: 5000, c: 2 } },
    expectedMessage: "5000 صف"
  },
  {
    label: "الأعمدة",
    range: { s: { r: 0, c: 0 }, e: { r: 2, c: 100 } },
    expectedMessage: "100 عمود"
  }
]) {
  test(`الأداة 3 ترفض تجاوز حد ${dimension.label} قبل بناء الجداول`, async ({ page }) => {
    await prepareAnalysisPage(page);
    await fillAnalysisFields(page);
    await page.evaluate(range => {
      window.__mockRange = range;
    }, dimension.range);
    await selectSmallWorkbook(page);
    await page.locator("#doAnalyze").click();

    await expect.poll(() => page.evaluate(() => window.__toolAlerts.join("\n")))
      .toContain(dimension.expectedMessage);
    expect(await page.evaluate(() => window.__sheetToJsonCalls)).toBe(0);
    await expect(page.locator("#weakBody img, #weakBody script")).toHaveCount(0);
  });
}

test("الأداة 3 تستمر في تحليل ملف مدرسي طبيعي", async ({ page }) => {
  await prepareAnalysisPage(page);
  await fillAnalysisFields(page);
  await selectSmallWorkbook(page);
  await page.locator("#doAnalyze").click();

  await expect(page.locator("#statusPill")).toHaveText("تم التحليل بنجاح");
  await expect(page.locator("#kN")).toHaveText("2");
  await expect(page.locator("#weakBody .nameCell")).toHaveText("طالب تجريبي");
  await expect(page.locator("#page2")).not.toHaveClass(/hidden/);
});
