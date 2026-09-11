'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const {
  PRODUCTION_ORIGIN,
  PROGRESS_STEPS,
  PublishError,
  defaultRunCommand,
  publishReport,
  sanitizeOutput,
  validatePublishPayload
} = require('./report-publish-service');

const host = '127.0.0.1';
const port = 4174;
const origin = `http://${host}:${port}`;
const allowedHosts = new Set([`${host}:${port}`, `localhost:${port}`]);
const allowedOrigins = new Set([origin, `http://localhost:${port}`]);
const csrfToken = crypto.randomBytes(32).toString('hex');
const maxRequestBytes = 22 * 1024 * 1024;
const maxDocumentBytes = 15 * 1024 * 1024;
const projectRoot = path.resolve(__dirname, '..');
const pagePath = path.join(__dirname, 'report-manager.html');
const dashboardPath = path.join(__dirname, 'project-dashboard.html');
const reportsDataPath = path.join(projectRoot, 'assets', 'data', 'manager-reports.json');
const templatesDirectory = path.join(projectRoot, 'assets', 'report-templates', 'manager-reports');
const checkScriptPath = path.join(__dirname, 'check-manager-reports.js');
const allowedCategories = new Set(['الاجتماعات', 'اللجان', 'النماذج', 'السجلات', 'أخرى']);
const allowedStatuses = new Set(['متاح', 'معتمد', 'تجريبي', 'مخطط']);
let addQueue = Promise.resolve();
let publishQueue = Promise.resolve();
const publishOperations = new Map();
const latestPublishByReport = new Map();

class RequestError extends Error{
  constructor(status, message){
    super(message);
    this.status = status;
  }
}

function securityHeaders(contentType){
  return {
    'Cache-Control':'no-store',
    'Content-Type':contentType,
    'Content-Security-Policy':"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'Referrer-Policy':'no-referrer',
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY'
  };
}

function sendJson(response, status, data){
  response.writeHead(status, securityHeaders('application/json; charset=utf-8'));
  response.end(JSON.stringify(data));
}

function sendHtml(response, html){
  response.writeHead(200, securityHeaders('text/html; charset=utf-8'));
  response.end(html);
}

function isLoopback(address){
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function ensureAllowedHost(request){
  if(!allowedHosts.has(String(request.headers.host || '').toLowerCase())){
    throw new RequestError(403, 'تم رفض الطلب لأن Host غير محلي أو غير متوقع.');
  }
}

function tokensMatch(actual, expected){
  const actualBuffer = Buffer.from(String(actual || ''), 'utf8');
  const expectedBuffer = Buffer.from(String(expected || ''), 'utf8');
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function ensureLocalPost(request, expectedToken = csrfToken){
  if(!allowedOrigins.has(request.headers.origin)){
    throw new RequestError(403, 'تم رفض الطلب لأنه لم يصدر من واجهة الأداة المحلية.');
  }
  if(request.headers['x-report-manager'] !== 'local'){
    throw new RequestError(403, 'رأس التحقق المحلي مفقود.');
  }
  if(!tokensMatch(request.headers['x-report-manager-token'], expectedToken)){
    throw new RequestError(403, 'رمز حماية العملية المحلية غير صالح. أعد فتح الأداة وحاول مرة أخرى.');
  }
}

function readJsonBody(request){
  return new Promise((resolve, reject)=>{
    const contentType = String(request.headers['content-type'] || '').split(';')[0].trim();
    if(contentType !== 'application/json'){
      reject(new RequestError(415, 'نوع الطلب يجب أن يكون application/json.'));
      return;
    }

    const declaredLength = Number(request.headers['content-length'] || 0);
    if(Number.isFinite(declaredLength) && declaredLength > maxRequestBytes){
      reject(new RequestError(413, 'حجم الطلب أكبر من الحد المسموح.'));
      request.resume();
      return;
    }

    const chunks = [];
    let size = 0;
    let settled = false;
    request.on('data', chunk=>{
      if(settled) return;
      size += chunk.length;
      if(size > maxRequestBytes){
        settled = true;
        reject(new RequestError(413, 'حجم الطلب أكبر من الحد المسموح.'));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', ()=>{
      if(settled) return;
      try{
        const rawBody = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(rawBody));
      }catch(error){
        reject(new RequestError(400, `تعذر قراءة بيانات الطلب: ${error.message}`));
      }
    });
    request.on('error', error=>{
      if(settled) return;
      settled = true;
      reject(new RequestError(400, `تعذر استقبال الطلب: ${error.message}`));
    });
  });
}

function readReportsFile(){
  const raw = fs.readFileSync(reportsDataPath, 'utf8');
  let reports;
  try{
    reports = JSON.parse(raw);
  }catch(error){
    throw new Error(`تعذر قراءة manager-reports.json: ${error.message}`, {cause:error});
  }
  if(!Array.isArray(reports)) throw new Error('ملف manager-reports.json لا يحتوي على مصفوفة تقارير.');
  return {raw, reports};
}

function normalizeString(value, maxLength){
  const normalized = value === null || value === undefined ? '' : String(value).trim();
  if(normalized.length > maxLength) throw new RequestError(400, `إحدى القيم تتجاوز ${maxLength} حرفًا.`);
  return normalized;
}

function normalizeList(value){
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(source.map(item=>normalizeString(item, 80)).filter(Boolean))];
}

function validateFields(fields, label){
  fields.forEach(field=>{
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(field)){
      throw new RequestError(400, `${label} يجب أن تحتوي أسماء حقول إنجليزية مثل principalName.`);
    }
  });
}

function decodeDocument(payload){
  const fileName = normalizeString(payload.fileName, 255);
  if(path.extname(fileName).toLowerCase() !== '.docx'){
    throw new RequestError(400, 'اختر ملف Word بصيغة DOCX.');
  }
  const base64 = normalizeString(payload.fileBase64, maxRequestBytes);
  if(!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)){
    throw new RequestError(400, 'بيانات ملف DOCX غير صالحة.');
  }
  const documentBuffer = Buffer.from(base64, 'base64');
  if(!documentBuffer.length || documentBuffer.length > maxDocumentBytes){
    throw new RequestError(413, 'حجم ملف DOCX غير صالح أو أكبر من 15 ميجابايت.');
  }
  if(documentBuffer[0] !== 0x50 || documentBuffer[1] !== 0x4b){
    throw new RequestError(400, 'الملف المحدد لا يحمل بنية DOCX صالحة.');
  }
  return {documentBuffer, fileName};
}

function validatePayload(payload){
  if(!payload || typeof payload !== 'object' || Array.isArray(payload)){
    throw new RequestError(400, 'بيانات التقرير غير صالحة.');
  }

  const title = normalizeString(payload.title, 160);
  const category = normalizeString(payload.category, 40);
  const slug = normalizeString(payload.slug, 80).replace(/\.docx$/i, '');
  const description = normalizeString(payload.description, 1000);
  const status = normalizeString(payload.status, 40) || 'تجريبي';
  const notes = normalizeString(payload.notes, 2000);
  if(!title) throw new RequestError(400, 'عنوان التقرير مطلوب.');
  if(!allowedCategories.has(category)) throw new RequestError(400, 'اختر تصنيفًا صالحًا.');
  if(!allowedStatuses.has(status)) throw new RequestError(400, 'اختر حالة صالحة.');
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)){
    throw new RequestError(400, 'يجب أن يكون slug إنجليزيًا صغيرًا ويستخدم الشرطات فقط.');
  }

  const tags = normalizeList(payload.tags);
  const requiredFields = normalizeList(payload.requiredFields);
  const optionalFields = normalizeList(payload.optionalFields);
  validateFields(requiredFields, 'الحقول المطلوبة');
  validateFields(optionalFields, 'الحقول الاختيارية');
  const {documentBuffer, fileName} = decodeDocument(payload);
  const templatePath = `assets/report-templates/manager-reports/${slug}.docx`;
  return {
    documentBuffer,
    fileName,
    report:{
      id:slug,
      title,
      description,
      category,
      status,
      sectionId:'managerReports',
      templatePath,
      outputFileName:`${title} - {{schoolDisplayName}}.docx`,
      tags,
      fields:[...new Set([...requiredFields, ...optionalFields])],
      requiredFields,
      optionalFields,
      customFields:[],
      notes
    }
  };
}

function ensureReportIsUnique(reports, report){
  if(reports.some(item=>item.id === report.id)){
    throw new RequestError(409, `يوجد تقرير بالـ slug نفسه: ${report.id}`);
  }
  if(reports.some(item=>item.templatePath === report.templatePath)){
    throw new RequestError(409, `مسار القالب مستخدم مسبقًا: ${report.templatePath}`);
  }
  const destinationPath = path.join(templatesDirectory, `${report.id}.docx`);
  if(fs.existsSync(destinationPath)){
    throw new RequestError(409, `ملف القالب موجود مسبقًا: ${report.id}.docx`);
  }
  return destinationPath;
}

function buildGitCommands(report){
  return [
    'git status --short',
    `git add "assets/data/manager-reports.json" "${report.templatePath}"`,
    `git commit -m "Add ${report.id} manager report"`,
    'git push'
  ];
}

function runReportCheck(){
  return new Promise(resolve=>{
    childProcess.execFile(
      process.execPath,
      [checkScriptPath],
      {cwd:projectRoot, timeout:15000, maxBuffer:1024 * 1024, windowsHide:true},
      (error, stdout, stderr)=>{
        const output = `${stdout || ''}${stderr || ''}`.trim();
        resolve({
          ok:!error,
          message:error ? 'فشل فحص التقارير.' : 'فحص التقارير ناجح.',
          output:output || (error ? 'فشل فحص التقارير.' : 'نجح فحص التقارير.')
        });
      }
    );
  });
}

async function getCurrentBranch(){
  try{
    const result = await defaultRunCommand('git', ['branch', '--show-current'], {cwd:projectRoot, timeoutMs:15000});
    return result.code === 0 ? result.stdout.trim() : 'غير معروف';
  }catch{
    return 'غير معروف';
  }
}

function buildPublishInfo(report, branch){
  return {
    reportId:report.id,
    title:report.title,
    slug:report.id,
    outputFileName:`${report.id}.docx`,
    templatePath:report.templatePath,
    reportStatus:report.status,
    publishStatus:'ready',
    files:['assets/data/manager-reports.json', report.templatePath],
    branch,
    commitMessage:`Add ${report.id} manager report`,
    productionUrl:PRODUCTION_ORIGIN
  };
}

function createProgressSteps(){
  return PROGRESS_STEPS.map(step=>({...step, status:'pending', message:''}));
}

function publicPublishState(state){
  return {
    ok:true,
    operationId:state.operationId,
    reportId:state.reportId,
    status:state.status,
    message:state.message,
    details:state.details,
    steps:state.steps,
    retryAvailable:state.retryAvailable,
    commitHash:state.commitHash,
    productionUrl:state.productionUrl,
    outputFileName:state.outputFileName,
    publishedAt:state.publishedAt,
    verificationWarning:state.verificationWarning
  };
}

function setPublishProgress(state, update){
  const step = state.steps.find(item=>item.id === update.step);
  if(!step) return;
  step.status = update.status;
  step.message = update.message || '';
}

function startPublishOperation(payload, mode = 'full'){
  const reportId = validatePublishPayload(payload);
  const prior = latestPublishByReport.get(reportId);
  if(mode === 'deploy-only' && (!prior || !prior.retryAvailable || !prior.commitHash || !prior.pushSucceeded)){
    throw new RequestError(409, 'لا توجد محاولة Deploy قابلة للإعادة لهذا التقرير.');
  }

  const state = {
    operationId:crypto.randomUUID(),
    reportId,
    status:'publishing',
    message:mode === 'deploy-only' ? 'جاري إعادة محاولة Deploy فقط...' : 'بدأت عملية النشر الآمنة.',
    details:[],
    steps:createProgressSteps(),
    retryAvailable:false,
    commitHash:mode === 'deploy-only' ? prior.commitHash : '',
    pushSucceeded:mode === 'deploy-only',
    productionUrl:PRODUCTION_ORIGIN,
    outputFileName:`${reportId}.docx`,
    publishedAt:'',
    verificationWarning:false
  };
  publishOperations.set(state.operationId, state);
  latestPublishByReport.set(reportId, state);

  const execute = async ()=>{
    try{
      const result = await publishReport({
        projectRoot,
        reportsDataPath,
        templatesDirectory,
        payload:{reportId},
        mode,
        prior:mode === 'deploy-only' ? prior : null,
        runReportCheck,
        onProgress:update=>setPublishProgress(state, update)
      });
      state.status = 'published';
      state.message = 'تم نشر التقرير على الموقع الحي بنجاح.';
      state.commitHash = result.commitHash;
      state.pushSucceeded = result.pushSucceeded;
      state.outputFileName = result.outputFileName;
      state.publishedAt = result.publishedAt;
    }catch(error){
      const failedStep = state.steps.find(item=>item.id === error.phase);
      if(failedStep){
        failedStep.status = 'failed';
        failedStep.message = error.message;
      }
      state.status = 'failed';
      state.message = error.message || 'فشلت عملية النشر.';
      state.details = Array.isArray(error.details) ? error.details.map(sanitizeOutput) : [];
      state.retryAvailable = error.retryAvailable === true;
      state.commitHash = error.commitHash || state.commitHash;
      state.pushSucceeded = error.pushSucceeded === true;
      state.verificationWarning = error.verificationWarning === true;
    }
  };

  const operation = publishQueue.then(execute, execute);
  publishQueue = operation.catch(()=>{});
  return publicPublishState(state);
}

function openLocalTarget(command, argumentsList){
  const processHandle = childProcess.spawn(command, argumentsList, {
    detached:true,
    stdio:'ignore',
    windowsHide:true
  });
  processHandle.unref();
}

function enqueueAdd(task){
  const operation = addQueue.then(task, task);
  addQueue = operation.catch(()=>{});
  return operation;
}

async function dryRunReport(payload){
  const {reports} = readReportsFile();
  const candidate = validatePayload(payload);
  ensureReportIsUnique(reports, candidate.report);
  return {
    ok:true,
    dryRun:true,
    message:'الفحص المبدئي ناجح. لن يتم نسخ أو تعديل أي ملف.',
    sourceFileName:candidate.fileName,
    outputFileName:`${candidate.report.id}.docx`,
    templatePath:candidate.report.templatePath,
    reportCount:reports.length,
    nextReportCount:reports.length + 1,
    gitCommands:buildGitCommands(candidate.report)
  };
}

async function addReport(payload){
  return enqueueAdd(async ()=>{
    const {raw, reports} = readReportsFile();
    const candidate = validatePayload(payload);
    const destinationPath = ensureReportIsUnique(reports, candidate.report);
    const temporaryDataPath = `${reportsDataPath}.${process.pid}.${Date.now()}.tmp`;
    const updatedReports = [...reports, candidate.report];
    let templateWritten = false;
    let temporaryDataWritten = false;

    try{
      fs.writeFileSync(destinationPath, candidate.documentBuffer, {flag:'wx'});
      templateWritten = true;
      fs.writeFileSync(temporaryDataPath, `${JSON.stringify(updatedReports, null, 2)}\n`, {encoding:'utf8', flag:'wx'});
      temporaryDataWritten = true;
      fs.renameSync(temporaryDataPath, reportsDataPath);
      temporaryDataWritten = false;

      const check = await runReportCheck();
      if(!check.ok) throw new Error(`فشل فحص التقارير بعد الإضافة:\n${check.output}`);
      return {
        ok:true,
        message:'تمت إضافة التقرير وفحص المكتبة بنجاح.',
        outputFileName:`${candidate.report.id}.docx`,
        templatePath:candidate.report.templatePath,
        reportCount:updatedReports.length,
        check,
        gitCommands:buildGitCommands(candidate.report),
        publish:buildPublishInfo(candidate.report, await getCurrentBranch())
      };
    }catch(error){
      if(temporaryDataWritten && fs.existsSync(temporaryDataPath)) fs.unlinkSync(temporaryDataPath);
      if(templateWritten && fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath);
      if(fs.readFileSync(reportsDataPath, 'utf8') !== raw){
        fs.writeFileSync(reportsDataPath, raw, 'utf8');
      }
      throw error;
    }
  });
}

async function handleApi(request, response, requestUrl){
  const pathname = requestUrl.pathname;
  if(request.method === 'GET' && pathname === '/api/reports/list'){
    const {reports} = readReportsFile();
    sendJson(response, 200, {ok:true, count:reports.length, reports});
    return;
  }
  if(request.method === 'GET' && pathname === '/api/reports/check'){
    const check = await runReportCheck();
    sendJson(response, check.ok ? 200 : 422, check);
    return;
  }
  if(request.method === 'GET' && pathname === '/api/reports/publish-status'){
    const operationId = String(requestUrl.searchParams.get('operationId') || '');
    const state = publishOperations.get(operationId);
    if(!state) throw new RequestError(404, 'عملية النشر المطلوبة غير موجودة.');
    sendJson(response, 200, publicPublishState(state));
    return;
  }

  if(request.method !== 'POST') throw new RequestError(405, 'طريقة الطلب غير مسموحة.');
  ensureLocalPost(request);

  if(pathname === '/api/reports/dry-run'){
    sendJson(response, 200, await dryRunReport(await readJsonBody(request)));
    return;
  }
  if(pathname === '/api/reports/add'){
    sendJson(response, 201, await addReport(await readJsonBody(request)));
    return;
  }
  if(pathname === '/api/reports/publish'){
    sendJson(response, 202, startPublishOperation(await readJsonBody(request)));
    return;
  }
  if(pathname === '/api/reports/publish/retry-deploy'){
    sendJson(response, 202, startPublishOperation(await readJsonBody(request), 'deploy-only'));
    return;
  }
  if(pathname === '/api/open/templates-folder'){
    openLocalTarget('explorer.exe', [templatesDirectory]);
    sendJson(response, 200, {ok:true, message:'تم فتح مجلد قوالب التقارير.'});
    return;
  }
  if(pathname === '/api/open/reports-json'){
    openLocalTarget('rundll32.exe', ['url.dll,FileProtocolHandler', reportsDataPath]);
    sendJson(response, 200, {ok:true, message:'تم فتح ملف manager-reports.json.'});
    return;
  }
  if(pathname === '/api/open/dashboard'){
    openLocalTarget('rundll32.exe', ['url.dll,FileProtocolHandler', dashboardPath]);
    sendJson(response, 200, {ok:true, message:'تم فتح الداشبورد المحلي.'});
    return;
  }
  throw new RequestError(404, 'المسار المطلوب غير موجود.');
}

function createServer(){
  return http.createServer(async (request, response)=>{
    try{
      if(!isLoopback(request.socket.remoteAddress)){
        sendJson(response, 403, {ok:false, message:'هذه الأداة متاحة من الجهاز المحلي فقط.'});
        return;
      }
      ensureAllowedHost(request);
      const requestUrl = new URL(request.url, origin);
      if(request.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname === '/report-manager.html')){
        const page = fs.readFileSync(pagePath, 'utf8').replace('__REPORT_MANAGER_CSRF_TOKEN__', csrfToken);
        sendHtml(response, page);
        return;
      }
      if(requestUrl.pathname.startsWith('/api/')){
        await handleApi(request, response, requestUrl);
        return;
      }
      sendJson(response, 404, {ok:false, message:'المسار المطلوب غير موجود.'});
    }catch(error){
      const status = error instanceof RequestError || error instanceof PublishError ? (error.status || 400) : 500;
      const message = status === 500 ? 'حدث خطأ محلي غير متوقع أثناء تنفيذ العملية.' : error.message;
      if(status === 500) console.error(error.message);
      sendJson(response, status, {
        ok:false,
        message,
        details:Array.isArray(error.details) ? error.details.map(sanitizeOutput) : []
      });
    }
  });
}

function startServer(){
  const server = createServer();
  server.on('error', error=>{
    if(error.code === 'EADDRINUSE'){
      console.error(`المنفذ ${port} مستخدم. افتح ${origin} أو أوقف العملية الحالية أولًا.`);
    }else{
      console.error(`تعذر تشغيل أداة تقارير المدير: ${error.message}`);
    }
    process.exitCode = 1;
  });
  server.listen(port, host, ()=>{
    console.log(`أداة إدارة تقارير المدير تعمل محليًا على ${origin}`);
    console.log('لإيقافها اضغط Ctrl+C في نافذة التشغيل.');
  });
  return server;
}

if(require.main === module) startServer();

module.exports = {
  RequestError,
  createServer,
  ensureAllowedHost,
  ensureLocalPost,
  startPublishOperation,
  tokensMatch
};
