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

const readyPublishInfo = {
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
};

async function routeReportList(page, pendingPublish = {state:'none'}, reports = []){
  await page.route('**/api/reports/list', route=>route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify({ok:true, count:reports.length, reports, pendingPublish, pendingDelete:{state:'none'}, pendingEdit:{state:'none'}})
  }));
}

for(const testCase of cases){
  test(`واجهة النشر المحلية آمنة ومتجاوبة: ${testCase.name}`, async ({page})=>{
    let publishRequests = 0;
    await routeReportList(page);
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
          publish:readyPublishInfo
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

for(const testCase of cases){
  test(`تأكيد حذف التقرير محمي ومتجاوب: ${testCase.name}`, async ({page})=>{
    const currentReport = {
      id:'delete-ui-report',
      title:'تقرير حذف تجريبي',
      category:'أخرى',
      status:'تجريبي',
      templatePath:'assets/report-templates/manager-reports/delete-ui-report.docx',
      publishStatus:'published'
    };
    let deleteRequests = 0;
    await routeReportList(page, {state:'none'}, [currentReport]);
    await page.route('**/api/reports/delete', route=>{
      deleteRequests += 1;
      return route.fulfill({status:202, contentType:'application/json', body:JSON.stringify({ok:true, operationId:'delete-op', status:'deleting', steps:[]})});
    });
    await page.setViewportSize(testCase.viewport);
    await page.emulateMedia({colorScheme:testCase.colorScheme});
    await page.goto('http://127.0.0.1:4174');
    await expect(page.locator('.delete-report-button')).toHaveText('حذف من الموقع الحي');
    await page.locator('.delete-report-button').click();
    await expect(page.locator('#deleteConfirm')).toBeVisible();
    await expect(page.locator('#confirmDelete')).toBeDisabled();
    expect(deleteRequests).toBe(0);
    await page.locator('#deleteSlugInput').fill('wrong-slug');
    await expect(page.locator('#confirmDelete')).toBeDisabled();
    await page.locator('#deleteSlugInput').fill('delete-ui-report');
    await expect(page.locator('#confirmDelete')).toBeEnabled();
    const overflow = await page.evaluate(()=>document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });
}

for(const testCase of cases){
  test(`تعديل التقرير محلي ومراجعته قبل النشر: ${testCase.name}`, async ({page})=>{
    const currentReport = {
      id:'edit-ui-report',
      sectionId:'manager-reports',
      title:'تقرير قابل للتعديل',
      description:'وصف قديم',
      category:'أخرى',
      status:'تجريبي',
      tags:['قديم'],
      requiredFields:[],
      optionalFields:[],
      customFields:[],
      notes:'',
      templatePath:'assets/report-templates/manager-reports/edit-ui-report.docx',
      publishStatus:'published'
    };
    let submittedPayload = null;
    await routeReportList(page, {state:'none'}, [currentReport]);
    await page.route('**/api/reports/edit', async route=>{
      submittedPayload = route.request().postDataJSON();
      await route.fulfill({
        status:200,
        contentType:'application/json',
        body:JSON.stringify({
          ok:true,
          message:'تم حفظ التعديلات محليًا وفحصها. التعديلات جاهزة للمراجعة والنشر.',
          draft:{
            reportId:'edit-ui-report',
            title:'عنوان محدث',
            templatePath:currentReport.templatePath,
            wordChanged:false,
            files:['assets/data/manager-reports.json'],
            differences:{title:{before:'تقرير قابل للتعديل', after:'عنوان محدث'}}
          }
        })
      });
    });
    await page.setViewportSize(testCase.viewport);
    await page.emulateMedia({colorScheme:testCase.colorScheme});
    await page.goto('http://127.0.0.1:4174');

    await page.locator('.edit-report-button').click();
    await expect(page.locator('#editDialog')).toBeVisible();
    await expect(page.locator('#editId')).toHaveValue('edit-ui-report');
    await expect(page.locator('#editId')).toHaveAttribute('readonly', '');
    await expect(page.locator('#editTemplatePath')).toHaveAttribute('readonly', '');
    await page.locator('#editTitle').fill('عنوان محدث');
    await page.locator('#saveEdit').click();

    await expect(page.locator('#editPanel')).toBeVisible();
    await expect(page.locator('#editState')).toHaveText('تعديل محلي — جاهز للنشر');
    await expect(page.locator('#editReview')).toContainText('عنوان محدث');
    expect(submittedPayload.reportId).toBe('edit-ui-report');
    expect(submittedPayload.changes.title).toBe('عنوان محدث');
    expect(submittedPayload.changes.id).toBeUndefined();
    expect(submittedPayload.changes.templatePath).toBeUndefined();

    await page.locator('#publishEdit').click();
    await expect(page.locator('#editPublishConfirm')).toBeVisible();
    await expect(page.locator('#editConfirmCommit')).toHaveText('Update manager report: edit-ui-report');
    const overflow = await page.evaluate(()=>document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
    await page.screenshot({path:path.join(os.tmpdir(), `report-manager-edit-${testCase.name}.png`), fullPage:true});
  });
}

test('واجهة التقدم تعرض المراحل الست والفشل الآمن دون نشر فعلي', async ({page})=>{
  await routeReportList(page);
  await page.route('**/api/reports/add', route=>route.fulfill({
    status:201,
    contentType:'application/json',
    body:JSON.stringify({
      ok:true,
      message:'تمت إضافة التقرير وفحص المكتبة بنجاح.',
      outputFileName:'ui-safe-report.docx',
      templatePath:'assets/report-templates/manager-reports/ui-safe-report.docx',
      reportCount:9,
      publish:readyPublishInfo
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

test('فشل Deploy لتعديل تقرير يعرض إعادة المحاولة دون نشر فعلي', async ({page})=>{
  const currentReport = {
    id:'edit-retry-report', sectionId:'managerReports', title:'تقرير قبل التعديل', description:'',
    category:'أخرى', status:'تجريبي', tags:[], fields:[], requiredFields:[], optionalFields:[],
    customFields:[], notes:'', templatePath:'assets/report-templates/manager-reports/edit-retry-report.docx',
    publishStatus:'published'
  };
  await routeReportList(page, {state:'none'}, [currentReport]);
  await page.route('**/api/reports/edit', route=>route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify({
      ok:true,
      message:'تم حفظ التعديلات محليًا وفحصها.',
      draft:{
        reportId:'edit-retry-report', title:'تقرير بعد التعديل', templatePath:currentReport.templatePath,
        wordChanged:false, files:['assets/data/manager-reports.json'],
        differences:{title:{before:'تقرير قبل التعديل', after:'تقرير بعد التعديل'}}
      }
    })
  }));
  await page.route('**/api/reports/edit/publish', route=>route.fulfill({
    status:202,
    contentType:'application/json',
    body:JSON.stringify({ok:true, operationId:'edit-retry-op', status:'publishing', steps:[]})
  }));
  await page.route('**/api/reports/edit-status?**', route=>route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify({
      ok:true,
      operationId:'edit-retry-op',
      status:'failed',
      message:'فشل Deploy بعد نجاح Commit وPush.',
      details:['يمكن إعادة Deploy بأمان.'],
      retryAvailable:true,
      verificationWarning:false,
      steps:[
        {id:'validation', label:'فحص التعديلات', status:'success', message:'نجح'},
        {id:'git', label:'فحص Git', status:'success', message:'نجح'},
        {id:'commit', label:'إنشاء Commit', status:'success', message:'نجح'},
        {id:'push', label:'Push إلى GitHub', status:'success', message:'نجح'},
        {id:'deploy', label:'Deploy إلى Cloudflare', status:'failed', message:'فشل'},
        {id:'verify', label:'التحقق من الموقع', status:'pending', message:''}
      ]
    })
  }));

  await page.goto('http://127.0.0.1:4174');
  await page.locator('.edit-report-button').click();
  await page.locator('#editTitle').fill('تقرير بعد التعديل');
  await page.locator('#saveEdit').click();
  await page.locator('#publishEdit').click();
  await page.locator('#confirmEditPublish').click();

  await expect(page.locator('#editState')).toHaveText('فشل النشر');
  await expect(page.locator('#editProgress .progress-step')).toHaveCount(6);
  await expect(page.locator('#editErrors')).toContainText('يمكن إعادة Deploy بأمان.');
  await expect(page.locator('#retryEditDeploy')).toBeVisible();
});

test('التقرير المحلي الجاهز يعود بعد إعادة تحميل الصفحة دون إضافة مكررة', async ({page})=>{
  let addRequests = 0;
  await routeReportList(page, {state:'ready', publish:readyPublishInfo});
  page.on('request', request=>{
    if(new URL(request.url()).pathname === '/api/reports/add') addRequests += 1;
  });

  await page.goto('http://127.0.0.1:4174');
  await expect(page.locator('#publishSection')).toBeVisible();
  await expect(page.locator('#publishSlug')).toHaveText('ui-safe-report');
  await expect(page.locator('#publishButton')).toBeEnabled();
  await page.reload();
  await expect(page.locator('#publishSection')).toBeVisible();
  await expect(page.locator('#publishSlug')).toHaveText('ui-safe-report');
  await expect(page.locator('#publishButton')).toBeEnabled();
  expect(addRequests).toBe(0);
});
