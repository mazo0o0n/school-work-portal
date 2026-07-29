import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const registrationSource = await readFile(
  new globalThis.URL('../src/index.js', import.meta.url),
  'utf8'
);
const loadableRegistrationSource = registrationSource
  .replace(
    "'./chat-security.mjs'",
    JSON.stringify(new globalThis.URL('../src/chat-security.mjs', import.meta.url).href)
  )
  .replace(
    "'./registration-verification.mjs'",
    JSON.stringify(new globalThis.URL('../src/registration-verification.mjs', import.meta.url).href)
  );
const registrationWorkerModule =
  `data:text/javascript;base64,${Buffer.from(loadableRegistrationSource).toString('base64')}`;
const wrapperSource = await readFile(
  new globalThis.URL('../src/worker.js', import.meta.url),
  'utf8'
);
const loadableWrapperSource = wrapperSource.replace(
  "'./index.js'",
  JSON.stringify(registrationWorkerModule)
);
const wrapperWorkerModule =
  `data:text/javascript;base64,${Buffer.from(loadableWrapperSource).toString('base64')}`;
const { default: worker } = await import(wrapperWorkerModule);

const BASE_URL = 'https://local-integration.test';
const TEST_ADMIN_TOKEN = 'local-integration-admin-token';
const TEST_PHONE_SECRET = 'local-integration-phone-secret';
const TEST_RATE_LIMIT_SALT = 'local-integration-rate-limit-salt';
const TEST_PHONE = '0500000000';
const SECOND_TEST_PHONE = '0511111111';

class LocalD1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new LocalD1Statement(this.database, this.sql, values);
  }

  async first(column) {
    const row = this.database.prepare(this.sql).get(...this.values) || null;
    if(!column) return row;
    return row ? row[column] : null;
  }

  async all() {
    return {
      success: true,
      results: this.database.prepare(this.sql).all(...this.values)
    };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return {
      success: true,
      meta: {
        changes: Number(result.changes || 0),
        last_row_id: Number(result.lastInsertRowid || 0)
      }
    };
  }
}

class LocalD1Database {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new LocalD1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for(const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch(error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

async function createMigratedDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  const migrationsDirectory = new globalThis.URL('../migrations/platform/', import.meta.url);
  const migrations = (await readdir(migrationsDirectory))
    .filter(name => name.endsWith('.sql'))
    .sort();
  for(const migration of migrations) {
    sqlite.exec(await readFile(new globalThis.URL(migration, migrationsDirectory), 'utf8'));
  }
  return {
    sqlite,
    binding: new LocalD1Database(sqlite),
    migrations
  };
}

function createEnvironment(database, sentCodes, overrides = {}) {
  return {
    PLATFORM_DB: database,
    PHONE_VERIFICATION_REQUIRED: 'true',
    PHONE_VERIFICATION_SECRET: TEST_PHONE_SECRET,
    WHATSAPP_TEST_MODE: 'true',
    WHATSAPP_TEST_ALLOWED_PHONES: `${TEST_PHONE},${SECOND_TEST_PHONE}`,
    WHATSAPP_OTP_SENDER: async ({ phone, code }) => {
      sentCodes.set(phone, code);
    },
    RATE_LIMIT_SALT: TEST_RATE_LIMIT_SALT,
    CHAT_RATE_LIMITER: {
      async limit() {
        return { success: true };
      }
    },
    ADMIN_API_TOKEN: TEST_ADMIN_TOKEN,
    ADMIN_AUTH_RATE_LIMITER: {
      async limit() {
        return { success: true };
      }
    },
    ASSETS: {
      async fetch() {
        return new globalThis.Response('Not found', { status: 404 });
      }
    },
    ...overrides
  };
}

async function requestJson(env, pathname, body, extraHeaders = {}) {
  const response = await worker.fetch(new globalThis.Request(`${BASE_URL}${pathname}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'CF-Connecting-IP': '127.0.0.1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...extraHeaders
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), env, { waitUntil() {} });
  const text = await response.text();
  return {
    response,
    text,
    body: text ? JSON.parse(text) : null
  };
}

function schoolPayload(name, phone, verificationToken = '') {
  return {
    schoolName: name,
    schoolStage: 'ابتدائية',
    educationDepartment: 'إدارة التعليم بمنطقة الاختبار',
    registrationContactName: 'مسؤول اختبار محلي',
    registrationContactPhone: phone,
    registrationContactConsent: true,
    phoneVerificationToken: verificationToken
  };
}

test('preview config is isolated and keeps verification disabled for the first deploy', async () => {
  const config = await readFile(new globalThis.URL('../wrangler.toml', import.meta.url), 'utf8');
  const previewStart = config.indexOf('[env.preview]');
  assert.ok(previewStart > 0);

  const productionConfig = config.slice(0, previewStart);
  const previewConfig = config.slice(previewStart);
  assert.match(previewConfig, /name = "snowy-mud-6e88-preview"/);
  assert.match(previewConfig, /routes = \[\]/);
  assert.match(previewConfig, /database_name = "school-platform-db-whatsapp-preview"/);
  assert.match(previewConfig, /PHONE_VERIFICATION_REQUIRED = "false"/);
  assert.match(previewConfig, /WHATSAPP_TEST_MODE = "true"/);
  assert.match(previewConfig, /\[env\.preview\.secrets\]/);
  for(const secretName of [
    'PHONE_VERIFICATION_SECRET',
    'WHATSAPP_ACCESS_TOKEN',
    'WHATSAPP_TEST_ALLOWED_PHONES',
    'RATE_LIMIT_SALT',
    'ADMIN_API_TOKEN'
  ]){
    assert.match(previewConfig, new RegExp(`"${secretName}"`));
  }
  assert.doesNotMatch(productionConfig, /PHONE_VERIFICATION_REQUIRED\s*=\s*"true"/);
});

test('runs the OTP and single-use registration lifecycle against migrated SQLite', async t => {
  const database = await createMigratedDatabase();
  t.after(() => database.sqlite.close());
  assert.deepEqual(database.migrations, [
    '0001_create_schools_table.sql',
    '0002_add_school_identity_unique_index.sql',
    '0003_create_audit_logs.sql',
    '0004_add_school_registration_contact.sql',
    '0005_create_phone_verifications.sql'
  ]);

  const sentCodes = new Map();
  const env = createEnvironment(database.binding, sentCodes);
  const sent = await requestJson(env, '/api/register/send-whatsapp-code', {
    phone: TEST_PHONE
  });
  assert.equal(sent.response.status, 200);
  const normalizedPhone = '+966500000000';
  const otp = sentCodes.get(normalizedPhone);
  assert.match(otp, /^\d{6}$/);

  const reserved = database.sqlite.prepare(
    'SELECT code_hash, verification_token_hash FROM phone_verifications WHERE phone = ?'
  ).get(normalizedPhone);
  assert.match(reserved.code_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(reserved.code_hash, otp);
  assert.equal(reserved.verification_token_hash, null);

  const verified = await requestJson(env, '/api/register/verify-whatsapp-code', {
    phone: TEST_PHONE,
    code: otp
  });
  assert.equal(verified.response.status, 200);
  assert.equal(verified.body.status, 'verified');
  assert.match(verified.body.verificationToken, /^[A-Za-z0-9_-]+$/);

  const verifiedRow = database.sqlite.prepare(
    'SELECT code_hash, verification_token_hash, consumed_at FROM phone_verifications WHERE phone = ?'
  ).get(normalizedPhone);
  assert.equal(verifiedRow.code_hash, '');
  assert.match(verifiedRow.verification_token_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(verifiedRow.verification_token_hash, verified.body.verificationToken);
  assert.equal(verifiedRow.consumed_at, null);

  const registered = await requestJson(
    env,
    '/api/schools/register',
    schoolPayload('مدرسة تكامل واتساب', TEST_PHONE, verified.body.verificationToken)
  );
  assert.equal(registered.response.status, 201);
  const consumed = database.sqlite.prepare(
    'SELECT consumed_at FROM phone_verifications WHERE phone = ?'
  ).get(normalizedPhone);
  assert.ok(consumed.consumed_at);

  const reused = await requestJson(
    env,
    '/api/schools/register',
    schoolPayload('مدرسة إعادة استخدام الرمز', TEST_PHONE, verified.body.verificationToken)
  );
  assert.equal(reused.response.status, 403);
  assert.equal(reused.body.code, 'phone_verification_required');

  const admin = await requestJson(env, '/api/admin/schools?limit=10', undefined, {
    'X-Admin-Token': TEST_ADMIN_TOKEN
  });
  assert.equal(admin.response.status, 200);
  assert.doesNotMatch(
    admin.text,
    /code_hash|verification_token_hash|verificationToken|PHONE_VERIFICATION_SECRET/
  );
  assert.equal(admin.text.includes(otp), false);
  assert.equal(admin.text.includes(verified.body.verificationToken), false);
  assert.equal(admin.text.includes(verifiedRow.verification_token_hash), false);
});

test('invalidates an older OTP after resend using the migrated database', async t => {
  const database = await createMigratedDatabase();
  t.after(() => database.sqlite.close());
  const sentCodes = new Map();
  const env = createEnvironment(database.binding, sentCodes);
  const normalizedPhone = '+966511111111';

  await requestJson(env, '/api/register/send-whatsapp-code', { phone: SECOND_TEST_PHONE });
  const oldCode = sentCodes.get(normalizedPhone);
  database.sqlite.prepare(
    "UPDATE phone_verifications SET last_sent_at = datetime('now', '-61 seconds') WHERE phone = ?"
  ).run(normalizedPhone);
  await requestJson(env, '/api/register/send-whatsapp-code', { phone: SECOND_TEST_PHONE });
  const currentCode = sentCodes.get(normalizedPhone);
  assert.match(currentCode, /^\d{6}$/);

  if(currentCode !== oldCode) {
    const oldAttempt = await requestJson(env, '/api/register/verify-whatsapp-code', {
      phone: SECOND_TEST_PHONE,
      code: oldCode
    });
    assert.equal(oldAttempt.response.status, 400);
    assert.equal(oldAttempt.body.code, 'verification_code_invalid_or_expired');
  }

  const currentAttempt = await requestJson(env, '/api/register/verify-whatsapp-code', {
    phone: SECOND_TEST_PHONE,
    code: currentCode
  });
  assert.equal(currentAttempt.response.status, 200);
});

test('fails provider and allowlist errors closed without retaining a usable OTP', async t => {
  const database = await createMigratedDatabase();
  t.after(() => database.sqlite.close());
  const sentCodes = new Map();
  const failingEnv = createEnvironment(database.binding, sentCodes, {
    WHATSAPP_OTP_SENDER: async () => {
      throw new Error('local provider network failure');
    }
  });
  const failed = await requestJson(failingEnv, '/api/register/send-whatsapp-code', {
    phone: TEST_PHONE
  });
  assert.equal(failed.response.status, 502);
  assert.equal(failed.body.code, 'whatsapp_send_failed');
  const failedRow = database.sqlite.prepare(
    'SELECT code_hash, expires_at FROM phone_verifications WHERE phone = ?'
  ).get('+966500000000');
  assert.equal(failedRow.code_hash, '');
  assert.ok(Date.parse(failedRow.expires_at) <= Date.now());
  assert.doesNotMatch(failed.text, /local provider|access token|code_hash/i);

  const disallowedEnv = createEnvironment(database.binding, sentCodes, {
    WHATSAPP_TEST_ALLOWED_PHONES: TEST_PHONE
  });
  const disallowed = await requestJson(
    disallowedEnv,
    '/api/register/send-whatsapp-code',
    { phone: SECOND_TEST_PHONE }
  );
  assert.equal(disallowed.response.status, 503);
  assert.equal(disallowed.body.code, 'whatsapp_verification_unavailable');

  const noAllowlistEnv = createEnvironment(database.binding, sentCodes);
  delete noAllowlistEnv.WHATSAPP_TEST_ALLOWED_PHONES;
  const noAllowlist = await requestJson(
    noAllowlistEnv,
    '/api/register/send-whatsapp-code',
    { phone: TEST_PHONE }
  );
  assert.equal(noAllowlist.response.status, 503);
  assert.equal(noAllowlist.body.code, 'whatsapp_verification_unavailable');
});

test('keeps classic registration independent from the verification table', async t => {
  const database = await createMigratedDatabase();
  t.after(() => database.sqlite.close());
  database.sqlite.exec('DROP TABLE phone_verifications');
  const sentCodes = new Map();
  const env = createEnvironment(database.binding, sentCodes, {
    PHONE_VERIFICATION_REQUIRED: 'false'
  });
  delete env.PHONE_VERIFICATION_SECRET;
  delete env.WHATSAPP_OTP_SENDER;

  const config = await requestJson(env, '/api/register/verification-config');
  assert.equal(config.response.status, 200);
  assert.equal(config.body.phoneVerificationRequired, false);

  const registered = await requestJson(
    env,
    '/api/schools/register',
    schoolPayload('مدرسة التسجيل التقليدي', TEST_PHONE)
  );
  assert.equal(registered.response.status, 201);
  assert.equal(registered.body.ok, true);
});
