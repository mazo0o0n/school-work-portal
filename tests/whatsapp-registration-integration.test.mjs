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
    "'./assistant-timeout.mjs'",
    JSON.stringify(new globalThis.URL('../src/assistant-timeout.mjs', import.meta.url).href)
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
).replace(
  "'./data-retention.mjs'",
  JSON.stringify(new globalThis.URL('../src/data-retention.mjs', import.meta.url).href)
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
    OTP_SEND_ENABLED: 'true',
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

function testPhone(index) {
  return `05${String(index).padStart(8, '0')}`;
}

function normalizedTestPhone(index) {
  return `+9665${String(index).padStart(8, '0')}`;
}

function testIp(index) {
  return `198.51.100.${(index % 250) + 1}`;
}

function agePhoneCooldown(database, normalizedPhone, milliseconds = 61_000) {
  database.sqlite.prepare(
    'UPDATE phone_verifications SET last_sent_at = ?, send_hold_until = NULL WHERE phone = ?'
  ).run(new Date(Date.now() - milliseconds).toISOString(), normalizedPhone);
}

function wrongCodeFor(code) {
  return code === '999999' ? '888888' : '999999';
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
    '0005_create_phone_verifications.sql',
    '0006_create_phone_verification_abuse_events.sql'
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

test('keeps registration verification required when the independent send switch is off', async t => {
  const database = await createMigratedDatabase();
  t.after(() => database.sqlite.close());
  const sentCodes = new Map();
  const env = createEnvironment(database.binding, sentCodes, {
    OTP_SEND_ENABLED: 'false'
  });

  const send = await requestJson(env, '/api/register/send-whatsapp-code', {
    phone: TEST_PHONE
  });
  assert.equal(send.response.status, 503);
  assert.equal(send.body.code, 'whatsapp_verification_unavailable');
  assert.equal(sentCodes.size, 0);

  delete env.OTP_SEND_ENABLED;
  const missingSwitch = await requestJson(env, '/api/register/send-whatsapp-code', {
    phone: SECOND_TEST_PHONE
  });
  assert.equal(missingSwitch.response.status, 503);
  assert.equal(missingSwitch.body.code, 'whatsapp_verification_unavailable');

  const registration = await requestJson(
    env,
    '/api/schools/register',
    schoolPayload('مدرسة مفتاح الإرسال المغلق', TEST_PHONE)
  );
  assert.equal(registration.response.status, 403);
  assert.equal(registration.body.code, 'phone_verification_required');
});

test('enforces phone send windows at 3 per 10 minutes, 6 per hour, and 10 per day', async () => {
  const runWindow = async ({ allowed, ageMilliseconds }) => {
    const database = await createMigratedDatabase();
    const sentCodes = new Map();
    const env = createEnvironment(database.binding, sentCodes, {
      WHATSAPP_TEST_MODE: 'false'
    });
    const phone = testPhone(10 + allowed);
    const normalizedPhone = normalizedTestPhone(10 + allowed);
    for(let index = 0; index < allowed; index += 1) {
      const sent = await requestJson(env, '/api/register/send-whatsapp-code', { phone });
      assert.equal(sent.response.status, 200);
      agePhoneCooldown(database, normalizedPhone);
      if(ageMilliseconds) {
        database.sqlite.prepare(
          'UPDATE phone_verification_abuse_events SET created_at = ? WHERE event_type = ?'
        ).run(new Date(Date.now() - ageMilliseconds).toISOString(), 'send_attempt');
      }
    }
    const blocked = await requestJson(env, '/api/register/send-whatsapp-code', { phone });
    assert.equal(blocked.response.status, 429);
    assert.equal(blocked.body.code, 'verification_rate_limited');
    assert.equal(sentCodes.size, 1);
    database.sqlite.close();
  };

  await runWindow({ allowed: 3, ageMilliseconds: 0 });
  await runWindow({ allowed: 6, ageMilliseconds: 11 * 60 * 1000 });
  await runWindow({ allowed: 10, ageMilliseconds: 61 * 60 * 1000 });
});

test('enforces IP send windows at 20 per hour and 50 per day', async () => {
  const runWindow = async ({ allowed, ageMilliseconds }) => {
    const database = await createMigratedDatabase();
    const providerCalls = [];
    const env = createEnvironment(database.binding, new Map(), {
      WHATSAPP_TEST_MODE: 'false',
      WHATSAPP_OTP_SENDER: async ({ phone, code }) => providerCalls.push({ phone, code })
    });
    for(let index = 0; index < allowed; index += 1) {
      const sent = await requestJson(env, '/api/register/send-whatsapp-code', {
        phone: testPhone(1000 + index)
      });
      assert.equal(sent.response.status, 200);
      if(ageMilliseconds) {
        database.sqlite.prepare(
          'UPDATE phone_verification_abuse_events SET created_at = ? WHERE event_type = ?'
        ).run(new Date(Date.now() - ageMilliseconds).toISOString(), 'send_attempt');
      }
    }
    const blocked = await requestJson(env, '/api/register/send-whatsapp-code', {
      phone: testPhone(2000 + allowed)
    });
    assert.equal(blocked.response.status, 429);
    assert.equal(blocked.body.code, 'verification_rate_limited');
    assert.equal(providerCalls.length, allowed);
    database.sqlite.close();
  };

  await runWindow({ allowed: 20, ageMilliseconds: 0 });
  await runWindow({ allowed: 50, ageMilliseconds: 61 * 60 * 1000 });
});

test('enforces the global provider-attempt cap atomically at 100', async t => {
  const database = await createMigratedDatabase();
  t.after(() => database.sqlite.close());
  const providerCalls = [];
  const env = createEnvironment(database.binding, new Map(), {
    WHATSAPP_TEST_MODE: 'false',
    WHATSAPP_OTP_SENDER: async ({ phone, code }) => providerCalls.push({ phone, code })
  });
  const originalWarn = globalThis.console.warn;
  let warnings = 0;
  globalThis.console.warn = (message) => {
    if(message === 'OTP provider attempt cap warning threshold reached.') warnings += 1;
  };
  t.after(() => { globalThis.console.warn = originalWarn; });

  for(let index = 0; index < 99; index += 1) {
    const sent = await requestJson(
      env,
      '/api/register/send-whatsapp-code',
      { phone: testPhone(3000 + index) },
      { 'CF-Connecting-IP': testIp(index) }
    );
    assert.equal(sent.response.status, 200);
  }
  const crossing = await Promise.all([99, 100].map((index) => requestJson(
    env,
    '/api/register/send-whatsapp-code',
    { phone: testPhone(3000 + index) },
    { 'CF-Connecting-IP': `203.0.113.${index}` }
  )));
  assert.deepEqual(crossing.map((result) => result.response.status).sort(), [200, 429]);
  assert.equal(providerCalls.length, 100);
  assert.equal(
    database.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM phone_verification_abuse_events WHERE event_type = 'send_attempt'"
    ).get().count,
    100
  );
  assert.ok(warnings >= 1);
});

test('holds ambiguous provider failures for five minutes without exposing details', async t => {
  const database = await createMigratedDatabase();
  t.after(() => database.sqlite.close());
  let providerCalls = 0;
  const env = createEnvironment(database.binding, new Map(), {
    WHATSAPP_TEST_MODE: 'false',
    WHATSAPP_OTP_SENDER: async () => {
      providerCalls += 1;
      if(providerCalls === 1) throw new Error('simulated ambiguous network failure with secret');
    }
  });
  const phone = testPhone(5000);
  const normalizedPhone = normalizedTestPhone(5000);

  const failed = await requestJson(env, '/api/register/send-whatsapp-code', { phone });
  assert.equal(failed.response.status, 502);
  assert.equal(failed.body.code, 'whatsapp_send_failed');
  assert.doesNotMatch(failed.text, /ambiguous|secret|5000/i);
  const heldRow = database.sqlite.prepare(
    'SELECT code_hash, send_hold_until FROM phone_verifications WHERE phone = ?'
  ).get(normalizedPhone);
  assert.equal(heldRow.code_hash, '');
  assert.ok(Date.parse(heldRow.send_hold_until) >= Date.now() + 4 * 60 * 1000);

  const held = await requestJson(
    env,
    '/api/register/send-whatsapp-code',
    { phone },
    { 'CF-Connecting-IP': '203.0.113.200' }
  );
  assert.equal(held.response.status, 429);
  assert.equal(held.body.code, 'verification_rate_limited');
  assert.equal(providerCalls, 1);
});

test('enforces parallel send limits without storing raw IP addresses', async t => {
  const database = await createMigratedDatabase();
  t.after(() => database.sqlite.close());
  const providerCalls = [];
  const env = createEnvironment(database.binding, new Map(), {
    WHATSAPP_TEST_MODE: 'false',
    WHATSAPP_OTP_SENDER: async ({ phone, code }) => providerCalls.push({ phone, code })
  });
  const phone = testPhone(6000);
  const samePhoneResults = await Promise.all(Array.from({ length: 100 }, (_, index) =>
    requestJson(env, '/api/register/send-whatsapp-code', { phone }, {
      'CF-Connecting-IP': testIp(index)
    })
  ));
  assert.equal(samePhoneResults.filter((result) => result.response.status === 200).length, 1);
  assert.equal(providerCalls.length, 1);

  const stored = database.sqlite.prepare(
    'SELECT phone_hash, ip_hash, ip_phone_hash FROM phone_verification_abuse_events LIMIT 1'
  ).get();
  for(const value of Object.values(stored)) assert.match(value, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(stored).includes('198.51.100.'), false);
});

test('enforces the same-IP-and-phone limit under parallel requests', async t => {
  const database = await createMigratedDatabase();
  t.after(() => database.sqlite.close());
  const providerCalls = [];
  const env = createEnvironment(database.binding, new Map(), {
    WHATSAPP_TEST_MODE: 'false',
    WHATSAPP_OTP_SENDER: async ({ phone, code }) => providerCalls.push({ phone, code })
  });
  const results = await Promise.all(Array.from({ length: 100 }, () =>
    requestJson(env, '/api/register/send-whatsapp-code', {
      phone: testPhone(6100)
    }, { 'CF-Connecting-IP': '203.0.113.220' })
  ));
  assert.equal(results.filter((result) => result.response.status === 200).length, 1);
  assert.equal(providerCalls.length, 1);
  assert.ok(results.every((result) => [200, 429].includes(result.response.status)));
});

test('limits 100 phones from one IP to 20 provider attempts', async t => {
  const database = await createMigratedDatabase();
  t.after(() => database.sqlite.close());
  const providerCalls = [];
  const env = createEnvironment(database.binding, new Map(), {
    WHATSAPP_TEST_MODE: 'false',
    WHATSAPP_OTP_SENDER: async ({ phone, code }) => providerCalls.push({ phone, code })
  });
  const results = await Promise.all(Array.from({ length: 100 }, (_, index) =>
    requestJson(env, '/api/register/send-whatsapp-code', {
      phone: testPhone(7000 + index)
    })
  ));
  assert.equal(results.filter((result) => result.response.status === 200).length, 20);
  assert.equal(providerCalls.length, 20);
});

test('keeps current-challenge and aggregate verify limits under parallel failures', async t => {
  const database = await createMigratedDatabase();
  t.after(() => database.sqlite.close());
  const sentCodes = new Map();
  const env = createEnvironment(database.binding, sentCodes, {
    WHATSAPP_TEST_MODE: 'false'
  });
  const phone = testPhone(8000);
  const normalizedPhone = normalizedTestPhone(8000);
  await requestJson(env, '/api/register/send-whatsapp-code', { phone });
  const wrongCode = wrongCodeFor(sentCodes.get(normalizedPhone));
  const results = await Promise.all(Array.from({ length: 100 }, (_, index) =>
    requestJson(env, '/api/register/verify-whatsapp-code', { phone, code: wrongCode }, {
      'CF-Connecting-IP': testIp(index)
    })
  ));
  assert.equal(
    database.sqlite.prepare('SELECT attempts FROM phone_verifications WHERE phone = ?')
      .get(normalizedPhone).attempts,
    5
  );
  assert.equal(
    database.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM phone_verification_abuse_events WHERE event_type = 'verify_failure'"
    ).get().count,
    10
  );
  assert.equal(results.filter((result) => result.response.status === 429).length, 90);
});

test('resend does not reset the 10-per-phone aggregate verify limit', async t => {
  const database = await createMigratedDatabase();
  t.after(() => database.sqlite.close());
  const sentCodes = new Map();
  const env = createEnvironment(database.binding, sentCodes, {
    WHATSAPP_TEST_MODE: 'false'
  });
  const phone = testPhone(9000);
  const normalizedPhone = normalizedTestPhone(9000);

  for(let challenge = 0; challenge < 2; challenge += 1) {
    const sent = await requestJson(env, '/api/register/send-whatsapp-code', { phone });
    assert.equal(sent.response.status, 200);
    const wrongCode = wrongCodeFor(sentCodes.get(normalizedPhone));
    for(let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await requestJson(env, '/api/register/verify-whatsapp-code', {
        phone,
        code: wrongCode
      }, { 'CF-Connecting-IP': testIp(challenge * 10 + attempt) });
      assert.equal(failed.response.status, 400);
    }
    agePhoneCooldown(database, normalizedPhone);
  }

  const thirdSend = await requestJson(env, '/api/register/send-whatsapp-code', { phone });
  assert.equal(thirdSend.response.status, 200);
  const blocked = await requestJson(env, '/api/register/verify-whatsapp-code', {
    phone,
    code: wrongCodeFor(sentCodes.get(normalizedPhone))
  }, { 'CF-Connecting-IP': '203.0.113.201' });
  assert.equal(blocked.response.status, 429);
  assert.equal(blocked.body.code, 'verification_rate_limited');
});

test('enforces 30 aggregate verify failures per IP across phones', async t => {
  const database = await createMigratedDatabase();
  t.after(() => database.sqlite.close());
  const sentCodes = new Map();
  const env = createEnvironment(database.binding, sentCodes, {
    WHATSAPP_TEST_MODE: 'false'
  });
  const ip = '203.0.113.210';

  for(let phoneIndex = 0; phoneIndex < 6; phoneIndex += 1) {
    const phone = testPhone(10_000 + phoneIndex);
    const normalizedPhone = normalizedTestPhone(10_000 + phoneIndex);
    await requestJson(env, '/api/register/send-whatsapp-code', { phone }, {
      'CF-Connecting-IP': testIp(phoneIndex)
    });
    const wrongCode = wrongCodeFor(sentCodes.get(normalizedPhone));
    for(let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await requestJson(env, '/api/register/verify-whatsapp-code', {
        phone,
        code: wrongCode
      }, { 'CF-Connecting-IP': ip });
      assert.equal(failed.response.status, 400);
    }
  }

  const lastPhone = testPhone(10_100);
  const normalizedLastPhone = normalizedTestPhone(10_100);
  await requestJson(env, '/api/register/send-whatsapp-code', { phone: lastPhone }, {
    'CF-Connecting-IP': '203.0.113.211'
  });
  const blocked = await requestJson(env, '/api/register/verify-whatsapp-code', {
    phone: lastPhone,
    code: wrongCodeFor(sentCodes.get(normalizedLastPhone))
  }, { 'CF-Connecting-IP': ip });
  assert.equal(blocked.response.status, 429);
  assert.equal(blocked.body.code, 'verification_rate_limited');
});

test('fails OTP sends closed when RATE_LIMIT_SALT is missing', async t => {
  const database = await createMigratedDatabase();
  t.after(() => database.sqlite.close());
  const sentCodes = new Map();
  const env = createEnvironment(database.binding, sentCodes, {
    OTP_SEND_ENABLED: 'true'
  });
  delete env.RATE_LIMIT_SALT;

  const response = await requestJson(env, '/api/register/send-whatsapp-code', {
    phone: TEST_PHONE
  });
  assert.equal(response.response.status, 503);
  assert.equal(response.body.code, 'rate_limit_unavailable');
  assert.equal(sentCodes.size, 0);
});
