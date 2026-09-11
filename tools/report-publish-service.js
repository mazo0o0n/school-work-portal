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
  const entries = String(output || '').split('\0');
  const files = [];
  for(let index = 0; index < entries.length; index += 1){
    const entry = entries[index];
    if(!entry) continue;
    const status = entry.slice(0, 2);
    const file = normalizeRepoPath(entry.slice(3));
    if(file) files.push(file);
    if(/[RC]/.test(status) && entries[index + 1]){
      files.push(normalizeRepoPath(entries[index + 1]));
      index += 1;
    }
  }
  return [...new Set(files)];
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
  if(!isInsideDirectory(options.templatesDirectory, absoluteTemplatePath) || !fs.existsSync(absoluteTemplatePath)){
    throw new PublishError('UNSAFE_TEMPLATE_PATH', 'تعذر اعتماد مسار قالب التقرير.', {phase:'validation'});
  }
  return {report, templatePath, absoluteTemplatePath};
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

function emitProgress(callback, step, status, message){
  if(typeof callback === 'function') callback({step, status, message});
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

module.exports = {
  PRODUCTION_ORIGIN,
  PROGRESS_STEPS,
  PublishError,
  defaultRunCommand,
  normalizeRepoPath,
  parsePorcelain,
  publishReport,
  resolveDeployInvocation,
  sanitizeOutput,
  validatePublishPayload,
  validateReportId,
  validateReportLibrary
};
