'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const REPORTS_RELATIVE_PATH = 'assets/data/manager-reports.json';
const TEMPLATES_RELATIVE_DIRECTORY = 'assets/report-templates/manager-reports';
const PRODUCTION_ORIGIN = 'https://mazen.zb-store.com';
const ALLOWED_STATUSES = new Set(['متاح', 'معتمد', 'تجريبي', 'مخطط']);
const REQUIRED_PROPERTIES = ['id', 'title', 'category', 'status', 'templatePath'];
const PROGRESS_STEPS = [
  {id:'validation', label:'فحص التقرير'},
  {id:'git', label:'فحص Git'},
  {id:'commit', label:'تجهيز Commit'},
  {id:'push', label:'Push إلى GitHub'},
  {id:'deploy', label:'Deploy إلى Cloudflare'},
  {id:'verify', label:'التحقق من الموقع'}
];
const DELETE_PROGRESS_STEPS = [
  {id:'git', label:'فحص Git'},
  {id:'mutation', label:'تجهيز الحذف'},
  {id:'validation', label:'فحص مكتبة التقارير'},
  {id:'commit', label:'إنشاء Commit'},
  {id:'push', label:'Push إلى GitHub'},
  {id:'deploy', label:'Deploy إلى Cloudflare'},
  {id:'verify', label:'التحقق من الموقع'}
];

class PublishError extends Error{
  constructor(code, message, options = {}){
    super(message);
    this.name = 'PublishError';
    this.code = code;
    this.phase = options.phase || '';
    this.details = Array.isArray(options.details) ? options.details : [];
    this.commitHash = options.commitHash || '';
    this.pushSucceeded = options.pushSucceeded === true;
    this.deploySucceeded = options.deploySucceeded === true;
    this.retryAvailable = options.retryAvailable === true;
    this.verificationWarning = options.verificationWarning === true;
  }
}

function normalizeRepoPath(value){
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function validateReportId(value){
  const reportId = String(value || '').trim();
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(reportId)){
    throw new PublishError('INVALID_REPORT_ID', 'معرّف التقرير غير صالح.', {phase:'validation'});
  }
  return reportId;
}

function validatePublishPayload(payload){
  if(!payload || typeof payload !== 'object' || Array.isArray(payload)){
    throw new PublishError('INVALID_REQUEST', 'طلب النشر غير صالح.', {phase:'validation'});
  }
  const keys = Object.keys(payload);
  if(keys.length !== 1 || keys[0] !== 'reportId'){
    throw new PublishError('UNSAFE_REQUEST', 'طلب النشر يقبل معرّف التقرير فقط.', {phase:'validation'});
  }
  return validateReportId(payload.reportId);
}

function validateDeletePayload(payload){
  if(!payload || typeof payload !== 'object' || Array.isArray(payload)){
    throw new PublishError('INVALID_REQUEST', 'طلب الحذف غير صالح.', {phase:'validation'});
  }
  const keys = Object.keys(payload);
  if(keys.length !== 1 || keys[0] !== 'reportId'){
    throw new PublishError('UNSAFE_REQUEST', 'طلب الحذف يقبل معرّف التقرير فقط.', {phase:'validation'});
  }
  return validateReportId(payload.reportId);
}

function sanitizeOutput(value){
  return String(value || '')
    .replace(/(authorization\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret)\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/\b(?:ghp|github_pat|glpat)-?[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
    .replace(/https:\/\/[^\s/@]+:[^\s/@]+@/gi, 'https://[REDACTED]@')
    .trim()
    .slice(0, 1200);
}

function parsePorcelain(output){
  return [...new Set(parsePorcelainEntries(output).map(entry=>entry.path))];
}

function parsePorcelainEntries(output){
  const entries = String(output || '').split('\0');
  const files = [];
  for(let index = 0; index < entries.length; index += 1){
    const entry = entries[index];
    if(!entry) continue;
    const status = entry.slice(0, 2);
    const file = normalizeRepoPath(entry.slice(3));
    if(file) files.push({status, path:file});
    if(/[RC]/.test(status) && entries[index + 1]){
      files.push({status, path:normalizeRepoPath(entries[index + 1])});
      index += 1;
    }
  }
  return files.filter((entry, index)=>entry.path && files.findIndex(candidate=>candidate.path === entry.path) === index);
}

function parseNullSeparatedPaths(output){
  return [...new Set(String(output || '').split('\0').map(normalizeRepoPath).filter(Boolean))];
}

function isInsideDirectory(directoryPath, candidatePath){
  const relative = path.relative(directoryPath, candidatePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function listDocxFiles(directoryPath, fsApi = fs){
  const files = [];
  const visit = currentDirectory=>{
    for(const entry of fsApi.readdirSync(currentDirectory, {withFileTypes:true})){
      const absolutePath = path.join(currentDirectory, entry.name);
      if(entry.isDirectory()) visit(absolutePath);
      else if(entry.isFile() && path.extname(entry.name).toLowerCase() === '.docx') files.push(absolutePath);
    }
  };
  visit(directoryPath);
  return files;
}

function validateReportLibrary(options){
  const fsApi = options.fsApi || fs;
  const projectRoot = options.projectRoot;
  const reportsDataPath = options.reportsDataPath || path.join(projectRoot, REPORTS_RELATIVE_PATH);
  const templatesDirectory = options.templatesDirectory || path.join(projectRoot, TEMPLATES_RELATIVE_DIRECTORY);
  let reports;
  try{
    reports = JSON.parse(fsApi.readFileSync(reportsDataPath, 'utf8'));
  }catch(error){
    throw new PublishError('INVALID_REPORT_LIBRARY', `تعذر قراءة بيانات التقارير: ${sanitizeOutput(error.message)}`, {phase:'validation'});
  }
  if(!Array.isArray(reports)){
    throw new PublishError('INVALID_REPORT_LIBRARY', 'ملف بيانات التقارير لا يحتوي على مصفوفة.', {phase:'validation'});
  }

  const issues = [];
  const ids = new Set();
  const templatePaths = new Set();
  reports.forEach((report, index)=>{
    REQUIRED_PROPERTIES.forEach(property=>{
      if(!String(report[property] || '').trim()) issues.push(`السجل ${index + 1}: ${property} مفقود`);
    });
    const id = String(report.id || '').trim();
    const templatePath = normalizeRepoPath(report.templatePath);
    if(id && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) issues.push(`slug غير صالح: ${id}`);
    if(id && ids.has(id)) issues.push(`slug مكرر: ${id}`);
    if(id) ids.add(id);
    if(report.status && !ALLOWED_STATUSES.has(String(report.status).trim())) issues.push(`حالة غير صالحة: ${report.status}`);
    if(templatePath && templatePaths.has(templatePath)) issues.push(`مسار قالب مكرر: ${templatePath}`);
    if(templatePath) templatePaths.add(templatePath);
    const absoluteTemplatePath = path.resolve(projectRoot, templatePath);
    if(templatePath && (!isInsideDirectory(templatesDirectory, absoluteTemplatePath) || !fsApi.existsSync(absoluteTemplatePath))){
      issues.push(`قالب مفقود أو خارج مجلد التقارير: ${templatePath}`);
    }
  });

  if(fsApi.existsSync(templatesDirectory)){
    const orphanTemplates = listDocxFiles(templatesDirectory, fsApi)
      .map(filePath=>normalizeRepoPath(path.relative(projectRoot, filePath)))
      .filter(filePath=>!templatePaths.has(filePath));
    orphanTemplates.forEach(filePath=>issues.push(`قالب غير مرتبط بتقرير: ${filePath}`));
  }

  if(issues.length){
    throw new PublishError('REPORT_VALIDATION_FAILED', 'فشل فحص مكتبة تقارير المدير.', {
      phase:'validation',
      details:issues
    });
  }
  return reports;
}

function resolveTrustedReport(options, reportId, reports){
  const fsApi = options.fsApi || fs;
  const report = reports.find(item=>String(item.id || '').trim() === reportId);
  if(!report){
    throw new PublishError('REPORT_NOT_FOUND', 'التقرير المطلوب غير موجود في مكتبة التقارير.', {phase:'validation'});
  }
  const expectedTemplatePath = `${TEMPLATES_RELATIVE_DIRECTORY}/${reportId}.docx`;
  const templatePath = normalizeRepoPath(report.templatePath);
  if(templatePath !== expectedTemplatePath){
    throw new PublishError('UNSAFE_TEMPLATE_PATH', 'مسار قالب التقرير لا يطابق المسار الآمن المتوقع.', {phase:'validation'});
  }
  const absoluteTemplatePath = path.resolve(options.projectRoot, templatePath);
  if(!isInsideDirectory(options.templatesDirectory, absoluteTemplatePath) || !fsApi.existsSync(absoluteTemplatePath)){
    throw new PublishError('UNSAFE_TEMPLATE_PATH', 'تعذر اعتماد مسار قالب التقرير.', {phase:'validation'});
  }
  return {report, templatePath, absoluteTemplatePath};
}

function resolveSafeDeleteTarget(options, reportId, reports){
  const fsApi = options.fsApi || fs;
  const report = reports.find(item=>String(item.id || '').trim() === reportId);
  if(!report){
    throw new PublishError('REPORT_NOT_FOUND', 'التقرير المطلوب غير موجود في مكتبة التقارير.', {phase:'validation'});
  }
  const templatePath = normalizeRepoPath(report.templatePath);
  const segments = templatePath.split('/');
  if(!templatePath.startsWith(`${TEMPLATES_RELATIVE_DIRECTORY}/`) ||
     path.posix.extname(templatePath).toLowerCase() !== '.docx' ||
     segments.includes('..')){
    throw new PublishError('UNSAFE_TEMPLATE_PATH', 'مسار قالب التقرير غير آمن للحذف.', {phase:'validation'});
  }
  const absoluteTemplatePath = path.resolve(options.projectRoot, templatePath);
  if(!isInsideDirectory(options.templatesDirectory, absoluteTemplatePath) || !fsApi.existsSync(absoluteTemplatePath)){
    throw new PublishError('UNSAFE_TEMPLATE_PATH', 'تعذر اعتماد مسار قالب التقرير للحذف.', {phase:'validation'});
  }
  return {report, templatePath, absoluteTemplatePath};
}

async function detectPendingReport(options){
  const fsApi = options.fsApi || fs;
  const runCommand = options.runCommand || defaultRunCommand;
  let statusResult;
  try{
    statusResult = await runCommand('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
      cwd:options.projectRoot,
      timeoutMs:15000,
      maxBuffer:1024 * 1024
    });
  }catch(error){
    return {state:'ambiguous', message:'تعذر فحص تغييرات Git المحلية.', details:[sanitizeOutput(error.message)]};
  }
  if(statusResult.code !== 0){
    return {
      state:'ambiguous',
      message:'تعذر فحص تغييرات Git المحلية.',
      details:[sanitizeOutput(statusResult.stderr || statusResult.stdout)]
    };
  }

  const entries = parsePorcelainEntries(statusResult.stdout);
  if(!entries.length) return {state:'none'};
  const jsonEntries = entries.filter(entry=>entry.path === REPORTS_RELATIVE_PATH);
  const reportDocxEntries = entries.filter(entry=>
    entry.path.startsWith(`${TEMPLATES_RELATIVE_DIRECTORY}/`) && path.posix.extname(entry.path).toLowerCase() === '.docx'
  );
  const expectedPaths = new Set([
    REPORTS_RELATIVE_PATH,
    ...reportDocxEntries.map(entry=>entry.path)
  ]);
  const unrelatedEntries = entries.filter(entry=>!expectedPaths.has(entry.path));
  const jsonIsModified = jsonEntries.length === 1 && jsonEntries[0].status.includes('M');
  const oneUntrackedDocx = reportDocxEntries.length === 1 && reportDocxEntries[0].status === '??';
  if(entries.length !== 2 || !jsonIsModified || !oneUntrackedDocx || unrelatedEntries.length){
    return {
      state:'ambiguous',
      message:'توجد عدة تغييرات أو تغييرات غير واضحة وتحتاج مراجعة قبل النشر.',
      details:entries.map(entry=>entry.path)
    };
  }

  let reports;
  try{
    reports = JSON.parse(fsApi.readFileSync(options.reportsDataPath, 'utf8'));
  }catch(error){
    return {state:'ambiguous', message:'تعذر قراءة بيانات تقارير المدير.', details:[sanitizeOutput(error.message)]};
  }
  if(!Array.isArray(reports)){
    return {state:'ambiguous', message:'بيانات تقارير المدير غير صالحة.', details:[REPORTS_RELATIVE_PATH]};
  }
  const templatePath = reportDocxEntries[0].path;
  const matches = reports.filter(report=>normalizeRepoPath(report.templatePath) === templatePath);
  if(matches.length !== 1){
    return {
      state:'ambiguous',
      message:'تعذر مطابقة ملف DOCX مع تقرير واحد داخل manager-reports.json.',
      details:[templatePath]
    };
  }

  let trusted;
  try{
    const reportId = validateReportId(matches[0].id);
    trusted = resolveTrustedReport(options, reportId, reports);
  }catch(error){
    return {state:'ambiguous', message:error.message, details:[templatePath]};
  }

  let branch = 'غير معروف';
  try{
    const branchResult = await runCommand('git', ['branch', '--show-current'], {cwd:options.projectRoot, timeoutMs:15000});
    if(branchResult.code === 0) branch = branchResult.stdout.trim() || branch;
  }catch{
    branch = 'غير معروف';
  }
  return {
    state:'ready',
    branch,
    report:{
      id:trusted.report.id,
      title:trusted.report.title,
      status:trusted.report.status,
      templatePath:trusted.templatePath
    }
  };
}

function defaultRunCommand(command, args, options = {}){
  return new Promise((resolve, reject)=>{
    const processHandle = childProcess.spawn(command, args, {
      cwd:options.cwd,
      env:options.env || process.env,
      shell:false,
      windowsHide:true,
      stdio:['ignore', 'pipe', 'pipe']
    });
    const maxBuffer = options.maxBuffer || 1024 * 1024;
    const timeoutMs = options.timeoutMs || 120000;
    let stdout = '';
    let stderr = '';
    let overflowed = false;
    const timer = setTimeout(()=>{
      processHandle.kill();
      reject(new Error('انتهت مهلة تنفيذ العملية المحلية.'));
    }, timeoutMs);
    processHandle.stdout.on('data', chunk=>{
      if(stdout.length < maxBuffer) stdout += chunk.toString('utf8');
      else overflowed = true;
    });
    processHandle.stderr.on('data', chunk=>{
      if(stderr.length < maxBuffer) stderr += chunk.toString('utf8');
      else overflowed = true;
    });
    processHandle.on('error', error=>{
      clearTimeout(timer);
      reject(error);
    });
    processHandle.on('close', code=>{
      clearTimeout(timer);
      resolve({code:Number(code), stdout, stderr, overflowed});
    });
  });
}

function resolveDeployInvocation(){
  const npxCliPath = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  if(!fs.existsSync(npxCliPath)){
    throw new PublishError('WRANGLER_UNAVAILABLE', 'تعذر العثور على مشغّل Wrangler المحلي غير التفاعلي.', {phase:'deploy'});
  }
  return {
    command:process.execPath,
    args:[npxCliPath, '--no-install', 'wrangler', 'deploy']
  };
}

async function requireCommandSuccess(dependencies, command, args, phase, failureMessage, options = {}){
  let result;
  try{
    result = await dependencies.runCommand(command, args, {
      cwd:dependencies.projectRoot,
      env:options.env,
      timeoutMs:options.timeoutMs,
      maxBuffer:1024 * 1024
    });
  }catch(error){
    throw new PublishError(`${phase.toUpperCase()}_FAILED`, failureMessage, {
      phase,
      details:[sanitizeOutput(error.message)],
      ...options.errorState
    });
  }
  if(result.code !== 0){
    const safeOutput = sanitizeOutput(result.stderr || result.stdout || 'لم تُرجع العملية تفاصيل إضافية.');
    throw new PublishError(`${phase.toUpperCase()}_FAILED`, failureMessage, {
      phase,
      details:safeOutput ? [safeOutput] : [],
      ...options.errorState
    });
  }
  return result;
}

async function verifyProduction(dependencies, reportId, templatePath){
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  if(typeof fetchImpl !== 'function'){
    throw new PublishError('VERIFY_UNAVAILABLE', 'تعذر تشغيل التحقق من الموقع في إصدار Node الحالي.', {phase:'verify'});
  }
  const cacheBust = `publish-check=${Date.now()}`;
  const jsonUrl = `${dependencies.productionOrigin}/${REPORTS_RELATIVE_PATH}?${cacheBust}`;
  const templateUrl = `${dependencies.productionOrigin}/${templatePath}?${cacheBust}`;
  let jsonResponse;
  try{
    jsonResponse = await fetchImpl(jsonUrl, {method:'GET', cache:'no-store', signal:AbortSignal.timeout(20000)});
  }catch(error){
    throw new PublishError('VERIFY_FAILED', 'تم النشر، لكن تعذر تأكيد ظهور التقرير في الموقع.', {
      phase:'verify',
      details:[sanitizeOutput(error.message)],
      deploySucceeded:true,
      verificationWarning:true
    });
  }
  if(!jsonResponse.ok){
    throw new PublishError('VERIFY_FAILED', 'تم النشر، لكن تعذر تأكيد ظهور التقرير في الموقع.', {
      phase:'verify', details:[`استجابة بيانات التقارير: HTTP ${jsonResponse.status}`], deploySucceeded:true, verificationWarning:true
    });
  }
  let productionReports;
  try{
    productionReports = await jsonResponse.json();
  }catch(error){
    throw new PublishError('VERIFY_FAILED', 'تم النشر، لكن تعذر قراءة بيانات التقارير من الموقع.', {
      phase:'verify', details:[sanitizeOutput(error.message)], deploySucceeded:true, verificationWarning:true
    });
  }
  if(!Array.isArray(productionReports) || !productionReports.some(report=>report.id === reportId && normalizeRepoPath(report.templatePath) === templatePath)){
    throw new PublishError('VERIFY_FAILED', 'تم النشر، لكن التقرير لم يظهر بعد في بيانات الموقع.', {
      phase:'verify', deploySucceeded:true, verificationWarning:true
    });
  }

  let templateResponse;
  try{
    templateResponse = await fetchImpl(templateUrl, {method:'HEAD', cache:'no-store', signal:AbortSignal.timeout(20000)});
    if(templateResponse.status === 405){
      templateResponse = await fetchImpl(templateUrl, {method:'GET', cache:'no-store', signal:AbortSignal.timeout(20000)});
    }
  }catch(error){
    throw new PublishError('VERIFY_FAILED', 'تم النشر، لكن تعذر تأكيد وصول ملف DOCX.', {
      phase:'verify', details:[sanitizeOutput(error.message)], deploySucceeded:true, verificationWarning:true
    });
  }
  if(!templateResponse.ok){
    throw new PublishError('VERIFY_FAILED', 'تم النشر، لكن ملف DOCX لم يرجع استجابة ناجحة.', {
      phase:'verify', details:[`استجابة ملف DOCX: HTTP ${templateResponse.status}`], deploySucceeded:true, verificationWarning:true
    });
  }
}

async function verifyDeletedReport(dependencies, reportId, templatePath, docxDeleted){
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  if(typeof fetchImpl !== 'function'){
    throw new PublishError('VERIFY_UNAVAILABLE', 'تعذر تشغيل التحقق من الموقع في إصدار Node الحالي.', {phase:'verify'});
  }
  const cacheBust = `delete-check=${Date.now()}`;
  const jsonUrl = `${dependencies.productionOrigin}/${REPORTS_RELATIVE_PATH}?${cacheBust}`;
  const templateUrl = `${dependencies.productionOrigin}/${templatePath}?${cacheBust}`;
  let jsonResponse;
  try{
    jsonResponse = await fetchImpl(jsonUrl, {method:'GET', cache:'no-store', signal:AbortSignal.timeout(20000)});
  }catch(error){
    throw new PublishError('VERIFY_FAILED', 'تم النشر، لكن تعذر تأكيد حذف التقرير من الموقع.', {
      phase:'verify', details:[sanitizeOutput(error.message)], deploySucceeded:true, verificationWarning:true
    });
  }
  if(!jsonResponse.ok){
    throw new PublishError('VERIFY_FAILED', 'تم النشر، لكن تعذر قراءة بيانات التقارير من الموقع.', {
      phase:'verify', details:[`استجابة بيانات التقارير: HTTP ${jsonResponse.status}`], deploySucceeded:true, verificationWarning:true
    });
  }
  let productionReports;
  try{
    productionReports = await jsonResponse.json();
  }catch(error){
    throw new PublishError('VERIFY_FAILED', 'تم النشر، لكن تعذر قراءة بيانات التقارير من الموقع.', {
      phase:'verify', details:[sanitizeOutput(error.message)], deploySucceeded:true, verificationWarning:true
    });
  }
  if(!Array.isArray(productionReports) || productionReports.some(report=>String(report.id || '').trim() === reportId)){
    throw new PublishError('VERIFY_FAILED', 'تم النشر، لكن التقرير ما زال ظاهرًا في بيانات الموقع.', {
      phase:'verify', deploySucceeded:true, verificationWarning:true
    });
  }

  let templateResponse;
  try{
    templateResponse = await fetchImpl(templateUrl, {method:'HEAD', cache:'no-store', signal:AbortSignal.timeout(20000)});
    if(templateResponse.status === 405){
      templateResponse = await fetchImpl(templateUrl, {method:'GET', cache:'no-store', signal:AbortSignal.timeout(20000)});
    }
  }catch(error){
    throw new PublishError('VERIFY_FAILED', 'تم النشر، لكن تعذر التحقق من ملف DOCX.', {
      phase:'verify', details:[sanitizeOutput(error.message)], deploySucceeded:true, verificationWarning:true
    });
  }
  if(docxDeleted && templateResponse.ok){
    throw new PublishError('VERIFY_FAILED', 'تم حذف السجل، لكن ملف DOCX ما زال متاحًا في الموقع.', {
      phase:'verify', deploySucceeded:true, verificationWarning:true
    });
  }
  if(!docxDeleted && !templateResponse.ok){
    throw new PublishError('VERIFY_FAILED', 'تم حذف السجل، لكن ملف DOCX المشترك لم يعد متاحًا.', {
      phase:'verify', details:[`استجابة ملف DOCX: HTTP ${templateResponse.status}`], deploySucceeded:true, verificationWarning:true
    });
  }
}

function emitProgress(callback, step, status, message){
  if(typeof callback === 'function') callback({step, status, message});
}

async function runDeploy(dependencies, commitHash){
  try{
    await requireCommandSuccess(
      dependencies,
      dependencies.deployInvocation.command,
      dependencies.deployInvocation.args,
      'deploy',
      'تم رفع التغييرات إلى GitHub، لكن Deploy فشل.',
      {
        timeoutMs:10 * 60 * 1000,
        env:{...process.env, CI:'true', WRANGLER_SEND_METRICS:'false'},
        errorState:{commitHash, pushSucceeded:true, retryAvailable:true}
      }
    );
  }catch(error){
    error.commitHash = commitHash;
    error.pushSucceeded = true;
    error.retryAvailable = true;
    throw error;
  }
}

async function publishReport(options){
  const dependencies = {
    projectRoot:options.projectRoot,
    reportsDataPath:options.reportsDataPath || path.join(options.projectRoot, REPORTS_RELATIVE_PATH),
    templatesDirectory:options.templatesDirectory || path.join(options.projectRoot, TEMPLATES_RELATIVE_DIRECTORY),
    productionOrigin:options.productionOrigin || PRODUCTION_ORIGIN,
    runCommand:options.runCommand || defaultRunCommand,
    runReportCheck:options.runReportCheck,
    fetchImpl:options.fetchImpl || globalThis.fetch,
    deployInvocation:options.deployInvocation || resolveDeployInvocation()
  };
  const reportId = validatePublishPayload(options.payload);
  const mode = options.mode === 'deploy-only' ? 'deploy-only' : 'full';
  const prior = options.prior || {};
  let commitHash = prior.commitHash || '';
  let pushSucceeded = mode === 'deploy-only' && prior.pushSucceeded === true;

  if(mode === 'deploy-only' && (!pushSucceeded || !commitHash)){
    throw new PublishError('RETRY_NOT_ALLOWED', 'إعادة المحاولة متاحة فقط بعد Push ناجح وDeploy فاشل.', {phase:'validation'});
  }

  emitProgress(options.onProgress, 'validation', 'running', 'جاري فحص مكتبة التقارير...');
  if(typeof dependencies.runReportCheck !== 'function'){
    throw new PublishError('CHECK_UNAVAILABLE', 'فاحص تقارير المدير غير متاح.', {phase:'validation'});
  }
  const check = await dependencies.runReportCheck();
  if(!check.ok){
    throw new PublishError('REPORT_VALIDATION_FAILED', 'فشل فحص مكتبة تقارير المدير.', {
      phase:'validation', details:[sanitizeOutput(check.output || check.message)]
    });
  }
  const reports = validateReportLibrary(dependencies);
  const trusted = resolveTrustedReport(dependencies, reportId, reports);
  emitProgress(options.onProgress, 'validation', 'success', 'فحص التقرير ناجح.');

  if(mode === 'full'){
    emitProgress(options.onProgress, 'git', 'running', 'جاري فحص الفرع والتغييرات المحلية...');
    const branchResult = await requireCommandSuccess(dependencies, 'git', ['branch', '--show-current'], 'git', 'تعذر تحديد فرع Git الحالي.');
    const branch = branchResult.stdout.trim();
    if(branch !== 'main'){
      throw new PublishError('WRONG_BRANCH', 'النشر مسموح من فرع main فقط.', {phase:'git', details:[`الفرع الحالي: ${branch || 'غير معروف'}`]});
    }
    const statusResult = await requireCommandSuccess(
      dependencies,
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      'git',
      'تعذر قراءة حالة Git.'
    );
    const allowedFiles = [REPORTS_RELATIVE_PATH, trusted.templatePath];
    const allowedSet = new Set(allowedFiles);
    const changedFiles = parsePorcelain(statusResult.stdout);
    const unrelatedFiles = changedFiles.filter(filePath=>!allowedSet.has(filePath));
    if(unrelatedFiles.length){
      throw new PublishError('UNRELATED_CHANGES', 'تعذر النشر لأن هناك تغييرات أخرى غير مرتبطة بالتقرير.', {
        phase:'git', details:unrelatedFiles
      });
    }
    const missingChanges = allowedFiles.filter(filePath=>!changedFiles.includes(filePath));
    if(missingChanges.length){
      throw new PublishError('EXPECTED_CHANGES_MISSING', 'ملفات التقرير المطلوبة للنشر ليست كلها ضمن تغييرات Git الحالية.', {
        phase:'git', details:missingChanges
      });
    }
    emitProgress(options.onProgress, 'git', 'success', 'الفرع والتغييرات المحلية آمنة.');

    emitProgress(options.onProgress, 'commit', 'running', 'جاري تجهيز Commit لملفي التقرير فقط...');
    await requireCommandSuccess(dependencies, 'git', ['add', '--', ...allowedFiles], 'commit', 'تعذر تجهيز ملفات التقرير في Git.');
    const stagedResult = await requireCommandSuccess(
      dependencies,
      'git',
      ['diff', '--cached', '--name-only', '-z'],
      'commit',
      'تعذر التحقق من الملفات المجهزة.'
    );
    const stagedFiles = parseNullSeparatedPaths(stagedResult.stdout);
    const stagedSafe = stagedFiles.length === allowedFiles.length && stagedFiles.every(filePath=>allowedSet.has(filePath));
    if(!stagedSafe){
      await dependencies.runCommand('git', ['restore', '--staged', '--', ...allowedFiles], {cwd:dependencies.projectRoot, timeoutMs:30000});
      throw new PublishError('UNSAFE_STAGE', 'أوقف النشر لأن قائمة الملفات المجهزة لا تطابق allowlist.', {
        phase:'commit', details:stagedFiles
      });
    }
    const commitMessage = `Add ${reportId} manager report`;
    await requireCommandSuccess(
      dependencies,
      'git',
      ['commit', '-m', commitMessage, '--', ...allowedFiles],
      'commit',
      'تعذر إنشاء Commit محلي للتقرير.'
    );
    const hashResult = await requireCommandSuccess(dependencies, 'git', ['rev-parse', 'HEAD'], 'commit', 'تم إنشاء Commit، لكن تعذر قراءة معرّفه.');
    commitHash = hashResult.stdout.trim();
    emitProgress(options.onProgress, 'commit', 'success', 'تم إنشاء Commit محلي آمن.');

    emitProgress(options.onProgress, 'push', 'running', 'جاري رفع Commit إلى origin main...');
    try{
      await requireCommandSuccess(dependencies, 'git', ['push', 'origin', 'main'], 'push', 'تم إنشاء Commit محلي، لكن Push فشل.', {
        errorState:{commitHash}
      });
    }catch(error){
      error.commitHash = commitHash;
      throw error;
    }
    pushSucceeded = true;
    emitProgress(options.onProgress, 'push', 'success', 'تم رفع التغييرات إلى GitHub.');
  }else{
    emitProgress(options.onProgress, 'git', 'running', 'جاري التأكد أن النسخة المحلية ما زالت تطابق Commit المرفوع...');
    const branchResult = await requireCommandSuccess(dependencies, 'git', ['branch', '--show-current'], 'git', 'تعذر تحديد فرع Git الحالي.');
    const hashResult = await requireCommandSuccess(dependencies, 'git', ['rev-parse', 'HEAD'], 'git', 'تعذر التحقق من Commit الحالي.');
    const statusResult = await requireCommandSuccess(
      dependencies,
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      'git',
      'تعذر قراءة حالة Git.'
    );
    if(branchResult.stdout.trim() !== 'main' || hashResult.stdout.trim() !== commitHash || parsePorcelain(statusResult.stdout).length){
      throw new PublishError('UNSAFE_DEPLOY_RETRY', 'توقفت إعادة Deploy لأن النسخة المحلية لم تعد تطابق Commit المرفوع.', {phase:'git'});
    }
    emitProgress(options.onProgress, 'git', 'success', 'النسخة المحلية تطابق Commit المرفوع.');
    emitProgress(options.onProgress, 'commit', 'skipped', 'لن يتم إنشاء Commit جديد.');
    emitProgress(options.onProgress, 'push', 'skipped', 'لن يتم تنفيذ Push جديد.');
  }

  emitProgress(options.onProgress, 'deploy', 'running', 'جاري النشر إلى Cloudflare...');
  await runDeploy(dependencies, commitHash);
  emitProgress(options.onProgress, 'deploy', 'success', 'اكتمل Deploy إلى Cloudflare.');

  emitProgress(options.onProgress, 'verify', 'running', 'جاري التحقق من بيانات التقرير وملف DOCX في الموقع...');
  try{
    await verifyProduction(dependencies, reportId, trusted.templatePath);
  }catch(error){
    error.commitHash = commitHash;
    error.pushSucceeded = pushSucceeded;
    throw error;
  }
  emitProgress(options.onProgress, 'verify', 'success', 'ظهر التقرير وملف DOCX في الموقع الحي.');

  return {
    reportId,
    title:trusted.report.title,
    status:'published',
    commitHash,
    pushSucceeded,
    productionUrl:dependencies.productionOrigin,
    templatePath:trusted.templatePath,
    outputFileName:path.basename(trusted.templatePath),
    publishedAt:new Date().toISOString()
  };
}

function writeReportsAtomically(fsApi, reportsDataPath, contents){
  const temporaryPath = `${reportsDataPath}.${process.pid}.${Date.now()}.delete.tmp`;
  fsApi.writeFileSync(temporaryPath, contents, {encoding:'utf8', flag:'wx'});
  try{
    fsApi.renameSync(temporaryPath, reportsDataPath);
  }catch(error){
    if(fsApi.existsSync(temporaryPath)) fsApi.unlinkSync(temporaryPath);
    throw error;
  }
}

async function restoreDeleteMutation(dependencies, backup){
  try{
    writeReportsAtomically(dependencies.fsApi, dependencies.reportsDataPath, backup.rawReports);
    if(backup.docxDeleted && !dependencies.fsApi.existsSync(backup.absoluteTemplatePath)){
      dependencies.fsApi.writeFileSync(backup.absoluteTemplatePath, backup.docxBuffer, {flag:'wx'});
    }
  }catch(error){
    throw new PublishError('ROLLBACK_FAILED', 'فشل الحذف وفشلت استعادة الملفات المحلية بالكامل.', {
      phase:'validation', details:[sanitizeOutput(error.message)]
    });
  }
}

async function deleteReport(options){
  const dependencies = {
    projectRoot:options.projectRoot,
    reportsDataPath:options.reportsDataPath || path.join(options.projectRoot, REPORTS_RELATIVE_PATH),
    templatesDirectory:options.templatesDirectory || path.join(options.projectRoot, TEMPLATES_RELATIVE_DIRECTORY),
    productionOrigin:options.productionOrigin || PRODUCTION_ORIGIN,
    runCommand:options.runCommand || defaultRunCommand,
    runReportCheck:options.runReportCheck,
    fetchImpl:options.fetchImpl || globalThis.fetch,
    deployInvocation:options.deployInvocation || resolveDeployInvocation(),
    fsApi:options.fsApi || fs
  };
  const reportId = validateDeletePayload(options.payload);
  const mode = options.mode === 'deploy-only' ? 'deploy-only' : 'full';
  const prior = options.prior || {};
  let report;
  let templatePath;
  let docxDeleted = prior.docxDeleted === true;
  let commitHash = prior.commitHash || '';
  let pushSucceeded = mode === 'deploy-only' && prior.pushSucceeded === true;

  if(mode === 'deploy-only'){
    if(!pushSucceeded || !commitHash || prior.reportId !== reportId || !prior.templatePath){
      throw new PublishError('RETRY_NOT_ALLOWED', 'إعادة المحاولة متاحة فقط بعد Push ناجح وDeploy فاشل لعملية الحذف نفسها.', {phase:'validation'});
    }
    report = {id:reportId, title:prior.title || reportId};
    templatePath = normalizeRepoPath(prior.templatePath);
  }else{
    let rawReports;
    let reports;
    try{
      rawReports = dependencies.fsApi.readFileSync(dependencies.reportsDataPath, 'utf8');
      reports = JSON.parse(rawReports);
    }catch(error){
      throw new PublishError('INVALID_REPORT_LIBRARY', 'تعذر قراءة بيانات تقارير المدير.', {
        phase:'validation', details:[sanitizeOutput(error.message)]
      });
    }
    if(!Array.isArray(reports)) throw new PublishError('INVALID_REPORT_LIBRARY', 'ملف بيانات التقارير لا يحتوي على مصفوفة.', {phase:'validation'});
    const trusted = resolveSafeDeleteTarget(dependencies, reportId, reports);
    report = trusted.report;
    templatePath = trusted.templatePath;

    emitProgress(options.onProgress, 'git', 'running', 'جاري فحص الفرع ونظافة Git قبل الحذف...');
    const branchResult = await requireCommandSuccess(dependencies, 'git', ['branch', '--show-current'], 'git', 'تعذر تحديد فرع Git الحالي.');
    if(branchResult.stdout.trim() !== 'main'){
      throw new PublishError('WRONG_BRANCH', 'الحذف مسموح من فرع main فقط.', {phase:'git', details:[`الفرع الحالي: ${branchResult.stdout.trim() || 'غير معروف'}`]});
    }
    const statusResult = await requireCommandSuccess(dependencies, 'git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 'git', 'تعذر قراءة حالة Git.');
    const stagedBefore = await requireCommandSuccess(dependencies, 'git', ['diff', '--cached', '--name-only', '-z'], 'git', 'تعذر فحص Git index.');
    const localChanges = parsePorcelain(statusResult.stdout);
    const stagedChanges = parseNullSeparatedPaths(stagedBefore.stdout);
    if(localChanges.length || stagedChanges.length){
      throw new PublishError('UNRELATED_CHANGES', 'تعذر الحذف لأن هناك تغييرات محلية تحتاج مراجعة أولًا.', {
        phase:'git', details:[...new Set([...localChanges, ...stagedChanges])]
      });
    }
    emitProgress(options.onProgress, 'git', 'success', 'الفرع وWorking Tree وGit index نظيفة.');

    const sharedTemplate = reports.some(item=>item !== report && normalizeRepoPath(item.templatePath) === templatePath);
    const docxBuffer = sharedTemplate ? null : dependencies.fsApi.readFileSync(trusted.absoluteTemplatePath);
    const updatedReports = reports.filter(item=>item !== report);
    const backup = {rawReports, docxBuffer, docxDeleted:false, absoluteTemplatePath:trusted.absoluteTemplatePath};
    let mutationApplied = false;
    let commitCreated = false;
    const allowedFiles = [REPORTS_RELATIVE_PATH];

    try{
      emitProgress(options.onProgress, 'mutation', 'running', 'جاري إزالة سجل التقرير وتجهيز ملف DOCX...');
      writeReportsAtomically(dependencies.fsApi, dependencies.reportsDataPath, `${JSON.stringify(updatedReports, null, 2)}\n`);
      mutationApplied = true;
      if(!sharedTemplate){
        dependencies.fsApi.unlinkSync(trusted.absoluteTemplatePath);
        backup.docxDeleted = true;
        docxDeleted = true;
        allowedFiles.push(templatePath);
      }
      emitProgress(options.onProgress, 'mutation', 'success', sharedTemplate ? 'حُذف السجل وأُبقي ملف DOCX لأنه مشترك.' : 'حُذف السجل وملف DOCX محليًا.');

      emitProgress(options.onProgress, 'validation', 'running', 'جاري فحص مكتبة التقارير بعد الحذف...');
      if(typeof dependencies.runReportCheck !== 'function') throw new PublishError('CHECK_UNAVAILABLE', 'فاحص تقارير المدير غير متاح.', {phase:'validation'});
      const check = await dependencies.runReportCheck();
      if(!check.ok) throw new PublishError('REPORT_VALIDATION_FAILED', 'فشل فحص مكتبة تقارير المدير بعد الحذف.', {
        phase:'validation', details:[sanitizeOutput(check.output || check.message)]
      });
      const verifiedReports = validateReportLibrary(dependencies);
      if(verifiedReports.some(item=>String(item.id || '').trim() === reportId)){
        throw new PublishError('REPORT_VALIDATION_FAILED', 'التقرير ما زال موجودًا بعد الحذف المحلي.', {phase:'validation'});
      }
      emitProgress(options.onProgress, 'validation', 'success', 'مكتبة التقارير سليمة بعد الحذف.');

      emitProgress(options.onProgress, 'commit', 'running', 'جاري تجهيز Commit لملفات الحذف فقط...');
      await requireCommandSuccess(dependencies, 'git', ['add', '--', ...allowedFiles], 'commit', 'تعذر تجهيز ملفات الحذف في Git.');
      const stagedResult = await requireCommandSuccess(dependencies, 'git', ['diff', '--cached', '--name-only', '-z'], 'commit', 'تعذر التحقق من الملفات المجهزة.');
      const stagedFiles = parseNullSeparatedPaths(stagedResult.stdout);
      const allowedSet = new Set(allowedFiles);
      if(stagedFiles.length !== allowedFiles.length || !stagedFiles.every(filePath=>allowedSet.has(filePath))){
        throw new PublishError('UNSAFE_STAGE', 'أوقف الحذف لأن قائمة الملفات المجهزة لا تطابق allowlist.', {phase:'commit', details:stagedFiles});
      }
      const commitMessage = `Remove manager report: ${reportId}`;
      await requireCommandSuccess(dependencies, 'git', ['commit', '-m', commitMessage, '--', ...allowedFiles], 'commit', 'تعذر إنشاء Commit محلي للحذف.');
      commitCreated = true;
      const hashResult = await requireCommandSuccess(dependencies, 'git', ['rev-parse', 'HEAD'], 'commit', 'تم إنشاء Commit، لكن تعذر قراءة معرّفه.');
      commitHash = hashResult.stdout.trim();
      emitProgress(options.onProgress, 'commit', 'success', 'تم إنشاء Commit حذف محلي آمن.');
    }catch(error){
      if(!commitCreated && mutationApplied){
        await dependencies.runCommand('git', ['restore', '--staged', '--', ...allowedFiles], {cwd:dependencies.projectRoot, timeoutMs:30000});
        await restoreDeleteMutation(dependencies, backup);
      }
      throw error;
    }

    emitProgress(options.onProgress, 'push', 'running', 'جاري رفع Commit الحذف إلى origin main...');
    try{
      await requireCommandSuccess(dependencies, 'git', ['push', 'origin', 'main'], 'push', 'تم إنشاء Commit الحذف محليًا، لكن Push فشل.', {errorState:{commitHash}});
    }catch(error){
      error.commitHash = commitHash;
      throw error;
    }
    pushSucceeded = true;
    emitProgress(options.onProgress, 'push', 'success', 'تم رفع الحذف إلى GitHub.');
  }

  if(mode === 'deploy-only'){
    emitProgress(options.onProgress, 'git', 'running', 'جاري التأكد أن النسخة المحلية تطابق Commit الحذف المرفوع...');
    const branchResult = await requireCommandSuccess(dependencies, 'git', ['branch', '--show-current'], 'git', 'تعذر تحديد فرع Git الحالي.');
    const hashResult = await requireCommandSuccess(dependencies, 'git', ['rev-parse', 'HEAD'], 'git', 'تعذر التحقق من Commit الحالي.');
    const statusResult = await requireCommandSuccess(dependencies, 'git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 'git', 'تعذر قراءة حالة Git.');
    if(branchResult.stdout.trim() !== 'main' || hashResult.stdout.trim() !== commitHash || parsePorcelain(statusResult.stdout).length){
      throw new PublishError('UNSAFE_DEPLOY_RETRY', 'توقفت إعادة Deploy لأن النسخة المحلية لم تعد تطابق Commit الحذف المرفوع.', {phase:'git'});
    }
    emitProgress(options.onProgress, 'git', 'success', 'النسخة المحلية تطابق Commit الحذف المرفوع.');
    emitProgress(options.onProgress, 'mutation', 'skipped', 'لن يتكرر الحذف المحلي.');
    emitProgress(options.onProgress, 'validation', 'skipped', 'لن يتكرر فحص ما قبل Commit.');
    emitProgress(options.onProgress, 'commit', 'skipped', 'لن يتم إنشاء Commit جديد.');
    emitProgress(options.onProgress, 'push', 'skipped', 'لن يتم تنفيذ Push جديد.');
  }

  emitProgress(options.onProgress, 'deploy', 'running', 'جاري نشر الحذف إلى Cloudflare...');
  try{
    await runDeploy(dependencies, commitHash);
  }catch(error){
    error.docxDeleted = docxDeleted;
    error.templatePath = templatePath;
    error.reportTitle = report.title;
    throw error;
  }
  emitProgress(options.onProgress, 'deploy', 'success', 'اكتمل Deploy إلى Cloudflare.');

  emitProgress(options.onProgress, 'verify', 'running', 'جاري التحقق من اختفاء التقرير من الموقع...');
  try{
    await verifyDeletedReport(dependencies, reportId, templatePath, docxDeleted);
  }catch(error){
    error.commitHash = commitHash;
    error.pushSucceeded = pushSucceeded;
    error.docxDeleted = docxDeleted;
    error.templatePath = templatePath;
    error.reportTitle = report.title;
    throw error;
  }
  emitProgress(options.onProgress, 'verify', 'success', docxDeleted ? 'اختفى التقرير وملف DOCX من الموقع.' : 'اختفى التقرير وبقي ملف DOCX المشترك متاحًا.');

  return {
    reportId,
    title:report.title,
    status:'deleted',
    commitHash,
    pushSucceeded,
    productionUrl:dependencies.productionOrigin,
    templatePath,
    outputFileName:path.basename(templatePath),
    docxDeleted,
    deletedAt:new Date().toISOString()
  };
}

async function recoverDeleteRetry(options, requestedReportId = ''){
  const dependencies = {
    projectRoot:options.projectRoot,
    reportsDataPath:options.reportsDataPath || path.join(options.projectRoot, REPORTS_RELATIVE_PATH),
    templatesDirectory:options.templatesDirectory || path.join(options.projectRoot, TEMPLATES_RELATIVE_DIRECTORY),
    runCommand:options.runCommand || defaultRunCommand,
    fsApi:options.fsApi || fs
  };
  try{
    const [branchResult, statusResult, stagedResult, subjectResult, headResult, originResult] = await Promise.all([
      requireCommandSuccess(dependencies, 'git', ['branch', '--show-current'], 'git', 'تعذر تحديد فرع Git الحالي.'),
      requireCommandSuccess(dependencies, 'git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 'git', 'تعذر قراءة حالة Git.'),
      requireCommandSuccess(dependencies, 'git', ['diff', '--cached', '--name-only', '-z'], 'git', 'تعذر فحص Git index.'),
      requireCommandSuccess(dependencies, 'git', ['log', '-1', '--pretty=%s'], 'git', 'تعذر قراءة آخر Commit.'),
      requireCommandSuccess(dependencies, 'git', ['rev-parse', 'HEAD'], 'git', 'تعذر قراءة Commit الحالي.'),
      requireCommandSuccess(dependencies, 'git', ['rev-parse', 'origin/main'], 'git', 'تعذر قراءة origin/main.')
    ]);
    if(branchResult.stdout.trim() !== 'main' || parsePorcelain(statusResult.stdout).length || parseNullSeparatedPaths(stagedResult.stdout).length){
      return {state:'none'};
    }
    const match = subjectResult.stdout.trim().match(/^Remove manager report: ([a-z0-9]+(?:-[a-z0-9]+)*)$/);
    if(!match || (requestedReportId && match[1] !== requestedReportId)) return {state:'none'};
    const reportId = validateReportId(match[1]);
    const commitHash = headResult.stdout.trim();
    if(!commitHash || originResult.stdout.trim() !== commitHash) return {state:'none'};

    const currentReports = JSON.parse(dependencies.fsApi.readFileSync(dependencies.reportsDataPath, 'utf8'));
    if(!Array.isArray(currentReports) || currentReports.some(item=>String(item.id || '').trim() === reportId)) return {state:'none'};
    const previousResult = await requireCommandSuccess(dependencies, 'git', ['show', `HEAD^:${REPORTS_RELATIVE_PATH}`], 'git', 'تعذر استعادة بيانات التقرير المحذوف من Git.');
    const previousReports = JSON.parse(previousResult.stdout);
    const report = Array.isArray(previousReports) ? previousReports.find(item=>String(item.id || '').trim() === reportId) : null;
    if(!report) return {state:'none'};
    const templatePath = normalizeRepoPath(report.templatePath);
    const absoluteTemplatePath = path.resolve(dependencies.projectRoot, templatePath);
    if(!templatePath.startsWith(`${TEMPLATES_RELATIVE_DIRECTORY}/`) ||
       path.posix.extname(templatePath).toLowerCase() !== '.docx' ||
       templatePath.split('/').includes('..') ||
       !isInsideDirectory(dependencies.templatesDirectory, absoluteTemplatePath)) return {state:'none'};

    const diffResult = await requireCommandSuccess(dependencies, 'git', ['diff-tree', '--no-commit-id', '--name-status', '-r', 'HEAD'], 'git', 'تعذر فحص ملفات Commit الحذف.');
    const changes = diffResult.stdout.split(/\r?\n/).filter(Boolean).map(line=>{
      const parts = line.split(/\s+/);
      return {status:parts[0], path:normalizeRepoPath(parts.slice(1).join(' '))};
    });
    const allowed = new Set([REPORTS_RELATIVE_PATH, templatePath]);
    if(!changes.some(change=>change.path === REPORTS_RELATIVE_PATH) || changes.some(change=>!allowed.has(change.path))) return {state:'none'};
    const templateChange = changes.find(change=>change.path === templatePath);
    const docxDeleted = templateChange?.status === 'D';
    if(docxDeleted === dependencies.fsApi.existsSync(absoluteTemplatePath)) return {state:'none'};
    return {
      state:'ready',
      prior:{
        reportId,
        title:report.title,
        templatePath,
        docxDeleted,
        commitHash,
        pushSucceeded:true,
        retryAvailable:true
      }
    };
  }catch{
    return {state:'none'};
  }
}

module.exports = {
  DELETE_PROGRESS_STEPS,
  PRODUCTION_ORIGIN,
  PROGRESS_STEPS,
  PublishError,
  detectPendingReport,
  deleteReport,
  recoverDeleteRetry,
  defaultRunCommand,
  normalizeRepoPath,
  parsePorcelain,
  parsePorcelainEntries,
  publishReport,
  requireCommandSuccess,
  resolveDeployInvocation,
  runDeploy,
  sanitizeOutput,
  validateDeletePayload,
  validatePublishPayload,
  validateReportId,
  validateReportLibrary
};
