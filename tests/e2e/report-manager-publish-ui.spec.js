const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '../..');
let reportManagerProcess = null;

async function reportManagerIsReady(){
  try{
    const response = await fetch('http://127.0.0.1:4174');
    return response.ok;
  }catch{
    return false;
  }
}

test.beforeAll(async ()=>{
  if(await reportManagerIsReady()) return;
  reportManagerProcess = spawn(process.execPath, ['tools/report-manager-server.js'], {
    cwd:projectRoot,
    shell:false,
    windowsHide:true,
    stdio:'ignore'
  });
  for(let attempt = 0; attempt < 30; attempt += 1){
    if(await reportManagerIsReady()) return;
    await new Promise(resolve=>setTimeout(resolve, 100));
  }
  throw new Error('تعذر تشغيل أداة تقارير المدير للاختبار المحلي.');
});

test.afterAll(()=>{
  if(reportManagerProcess) reportManagerProcess.kill();
});

const cases = [
  {name:'desktop-dark', viewport:{width:1440, height:1000}, colorScheme:'dark'},
  {name:'desktop-light', viewport:{width:1440, height:1000}, colorScheme:'light'},
  {name:'mobile-dark', viewport:{width:390, height:844}, colorScheme:'dark'},
  {name:'mobile-light', viewport:{width:390, height:844}, colorScheme:'light'}
];

for(const testCase of cases){
  test(`واجهة النشر المحلية آمنة ومتجاوبة: ${testCase.name}`, async ({page})=>{
    let publishRequests = 0;
    await page.setViewportSize(testCase.viewport);
    await page.emulateMedia({colorScheme:testCase.colorScheme});
    await page.route('**/api/reports/add', async route=>{
      await route.fulfill({
        status:201,
        contentType:'application/json',
        body:JSON.stringify({
          ok:true,
          message:'تمت إضافة التقرير وفحص المكتبة بنجاح.',
          outputFileName:'ui-safe-report.docx',
          templatePath:'assets/report-templates/manager-reports/ui-safe-report.docx',
          reportCount:9,
          check:{ok:true, output:'PASS'},
          publish:{
            reportId:'ui-safe-report',
            title:'تقرير واجهة آمن',
            slug:'ui-safe-report',
            outputFileName:'ui-safe-report.docx',
            templatePath:'assets/report-templates/manager-reports/ui-safe-report.docx',
            reportStatus:'تجريبي',
            publishStatus:'ready',
            files:['assets/data/manager-reports.json', 'assets/report-templates/manager-reports/ui-safe-report.docx'],
            branch:'main',
            commitMessage:'Add ui-safe-report manager report',
            productionUrl:'https://mazen.zb-store.com'
          }
        })
      });
    });
    await page.route('**/api/reports/publish', async route=>{
      publishRequests += 1;
      await route.abort();
    });
    page.on('dialog', dialog=>dialog.accept());

    await page.goto('http://127.0.0.1:4174');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('#publishSection')).toBeHidden();
    await expect(page.locator('#publishButton')).toBeDisabled();

    await page.locator('#reportFile').setInputFiles({
      name:'ui-safe-report.docx',
      mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer:Buffer.from('PK-safe-ui-test')
    });
    await page.locator('#title').fill('تقرير واجهة آمن');
    await page.locator('#category').selectOption('أخرى');
    await page.locator('#slug').fill('ui-safe-report');
    await page.locator('#addButton').click();

    await expect(page.locator('#publishSection')).toBeVisible();
    await expect(page.locator('#publishState')).toHaveText('جاهز للنشر');
    await expect(page.locator('#publishButton')).toBeEnabled();
    await page.locator('#publishButton').click();
    await expect(page.locator('#publishConfirm')).toBeVisible();
    await expect(page.locator('#confirmBranch')).toHaveText('main');
    await expect(page.locator('#confirmUrl')).toHaveText('https://mazen.zb-store.com');
    expect(publishRequests).toBe(0);

    const overflow = await page.evaluate(()=>document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({
      path:path.join(os.tmpdir(), `report-manager-${testCase.name}.png`),
      fullPage:true
    });
  });
}

test('واجهة التقدم تعرض المراحل الست والفشل الآمن دون نشر فعلي', async ({page})=>{
  await page.route('**/api/reports/add', route=>route.fulfill({
    status:201,
    contentType:'application/json',
    body:JSON.stringify({
      ok:true,
      message:'تمت إضافة التقرير وفحص المكتبة بنجاح.',
      outputFileName:'ui-safe-report.docx',
      templatePath:'assets/report-templates/manager-reports/ui-safe-report.docx',
      reportCount:9,
      publish:{
        reportId:'ui-safe-report', title:'تقرير واجهة آمن', slug:'ui-safe-report',
        outputFileName:'ui-safe-report.docx', reportStatus:'تجريبي', branch:'main',
        files:['assets/data/manager-reports.json', 'assets/report-templates/manager-reports/ui-safe-report.docx'],
        commitMessage:'Add ui-safe-report manager report', productionUrl:'https://mazen.zb-store.com'
      }
    })
  }));
  await page.route('**/api/reports/publish', route=>route.fulfill({
    status:202,
    contentType:'application/json',
    body:JSON.stringify({ok:true, operationId:'mock-operation', status:'publishing', steps:[]})
  }));
  await page.route('**/api/reports/publish-status?**', route=>route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify({
      ok:true,
      operationId:'mock-operation',
      status:'failed',
      message:'تعذر النشر لأن هناك تغييرات أخرى غير مرتبطة بالتقرير.',
      details:['assets/js/unrelated.js'],
      retryAvailable:false,
      steps:[
        {id:'validation', label:'فحص التقرير', status:'success', message:'نجح'},
        {id:'git', label:'فحص Git', status:'failed', message:'تغييرات غير مرتبطة'},
        {id:'commit', label:'تجهيز Commit', status:'pending', message:''},
        {id:'push', label:'Push إلى GitHub', status:'pending', message:''},
        {id:'deploy', label:'Deploy إلى Cloudflare', status:'pending', message:''},
        {id:'verify', label:'التحقق من الموقع', status:'pending', message:''}
      ]
    })
  }));
  page.on('dialog', dialog=>dialog.accept());

  await page.goto('http://127.0.0.1:4174');
  await page.locator('#reportFile').setInputFiles({
    name:'ui-safe-report.docx',
    mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer:Buffer.from('PK-safe-ui-test')
  });
  await page.locator('#title').fill('تقرير واجهة آمن');
  await page.locator('#category').selectOption('أخرى');
  await page.locator('#slug').fill('ui-safe-report');
  await page.locator('#addButton').click();
  await page.locator('#publishButton').click();
  await page.locator('#confirmPublish').click();

  await expect(page.locator('#publishState')).toHaveText('فشل النشر');
  await expect(page.locator('.progress-step')).toHaveCount(6);
  await expect(page.locator('#publishErrors')).toContainText('assets/js/unrelated.js');
  await expect(page.locator('#retryDeployButton')).toBeHidden();
  await page.screenshot({path:path.join(os.tmpdir(), 'report-manager-progress-safe-failure.png'), fullPage:true});
});
