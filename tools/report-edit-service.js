'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  PRODUCTION_ORIGIN,
  PublishError,
  defaultRunCommand,
  normalizeRepoPath,
  parsePorcelain,
  parsePorcelainEntries,
  runDeploy,
  requireCommandSuccess,
  resolveDeployInvocation,
  sanitizeOutput,
  validateReportId,
  validateReportLibrary
} = require('./report-publish-service');

const REPORTS_RELATIVE_PATH = 'assets/data/manager-reports.json';
const TEMPLATES_RELATIVE_DIRECTORY = 'assets/report-templates/manager-reports';
const ALLOWED_CATEGORIES = new Set(['الاجتماعات', 'اللجان', 'النماذج', 'السجلات', 'أخرى']);
const ALLOWED_STATUSES = new Set(['متاح', 'معتمد', 'تجريبي', 'مخطط']);
const EDITABLE_FIELDS = new Set(['title', 'description', 'category', 'status', 'tags', 'requiredFields', 'optionalFields', 'customFields', 'notes']);
const EDIT_PROGRESS_STEPS = [
  {id:'validation', label:'فحص التعديلات'},
  {id:'git', label:'فحص Git'},
  {id:'commit', label:'إنشاء Commit'},
  {id:'push', label:'Push إلى GitHub'},
  {id:'deploy', label:'Deploy إلى Cloudflare'},
  {id:'verify', label:'التحقق من الموقع'}
];
let cachedPizZip = null;

function isPlainObject(value){
  return value && typeof value === 'object' && !Array.isArray(value);
}

function validateExactKeys(value, allowed, message){
  if(Object.keys(value).some(key=>!allowed.has(key))) throw new PublishError('UNSAFE_REQUEST', message, {phase:'validation'});
}

function normalizeText(value, maxLength, label, required = false){
  if(typeof value !== 'string') throw new PublishError('INVALID_EDIT_VALUE', `${label} يجب أن يكون نصًا.`, {phase:'validation'});
  const normalized = value.trim();
  if(required && !normalized) throw new PublishError('INVALID_EDIT_VALUE', `${label} مطلوب.`, {phase:'validation'});
  if(normalized.length > maxLength) throw new PublishError('INVALID_EDIT_VALUE', `${label} يتجاوز ${maxLength} حرفًا.`, {phase:'validation'});
  return normalized;
}

function normalizeStringList(value, label){
  if(!Array.isArray(value) || value.length > 80) throw new PublishError('INVALID_EDIT_VALUE', `${label} غير صالح.`, {phase:'validation'});
  const values = value.map(item=>normalizeText(item, 80, label)).filter(Boolean);
  return [...new Set(values)];
}

function validateFieldNames(values, label){
  values.forEach(value=>{
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)){
      throw new PublishError('INVALID_EDIT_VALUE', `${label} يحتوي اسم حقل غير صالح: ${value}`, {phase:'validation'});
    }
  });
}

function normalizeCustomFields(value){
  if(!Array.isArray(value) || value.length > 30) throw new PublishError('INVALID_EDIT_VALUE', 'customFields غير صالح.', {phase:'validation'});
  const allowed = new Set(['key', 'label', 'type', 'placeholder']);
  const keys = new Set();
  return value.map((field, index)=>{
    if(!isPlainObject(field)) throw new PublishError('INVALID_EDIT_VALUE', `customFields رقم ${index + 1} غير صالح.`, {phase:'validation'});
    validateExactKeys(field, allowed, `customFields رقم ${index + 1} يحتوي خصائص غير مسموحة.`);
    const key = normalizeText(field.key, 80, 'customFields.key', true);
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || keys.has(key)) throw new PublishError('INVALID_EDIT_VALUE', `customFields.key غير صالح أو مكرر: ${key}`, {phase:'validation'});
    keys.add(key);
    return {
      key,
      label:normalizeText(field.label || '', 120, 'customFields.label', true),
      type:normalizeText(field.type || 'text', 30, 'customFields.type', true),
      placeholder:normalizeText(field.placeholder || '', 200, 'customFields.placeholder')
    };
  });
}

function validateEditPayload(payload){
  if(!isPlainObject(payload)) throw new PublishError('INVALID_REQUEST', 'طلب تعديل التقرير غير صالح.', {phase:'validation'});
  validateExactKeys(payload, new Set(['reportId', 'changes', 'wordFile']), 'طلب التعديل يحتوي خصائص غير مسموحة.');
  const reportId = validateReportId(payload.reportId);
  if(!isPlainObject(payload.changes)) throw new PublishError('INVALID_REQUEST', 'بيانات التعديل غير صالحة.', {phase:'validation'});
  validateExactKeys(payload.changes, EDITABLE_FIELDS, 'لا يمكن تعديل id أو sectionId أو templatePath أو خصائص غير مسموحة.');
  const changes = {};
  for(const [key, value] of Object.entries(payload.changes)){
    if(key === 'title') changes.title = normalizeText(value, 160, 'عنوان التقرير', true);
    else if(key === 'description') changes.description = normalizeText(value, 1000, 'الوصف');
    else if(key === 'category'){
      changes.category = normalizeText(value, 40, 'التصنيف', true);
      if(!ALLOWED_CATEGORIES.has(changes.category)) throw new PublishError('INVALID_EDIT_VALUE', 'تصنيف التقرير غير صالح.', {phase:'validation'});
    }else if(key === 'status'){
      changes.status = normalizeText(value, 40, 'الحالة', true);
      if(!ALLOWED_STATUSES.has(changes.status)) throw new PublishError('INVALID_EDIT_VALUE', 'حالة التقرير غير صالحة.', {phase:'validation'});
    }else if(key === 'customFields') changes.customFields = normalizeCustomFields(value);
    else if(key === 'notes') changes.notes = normalizeText(value, 2000, 'الملاحظات');
    else{
      changes[key] = normalizeStringList(value, key);
      if(key === 'requiredFields' || key === 'optionalFields') validateFieldNames(changes[key], key);
    }
  }
  let wordFile = null;
  if(payload.wordFile !== undefined && payload.wordFile !== null){
    if(!isPlainObject(payload.wordFile)) throw new PublishError('INVALID_WORD_FILE', 'بيانات قالب Word غير صالحة.', {phase:'validation'});
    validateExactKeys(payload.wordFile, new Set(['fileName', 'fileBase64']), 'بيانات قالب Word تحتوي خصائص غير مسموحة.');
    const fileName = normalizeText(payload.wordFile.fileName, 255, 'اسم ملف Word', true);
    if(path.extname(fileName).toLowerCase() !== '.docx') throw new PublishError('INVALID_WORD_FILE', 'ملف الاستبدال يجب أن يكون DOCX.', {phase:'validation'});
    const base64 = normalizeText(payload.wordFile.fileBase64, 22 * 1024 * 1024, 'بيانات ملف Word', true);
    if(!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new PublishError('INVALID_WORD_FILE', 'بيانات ملف DOCX غير صالحة.', {phase:'validation'});
    const buffer = Buffer.from(base64, 'base64');
    if(!buffer.length || buffer.length > 15 * 1024 * 1024) throw new PublishError('INVALID_WORD_FILE', 'حجم ملف DOCX غير صالح أو أكبر من 15 ميجابايت.', {phase:'validation'});
    wordFile = {fileName, buffer};
  }
  if(!Object.keys(changes).length && !wordFile) throw new PublishError('NO_EDIT_CHANGES', 'لم يتم إدخال أي تعديل.', {phase:'validation'});
  return {reportId, changes, wordFile};
}

function loadPizZip(projectRoot, fsApi = fs){
  if(cachedPizZip) return cachedPizZip;
  const source = fsApi.readFileSync(path.join(projectRoot, 'assets/vendor/pizzip-3.2.0.min.js'), 'utf8');
  const sandbox = {window:{}, Buffer, Uint8Array, ArrayBuffer, Blob:globalThis.Blob};
  vm.runInNewContext(source, sandbox, {filename:'pizzip-3.2.0.min.js'});
  cachedPizZip = sandbox.window.PizZip;
  return cachedPizZip;
}

function validateWordDocument(projectRoot, buffer, fsApi = fs){
  try{
    const PizZip = loadPizZip(projectRoot, fsApi);
    const zip = new PizZip(buffer);
    const documentPart = zip.file('word/document.xml');
    if(!documentPart) throw new Error('word/document.xml مفقود');
    const documentXml = documentPart.asText();
    if(!documentXml.includes('<w:document')) throw new Error('word/document.xml غير صالح');
    const placeholders = [...new Set((documentXml.match(/\{\{[^{}]+\}\}/g) || []))];
    return {placeholders};
  }catch(error){
    throw new PublishError('INVALID_WORD_FILE', `ملف DOCX أو OpenXML غير صالح: ${sanitizeOutput(error.message)}`, {phase:'validation'});
  }
}

function readReports(fsApi, reportsDataPath){
  let raw;
  let reports;
  try{
    raw = fsApi.readFileSync(reportsDataPath, 'utf8');
    reports = JSON.parse(raw);
  }catch(error){
    throw new PublishError('INVALID_REPORT_LIBRARY', `تعذر قراءة بيانات التقارير: ${sanitizeOutput(error.message)}`, {phase:'validation'});
  }
  if(!Array.isArray(reports)) throw new PublishError('INVALID_REPORT_LIBRARY', 'ملف بيانات التقارير لا يحتوي على مصفوفة.', {phase:'validation'});
  return {raw, reports};
}

function resolveEditTarget(dependencies, reportId, reports, requireFile = true){
  const report = reports.find(item=>String(item.id || '').trim() === reportId);
  if(!report) throw new PublishError('REPORT_NOT_FOUND', 'التقرير المطلوب غير موجود.', {phase:'validation'});
  const templatePath = normalizeRepoPath(report.templatePath);
  const absoluteTemplatePath = path.resolve(dependencies.projectRoot, templatePath);
  const relative = path.relative(dependencies.templatesDirectory, absoluteTemplatePath);
  if(!templatePath.startsWith(`${TEMPLATES_RELATIVE_DIRECTORY}/`) || path.posix.extname(templatePath).toLowerCase() !== '.docx' || templatePath.split('/').includes('..') || !relative || relative.startsWith('..') || path.isAbsolute(relative)){
    throw new PublishError('UNSAFE_TEMPLATE_PATH', 'مسار قالب التقرير غير آمن.', {phase:'validation'});
  }
  if(requireFile && !dependencies.fsApi.existsSync(absoluteTemplatePath)) throw new PublishError('UNSAFE_TEMPLATE_PATH', 'قالب التقرير غير موجود.', {phase:'validation'});
  return {report, templatePath, absoluteTemplatePath};
}

function writeAtomically(fsApi, targetPath, contents){
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.edit.tmp`;
  fsApi.writeFileSync(temporaryPath, contents, {flag:'wx'});
  try{
    fsApi.renameSync(temporaryPath, targetPath);
  }catch(error){
    if(fsApi.existsSync(temporaryPath)) fsApi.unlinkSync(temporaryPath);
    throw error;
  }
}

async function ensureCleanDraftBase(dependencies){
  const branch = await requireCommandSuccess(dependencies, 'git', ['branch', '--show-current'], 'git', 'تعذر تحديد فرع Git الحالي.');
  if(branch.stdout.trim() !== 'main') throw new PublishError('WRONG_BRANCH', 'حفظ التعديل المحلي مسموح من فرع main فقط.', {phase:'git'});
  const status = await requireCommandSuccess(dependencies, 'git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 'git', 'تعذر قراءة حالة Git.');
  const staged = await requireCommandSuccess(dependencies, 'git', ['diff', '--cached', '--name-only', '-z'], 'git', 'تعذر فحص Git index.');
  const files = [...new Set([...parsePorcelain(status.stdout), ...String(staged.stdout || '').split('\0').map(normalizeRepoPath).filter(Boolean)])];
  if(files.length) throw new PublishError('UNRELATED_CHANGES', 'تعذر حفظ التعديل لأن هناك تغييرات محلية تحتاج مراجعة أولًا.', {phase:'git', details:files});
}

function changedValues(before, after){
  const changes = {};
  for(const key of EDITABLE_FIELDS){
    if(JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) changes[key] = {before:before[key] ?? null, after:after[key] ?? null};
  }
  return changes;
}

async function saveReportEdit(options){
  const dependencies = {
    projectRoot:options.projectRoot,
    reportsDataPath:options.reportsDataPath || path.join(options.projectRoot, REPORTS_RELATIVE_PATH),
    templatesDirectory:options.templatesDirectory || path.join(options.projectRoot, TEMPLATES_RELATIVE_DIRECTORY),
    runCommand:options.runCommand || defaultRunCommand,
    runReportCheck:options.runReportCheck,
    fsApi:options.fsApi || fs
  };
  const request = validateEditPayload(options.payload);
  const {raw, reports} = readReports(dependencies.fsApi, dependencies.reportsDataPath);
  const trusted = resolveEditTarget(dependencies, request.reportId, reports);
  if(request.wordFile && reports.some(item=>item !== trusted.report && normalizeRepoPath(item.templatePath) === trusted.templatePath)){
    throw new PublishError('SHARED_TEMPLATE', 'هذا القالب مشترك مع تقرير آخر ولا يمكن استبداله تلقائيًا.', {phase:'validation'});
  }
  validateReportLibrary(dependencies);
  if(request.wordFile) validateWordDocument(dependencies.projectRoot, request.wordFile.buffer, dependencies.fsApi);
  await ensureCleanDraftBase(dependencies);

  const before = JSON.parse(JSON.stringify(trusted.report));
  const after = {...trusted.report, ...request.changes};
  if('requiredFields' in request.changes || 'optionalFields' in request.changes || 'customFields' in request.changes){
    after.fields = [...new Set([
      ...(after.requiredFields || []),
      ...(after.optionalFields || [])
    ])];
  }
  const differences = changedValues(before, after);
  if(!Object.keys(differences).length && !request.wordFile) throw new PublishError('NO_EDIT_CHANGES', 'القيم الجديدة مطابقة للقيم الحالية.', {phase:'validation'});
  const updatedReports = reports.map(item=>item === trusted.report ? after : item);
  const originalDocx = request.wordFile ? dependencies.fsApi.readFileSync(trusted.absoluteTemplatePath) : null;
  let mutationApplied = false;
  try{
    writeAtomically(dependencies.fsApi, dependencies.reportsDataPath, `${JSON.stringify(updatedReports, null, 2)}\n`);
    mutationApplied = true;
    if(request.wordFile) writeAtomically(dependencies.fsApi, trusted.absoluteTemplatePath, request.wordFile.buffer);
    if(typeof dependencies.runReportCheck !== 'function') throw new PublishError('CHECK_UNAVAILABLE', 'فاحص تقارير المدير غير متاح.', {phase:'validation'});
    const check = await dependencies.runReportCheck();
    if(!check.ok) throw new PublishError('REPORT_VALIDATION_FAILED', 'فشل فحص مكتبة تقارير المدير بعد التعديل.', {phase:'validation', details:[sanitizeOutput(check.output || check.message)]});
    validateReportLibrary(dependencies);
  }catch(error){
    if(mutationApplied){
      writeAtomically(dependencies.fsApi, dependencies.reportsDataPath, raw);
      if(originalDocx) writeAtomically(dependencies.fsApi, trusted.absoluteTemplatePath, originalDocx);
    }
    throw error;
  }
  return {
    reportId:request.reportId,
    title:after.title,
    before,
    after,
    differences,
    wordChanged:Boolean(request.wordFile),
    templatePath:trusted.templatePath,
    files:[REPORTS_RELATIVE_PATH, ...(request.wordFile ? [trusted.templatePath] : [])],
    savedAt:new Date().toISOString(),
    originalRaw:raw,
    originalDocx,
    committed:false
  };
}

async function undoReportEdit(options){
  const dependencies = {
    projectRoot:options.projectRoot,
    reportsDataPath:options.reportsDataPath || path.join(options.projectRoot, REPORTS_RELATIVE_PATH),
    templatesDirectory:options.templatesDirectory || path.join(options.projectRoot, TEMPLATES_RELATIVE_DIRECTORY),
    runCommand:options.runCommand || defaultRunCommand,
    runReportCheck:options.runReportCheck,
    fsApi:options.fsApi || fs
  };
  const reportId = validateReportId(options.reportId);
  const draft = options.draft;
  if(!draft || draft.reportId !== reportId || draft.committed) throw new PublishError('UNDO_NOT_AVAILABLE', 'لا توجد تعديلات محلية قابلة للإلغاء لهذا التقرير.', {phase:'validation'});
  const status = await requireCommandSuccess(dependencies, 'git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 'git', 'تعذر قراءة حالة Git.');
  const staged = await requireCommandSuccess(dependencies, 'git', ['diff', '--cached', '--name-only', '-z'], 'git', 'تعذر فحص Git index.');
  const changedFiles = parsePorcelain(status.stdout);
  const stagedFiles = String(staged.stdout || '').split('\0').map(normalizeRepoPath).filter(Boolean);
  const allowed = new Set(draft.files);
  if(stagedFiles.length || changedFiles.length !== draft.files.length || changedFiles.some(file=>!allowed.has(file))){
    throw new PublishError('UNSAFE_UNDO', 'تعذر الإلغاء لأن تغييرات Git لم تعد تطابق هذا التعديل فقط.', {phase:'git', details:[...new Set([...changedFiles, ...stagedFiles])]});
  }
  writeAtomically(dependencies.fsApi, dependencies.reportsDataPath, draft.originalRaw);
  if(draft.wordChanged && draft.originalDocx) writeAtomically(dependencies.fsApi, path.resolve(dependencies.projectRoot, draft.templatePath), draft.originalDocx);
  const check = typeof dependencies.runReportCheck === 'function' ? await dependencies.runReportCheck() : {ok:true};
  if(!check.ok) throw new PublishError('UNDO_VALIDATION_FAILED', 'تمت الاستعادة، لكن فحص المكتبة فشل.', {phase:'validation', details:[sanitizeOutput(check.output || check.message)]});
  return {ok:true, reportId, message:'تم إلغاء التعديلات المحلية واستعادة التقرير.'};
}

function emitProgress(callback, step, status, message){
  if(typeof callback === 'function') callback({step, status, message});
}

async function verifyEditedReport(dependencies, prior){
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  if(typeof fetchImpl !== 'function') throw new PublishError('VERIFY_UNAVAILABLE', 'تعذر تشغيل التحقق من الموقع.', {phase:'verify'});
  const cacheBust = `edit-check=${Date.now()}`;
  const jsonUrl = `${dependencies.productionOrigin}/${REPORTS_RELATIVE_PATH}?${cacheBust}`;
  let jsonResponse;
  try{
    jsonResponse = await fetchImpl(jsonUrl, {method:'GET', cache:'no-store', signal:AbortSignal.timeout(20000)});
  }catch(error){
    throw new PublishError('VERIFY_FAILED', 'تم النشر، لكن تعذر التحقق من بيانات التقرير المحدثة.', {phase:'verify', details:[sanitizeOutput(error.message)], deploySucceeded:true, verificationWarning:true});
  }
  if(!jsonResponse.ok) throw new PublishError('VERIFY_FAILED', 'تم النشر، لكن Production JSON غير متاح.', {phase:'verify', details:[`HTTP ${jsonResponse.status}`], deploySucceeded:true, verificationWarning:true});
  const reports = await jsonResponse.json();
  const report = Array.isArray(reports) ? reports.find(item=>String(item.id || '').trim() === prior.reportId) : null;
  if(!report || normalizeRepoPath(report.templatePath) !== prior.templatePath){
    throw new PublishError('VERIFY_FAILED', 'التقرير المحدث غير موجود في Production JSON.', {phase:'verify', deploySucceeded:true, verificationWarning:true});
  }
  for(const key of Object.keys(prior.differences || {})){
    if(JSON.stringify(report[key] ?? null) !== JSON.stringify(prior.after[key] ?? null)){
      throw new PublishError('VERIFY_FAILED', `قيمة ${key} في Production لا تطابق التعديل.`, {phase:'verify', deploySucceeded:true, verificationWarning:true});
    }
  }
  if(prior.wordChanged){
    const response = await fetchImpl(`${dependencies.productionOrigin}/${prior.templatePath}?${cacheBust}`, {method:'GET', cache:'no-store', signal:AbortSignal.timeout(20000)});
    if(!response.ok || typeof response.arrayBuffer !== 'function') throw new PublishError('VERIFY_FAILED', 'ملف DOCX المحدث غير متاح في Production.', {phase:'verify', details:[`HTTP ${response.status}`], deploySucceeded:true, verificationWarning:true});
    const remoteBuffer = Buffer.from(await response.arrayBuffer());
    const localBuffer = dependencies.fsApi.readFileSync(path.resolve(dependencies.projectRoot, prior.templatePath));
    if(crypto.createHash('sha256').update(remoteBuffer).digest('hex') !== crypto.createHash('sha256').update(localBuffer).digest('hex')){
      throw new PublishError('VERIFY_FAILED', 'ملف DOCX في Production لا يطابق القالب المحدث.', {phase:'verify', deploySucceeded:true, verificationWarning:true});
    }
  }
}

async function publishReportEdit(options){
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
  const reportId = validateReportId(options.reportId);
  const mode = options.mode === 'deploy-only' ? 'deploy-only' : 'full';
  const prior = options.draft || options.prior;
  if(!prior || prior.reportId !== reportId) throw new PublishError('EDIT_NOT_READY', 'لا توجد تعديلات محلية موثوقة جاهزة للنشر.', {phase:'validation'});
  let commitHash = prior.commitHash || '';
  let pushSucceeded = mode === 'deploy-only' && prior.pushSucceeded === true;

  emitProgress(options.onProgress, 'validation', 'running', 'جاري فحص التعديلات المحلية...');
  const check = await dependencies.runReportCheck();
  if(!check.ok) throw new PublishError('REPORT_VALIDATION_FAILED', 'فشل فحص مكتبة تقارير المدير.', {phase:'validation', details:[sanitizeOutput(check.output || check.message)]});
  const reports = validateReportLibrary(dependencies);
  const trusted = resolveEditTarget(dependencies, reportId, reports);
  if(JSON.stringify(trusted.report) !== JSON.stringify(prior.after)) throw new PublishError('EDIT_STATE_CHANGED', 'بيانات التقرير المحلية لم تعد تطابق مسودة التعديل.', {phase:'validation'});
  emitProgress(options.onProgress, 'validation', 'success', 'التعديلات المحلية سليمة.');

  if(mode === 'full'){
    emitProgress(options.onProgress, 'git', 'running', 'جاري فحص Git وملفات التعديل...');
    const branch = await requireCommandSuccess(dependencies, 'git', ['branch', '--show-current'], 'git', 'تعذر تحديد فرع Git الحالي.');
    if(branch.stdout.trim() !== 'main') throw new PublishError('WRONG_BRANCH', 'نشر التعديل مسموح من فرع main فقط.', {phase:'git'});
    const status = await requireCommandSuccess(dependencies, 'git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 'git', 'تعذر قراءة حالة Git.');
    const stagedBefore = await requireCommandSuccess(dependencies, 'git', ['diff', '--cached', '--name-only', '-z'], 'git', 'تعذر فحص Git index.');
    const changedFiles = parsePorcelain(status.stdout);
    const stagedFilesBefore = String(stagedBefore.stdout || '').split('\0').map(normalizeRepoPath).filter(Boolean);
    const allowed = new Set(prior.files);
    if(stagedFilesBefore.length || changedFiles.length !== prior.files.length || changedFiles.some(file=>!allowed.has(file))){
      throw new PublishError('UNRELATED_CHANGES', 'تعذر نشر التعديل لأن تغييرات Git لا تطابق ملفات التقرير فقط.', {phase:'git', details:[...new Set([...changedFiles, ...stagedFilesBefore])]});
    }
    emitProgress(options.onProgress, 'git', 'success', 'تغييرات Git مطابقة للتعديل فقط.');

    emitProgress(options.onProgress, 'commit', 'running', 'جاري تجهيز Commit للتعديل...');
    await requireCommandSuccess(dependencies, 'git', ['add', '--', ...prior.files], 'commit', 'تعذر تجهيز ملفات التعديل.');
    const staged = await requireCommandSuccess(dependencies, 'git', ['diff', '--cached', '--name-only', '-z'], 'commit', 'تعذر التحقق من الملفات المجهزة.');
    const stagedFiles = String(staged.stdout || '').split('\0').map(normalizeRepoPath).filter(Boolean);
    if(stagedFiles.length !== prior.files.length || stagedFiles.some(file=>!allowed.has(file))){
      await dependencies.runCommand('git', ['restore', '--staged', '--', ...prior.files], {cwd:dependencies.projectRoot, timeoutMs:30000});
      throw new PublishError('UNSAFE_STAGE', 'أوقف نشر التعديل لأن Stage لا يطابق allowlist.', {phase:'commit', details:stagedFiles});
    }
    await requireCommandSuccess(dependencies, 'git', ['commit', '-m', `Update manager report: ${reportId}`, '--', ...prior.files], 'commit', 'تعذر إنشاء Commit محلي للتعديل.');
    const hash = await requireCommandSuccess(dependencies, 'git', ['rev-parse', 'HEAD'], 'commit', 'تم إنشاء Commit، لكن تعذر قراءة معرّفه.');
    commitHash = hash.stdout.trim();
    prior.committed = true;
    emitProgress(options.onProgress, 'commit', 'success', 'تم إنشاء Commit التعديل.');

    emitProgress(options.onProgress, 'push', 'running', 'جاري رفع Commit التعديل إلى origin main...');
    try{
      await requireCommandSuccess(dependencies, 'git', ['push', 'origin', 'main'], 'push', 'تم إنشاء Commit التعديل، لكن Push فشل.', {errorState:{commitHash}});
    }catch(error){
      error.commitHash = commitHash;
      throw error;
    }
    pushSucceeded = true;
    emitProgress(options.onProgress, 'push', 'success', 'تم رفع التعديل إلى GitHub.');
  }else{
    const branch = await requireCommandSuccess(dependencies, 'git', ['branch', '--show-current'], 'git', 'تعذر تحديد فرع Git الحالي.');
    const head = await requireCommandSuccess(dependencies, 'git', ['rev-parse', 'HEAD'], 'git', 'تعذر قراءة Commit الحالي.');
    const status = await requireCommandSuccess(dependencies, 'git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 'git', 'تعذر قراءة حالة Git.');
    if(branch.stdout.trim() !== 'main' || head.stdout.trim() !== commitHash || parsePorcelain(status.stdout).length || !pushSucceeded){
      throw new PublishError('UNSAFE_DEPLOY_RETRY', 'توقفت إعادة Deploy لأن النسخة المحلية لا تطابق Commit التعديل المرفوع.', {phase:'git'});
    }
    emitProgress(options.onProgress, 'git', 'success', 'النسخة المحلية تطابق Commit التعديل المرفوع.');
    emitProgress(options.onProgress, 'commit', 'skipped', 'لن يتم إنشاء Commit جديد.');
    emitProgress(options.onProgress, 'push', 'skipped', 'لن يتم تنفيذ Push جديد.');
  }

  emitProgress(options.onProgress, 'deploy', 'running', 'جاري نشر التعديل إلى Cloudflare...');
  try{
    await runDeploy(dependencies, commitHash);
  }catch(error){
    error.editPrior = {...prior, commitHash, pushSucceeded:true};
    throw error;
  }
  emitProgress(options.onProgress, 'deploy', 'success', 'اكتمل Deploy إلى Cloudflare.');
  emitProgress(options.onProgress, 'verify', 'running', 'جاري التحقق من التقرير المحدث في الموقع...');
  try{
    await verifyEditedReport(dependencies, prior);
  }catch(error){
    error.commitHash = commitHash;
    error.pushSucceeded = pushSucceeded;
    error.editPrior = {...prior, commitHash, pushSucceeded};
    throw error;
  }
  emitProgress(options.onProgress, 'verify', 'success', 'بيانات التقرير والقالب المحدث مطابقان في الموقع.');
  return {status:'updated', reportId, title:prior.after.title, commitHash, pushSucceeded, wordChanged:prior.wordChanged, templatePath:prior.templatePath, productionUrl:dependencies.productionOrigin, publishedAt:new Date().toISOString()};
}

function defaultReadGitBlob(projectRoot, objectName){
  return new Promise((resolve, reject)=>{
    const processHandle = require('child_process').spawn('git', ['show', objectName], {
      cwd:projectRoot,
      shell:false,
      windowsHide:true,
      stdio:['ignore', 'pipe', 'pipe']
    });
    const chunks = [];
    let size = 0;
    let stderr = '';
    processHandle.stdout.on('data', chunk=>{
      size += chunk.length;
      if(size <= 20 * 1024 * 1024) chunks.push(chunk);
    });
    processHandle.stderr.on('data', chunk=>{ if(stderr.length < 1200) stderr += chunk.toString('utf8'); });
    processHandle.on('error', reject);
    processHandle.on('close', code=>{
      if(code !== 0 || size > 20 * 1024 * 1024) reject(new Error(sanitizeOutput(stderr || 'تعذر قراءة ملف من Git.')));
      else resolve(Buffer.concat(chunks));
    });
  });
}

function buildRecoveredDraft(before, after, originalRaw, originalDocx, wordChanged){
  const differences = changedValues(before, after);
  return {
    reportId:after.id,
    title:after.title,
    before,
    after,
    differences,
    wordChanged,
    templatePath:normalizeRepoPath(after.templatePath),
    files:[REPORTS_RELATIVE_PATH, ...(wordChanged ? [normalizeRepoPath(after.templatePath)] : [])],
    savedAt:new Date().toISOString(),
    originalRaw,
    originalDocx,
    committed:false
  };
}

async function detectPendingEdit(options){
  const dependencies = {
    projectRoot:options.projectRoot,
    reportsDataPath:options.reportsDataPath || path.join(options.projectRoot, REPORTS_RELATIVE_PATH),
    templatesDirectory:options.templatesDirectory || path.join(options.projectRoot, TEMPLATES_RELATIVE_DIRECTORY),
    runCommand:options.runCommand || defaultRunCommand,
    readGitBlob:options.readGitBlob || defaultReadGitBlob,
    fsApi:options.fsApi || fs
  };
  try{
    const branch = await requireCommandSuccess(dependencies, 'git', ['branch', '--show-current'], 'git', 'تعذر تحديد فرع Git الحالي.');
    if(branch.stdout.trim() !== 'main') return {state:'ambiguous', message:'تعديل التقرير يحتاج فرع main.'};
    const status = await requireCommandSuccess(dependencies, 'git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 'git', 'تعذر قراءة حالة Git.');
    const entries = parsePorcelainEntries(status.stdout);
    if(entries.length){
      const jsonEntry = entries.find(entry=>entry.path === REPORTS_RELATIVE_PATH);
      const docxEntries = entries.filter(entry=>entry.path.startsWith(`${TEMPLATES_RELATIVE_DIRECTORY}/`) && path.posix.extname(entry.path).toLowerCase() === '.docx');
      const expectedCount = 1 + docxEntries.length;
      if(!jsonEntry || jsonEntry.status[0] !== ' ' || !jsonEntry.status.includes('M') || docxEntries.length > 1 || entries.length !== expectedCount || docxEntries.some(entry=>entry.status[0] !== ' ' || !entry.status.includes('M'))){
        return {state:'ambiguous', message:'توجد تغييرات محلية لا تطابق مسودة تعديل تقرير واحدة.', details:entries.map(entry=>entry.path)};
      }
      const originalResult = await requireCommandSuccess(dependencies, 'git', ['show', `HEAD:${REPORTS_RELATIVE_PATH}`], 'git', 'تعذر قراءة بيانات التقارير الأصلية.');
      const originalReports = JSON.parse(originalResult.stdout);
      const current = readReports(dependencies.fsApi, dependencies.reportsDataPath);
      if(!Array.isArray(originalReports) || originalReports.length !== current.reports.length) return {state:'ambiguous', message:'تغيير JSON لا يمثل تعديل تقرير واحدًا.'};
      const changed = current.reports.filter(report=>{
        const before = originalReports.find(item=>item.id === report.id);
        return !before || JSON.stringify(before) !== JSON.stringify(report);
      });
      if(changed.length !== 1 || originalReports.some(report=>!current.reports.some(item=>item.id === report.id))) return {state:'ambiguous', message:'تغيير JSON لا يمثل تعديل تقرير واحدًا.'};
      const after = changed[0];
      const before = originalReports.find(item=>item.id === after.id);
      const wordChanged = docxEntries.length === 1;
      if(wordChanged && docxEntries[0].path !== normalizeRepoPath(after.templatePath)) return {state:'ambiguous', message:'ملف DOCX المعدل لا يطابق templatePath للتقرير.'};
      const originalDocx = wordChanged ? await dependencies.readGitBlob(dependencies.projectRoot, `HEAD:${normalizeRepoPath(after.templatePath)}`) : null;
      return {state:'local', draft:buildRecoveredDraft(before, after, originalResult.stdout, originalDocx, wordChanged)};
    }

    const [subject, head, origin] = await Promise.all([
      requireCommandSuccess(dependencies, 'git', ['log', '-1', '--pretty=%s'], 'git', 'تعذر قراءة آخر Commit.'),
      requireCommandSuccess(dependencies, 'git', ['rev-parse', 'HEAD'], 'git', 'تعذر قراءة Commit الحالي.'),
      requireCommandSuccess(dependencies, 'git', ['rev-parse', 'origin/main'], 'git', 'تعذر قراءة origin/main.')
    ]);
    const match = subject.stdout.trim().match(/^Update manager report: ([a-z0-9]+(?:-[a-z0-9]+)*)$/);
    if(!match || head.stdout.trim() !== origin.stdout.trim()) return {state:'none'};
    const current = readReports(dependencies.fsApi, dependencies.reportsDataPath);
    const previous = await requireCommandSuccess(dependencies, 'git', ['show', `HEAD^:${REPORTS_RELATIVE_PATH}`], 'git', 'تعذر قراءة بيانات التقرير السابقة.');
    const previousReports = JSON.parse(previous.stdout);
    const after = current.reports.find(item=>item.id === match[1]);
    const before = Array.isArray(previousReports) ? previousReports.find(item=>item.id === match[1]) : null;
    if(!before || !after) return {state:'none'};
    const diff = await requireCommandSuccess(dependencies, 'git', ['diff-tree', '--no-commit-id', '--name-status', '-r', 'HEAD'], 'git', 'تعذر فحص Commit التعديل.');
    const changedFiles = diff.stdout.split(/\r?\n/).filter(Boolean).map(line=>normalizeRepoPath(line.split(/\s+/).slice(1).join(' ')));
    const templatePath = normalizeRepoPath(after.templatePath);
    const allowed = new Set([REPORTS_RELATIVE_PATH, templatePath]);
    if(!changedFiles.includes(REPORTS_RELATIVE_PATH) || changedFiles.some(file=>!allowed.has(file))) return {state:'none'};
    const draft = buildRecoveredDraft(before, after, previous.stdout, null, changedFiles.includes(templatePath));
    draft.committed = true;
    draft.commitHash = head.stdout.trim();
    draft.pushSucceeded = true;
    return {state:'deploy-retry', prior:draft};
  }catch(error){
    return {state:'ambiguous', message:'تعذر استنتاج حالة تعديل التقرير من Git.', details:[sanitizeOutput(error.message)]};
  }
}

module.exports = {
  EDIT_PROGRESS_STEPS,
  detectPendingEdit,
  publishReportEdit,
  saveReportEdit,
  undoReportEdit,
  validateEditPayload,
  validateWordDocument,
  verifyEditedReport
};
