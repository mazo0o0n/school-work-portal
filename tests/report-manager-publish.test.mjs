import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  PublishError,
  publishReport,
  sanitizeOutput,
  validatePublishPayload,
  validateReportLibrary
} = require('../tools/report-publish-service.js');
const { ensureAllowedHost, ensureLocalPost } = require('../tools/report-manager-server.js');

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportsRelativePath = 'assets/data/manager-reports.json';
const templateRelativePath = 'assets/report-templates/manager-reports/test-report.docx';

function createFixture(t){
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'report-publish-test-'));
  const reportsDataPath = path.join(root, reportsRelativePath);
  const templatesDirectory = path.join(root, 'assets/report-templates/manager-reports');
  fs.mkdirSync(path.dirname(reportsDataPath), {recursive:true});
  fs.mkdirSync(templatesDirectory, {recursive:true});
  fs.writeFileSync(path.join(root, templateRelativePath), 'DOCX');
  fs.writeFileSync(reportsDataPath, JSON.stringify([{
    id:'test-report',
    title:'تقرير اختباري',
    category:'أخرى',
    status:'تجريبي',
    templatePath:templateRelativePath
  }]));
  t.after(()=>fs.rmSync(root, {recursive:true, force:true}));
  return {root, reportsDataPath, templatesDirectory};
}

function createRunner(overrides = {}){
  const calls = [];
  const runner = async (command, args)=>{
    calls.push({command, args:[...args]});
    const key = command === 'git' ? `git ${args[0]}` : 'deploy';
    if(overrides[key]) return overrides[key]({command, args, calls});
    if(key === 'git branch') return {code:0, stdout:'main\n', stderr:''};
    if(key === 'git status') return {code:0, stdout:` M ${reportsRelativePath}\0?? ${templateRelativePath}\0`, stderr:''};
    if(key === 'git diff') return {code:0, stdout:`${reportsRelativePath}\0${templateRelativePath}\0`, stderr:''};
    if(key === 'git rev-parse') return {code:0, stdout:'abc123def456\n', stderr:''};
    return {code:0, stdout:'', stderr:''};
  };
  return {calls, runner};
}

function createFetch(){
  const calls = [];
  const fetchImpl = async (url, options)=>{
    calls.push({url, options});
    if(url.includes('manager-reports.json')){
      return {
        ok:true,
        status:200,
        json:async ()=>[{id:'test-report', templatePath:templateRelativePath}]
      };
    }
    return {ok:true, status:200};
  };
  return {calls, fetchImpl};
}

function publishOptions(t, overrides = {}){
  const fixture = createFixture(t);
  const command = createRunner(overrides.commands);
  const network = createFetch();
  return {
    options:{
      projectRoot:fixture.root,
      reportsDataPath:fixture.reportsDataPath,
      templatesDirectory:fixture.templatesDirectory,
      payload:{reportId:'test-report'},
      runReportCheck:async ()=>({ok:true, output:'PASS'}),
      runCommand:command.runner,
      fetchImpl:network.fetchImpl,
      deployInvocation:{command:'mock-wrangler', args:['deploy']},
      ...overrides.options
    },
    command,
    network,
    fixture
  };
}

test('publish UI is disabled and hidden before a successful add', async ()=>{
  const html = await readFile(path.join(projectRoot, 'tools/report-manager.html'), 'utf8');
  assert.match(html, /id="publishSection"[^>]*hidden/);
  assert.match(html, /id="publishButton"[^>]*disabled/);
});

test('report validation failure prevents every Git command', async t=>{
  const context = publishOptions(t, {options:{runReportCheck:async ()=>({ok:false, output:'invalid report'})}});
  await assert.rejects(()=>publishReport(context.options), error=>error.code === 'REPORT_VALIDATION_FAILED');
  assert.equal(context.command.calls.length, 0);
});

test('unrelated modified file blocks publishing and lists only its path', async t=>{
  const context = publishOptions(t, {commands:{
    'git status':()=>({code:0, stdout:` M ${reportsRelativePath}\0?? ${templateRelativePath}\0 M assets/js/index.js\0`, stderr:''})
  }});
  await assert.rejects(()=>publishReport(context.options), error=>{
    assert.equal(error.code, 'UNRELATED_CHANGES');
    assert.deepEqual(error.details, ['assets/js/index.js']);
    return true;
  });
  assert.equal(context.command.calls.some(call=>call.args[0] === 'add'), false);
});

test('a branch other than main blocks publishing', async t=>{
  const context = publishOptions(t, {commands:{
    'git branch':()=>({code:0, stdout:'feature/test\n', stderr:''})
  }});
  await assert.rejects(()=>publishReport(context.options), error=>error.code === 'WRONG_BRANCH');
  assert.equal(context.command.calls.some(call=>call.args[0] === 'add'), false);
});

test('Git allowlist never uses git add dot or add all', async t=>{
  const context = publishOptions(t);
  await publishReport(context.options);
  const addCall = context.command.calls.find(call=>call.command === 'git' && call.args[0] === 'add');
  assert.ok(addCall);
  assert.equal(addCall.args.includes('.'), false);
  assert.equal(addCall.args.includes('-A'), false);
});

test('stage contains only manager JSON and the current report DOCX', async t=>{
  const context = publishOptions(t);
  await publishReport(context.options);
  const addCall = context.command.calls.find(call=>call.command === 'git' && call.args[0] === 'add');
  assert.deepEqual(addCall.args, ['add', '--', reportsRelativePath, templateRelativePath]);
});

test('unexpected staged file stops publishing and unstages only allowlisted paths', async t=>{
  const context = publishOptions(t, {commands:{
    'git diff':()=>({code:0, stdout:`${reportsRelativePath}\0${templateRelativePath}\0assets/js/extra.js\0`, stderr:''})
  }});
  await assert.rejects(()=>publishReport(context.options), error=>error.code === 'UNSAFE_STAGE');
  const restoreCall = context.command.calls.find(call=>call.command === 'git' && call.args[0] === 'restore');
  assert.deepEqual(restoreCall.args, ['restore', '--staged', '--', reportsRelativePath, templateRelativePath]);
  assert.equal(context.command.calls.some(call=>call.args[0] === 'commit'), false);
});

test('push failure prevents deploy after creating a local commit', async t=>{
  const context = publishOptions(t, {commands:{
    'git push':()=>({code:1, stdout:'', stderr:'push rejected'})
  }});
  await assert.rejects(()=>publishReport(context.options), error=>{
    assert.equal(error.code, 'PUSH_FAILED');
    assert.equal(error.commitHash, 'abc123def456');
    return true;
  });
  assert.equal(context.command.calls.some(call=>call.command === 'mock-wrangler'), false);
});

test('deploy failure enables retry and never runs an automatic revert', async t=>{
  const context = publishOptions(t, {commands:{
    deploy:()=>({code:1, stdout:'', stderr:'deployment failed'})
  }});
  await assert.rejects(()=>publishReport(context.options), error=>{
    assert.equal(error.code, 'DEPLOY_FAILED');
    assert.equal(error.retryAvailable, true);
    assert.equal(error.pushSucceeded, true);
    return true;
  });
  assert.equal(context.command.calls.some(call=>['revert', 'reset'].includes(call.args[0])), false);
});

test('successful deploy verifies production JSON and DOCX', async t=>{
  const context = publishOptions(t);
  const result = await publishReport(context.options);
  assert.equal(result.status, 'published');
  assert.equal(context.network.calls.length, 2);
  assert.match(context.network.calls[0].url, /manager-reports\.json/);
  assert.match(context.network.calls[1].url, /test-report\.docx/);
});

test('client cannot submit arbitrary commands or paths', ()=>{
  assert.throws(
    ()=>validatePublishPayload({reportId:'test-report', command:'git push', path:'C:\\Windows'}),
    error=>error instanceof PublishError && error.code === 'UNSAFE_REQUEST'
  );
});

test('invalid report slug is rejected', ()=>{
  assert.throws(
    ()=>validatePublishPayload({reportId:'../unsafe'}),
    error=>error instanceof PublishError && error.code === 'INVALID_REPORT_ID'
  );
});

test('Host, Origin, and per-process token protections reject unsafe requests', ()=>{
  assert.throws(()=>ensureAllowedHost({headers:{host:'evil.example:4174'}}), /Host/);
  assert.doesNotThrow(()=>ensureAllowedHost({headers:{host:'127.0.0.1:4174'}}));
  const safeRequest = {headers:{
    origin:'http://127.0.0.1:4174',
    'x-report-manager':'local',
    'x-report-manager-token':'test-token'
  }};
  assert.doesNotThrow(()=>ensureLocalPost(safeRequest, 'test-token'));
  assert.doesNotThrow(()=>ensureLocalPost({headers:{...safeRequest.headers, origin:'http://localhost:4174'}}, 'test-token'));
  assert.throws(()=>ensureLocalPost(safeRequest, 'different-token'), /رمز حماية/);
  assert.throws(()=>ensureLocalPost({headers:{...safeRequest.headers, origin:'https://evil.example'}}, 'test-token'), /رفض الطلب/);
});

test('command output is redacted before it can reach the API response', ()=>{
  const output = sanitizeOutput('Authorization: top-secret token=my-token api_key=abc123 https://user:password@example.com');
  assert.doesNotMatch(output, /top-secret|my-token|abc123|password/);
  assert.match(output, /\[REDACTED\]/);
});

test('retry deploy runs deploy and verification without a new commit or push', async t=>{
  const context = publishOptions(t, {
    commands:{'git status':()=>({code:0, stdout:'', stderr:''})},
    options:{
      mode:'deploy-only',
      prior:{commitHash:'abc123def456', pushSucceeded:true}
    }
  });
  const result = await publishReport(context.options);
  assert.equal(result.status, 'published');
  assert.equal(context.command.calls.some(call=>call.command === 'git' && ['add', 'commit', 'push'].includes(call.args[0])), false);
  assert.equal(context.command.calls.filter(call=>call.command === 'mock-wrangler').length, 1);
});

test('retry deploy stops if HEAD no longer matches the pushed commit', async t=>{
  const context = publishOptions(t, {
    commands:{
      'git rev-parse':()=>({code:0, stdout:'different-head\n', stderr:''}),
      'git status':()=>({code:0, stdout:'', stderr:''})
    },
    options:{mode:'deploy-only', prior:{commitHash:'abc123def456', pushSucceeded:true}}
  });
  await assert.rejects(()=>publishReport(context.options), error=>error.code === 'UNSAFE_DEPLOY_RETRY');
  assert.equal(context.command.calls.some(call=>call.command === 'mock-wrangler'), false);
});

test('orphan DOCX template fails library validation', t=>{
  const context = publishOptions(t);
  fs.writeFileSync(path.join(context.fixture.templatesDirectory, 'orphan.docx'), 'DOCX');
  assert.throws(()=>validateReportLibrary({
    projectRoot:context.fixture.root,
    reportsDataPath:context.fixture.reportsDataPath,
    templatesDirectory:context.fixture.templatesDirectory
  }), error=>{
    assert.equal(error.code, 'REPORT_VALIDATION_FAILED');
    assert.equal(error.details.some(detail=>detail.includes('orphan.docx')), true);
    return true;
  });
});
