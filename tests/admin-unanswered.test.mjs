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
const wranglerSource = await readFile(
  new globalThis.URL('../wrangler.toml', import.meta.url),
  'utf8'
);

const ADMIN_URL = 'https://example.test/api/admin/unanswered';
const ADMIN_TOKEN = 'test-admin-token';
const ADMIN_PATCH_MAX_REQUEST_BYTES = 4 * 1024;

function getAdminRateLimitConfig(){
  const block = wranglerSource
    .split('[[ratelimits]]')
    .slice(1)
    .find((candidate) =>
      /^\s*name\s*=\s*"ADMIN_AUTH_RATE_LIMITER"\s*$/m.test(candidate)
    );

  assert.ok(block, 'Missing ADMIN_AUTH_RATE_LIMITER binding');

  return {
    limit: Number(block.match(/^\s*limit\s*=\s*(\d+)\s*$/m)?.[1]),
    period: Number(block.match(/^\s*period\s*=\s*(\d+)\s*$/m)?.[1])
  };
}

function createAdminRequest(query = ''){
  return new globalThis.Request(`${ADMIN_URL}${query}`, {
    headers: { 'X-Admin-Token': ADMIN_TOKEN }
  });
}

function createAdminPatchRequest(body, contentType = 'application/json'){
  return new globalThis.Request(`${ADMIN_URL}/7`, {
    method: 'PATCH',
    headers: {
      'Content-Type': contentType,
      'X-Admin-Token': ADMIN_TOKEN
    },
    body: typeof body === 'string' ? body : JSON.stringify(body)
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
              },
              async run(){
                return { meta: { changes: 1 } };
              }
            };
          }
        };
      }
    }
  };
}

function createRateLimiter(allowedRequests){
  const keys = [];
  return {
    keys,
    binding: {
      async limit({ key }){
        keys.push(key);
        return { success: keys.length <= allowedRequests };
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

async function fetchAdmin(request, database, extraEnv = {}){
  const response = await worker.fetch(request, {
    ADMIN_API_TOKEN: ADMIN_TOKEN,
    UNANSWERED_DB: database.binding,
    ...extraEnv
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

test('rate limits invalid admin tokens after 5 attempts without exposing identifiers', async () => {
  const adminConfig = getAdminRateLimitConfig();
  assert.deepEqual(adminConfig, { limit: 5, period: 60 });

  const database = createAdminDb();
  const limiter = createRateLimiter(adminConfig.limit);
  const extraEnv = {
    ADMIN_AUTH_RATE_LIMITER: limiter.binding,
    RATE_LIMIT_SALT: 'test-only-rate-limit-salt'
  };
  const requestOptions = {
    headers: {
      'X-Admin-Token': 'invalid-admin-token',
      'CF-Connecting-IP': '203.0.113.20'
    }
  };

  for(let attempt = 0; attempt < adminConfig.limit; attempt += 1){
    const allowed = await fetchAdmin(
      new globalThis.Request(ADMIN_URL, requestOptions),
      database,
      extraEnv
    );
    assert.equal(allowed.response.status, 403);
  }

  const blocked = await fetchAdmin(
    new globalThis.Request(ADMIN_URL, requestOptions),
    database,
    extraEnv
  );

  assert.equal(blocked.response.status, 429);
  assert.equal(blocked.response.headers.get('Retry-After'), String(adminConfig.period));
  assert.equal(blocked.response.headers.get('Cache-Control'), 'no-store');
  assert.equal(blocked.body.code, 'rate_limited');
  assert.doesNotMatch(JSON.stringify(blocked.body), /203\.0\.113\.20|invalid-admin-token|test-only-rate-limit-salt/);
  assert.equal(database.statements.length, 0);
  assert.equal(limiter.keys.length, adminConfig.limit + 1);
  assert.ok(limiter.keys.every((key) => /^[a-f0-9]{64}$/.test(key)));
  assert.ok(limiter.keys.every((key) => !key.includes('203.0.113.20')));

  const validRequest = new globalThis.Request(ADMIN_URL, {
    headers: {
      'X-Admin-Token': ADMIN_TOKEN,
      'CF-Connecting-IP': '203.0.113.20'
    }
  });
  const valid = await fetchAdmin(validRequest, createAdminDb(), extraEnv);
  assert.equal(valid.response.status, 200);
  assert.equal(limiter.keys.length, adminConfig.limit + 1);
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

test('prevents caching of successful and rejected admin responses', async () => {
  const successful = await fetchAdmin(createAdminRequest(), createAdminDb());
  const rejected = await fetchAdmin(
    new globalThis.Request(ADMIN_URL, {
      headers: { 'X-Admin-Token': 'invalid-admin-token' }
    }),
    createAdminDb()
  );

  for(const result of [successful, rejected]){
    assert.equal(result.response.headers.get('Cache-Control'), 'no-store');
    assert.equal(result.response.headers.get('Pragma'), 'no-cache');
    assert.equal(result.response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.match(result.response.headers.get('Content-Type'), /^application\/json/);
  }
});

test('rejects admin PATCH requests with an unsupported content type', async () => {
  const database = createAdminDb();
  const { response, body } = await fetchAdmin(
    createAdminPatchRequest({ status: 'reviewed' }, 'text/plain'),
    database
  );

  assert.equal(response.status, 415);
  assert.equal(body.error, 'Unsupported content type');
  assert.equal(database.statements.length, 0);
});

test('returns the unified 400 response for invalid admin PATCH JSON', async () => {
  const database = createAdminDb();
  const { response, body } = await fetchAdmin(
    createAdminPatchRequest('{'),
    database
  );

  assert.equal(response.status, 400);
  assert.deepEqual(body, { error: 'Invalid JSON' });
  assert.equal(database.statements.length, 0);
});

test('rejects admin PATCH bodies larger than the limit', async () => {
  const database = createAdminDb();
  const oversizedBody = JSON.stringify({
    status: 'reviewed',
    padding: 'x'.repeat(ADMIN_PATCH_MAX_REQUEST_BYTES)
  });
  const { response, body } = await fetchAdmin(
    createAdminPatchRequest(oversizedBody),
    database
  );

  assert.equal(response.status, 413);
  assert.equal(body.error, 'Request too large');
  assert.equal(database.statements.length, 0);
});

test('keeps valid JSON PATCH and DELETE admin requests working', async () => {
  const patchDatabase = createAdminDb();
  const patchResponse = await worker.fetch(
    createAdminPatchRequest({ status: 'reviewed' }),
    {
      ADMIN_API_TOKEN: ADMIN_TOKEN,
      UNANSWERED_DB: patchDatabase.binding
    }
  );
  const patchBody = await patchResponse.json();

  assert.equal(patchResponse.status, 200);
  assert.equal(patchBody.ok, true);
  assert.equal(patchBody.changed, 1);
  assert.match(patchDatabase.statements[0].sql, /^UPDATE unanswered_questions/);

  const deleteDatabase = createAdminDb();
  const deleteResponse = await worker.fetch(
    new globalThis.Request(`${ADMIN_URL}/7`, {
      method: 'DELETE',
      headers: { 'X-Admin-Token': ADMIN_TOKEN }
    }),
    {
      ADMIN_API_TOKEN: ADMIN_TOKEN,
      UNANSWERED_DB: deleteDatabase.binding
    }
  );
  const deleteBody = await deleteResponse.json();

  assert.equal(deleteResponse.status, 200);
  assert.equal(deleteBody.ok, true);
  assert.equal(deleteBody.deleted, 1);
  assert.match(deleteDatabase.statements[0].sql, /^DELETE FROM unanswered_questions/);
});

test('adds no-cache and no-index headers to internal admin pages', async () => {
  const response = await worker.fetch(
    new globalThis.Request('https://example.test/admin-unanswered.html'),
    {
      ASSETS: {
        async fetch(){
          return new globalThis.Response('<!doctype html>', {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }
      }
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');

  const staticHeaders = await readFile(
    new globalThis.URL('../_headers', import.meta.url),
    'utf8'
  );
  const pageNames = [
    'admin-unanswered.html',
    'assistant-status.html',
    'knowledge-status.html',
    'assistant-test.html'
  ];

  for(const pageName of pageNames){
    const pageBlock = staticHeaders
      .split(`/${pageName}`)[1]
      ?.split(/\r?\n(?=\/)/, 1)[0] || '';
    assert.match(pageBlock, /Cache-Control: no-store/);
    assert.match(pageBlock, /Pragma: no-cache/);
    assert.match(pageBlock, /X-Robots-Tag: noindex, nofollow/);

    const html = await readFile(
      new globalThis.URL(`../${pageName}`, import.meta.url),
      'utf8'
    );
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(html, /<meta name="referrer" content="no-referrer">/);
  }
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
import { URL } from 'node:url';

const { test: headerRegressionTest } = await import('node:test');
const { default: headerAssert } = await import('node:assert/strict');
const { readFile: readHeaderRules } = await import('node:fs/promises');

headerRegressionTest(
  'static asset headers protect html redirects and final clean internal routes',
  async () => {
    const headersText = await readHeaderRules(
      new URL('../_headers', import.meta.url),
      'utf8'
    );
    const internalPages = [
      '/admin-unanswered',
      '/assistant-status',
      '/knowledge-status',
      '/assistant-test'
    ];

    const getExactRouteBlock = (route) => {
      const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return headersText.match(
        new RegExp(`^${escapedRoute}\\r?\\n((?: {2}[^\\r\\n]+\\r?\\n?)+)`, 'm')
      )?.[1] || '';
    };

    internalPages.forEach((cleanRoute) => {
      const htmlBlock = getExactRouteBlock(`${cleanRoute}.html`);
      const cleanBlock = getExactRouteBlock(cleanRoute);

      [htmlBlock, cleanBlock].forEach((routeBlock) => {
        headerAssert.match(routeBlock, /Cache-Control: no-store(?:,|$)/);
        headerAssert.match(routeBlock, /Pragma: no-cache/);
        headerAssert.match(routeBlock, /X-Robots-Tag: noindex(?:,|$)/);
      });
    });

    const publicControlBlock = getExactRouteBlock('/index.html');
    headerAssert.doesNotMatch(publicControlBlock, /Cache-Control:.*no-store/i);
    headerAssert.doesNotMatch(publicControlBlock, /X-Robots-Tag:.*noindex/i);
  }
);
