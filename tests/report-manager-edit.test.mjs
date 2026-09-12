import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {
  EDIT_PROGRESS_STEPS,
  detectPendingEdit,
  publishReportEdit,
  saveReportEdit,
  undoReportEdit,
  validateEditPayload,
  validateWordDocument
} = require('../tools/report-edit-service.js');
const {PublishError, sanitizeOutput} = require('../tools/report-publish-service.js');
const {ensureAllowedHost, ensureLocalPost} = require('../tools/report-manager-server.js');

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportsPath = 'assets/data/manager-reports.json';
const templatePath = 'assets/report-templates/manager-reports/edit-me.docx';
const validDocx = fs.readFileSync(path.join(repositoryRoot, 'assets/report-templates/manager-reports/meeting-template-test.docx'));
validateWordDocument(repositoryRoot, validDocx);

function baseReport(id = 'edit-me', selectedTemplate = templatePath){
  return {
    id,
    title:'عنوان قديم',
    description:'وصف قديم',
    category:'السجلات',
    status:'تجريبي',
    sectionId:'managerReports',
    templatePath:selectedTemplate,
    outputFileName:'عنوان قديم - {{schoolDisplayName}}.docx',
    tags:['قديم'],
    fields:['principalName'],
    requiredFields:[],
    optionalFields:['principalName'],
    customFields:[],
    notes:''
  };
}

function createFixture(t, reports = [baseReport()]){
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'report-edit-test-'));
  const reportsDataPath = path.join(root, reportsPath);
  const templatesDirectory = path.join(root, 'assets/report-templates/manager-reports');
  fs.mkdirSync(path.dirname(reportsDataPath), {recursive:true});
  fs.mkdirSync(templatesDirectory, {recursive:true});
  fs.writeFileSync(reportsDataPath, `${JSON.stringify(reports, null, 2)}\n`);
  for(const selected of new Set(reports.map(report=>report.templatePath))){
    const absolute = path.resolve(root, selected);
    if(path.relative(templatesDirectory, absolute).startsWith('..')) continue;
    fs.mkdirSync(path.dirname(absolute), {recursive:true});
    fs.writeFileSync(absolute, validDocx);
  }
  t.after(()=>fs.rmSync(root, {recursive:true, force:true}));
  return {root, projectRoot:root, reportsDataPath, templatesDirectory};
}

function createRunner(overrides = {}){
  const calls = [];
  let dirtyFiles = [];
  let staged = false;
  const runner = async (command, args)=>{
    calls.push({command, args:[...args]});
    const key = command === 'git' ? `git ${args[0]}` : 'deploy';
    if(overrides[key]) return overrides[key]({command, args, calls, dirtyFiles, staged});
    if(key === 'git branch') return {code:0, stdout:'main\n', stderr:''};
    if(key === 'git status') return {code:0, stdout:dirtyFiles.map(file=>` M ${file}\0`).join(''), stderr:''};
    if(key === 'git add') staged = true;
    if(key === 'git restore') staged = false;
    if(key === 'git diff') return {code:0, stdout:staged ? `${dirtyFiles.join('\0')}\0` : '', stderr:''};
    if(key === 'git rev-parse') return {code:0, stdout:'edit123\n', stderr:''};
    return {code:0, stdout:'', stderr:''};
  };
  return {calls, runner, setDirty(files){ dirtyFiles = [...files]; }};
}

function createNetwork(){
  const state = {report:null, template:validDocx, reportMismatch:false, templateMismatch:false};
  const calls = [];
  const fetchImpl = async (url, options)=>{
    calls.push({url, options});
    if(url.includes('manager-reports.json')){
      const report = state.reportMismatch ? {...state.report, title:'عنوان مختلف'} : state.report;
      return {ok:true, status:200, json:async ()=>[report]};
    }
    const buffer = state.templateMismatch ? Buffer.from('different') : state.template;
    return {ok:true, status:200, arrayBuffer:async ()=>buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)};
  };
  return {state, calls, fetchImpl};
}

function context(t, overrides = {}){
  const fixture = createFixture(t, overrides.reports || [baseReport()]);
  const command = createRunner(overrides.commands);
  const network = createNetwork();
  const common = {
    ...fixture,
    runCommand:command.runner,
    runReportCheck:async ()=>({ok:true, output:'PASS'}),
    fetchImpl:network.fetchImpl,
    deployInvocation:{command:'mock-wrangler', args:['deploy']},
    ...overrides.options
  };
  return {fixture, command, network, common};
}

function payload(changes, wordFile){
  return {reportId:'edit-me', changes, ...(wordFile ? {wordFile} : {})};
}

async function save(contextValue, changes = {title:'عنوان جديد'}, wordFile){
  const draft = await saveReportEdit({...contextValue.common, payload:payload(changes, wordFile)});
  contextValue.command.setDirty(draft.files);
  contextValue.network.state.report = draft.after;
  return draft;
}

test('edits title only without changing ID or template path', async t=>{
  const value = context(t);
  const draft = await save(value);
  assert.equal(draft.after.title, 'عنوان جديد');
  assert.equal(draft.after.id, 'edit-me');
  assert.equal(draft.after.templatePath, templatePath);
});

test('edits description only with empty custom fields and no Word replacement', async t=>{
  const draft = await save(context(t), {
    description:'اختبار تعديل محلي',
    requiredFields:[],
    optionalFields:['principalName'],
    customFields:[]
  });
  assert.equal(draft.after.description, 'اختبار تعديل محلي');
  assert.deepEqual(Object.keys(draft.differences), ['description']);
  assert.equal(draft.wordChanged, false);
});

test('edits status and category', async t=>{
  const draft = await save(context(t), {status:'معتمد', category:'النماذج'});
  assert.equal(draft.after.status, 'معتمد');
  assert.equal(draft.after.category, 'النماذج');
});

test('edits tags required optional and custom fields', async t=>{
  const draft = await save(context(t), {
    tags:['جديد'], requiredFields:['schoolName'], optionalFields:['principalName'],
    customFields:[{key:'meetingDay', label:'اليوم', type:'text', placeholder:'الخميس'}]
  });
  assert.deepEqual(draft.after.tags, ['جديد']);
  assert.deepEqual(draft.after.fields, ['schoolName', 'principalName']);
});

test('ID cannot be changed through changes', ()=>{
  assert.throws(()=>validateEditPayload(payload({id:'new-id'})), error=>error.code === 'UNSAFE_REQUEST');
});

test('unknown report is rejected', async t=>{
  const value = context(t);
  await assert.rejects(()=>saveReportEdit({...value.common, payload:{reportId:'missing', changes:{title:'جديد'}}}), error=>error.code === 'REPORT_NOT_FOUND');
});

test('Word replacement is optional', async t=>{
  const value = context(t);
  const before = fs.readFileSync(path.join(value.fixture.root, templatePath));
  const draft = await save(value);
  assert.equal(draft.wordChanged, false);
  assert.deepEqual(fs.readFileSync(path.join(value.fixture.root, templatePath)), before);
});

test('invalid Word extension is rejected', ()=>{
  assert.throws(()=>validateEditPayload(payload({title:'جديد'}, {fileName:'bad.pdf', fileBase64:'UEs='})), error=>error.code === 'INVALID_WORD_FILE');
});

test('corrupted DOCX is rejected before replacement', async t=>{
  const value = context(t);
  const bad = {fileName:'bad.docx', fileBase64:Buffer.from('PK-not-docx').toString('base64')};
  await assert.rejects(()=>saveReportEdit({...value.common, payload:payload({title:'جديد'}, bad)}), error=>error.code === 'INVALID_WORD_FILE');
});

test('trusted JSON path traversal is rejected', async t=>{
  const value = context(t, {reports:[baseReport('edit-me', '../../outside.docx')]});
  await assert.rejects(()=>saveReportEdit({...value.common, payload:payload({title:'جديد'})}), error=>error.code === 'UNSAFE_TEMPLATE_PATH');
});

test('shared template replacement is blocked', async t=>{
  const value = context(t, {reports:[baseReport(), baseReport('other', templatePath)]});
  const wordFile = {fileName:'new.docx', fileBase64:validDocx.toString('base64')};
  await assert.rejects(()=>saveReportEdit({...value.common, payload:payload({title:'جديد'}, wordFile)}), error=>error.code === 'SHARED_TEMPLATE');
});

test('validation failure rolls back JSON', async t=>{
  const value = context(t, {options:{runReportCheck:async ()=>({ok:false, output:'invalid'})}});
  const before = fs.readFileSync(value.fixture.reportsDataPath, 'utf8');
  await assert.rejects(()=>saveReportEdit({...value.common, payload:payload({title:'جديد'})}), error=>error.code === 'REPORT_VALIDATION_FAILED');
  assert.equal(fs.readFileSync(value.fixture.reportsDataPath, 'utf8'), before);
});

test('validation failure restores old DOCX', async t=>{
  const value = context(t, {options:{runReportCheck:async ()=>({ok:false, output:'invalid'})}});
  const old = fs.readFileSync(path.join(value.fixture.root, templatePath));
  const replacement = Buffer.from(validDocx);
  replacement[replacement.length - 1] ^= 1;
  await assert.rejects(()=>saveReportEdit({...value.common, payload:payload({title:'جديد'}, {fileName:'new.docx', fileBase64:replacement.toString('base64')})}));
  assert.deepEqual(fs.readFileSync(path.join(value.fixture.root, templatePath)), old);
});

test('Word replacement preserves current trusted template path', async t=>{
  const value = context(t);
  const draft = await save(value, {title:'جديد'}, {fileName:'different-name.docx', fileBase64:validDocx.toString('base64')});
  assert.equal(draft.templatePath, templatePath);
  assert.deepEqual(draft.files, [reportsPath, templatePath]);
});

test('local edit creates no commit push or deploy', async t=>{
  const value = context(t);
  await save(value);
  assert.equal(value.command.calls.some(call=>call.args[0] === 'commit' || call.args[0] === 'push' || call.command === 'mock-wrangler'), false);
});

test('undo restores local JSON before commit', async t=>{
  const value = context(t);
  const before = fs.readFileSync(value.fixture.reportsDataPath, 'utf8');
  const draft = await save(value);
  await undoReportEdit({...value.common, reportId:'edit-me', draft});
  assert.equal(fs.readFileSync(value.fixture.reportsDataPath, 'utf8'), before);
});

test('undo refuses unrelated local changes', async t=>{
  const value = context(t);
  const draft = await save(value);
  value.command.setDirty([...draft.files, 'assets/js/unrelated.js']);
  await assert.rejects(()=>undoReportEdit({...value.common, reportId:'edit-me', draft}), error=>error.code === 'UNSAFE_UNDO');
});

test('unrelated Git changes block edit publish', async t=>{
  const value = context(t);
  const draft = await save(value);
  value.command.setDirty([...draft.files, 'assets/js/unrelated.js']);
  await assert.rejects(()=>publishReportEdit({...value.common, reportId:'edit-me', draft}), error=>error.code === 'UNRELATED_CHANGES');
});

test('branch other than main blocks edit publish', async t=>{
  const value = context(t, {commands:{'git branch':()=>({code:0, stdout:'feature/test\n', stderr:''})}});
  const draft = await saveReportEdit({...value.common, runCommand:createRunner().runner, payload:payload({title:'جديد'})});
  value.command.setDirty(draft.files);
  await assert.rejects(()=>publishReportEdit({...value.common, reportId:'edit-me', draft}), error=>error.code === 'WRONG_BRANCH');
});

test('stage allowlist is exact for JSON-only edit', async t=>{
  const value = context(t);
  const draft = await save(value);
  await publishReportEdit({...value.common, reportId:'edit-me', draft});
  const add = value.command.calls.find(call=>call.args[0] === 'add');
  assert.deepEqual(add.args, ['add', '--', reportsPath]);
});

test('edit publish never uses git add dot or add all', async t=>{
  const value = context(t);
  const draft = await save(value);
  await publishReportEdit({...value.common, reportId:'edit-me', draft});
  const add = value.command.calls.find(call=>call.args[0] === 'add');
  assert.equal(add.args.includes('.') || add.args.includes('-A'), false);
});

test('push failure prevents deploy', async t=>{
  const value = context(t, {commands:{'git push':()=>({code:1, stdout:'', stderr:'rejected'})}});
  const draft = await save(value);
  await assert.rejects(()=>publishReportEdit({...value.common, reportId:'edit-me', draft}), error=>error.code === 'PUSH_FAILED');
  assert.equal(value.command.calls.some(call=>call.command === 'mock-wrangler'), false);
});

test('deploy failure enables retry', async t=>{
  const value = context(t, {commands:{deploy:()=>({code:1, stdout:'', stderr:'deploy failed'})}});
  const draft = await save(value);
  await assert.rejects(()=>publishReportEdit({...value.common, reportId:'edit-me', draft}), error=>error.code === 'DEPLOY_FAILED' && error.retryAvailable === true && error.editPrior.pushSucceeded === true);
});

test('retry deploy creates no second commit or push', async t=>{
  const value = context(t);
  const draft = await save(value);
  draft.commitHash = 'edit123';
  draft.pushSucceeded = true;
  value.command.setDirty([]);
  await publishReportEdit({...value.common, reportId:'edit-me', mode:'deploy-only', prior:draft});
  assert.equal(value.command.calls.some(call=>call.args[0] === 'commit' || call.args[0] === 'push'), false);
});

test('production JSON must match updated values', async t=>{
  const value = context(t);
  const draft = await save(value);
  value.network.state.reportMismatch = true;
  await assert.rejects(()=>publishReportEdit({...value.common, reportId:'edit-me', draft}), error=>error.code === 'VERIFY_FAILED');
});

test('updated DOCX is verified by content hash', async t=>{
  const value = context(t);
  const draft = await save(value, {title:'جديد'}, {fileName:'new.docx', fileBase64:validDocx.toString('base64')});
  value.network.state.template = fs.readFileSync(path.join(value.fixture.root, templatePath));
  const result = await publishReportEdit({...value.common, reportId:'edit-me', draft});
  assert.equal(result.wordChanged, true);
  assert.equal(value.network.calls.some(call=>call.url.includes('edit-me.docx')), true);
});

test('client cannot submit path command or changed ID', ()=>{
  assert.throws(()=>validateEditPayload({reportId:'edit-me', changes:{title:'جديد'}, path:'C:\\Windows', command:'git push'}), error=>error instanceof PublishError && error.code === 'UNSAFE_REQUEST');
});

test('edit keeps Host Origin CSRF and sanitized errors', ()=>{
  assert.throws(()=>ensureAllowedHost({headers:{host:'evil.example:4174'}}), /Host/);
  const request = {headers:{origin:'http://127.0.0.1:4174', 'x-report-manager':'local', 'x-report-manager-token':'token'}};
  assert.doesNotThrow(()=>ensureLocalPost(request, 'token'));
  assert.doesNotMatch(sanitizeOutput('Authorization: secret token=abc123'), /secret|abc123/);
});

test('restart recovery recognizes one local JSON edit without duplicate commit', async t=>{
  const value = context(t);
  const original = fs.readFileSync(value.fixture.reportsDataPath, 'utf8');
  const draft = await save(value);
  const runCommand = async (command, args)=>{
    if(args[0] === 'branch') return {code:0, stdout:'main\n', stderr:''};
    if(args[0] === 'status') return {code:0, stdout:` M ${reportsPath}\0`, stderr:''};
    if(args[0] === 'show') return {code:0, stdout:original, stderr:''};
    return {code:1, stdout:'', stderr:'unexpected'};
  };
  const recovered = await detectPendingEdit({...value.fixture, runCommand});
  assert.equal(recovered.state, 'local');
  assert.equal(recovered.draft.reportId, draft.reportId);
  assert.equal(value.command.calls.some(call=>call.args[0] === 'commit'), false);
});

test('edit UI contains edit modal diff preview replacement and confirmation', ()=>{
  const html = fs.readFileSync(path.join(repositoryRoot, 'tools/report-manager.html'), 'utf8');
  assert.match(html, /تعديل التقرير/);
  assert.match(html, /مراجعة التعديلات/);
  assert.match(html, /استبدال قالب Word/);
  assert.match(html, /تأكيد نشر تعديلات التقرير/);
  assert.deepEqual(EDIT_PROGRESS_STEPS.map(step=>step.id), ['validation', 'git', 'commit', 'push', 'deploy', 'verify']);
});
