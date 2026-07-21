import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
const baseWorkerModule = `data:text/javascript;base64,${Buffer.from(`
  export default {
    async fetch(){
      return new Response('delegated', { status: 202 });
    }
  };
`).toString('base64')}`;
const loadableSource = source.replace("'./index.js'", JSON.stringify(baseWorkerModule));
const workerModule = `data:text/javascript;base64,${Buffer.from(loadableSource).toString('base64')}`;
const { default: worker } = await import(workerModule);

const TOKEN = 'test-admin-token';
const BASE_URL = 'https://example.test';

function createDatabase(){
  const statements = [];
  const schools = [
    {
      id: 2,
      public_id: 'school_two',
      school_name: 'مدرسة الاختبار الثانية',
      school_stage: 'متوسطة',
      education_department: 'الإدارة العامة للتعليم بمنطقة المدينة المنورة',
      verification_status: 'verified',
      created_at: '2026-07-21 15:09:26',
      updated_at: '2026-07-21 15:09:26'
    },
    {
      id: 1,
      public_id: 'school_one',
      school_name: 'مدرسة الاختبار الأولى',
      school_stage: 'ابتدائية',
      education_department: 'الإدارة العامة للتعليم بمنطقة المدينة المنورة',
      verification_status: 'unverified',
      created_at: '2026-07-21 15:06:50',
      updated_at: '2026-07-21 15:06:50'
    }
  ];

  function execute(sql, values, method){
    if(method === 'first' && sql.includes('COUNT(*) AS count')){
      return { count: schools.length };
    }
    if(method === 'all' && sql.includes('FROM schools')){
      return { results: schools };
    }
    if(method === 'run' && sql.startsWith('UPDATE schools')){
      return { meta: { changes: 1 } };
    }
    if(method === 'run' && sql.startsWith('DELETE FROM schools')){
      return { meta: { changes: 1 } };
    }
    return method === 'all' ? { results: [] } : { meta: { changes: 0 } };
  }

  const binding = {
    statements,
    prepare(sql){
      const record = { sql, values: [] };
      statements.push(record);
      return {
        bind(...values){
          record.values = values;
          return {
            first: async () => execute(sql, values, 'first'),
            all: async () => execute(sql, values, 'all'),
            run: async () => execute(sql, values, 'run')
          };
        },
        all: async () => {
          if(sql.includes('verification_status AS status')){
            return {
              results: [
                { status: 'unverified', count: 1 },
                { status: 'verified', count: 1 }
              ]
            };
          }
          if(sql.includes('school_stage AS stage')){
            return {
              results: [
                { stage: 'ابتدائية', count: 1 },
                { stage: 'متوسطة', count: 1 }
              ]
            };
          }
          return { results: [] };
        }
      };
    },
    async batch(preparedStatements){
      return Promise.all(preparedStatements.map((statement) => statement.all()));
    }
  };

  return { binding, statements };
}

function createEnv(database = createDatabase().binding){
  return {
    ADMIN_API_TOKEN: TOKEN,
    PLATFORM_DB: database,
    RATE_LIMIT_SALT: 'test-rate-limit-salt',
    ASSETS: {
      async fetch(){
        return new Response('<!doctype html><title>schools</title>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
    }
  };
}

function adminRequest(path, options = {}){
  return new Request(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'X-Admin-Token': TOKEN,
      ...(options.headers || {})
    }
  });
}

test('rejects invalid admin tokens before querying the schools database', async () => {
  const database = createDatabase();
  const response = await worker.fetch(new Request(`${BASE_URL}/api/admin/schools`, {
    headers: { 'X-Admin-Token': 'wrong-token' }
  }), createEnv(database.binding));

  assert.equal(response.status, 403);
  assert.equal(database.statements.length, 0);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('returns school summaries without exposing edit token hashes', async () => {
  const response = await worker.fetch(
    adminRequest('/api/admin/schools?summary=1'),
    createEnv()
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.status_counts, {
    all: 2,
    unverified: 1,
    pending: 0,
    verified: 1,
    suspended: 0
  });
  assert.equal(body.stage_counts['ابتدائية'], 1);
  assert.doesNotMatch(JSON.stringify(body), /edit_token|hash/i);
});

test('lists schools with filters, sorting, and pagination metadata', async () => {
  const database = createDatabase();
  const response = await worker.fetch(
    adminRequest('/api/admin/schools?status=verified&stage=متوسطة&q=اختبار&sort=name&page=1&limit=25'),
    createEnv(database.binding)
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.total, 2);
  assert.equal(body.items.length, 2);
  assert.equal(body.pagination.page, 1);
  assert.equal(body.pagination.limit, 25);
  assert.doesNotMatch(JSON.stringify(body), /edit_token_hash/);

  const listStatement = database.statements.find((item) => item.sql.includes('SELECT id, public_id'));
  assert.ok(listStatement);
  assert.match(listStatement.sql, /ORDER BY school_name COLLATE NOCASE ASC, id ASC/);
  assert.ok(listStatement.values.includes('verified'));
  assert.ok(listStatement.values.includes('متوسطة'));
  assert.ok(listStatement.values.includes('اختبار'));
});

test('updates verification status and deletes a school', async () => {
  const database = createDatabase();
  const patchResponse = await worker.fetch(adminRequest('/api/admin/schools/2', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verificationStatus: 'suspended' })
  }), createEnv(database.binding));
  const patchBody = await patchResponse.json();

  assert.equal(patchResponse.status, 200);
  assert.equal(patchBody.verification_status, 'suspended');
  const updateStatement = database.statements.find((item) => item.sql.startsWith('UPDATE schools'));
  assert.deepEqual(updateStatement.values, ['suspended', 2]);

  const deleteResponse = await worker.fetch(adminRequest('/api/admin/schools/2', {
    method: 'DELETE'
  }), createEnv(database.binding));
  const deleteBody = await deleteResponse.json();
  assert.equal(deleteResponse.status, 200);
  assert.equal(deleteBody.deleted, 1);
});

test('protects the admin page from caching and indexing', async () => {
  const response = await worker.fetch(
    new Request(`${BASE_URL}/admin-schools.html`),
    createEnv()
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
});

test('delegates unrelated requests to the existing worker', async () => {
  const response = await worker.fetch(new Request(`${BASE_URL}/index.html`), createEnv());
  assert.equal(response.status, 202);
  assert.equal(await response.text(), 'delegated');
});
