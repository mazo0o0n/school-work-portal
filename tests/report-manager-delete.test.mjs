import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {
  DELETE_PROGRESS_STEPS,
  PublishError,
  deleteReport,
  recoverDeleteRetry,
  validateDeletePayload
} = require('../tools/report-publish-service.js');
const {ensureAllowedHost, ensureLocalPost} = require('../tools/report-manager-server.js');

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportsPath = 'assets/data/manager-reports.json';
const templatePath = 'assets/report-templates/manager-reports/delete-me.docx';

function report(id = 'delete-me', selectedTemplate = templatePath){
  return {id, title:`تقرير ${id}`, category:'أخرى', status:'تجريبي', templatePath:selectedTemplate};
}

function createFixture(t, reports = [report()]){
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'report-delete-test-'));
  const reportsDataPath = path.join(root, reportsPath);
  const templatesDirectory = path.join(root, 'assets/report-templates/manager-reports');
  fs.mkdirSync(path.dirname(reportsDataPath), {recursive:true});
  fs.mkdirSync(templatesDirectory, {recursive:true});
  fs.writeFileSync(reportsDataPath, `${JSON.stringify(reports, null, 2)}\n`);
  for(const current of new Set(reports.map(item=>item.templatePath))){
    const absolute = path.resolve(root, current);
    if(path.relative(templatesDirectory, absolute).startsWith('..')) continue;
    fs.mkdirSync(path.dirname(absolute), {recursive:true});
    fs.writeFileSync(absolute, `DOCX:${current}`);
  }
  t.after(()=>fs.rmSync(root, {recursive:true, force:true}));
  return {root, reportsDataPath, templatesDirectory};
}

function createRunner(stagedFiles = [reportsPath, templatePath], overrides = {}){
  const calls = [];
  let staged = false;
  const runner = async (command, args)=>{
    calls.push({command, args:[...args]});
    const key = command === 'git' ? `git ${args[0]}` : 'deploy';
    if(overrides[key]) return overrides[key]({command, args, calls});
    if(key === 'git branch') return {code:0, stdout:'main\n', stderr:''};
    if(key === 'git status') return {code:0, stdout:'', stderr:''};
    if(key === 'git add') staged = true;
    if(key === 'git restore') staged = false;
    if(key === 'git diff') return {code:0, stdout:staged ? `${stagedFiles.join('\0')}\0` : '', stderr:''};
    if(key === 'git rev-parse') return {code:0, stdout:'delete123\n', stderr:''};
    return {code:0, stdout:'', stderr:''};
  };
  return {calls, runner};
}

function createFetch({reportStillPresent = false, templateAvailable = false} = {}){
  const calls = [];
  const fetchImpl = async (url, options)=>{
    calls.push({url, options});
    if(url.includes('manager-reports.json')){
      return {ok:true, status:200, json:async ()=>reportStillPresent ? [report()] : []};
    }
    return {ok:templateAvailable, status:templateAvailable ? 200 : 404};
  };
  return {calls, fetchImpl};
}

function deleteOptions(t, overrides = {}){
  const fixture = createFixture(t, overrides.reports || [report()]);
  const stagedFiles = overrides.stagedFiles || [reportsPath, ...(overrides.shared ? [] : [templatePath])];
  const command = createRunner(stagedFiles, overrides.commands);
  const network = createFetch({templateAvailable:overrides.shared === true, ...overrides.network});
  return {
    options:{
      projectRoot:fixture.root,
      reportsDataPath:fixture.reportsDataPath,
      templatesDirectory:fixture.templatesDirectory,
      payload:{reportId:'delete-me'},
      runReportCheck:async ()=>({ok:true, output:'PASS'}),
      runCommand:command.runner,
      fetchImpl:network.fetchImpl,
      deployInvocation:{command:'mock-wrangler', args:['deploy']},
      ...overrides.options
    },
    fixture,
    command,
    network
  };
}

test('deletes an existing report and its unshared DOCX', async t=>{
  const context = deleteOptions(t);
  const result = await deleteReport(context.options);
  assert.equal(result.status, 'deleted');
  assert.equal(result.docxDeleted, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(context.fixture.reportsDataPath, 'utf8')), []);
  assert.equal(fs.existsSync(path.join(context.fixture.root, templatePath)), false);
});

test('rejects a reportId that does not exist without mutation', async t=>{
  const context = deleteOptions(t);
  const before = fs.readFileSync(context.fixture.reportsDataPath, 'utf8');
  context.options.payload = {reportId:'missing-report'};
  await assert.rejects(()=>deleteReport(context.options), error=>error.code === 'REPORT_NOT_FOUND');
  assert.equal(fs.readFileSync(context.fixture.reportsDataPath, 'utf8'), before);
});

test('rejects path traversal from trusted JSON', async t=>{
  const context = deleteOptions(t, {reports:[report('delete-me', '../../outside.docx')]});
  await assert.rejects(()=>deleteReport(context.options), error=>error.code === 'UNSAFE_TEMPLATE_PATH');
});

test('retains a shared DOCX and removes only selected JSON record', async t=>{
  const sharedReports = [report(), report('keep-me', templatePath)];
  const context = deleteOptions(t, {reports:sharedReports, shared:true});
  const result = await deleteReport(context.options);
  assert.equal(result.docxDeleted, false);
  assert.equal(fs.existsSync(path.join(context.fixture.root, templatePath)), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(context.fixture.reportsDataPath, 'utf8')).map(item=>item.id), ['keep-me']);
});

test('blocks unrelated Git changes before touching JSON or DOCX', async t=>{
  const context = deleteOptions(t, {commands:{'git status':()=>({code:0, stdout:' M assets/js/unrelated.js\0', stderr:''})}});
  const before = fs.readFileSync(context.fixture.reportsDataPath, 'utf8');
  await assert.rejects(()=>deleteReport(context.options), error=>error.code === 'UNRELATED_CHANGES');
  assert.equal(fs.readFileSync(context.fixture.reportsDataPath, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(context.fixture.root, templatePath)), true);
});

test('blocks a branch other than main before mutation', async t=>{
  const context = deleteOptions(t, {commands:{'git branch':()=>({code:0, stdout:'feature/test\n', stderr:''})}});
  await assert.rejects(()=>deleteReport(context.options), error=>error.code === 'WRONG_BRANCH');
  assert.equal(fs.existsSync(path.join(context.fixture.root, templatePath)), true);
});

test('validation failure rolls back JSON and DOCX', async t=>{
  const context = deleteOptions(t, {options:{runReportCheck:async ()=>({ok:false, output:'broken'})}});
  const before = fs.readFileSync(context.fixture.reportsDataPath, 'utf8');
  await assert.rejects(()=>deleteReport(context.options), error=>error.code === 'REPORT_VALIDATION_FAILED');
  assert.equal(fs.readFileSync(context.fixture.reportsDataPath, 'utf8'), before);
  assert.equal(fs.readFileSync(path.join(context.fixture.root, templatePath), 'utf8'), `DOCX:${templatePath}`);
});

test('stages only manager JSON and deleted DOCX', async t=>{
  const context = deleteOptions(t);
  await deleteReport(context.options);
  const add = context.command.calls.find(call=>call.command === 'git' && call.args[0] === 'add');
  assert.deepEqual(add.args, ['add', '--', reportsPath, templatePath]);
});

test('shared template stages only manager JSON', async t=>{
  const context = deleteOptions(t, {reports:[report(), report('keep-me', templatePath)], shared:true});
  await deleteReport(context.options);
  const add = context.command.calls.find(call=>call.command === 'git' && call.args[0] === 'add');
  assert.deepEqual(add.args, ['add', '--', reportsPath]);
});

test('unsafe staged file aborts and rolls back local deletion', async t=>{
  const context = deleteOptions(t, {stagedFiles:[reportsPath, templatePath, 'assets/js/extra.js']});
  await assert.rejects(()=>deleteReport(context.options), error=>error.code === 'UNSAFE_STAGE');
  assert.equal(fs.existsSync(path.join(context.fixture.root, templatePath)), true);
  assert.equal(JSON.parse(fs.readFileSync(context.fixture.reportsDataPath, 'utf8')).length, 1);
  assert.equal(context.command.calls.some(call=>call.args[0] === 'commit'), false);
});

test('push failure prevents deploy after creating deletion commit', async t=>{
  const context = deleteOptions(t, {commands:{'git push':()=>({code:1, stdout:'', stderr:'push rejected'})}});
  await assert.rejects(()=>deleteReport(context.options), error=>error.code === 'PUSH_FAILED' && error.commitHash === 'delete123');
  assert.equal(context.command.calls.some(call=>call.command === 'mock-wrangler'), false);
});

test('deploy failure does not auto-revert committed deletion', async t=>{
  const context = deleteOptions(t, {commands:{deploy:()=>({code:1, stdout:'', stderr:'deploy failed'})}});
  await assert.rejects(()=>deleteReport(context.options), error=>error.code === 'DEPLOY_FAILED' && error.retryAvailable === true);
  assert.equal(context.command.calls.some(call=>['revert', 'reset'].includes(call.args[0])), false);
});

test('deploy retry makes no second delete, commit, or push', async t=>{
  const context = deleteOptions(t, {
    options:{
      mode:'deploy-only',
      prior:{reportId:'delete-me', title:'تقرير delete-me', templatePath, docxDeleted:true, commitHash:'delete123', pushSucceeded:true}
    }
  });
  fs.unlinkSync(path.join(context.fixture.root, templatePath));
  fs.writeFileSync(context.fixture.reportsDataPath, '[]\n');
  const result = await deleteReport(context.options);
  assert.equal(result.status, 'deleted');
  assert.equal(context.command.calls.some(call=>call.command === 'git' && ['add', 'commit', 'push'].includes(call.args[0])), false);
});

test('production verification requires report absence', async t=>{
  const context = deleteOptions(t, {network:{reportStillPresent:true}});
  await assert.rejects(()=>deleteReport(context.options), error=>error.code === 'VERIFY_FAILED' && error.verificationWarning === true);
});

test('production verification rejects an available deleted DOCX', async t=>{
  const context = deleteOptions(t, {network:{templateAvailable:true}});
  await assert.rejects(()=>deleteReport(context.options), error=>error.code === 'VERIFY_FAILED');
});

test('production verification requires a retained shared DOCX', async t=>{
  const context = deleteOptions(t, {
    reports:[report(), report('keep-me', templatePath)],
    shared:true,
    network:{templateAvailable:false}
  });
  await assert.rejects(()=>deleteReport(context.options), error=>error.code === 'VERIFY_FAILED');
});

test('delete payload rejects arbitrary client path and command', ()=>{
  assert.throws(()=>validateDeletePayload({reportId:'delete-me', path:'C:\\Windows', command:'git push'}), error=>error instanceof PublishError && error.code === 'UNSAFE_REQUEST');
});

test('delete endpoint keeps Host Origin and CSRF protection', ()=>{
  assert.throws(()=>ensureAllowedHost({headers:{host:'evil.example:4174'}}), /Host/);
  const request = {headers:{origin:'http://127.0.0.1:4174', 'x-report-manager':'local', 'x-report-manager-token':'token'}};
  assert.doesNotThrow(()=>ensureLocalPost(request, 'token'));
  assert.throws(()=>ensureLocalPost({...request, headers:{...request.headers, origin:'https://evil.example'}}, 'token'), /رفض الطلب/);
});

test('UI requires typed slug and does not delete on first button click', ()=>{
  const html = fs.readFileSync(path.join(repositoryRoot, 'tools/report-manager.html'), 'utf8');
  assert.match(html, /id="deleteSlugInput"/);
  assert.match(html, /id="confirmDelete"[^>]*disabled/);
  assert.match(html, /deleteSlugInput\.value !== currentDeleteReport\?\.id/);
  assert.match(html, /beginDelete\('\/api\/reports\/delete'\)/);
});

test('delete workflow exposes all seven required progress steps', ()=>{
  assert.deepEqual(DELETE_PROGRESS_STEPS.map(step=>step.id), ['git', 'mutation', 'validation', 'commit', 'push', 'deploy', 'verify']);
});

test('deploy retry state is recovered from a pushed deletion commit after restart', async t=>{
  const fixture = createFixture(t);
  const previousJson = fs.readFileSync(fixture.reportsDataPath, 'utf8');
  fs.writeFileSync(fixture.reportsDataPath, '[]\n');
  fs.unlinkSync(path.join(fixture.root, templatePath));
  const runCommand = async (command, args)=>{
    assert.equal(command, 'git');
    if(args[0] === 'branch') return {code:0, stdout:'main\n', stderr:''};
    if(args[0] === 'status' || args[0] === 'diff') return {code:0, stdout:'', stderr:''};
    if(args[0] === 'log') return {code:0, stdout:'Remove manager report: delete-me\n', stderr:''};
    if(args[0] === 'rev-parse') return {code:0, stdout:'delete123\n', stderr:''};
    if(args[0] === 'show') return {code:0, stdout:previousJson, stderr:''};
    if(args[0] === 'diff-tree') return {code:0, stdout:`M\t${reportsPath}\nD\t${templatePath}\n`, stderr:''};
    return {code:1, stdout:'', stderr:'unexpected'};
  };
  const recovered = await recoverDeleteRetry({...fixture, projectRoot:fixture.root, runCommand});
  assert.equal(recovered.state, 'ready');
  assert.equal(recovered.prior.reportId, 'delete-me');
  assert.equal(recovered.prior.docxDeleted, true);
});

test('restart recovery rejects an unpushed deletion commit', async t=>{
  const fixture = createFixture(t);
  fs.writeFileSync(fixture.reportsDataPath, '[]\n');
  fs.unlinkSync(path.join(fixture.root, templatePath));
  const runCommand = async (command, args)=>{
    if(args[0] === 'branch') return {code:0, stdout:'main\n', stderr:''};
    if(args[0] === 'status' || args[0] === 'diff') return {code:0, stdout:'', stderr:''};
    if(args[0] === 'log') return {code:0, stdout:'Remove manager report: delete-me\n', stderr:''};
    if(args[0] === 'rev-parse') return {code:0, stdout:args[1] === 'HEAD' ? 'local\n' : 'origin\n', stderr:''};
    return {code:1, stdout:'', stderr:'unexpected'};
  };
  const recovered = await recoverDeleteRetry({...fixture, projectRoot:fixture.root, runCommand});
  assert.equal(recovered.state, 'none');
});
