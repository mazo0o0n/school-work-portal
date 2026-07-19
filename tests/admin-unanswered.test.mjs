import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workerSource = await readFile(new globalThis.URL('../src/index.js', import.meta.url), 'utf8');
const securityModuleUrl = new globalThis.URL('../src/chat-security.mjs', import.meta.url).href;
const loadableWorkerSource = workerSource.replace(
  "'./chat-security.mjs'",
  JSON.stringify(securityModuleUrl)
);
const workerModuleUrl = `data:text/javascript;base64,${Buffer.from(loadableWorkerSource).toString('base64')}`;
const { default: worker } = await import(workerModuleUrl);

const ADMIN_URL = 'https://example.test/api/admin/unanswered';
const ADMIN_TOKEN = 'test-admin-token';

function createAdminRequest(query = ''){
  return new globalThis.Request(`${ADMIN_URL}${query}`, {
    headers: { 'X-Admin-Token': ADMIN_TOKEN }
  });
}

function createAdminDb({ count = 3, items = [] } = {}){
  const statements = [];
  return {
    statements,
    binding: {
      prepare(sql){
        const statement = { sql, values: [] };
        statements.push(statement);
        return {
          bind(...values){
            statement.values = values;
            return {
              async first(){
                return { count };
              },
              async all(){
                return { results: items };
              }
            };
          }
        };
      }
    }
  };
}

function createItem(id, updatedAt, repeatCount = 1){
  return {
    id,
    question: `سؤال ${id}`,
    reason: 'no_matches',
    page_path: '/index.html',
    source: 'unanswered_auto',
    status: 'new',
    repeat_count: repeatCount,
    created_at: updatedAt,
    updated_at: updatedAt
  };
}

async function fetchAdmin(request, database){
  const response = await worker.fetch(request, {
    ADMIN_API_TOKEN: ADMIN_TOKEN,
    UNANSWERED_DB: database.binding
  });
  return { response, body: await response.json() };
}

test('rejects invalid admin tokens without querying D1', async () => {
  const database = createAdminDb();
  const request = new globalThis.Request(ADMIN_URL, {
    headers: { 'X-Admin-Token': 'invalid-admin-token' }
  });
  const { response, body } = await fetchAdmin(request, database);

  assert.equal(response.status, 403);
  assert.equal(body.error, 'Forbidden');
  assert.equal(database.statements.length, 0);
});

test('paginates unanswered questions with a stable keyset cursor', async () => {
  const database = createAdminDb({
    count: 3,
    items: [
      createItem(3, '2026-07-19T12:00:00.000Z'),
      createItem(2, '2026-07-19T11:00:00.000Z'),
      createItem(1, '2026-07-19T10:00:00.000Z')
    ]
  });
  const firstPage = await fetchAdmin(createAdminRequest('?status=new&limit=2'), database);

  assert.equal(firstPage.response.status, 200);
  assert.equal(firstPage.body.total_new, 3);
  assert.equal(firstPage.body.total, 3);
  assert.equal(firstPage.body.items.length, 2);
  assert.equal(firstPage.body.pagination.limit, 2);
  assert.equal(firstPage.body.pagination.has_more, true);
  assert.ok(firstPage.body.pagination.next_cursor);

  const listStatement = database.statements.find((statement) =>
    statement.sql.includes('SELECT id, question')
  );
  assert.match(listStatement.sql, /ORDER BY updated_at DESC, id DESC/);
  assert.equal(listStatement.values.at(-1), 3);

  const nextDatabase = createAdminDb({
    count: 3,
    items: [createItem(1, '2026-07-19T10:00:00.000Z')]
  });
  const secondPage = await fetchAdmin(createAdminRequest(
    `?status=new&limit=2&cursor=${encodeURIComponent(firstPage.body.pagination.next_cursor)}`
  ), nextDatabase);
  const nextListStatement = nextDatabase.statements.find((statement) =>
    statement.sql.includes('SELECT id, question')
  );

  assert.equal(secondPage.response.status, 200);
  assert.match(nextListStatement.sql, /updated_at < \?\d+/);
  assert.match(nextListStatement.sql, /id < \?\d+/);
  assert.equal(secondPage.body.pagination.has_more, false);
});

test('caps page size and rejects invalid cursors', async () => {
  const database = createAdminDb();
  const capped = await fetchAdmin(createAdminRequest('?status=new&limit=500'), database);
  const listStatement = database.statements.find((statement) =>
    statement.sql.includes('SELECT id, question')
  );

  assert.equal(capped.response.status, 200);
  assert.equal(capped.body.pagination.limit, 50);
  assert.equal(listStatement.values.at(-1), 51);

  const invalid = await fetchAdmin(
    createAdminRequest('?status=new&cursor=not-a-valid-cursor'),
    createAdminDb()
  );
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error, 'Invalid cursor');
});

test('keeps the existing unanswered list response fields', async () => {
  const database = createAdminDb({
    count: 1,
    items: [createItem(1, '2026-07-19T10:00:00.000Z')]
  });
  const { body } = await fetchAdmin(createAdminRequest(), database);

  assert.equal(body.total_new, 1);
  assert.equal(body.items.length, 1);
  assert.ok(body.pagination);
});

test('prepares archive support without applying or deleting data', async () => {
  const migration = await readFile(
    new globalThis.URL('../migrations/0002_unanswered_questions_archive.sql', import.meta.url),
    'utf8'
  );

  assert.match(migration, /ADD COLUMN archived_at TEXT/);
  assert.match(migration, /status,\s*updated_at DESC,\s*id DESC/);
  assert.doesNotMatch(migration, /^\s*DELETE\b/im);
});
