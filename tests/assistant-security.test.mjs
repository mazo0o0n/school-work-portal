import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CHAT_FALLBACK_ANSWER,
  MAX_CHAT_QUESTION_CHARS,
  MAX_CHAT_REQUEST_BYTES,
  sanitizeQuestionForStorage
} from '../src/chat-security.mjs';

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

const CHAT_URL = 'https://example.test/api/chat';

function getRateLimitConfig(name) {
  const block = wranglerSource
    .split('[[ratelimits]]')
    .slice(1)
    .find((candidate) => new RegExp(`^\\s*name\\s*=\\s*"${name}"\\s*$`, 'm').test(candidate));

  assert.ok(block, `Missing ${name} rate limiting binding`);

  const namespaceId = block.match(/^\s*namespace_id\s*=\s*"(\d+)"\s*$/m)?.[1];
  const limit = Number(block.match(/^\s*limit\s*=\s*(\d+)\s*$/m)?.[1]);
  const period = Number(block.match(/^\s*period\s*=\s*(\d+)\s*$/m)?.[1]);

  assert.match(namespaceId || '', /^\d+$/);
  assert.ok(Number(namespaceId) > 0);
  assert.ok(Number.isInteger(limit) && limit > 0);
  assert.ok([10, 60].includes(period));

  return { namespaceId, limit, period };
}

function jsonRequest(payload, headers = {}) {
  return new globalThis.Request(CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(payload)
  });
}

function createRagEnv({ matches, answer = 'إجابة موثوقة من معرفة المنصة.' } = {}) {
  const embeddingInputs = [];
  const vectorMatches = matches ?? [{
    id: 'known-1',
    score: 0.92,
    metadata: {
      text: 'برنامج فرص برنامج تعليمي موثق في ملفات المنصة.',
      source: 'ملف معرفة معتمد',
      section: 'برنامج فرص'
    }
  }];

  return {
    embeddingInputs,
    env: {
      AI: {
        async run(_model, payload) {
          if(typeof payload.text === 'string') {
            embeddingInputs.push(payload.text);
            return { data: [[0.1, 0.2, 0.3]] };
          }
          return { response: answer };
        }
      },
      VECTORIZE: {
        async query() {
          return { matches: vectorMatches };
        }
      }
    }
  };
}

function createDbRecorder() {
  const statements = [];
  return {
    statements,
    binding: {
      prepare(sql) {
        const statement = { sql, values: [] };
        statements.push(statement);
        return {
          bind(...values) {
            statement.values = values;
            return {
              async first() {
                return null;
              },
              async run() {
                return { meta: { changes: 1 } };
              }
            };
          }
        };
      }
    }
  };
}

function createRateLimiter(allowedRequests) {
  const keys = [];
  return {
    keys,
    binding: {
      async limit({ key }) {
        keys.push(key);
        return { success: keys.length <= allowedRequests };
      }
    }
  };
}

async function responseJson(request, env = {}) {
  const response = await worker.fetch(request, env);
  return {
    response,
    body: await response.json()
  };
}

test('fails open locally without rate limiting bindings or salt', async () => {
  const { env } = createRagEnv();
  const { response, body } = await responseJson(
    jsonRequest({ question: 'ما برنامج فرص؟' }),
    env
  );

  assert.equal(response.status, 200);
  assert.equal(body.notFound, false);
  assert.equal(body.answer, 'إجابة موثوقة من معرفة المنصة.');
});

test('configures separate chat and admin rate limiting bindings without a public salt', async () => {
  const chatConfig = getRateLimitConfig('CHAT_RATE_LIMITER');
  const adminConfig = getRateLimitConfig('ADMIN_AUTH_RATE_LIMITER');

  assert.deepEqual(
    { limit: chatConfig.limit, period: chatConfig.period },
    { limit: 20, period: 60 }
  );
  assert.deepEqual(
    { limit: adminConfig.limit, period: adminConfig.period },
    { limit: 5, period: 60 }
  );
  assert.notEqual(chatConfig.namespaceId, adminConfig.namespaceId);
  assert.match(wranglerSource, /^\s*\[secrets\]\s*$/m);
  assert.match(wranglerSource, /^\s*required\s*=\s*\[\s*"RATE_LIMIT_SALT"\s*\]\s*$/m);

  const varsBlock = wranglerSource.match(/^\s*\[vars\]\s*$([\s\S]*?)(?=^\s*\[|\s*$)/m)?.[1] || '';
  assert.doesNotMatch(varsBlock, /RATE_LIMIT_SALT/);

  const publicPaths = execFileSync(
    'git',
    ['ls-files', '-z', '--', '*.html', 'assets/**'],
    { encoding: 'utf8' }
  )
    .split('\0')
    .filter(Boolean);

  for(const publicPath of publicPaths) {
    const publicSource = await readFile(
      new globalThis.URL(`../${publicPath.replaceAll('\\', '/')}`, import.meta.url),
      'utf8'
    );
    assert.doesNotMatch(publicSource, /RATE_LIMIT_SALT/, publicPath);
  }
});

test('allows normal chat use with a privacy-preserving client key', async () => {
  const { env } = createRagEnv();
  const limiter = createRateLimiter(20);
  env.CHAT_RATE_LIMITER = limiter.binding;
  env.RATE_LIMIT_SALT = 'test-only-rate-limit-salt';

  const { response, body } = await responseJson(
    jsonRequest(
      { question: 'ما برنامج فرص؟' },
      { 'CF-Connecting-IP': '203.0.113.10' }
    ),
    env
  );

  assert.equal(response.status, 200);
  assert.equal(body.notFound, false);
  assert.equal(limiter.keys.length, 1);
  assert.match(limiter.keys[0], /^[a-f0-9]{64}$/);
  assert.doesNotMatch(limiter.keys[0], /203\.0\.113\.10/);
});

test('returns a private 429 chat response after 20 requests per minute', async () => {
  const chatConfig = getRateLimitConfig('CHAT_RATE_LIMITER');
  const { env } = createRagEnv();
  const limiter = createRateLimiter(chatConfig.limit);
  env.CHAT_RATE_LIMITER = limiter.binding;
  env.RATE_LIMIT_SALT = 'test-only-rate-limit-salt';
  const headers = { 'CF-Connecting-IP': '203.0.113.11' };

  for(let attempt = 0; attempt < chatConfig.limit; attempt += 1) {
    const allowed = await responseJson(
      jsonRequest({ question: 'ما برنامج فرص؟' }, headers),
      env
    );
    assert.equal(allowed.response.status, 200);
  }

  const blocked = await responseJson(
    jsonRequest({ question: 'ما برنامج فرص؟' }, headers),
    env
  );

  assert.equal(blocked.response.status, 429);
  assert.equal(blocked.response.headers.get('Retry-After'), String(chatConfig.period));
  assert.equal(blocked.response.headers.get('Cache-Control'), 'no-store');
  assert.equal(blocked.body.error, 'rate_limited');
  assert.equal(blocked.body.debug, undefined);
  assert.doesNotMatch(JSON.stringify(blocked.body), /203\.0\.113\.11|test-only-rate-limit-salt/);
});

test('fails open without logging the derived key, salt, address, or question', async () => {
  const { env } = createRagEnv();
  const sensitiveSalt = 'test-only-log-salt';
  const sensitiveAddress = '203.0.113.12';
  const sensitiveQuestion = 'private-test-question';
  const logs = [];
  const originalConsoleError = globalThis.console.error;

  env.RATE_LIMIT_SALT = sensitiveSalt;
  env.CHAT_RATE_LIMITER = {
    async limit() {
      throw new Error('test limiter failure');
    }
  };
  globalThis.console.error = (...values) => {
    logs.push(values.join(' '));
  };

  try {
    const { response } = await responseJson(
      jsonRequest(
        { question: sensitiveQuestion },
        { 'CF-Connecting-IP': sensitiveAddress }
      ),
      env
    );
    assert.equal(response.status, 200);
  } finally {
    globalThis.console.error = originalConsoleError;
  }

  assert.deepEqual(logs, ['Rate limiting binding unavailable.']);
  assert.doesNotMatch(
    logs.join(' '),
    new RegExp(`${sensitiveSalt}|${sensitiveAddress}|${sensitiveQuestion}`)
  );
});

test('rejects invalid question shapes and lengths', async (t) => {
  const cases = [
    ['empty question', { question: '   ' }, 400, 'empty_question'],
    ['non-string question', { question: { text: 'سؤال' } }, 400, 'invalid_question_type'],
    ['long question', { question: 'س'.repeat(MAX_CHAT_QUESTION_CHARS + 1) }, 413, 'question_too_long']
  ];

  for(const [name, payload, status, error] of cases) {
    await t.test(name, async () => {
      const result = await responseJson(jsonRequest(payload));
      assert.equal(result.response.status, status);
      assert.equal(result.body.error, error);
      assert.equal(result.body.notFound, true);
    });
  }
});

test('rejects an oversized body before processing the question', async () => {
  const result = await responseJson(jsonRequest({
    question: 'سؤال سليم',
    padding: 'x'.repeat(MAX_CHAT_REQUEST_BYTES)
  }));

  assert.equal(result.response.status, 413);
  assert.equal(result.body.error, 'request_too_large');
});

test('rejects invalid JSON and unsupported content types', async (t) => {
  await t.test('invalid JSON', async () => {
    const request = new globalThis.Request(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{'
    });
    const result = await responseJson(request);
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error, 'invalid_json');
  });

  await t.test('unsupported content type', async () => {
    const request = new globalThis.Request(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ question: 'سؤال' })
    });
    const result = await responseJson(request);
    assert.equal(result.response.status, 415);
    assert.equal(result.body.error, 'unsupported_content_type');
  });
});

test('redacts sensitive values from the stored question', () => {
  const sanitized = sanitizeQuestionForStorage(
    'البريد qa.user@example.com والهاتف +966 55 123 4567 والرقم 123456789012 ' +
    'والترويسة Bearer sample-token-value-123 و api_key=sampleApiKeyValue123'
  );

  assert.match(sanitized, /\[EMAIL_REDACTED\]/);
  assert.match(sanitized, /\[PHONE_REDACTED\]/);
  assert.match(sanitized, /\[NUMBER_REDACTED\]/);
  assert.equal((sanitized.match(/\[SECRET_REDACTED\]/g) || []).length, 2);
  assert.doesNotMatch(sanitized, /qa\.user@example\.com|sample-token-value-123|sampleApiKeyValue123/);
});

test('uses the original question for search and only the redacted copy for D1', async () => {
  const originalQuestion =
    'ابحث عن qa.user@example.com و0551234567 و123456789012 وBearer sample-token-value-123';
  const { env, embeddingInputs } = createRagEnv({ matches: [] });
  const database = createDbRecorder();
  env.UNANSWERED_DB = database.binding;

  const { body } = await responseJson(jsonRequest({ question: originalQuestion }), env);
  const insert = database.statements.find((statement) =>
    statement.sql.includes('INSERT INTO unanswered_questions')
  );

  assert.equal(embeddingInputs[0], originalQuestion);
  assert.equal(body.answer, CHAT_FALLBACK_ANSWER);
  assert.ok(insert);
  assert.match(insert.sql, /ON CONFLICT\(normalized_question\)/);
  assert.match(insert.sql, /repeat_count = unanswered_questions\.repeat_count \+ 1/);
  assert.equal(database.statements.some((statement) =>
    statement.sql.includes('SELECT id FROM unanswered_questions')
  ), false);
  assert.match(insert.values[0], /\[EMAIL_REDACTED\].*\[PHONE_REDACTED\].*\[NUMBER_REDACTED\].*\[SECRET_REDACTED\]/);
  assert.doesNotMatch(insert.values.slice(0, 2).join(' '), /qa\.user@example\.com|0551234567|123456789012|sample-token-value-123/);
});

test('does not expose debug metadata in production', async () => {
  const { env } = createRagEnv();
  env.DEBUG_CHAT = 'true';
  env.APP_ENV = 'production';

  const { body } = await responseJson(jsonRequest({ question: 'ما برنامج فرص؟' }), env);
  assert.equal(body.debug, undefined);
  assert.equal(body.score, undefined);
  assert.equal(body.matches, undefined);
  assert.equal(body.metadata, undefined);
});

test('returns the unified fallback without the removed personal response', async () => {
  const { env } = createRagEnv({ matches: [] });
  const { body } = await responseJson(jsonRequest({ question: '07/07/2027MN' }), env);

  assert.equal(body.answer, CHAT_FALLBACK_ANSWER);
  assert.equal(body.notFound, true);
  assert.equal(body.customType, undefined);
});
