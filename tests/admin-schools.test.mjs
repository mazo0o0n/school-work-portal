import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new globalThis.URL('../src/worker.js', import.meta.url), 'utf8');
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

const registrationSource = await readFile(
  new globalThis.URL('../src/index.js', import.meta.url),
  'utf8'
);
const chatSecurityModuleUrl = new globalThis.URL(
  '../src/chat-security.mjs',
  import.meta.url
).href;
const registrationVerificationModuleUrl = new globalThis.URL(
  '../src/registration-verification.mjs',
  import.meta.url
).href;
const {
  WHATSAPP_REQUEST_TIMEOUT_MS,
  buildWhatsAppMessagesEndpoint,
  buildWhatsAppOtpTemplatePayload,
  isPhoneVerificationFlowConfigured,
  isWhatsAppTestRecipientAllowed,
  isWhatsappOtpConfigured,
  normalizeWhatsAppGraphApiVersion,
  normalizeWhatsAppPhoneNumberId,
  normalizeWhatsAppTemplateLanguage,
  normalizeWhatsAppTemplateName,
  sendWhatsAppOtp
} = await import(registrationVerificationModuleUrl);
const loadableRegistrationSource = registrationSource
  .replace("'./chat-security.mjs'", JSON.stringify(chatSecurityModuleUrl))
  .replace(
    "'./registration-verification.mjs'",
    JSON.stringify(registrationVerificationModuleUrl)
  );
const registrationWorkerModule =
  `data:text/javascript;base64,${Buffer.from(loadableRegistrationSource).toString('base64')}`;
const { default: registrationWorker } = await import(registrationWorkerModule);
const schoolIdentityMigration = await readFile(
  new globalThis.URL(
    '../migrations/platform/0002_add_school_identity_unique_index.sql',
    import.meta.url
  ),
  'utf8'
);
const auditMigration = await readFile(
  new globalThis.URL(
    '../migrations/platform/0003_create_audit_logs.sql',
    import.meta.url
  ),
  'utf8'
);
const registrationContactMigration = await readFile(
  new globalThis.URL(
    '../migrations/platform/0004_add_school_registration_contact.sql',
    import.meta.url
  ),
  'utf8'
);
const phoneVerificationMigration = await readFile(
  new globalThis.URL(
    '../migrations/platform/0005_create_phone_verifications.sql',
    import.meta.url
  ),
  'utf8'
);

const TOKEN = 'test-admin-token';
const BASE_URL = 'https://example.test';
const PHONE_VERIFICATION_SECRET = 'test-only-phone-verification-secret';
const META_TEST_ENV = Object.freeze({
  WHATSAPP_ACCESS_TOKEN: 'test-only-meta-access-token',
  WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
  WHATSAPP_OTP_TEMPLATE_NAME: 'school_registration_test',
  WHATSAPP_TEMPLATE_LANGUAGE: 'ar',
  WHATSAPP_GRAPH_API_VERSION: 'v99.0'
});
const PUBLIC_VERIFICATION_FAILURE = Object.freeze({
  error: 'تعذر التحقق من الرمز. اطلب رمزًا جديدًا ثم حاول مرة أخرى.',
  code: 'verification_code_invalid_or_expired'
});

function createDatabase(){
  const statements = [];
  const schools = [
    {
      id: 2,
      public_id: 'school_two',
      school_name: 'مدرسة الاختبار الثانية',
      school_stage: 'متوسطة',
      education_department: 'الإدارة العامة للتعليم بمنطقة المدينة المنورة',
      registration_contact_name: 'مسؤول التسجيل الثاني',
      registration_contact_phone: '+966512345678',
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
      registration_contact_name: null,
      registration_contact_phone: null,
      verification_status: 'unverified',
      created_at: '2026-07-21 15:06:50',
      updated_at: '2026-07-21 15:06:50'
    }
  ];
  const auditLogs = [
    {
      id: 3,
      action: 'school_status_changed',
      entity_type: 'school',
      entity_id: '2',
      result: 'success',
      metadata_json: JSON.stringify({
        previous_status: 'pending',
        new_status: 'verified',
        ADMIN_API_TOKEN: 'must-not-leak'
      }),
      created_at: '2026-07-26 10:00:00'
    },
    {
      id: 2,
      action: 'school_deleted',
      entity_type: 'school',
      entity_id: '1',
      result: 'success',
      metadata_json: JSON.stringify({ verification_status: 'suspended' }),
      created_at: '2026-07-25 10:00:00'
    }
  ];

  function execute(sql, values, method){
    if(method === 'first' && sql.includes('COUNT(*) AS count')){
      return { count: schools.length };
    }
    if(method === 'all' && sql.includes('FROM audit_logs')){
      return { results: auditLogs.slice(0, Number(values[0] || auditLogs.length)) };
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
    ADMIN_AUTH_RATE_LIMITER: {
      async limit(){
        return { success: true };
      }
    },
    ASSETS: {
      async fetch(){
        return new globalThis.Response('<!doctype html><title>schools</title>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
    }
  };
}

function createRegistrationDatabase(){
  const rows = [];
  const verifications = [];
  const statements = [];
  let inserted = 0;

  const normalizeIdentityPart = (value) => String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

  return {
    rows,
    verifications,
    statements,
    get inserted(){
      return inserted;
    },
    binding: {
      async batch(preparedStatements){
        const results = [];
        for(const preparedStatement of preparedStatements){
          results.push(await preparedStatement.run());
        }
        return results;
      },
      prepare(sql){
        const statement = { sql, values: [] };
        statements.push(statement);
        return {
          bind(...values){
            statement.values = values;
            if(sql.startsWith('SELECT 1 AS found')){
              return {
                async first(){
                  const [schoolName, schoolStage, educationDepartment] = values;
                  return rows.some((row) => (
                    normalizeIdentityPart(row.school_name) === normalizeIdentityPart(schoolName) &&
                    row.school_stage === schoolStage &&
                    normalizeIdentityPart(row.education_department) ===
                      normalizeIdentityPart(educationDepartment)
                  )) ? { found: 1 } : null;
                }
              };
            }

            if(sql.startsWith('INSERT INTO phone_verifications')){
              return {
                async run(){
                  const [phone, codeHash, purpose, expiresAt, sentAt, cooldownElapsed] = values;
                  const existing = verifications.find((row) => (
                    row.phone === phone && row.purpose === purpose
                  ));
                  if(existing && existing.last_sent_at > cooldownElapsed){
                    return { success: true, meta: { changes: 0 } };
                  }
                  const next = existing || {
                    id: verifications.length + 1,
                    phone,
                    purpose,
                    created_at: sentAt
                  };
                  Object.assign(next, {
                    code_hash: codeHash,
                    expires_at: expiresAt,
                    attempts: 0,
                    last_sent_at: sentAt,
                    verified_at: null,
                    verification_token_hash: null,
                    token_expires_at: null,
                    consumed_at: null,
                    updated_at: sentAt
                  });
                  if(!existing) verifications.push(next);
                  return { success: true, meta: { changes: 1 } };
                }
              };
            }

            if(sql.startsWith('SELECT id, code_hash, expires_at, attempts')){
              return {
                async first(){
                  const [phone, purpose] = values;
                  return verifications.find((row) => (
                    row.phone === phone && row.purpose === purpose
                  )) || null;
                }
              };
            }

            if(sql.startsWith('UPDATE phone_verifications SET code_hash')){
              return {
                async run(){
                  const [codeHash, expiresAt, lastSentAt, phone, purpose, previousHash] = values;
                  const row = verifications.find((item) => (
                    item.phone === phone &&
                    item.purpose === purpose &&
                    item.code_hash === previousHash
                  ));
                  if(!row) return { success: true, meta: { changes: 0 } };
                  Object.assign(row, {
                    code_hash: codeHash,
                    expires_at: expiresAt,
                    last_sent_at: lastSentAt,
                    updated_at: expiresAt
                  });
                  return { success: true, meta: { changes: 1 } };
                }
              };
            }

            if(sql.startsWith('UPDATE phone_verifications SET attempts')){
              return {
                async first(){
                  const [updatedAt, id, maximumAttempts] = values;
                  const row = verifications.find((item) => (
                    item.id === id && item.attempts < maximumAttempts
                  ));
                  if(!row) return null;
                  row.attempts += 1;
                  row.updated_at = updatedAt;
                  return { attempts: row.attempts };
                }
              };
            }

            if(sql.startsWith('UPDATE phone_verifications SET verified_at')){
              return {
                async run(){
                  const [verifiedAt, tokenHash, tokenExpiresAt, id, submittedHash] = values;
                  const row = verifications.find((item) => (
                    item.id === id && item.code_hash === submittedHash
                  ));
                  if(!row) return { success: true, meta: { changes: 0 } };
                  Object.assign(row, {
                    verified_at: verifiedAt,
                    verification_token_hash: tokenHash,
                    token_expires_at: tokenExpiresAt,
                    consumed_at: null,
                    code_hash: '',
                    expires_at: verifiedAt,
                    updated_at: verifiedAt
                  });
                  return { success: true, meta: { changes: 1 } };
                }
              };
            }

            if(sql.startsWith('UPDATE phone_verifications SET consumed_at')){
              return {
                async run(){
                  const [now, phone, purpose, tokenHash, publicId] = values;
                  const row = verifications.find((item) => (
                    item.phone === phone &&
                    item.purpose === purpose &&
                    item.verification_token_hash === tokenHash &&
                    item.verified_at &&
                    item.token_expires_at > now &&
                    !item.consumed_at &&
                    (!publicId || rows.some((school) => school.public_id === publicId))
                  ));
                  if(!row) return { success: true, meta: { changes: 0 } };
                  row.consumed_at = now;
                  row.updated_at = now;
                  return { success: true, meta: { changes: 1 } };
                }
              };
            }

            if(sql.startsWith('INSERT INTO schools')){
              return {
                async run(){
                  const publicId = values[0];
                  const schoolName = values[2];
                  const schoolStage = values[3];
                  const educationDepartment = values[4];
                  const registrationContactName = values[5];
                  const registrationContactPhone = values[6];
                  const requiresVerification = values.length > 7;
                  const verification = requiresVerification
                    ? verifications.find((row) => (
                      row.phone === values[7] &&
                      row.purpose === values[8] &&
                      row.verification_token_hash === values[9] &&
                      row.verified_at &&
                      row.token_expires_at > values[10] &&
                      !row.consumed_at
                    ))
                    : true;
                  const duplicate = rows.some((row) => (
                    normalizeIdentityPart(row.school_name) === normalizeIdentityPart(schoolName) &&
                    row.school_stage === schoolStage &&
                    normalizeIdentityPart(row.education_department) ===
                      normalizeIdentityPart(educationDepartment)
                  ));

                  if(duplicate || !verification){
                    return { success: true, meta: { changes: 0 } };
                  }

                  rows.push({
                    public_id: publicId,
                    school_name: schoolName,
                    school_stage: schoolStage,
                    education_department: educationDepartment,
                    registration_contact_name: registrationContactName,
                    registration_contact_phone: registrationContactPhone
                  });
                  inserted += 1;
                  return { success: true, meta: { changes: 1 } };
                }
              };
            }

            throw new Error(`Unexpected registration SQL: ${sql}`);
          }
        };
      }
    }
  };
}

function createRegistrationEnv(database, { phoneVerificationRequired = true } = {}){
  const sentCodes = [];
  return {
    sentCodes,
    env: {
      PLATFORM_DB: database.binding,
      PHONE_VERIFICATION_REQUIRED: phoneVerificationRequired ? 'true' : 'false',
      PHONE_VERIFICATION_SECRET,
      WHATSAPP_OTP_SENDER: async ({ phone, code }) => {
        sentCodes.push({ phone, code });
      },
      RATE_LIMIT_SALT: 'test-rate-limit-salt',
      CHAT_RATE_LIMITER: {
        async limit(){
          return { success: true };
        }
      }
    }
  };
}

async function registrationRequest(env, path, payload){
  const response = await registrationWorker.fetch(new globalThis.Request(
    `${BASE_URL}${path}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '198.51.100.30'
      },
      body: JSON.stringify(payload)
    }
  ), env);

  return {
    response,
    body: await response.json()
  };
}

async function rawRegistrationRequest(env, path, body, headers = {}){
  const response = await registrationWorker.fetch(new globalThis.Request(
    `${BASE_URL}${path}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '198.51.100.30',
        ...headers
      },
      body
    }
  ), env);

  return {
    response,
    body: await response.json()
  };
}

async function registrationConfigRequest(env){
  const response = await registrationWorker.fetch(new globalThis.Request(
    `${BASE_URL}/api/register/verification-config`
  ), env);
  return { response, body: await response.json() };
}

async function verifyRegistrationPhone(database, phone){
  const session = createRegistrationEnv(database);
  const digits = String(phone).replace(/\D/g, '');
  const normalizedPhone = digits.startsWith('05')
    ? `+966${digits.slice(1)}`
    : `+${digits}`;
  const existing = database.verifications.find((row) => row.phone === normalizedPhone);
  if(existing){
    existing.last_sent_at = new Date(Date.now() - 61000).toISOString();
  }
  const sent = await registrationRequest(
    session.env,
    '/api/register/send-whatsapp-code',
    { phone }
  );
  assert.equal(sent.response.status, 200);
  const code = session.sentCodes.at(-1)?.code;
  assert.match(code, /^\d{6}$/);
  const verified = await registrationRequest(
    session.env,
    '/api/register/verify-whatsapp-code',
    { phone, code }
  );
  assert.equal(verified.response.status, 200);
  return verified.body.verificationToken;
}

async function registerSchool(database, payload, phoneVerificationToken = ''){
  const session = createRegistrationEnv(database);
  return registrationRequest(session.env, '/api/schools/register', {
    ...payload,
    phoneVerificationToken
  });
}

function adminRequest(path, options = {}){
  return new globalThis.Request(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'X-Admin-Token': TOKEN,
      ...(options.headers || {})
    }
  });
}

test('builds the versioned Meta endpoint and current one-parameter template payload', async () => {
  assert.equal(normalizeWhatsAppGraphApiVersion('v99.0'), 'v99.0');
  for(const invalidVersion of ['', '99.0', 'v99', 'v99.0/messages', 'latest']){
    assert.equal(normalizeWhatsAppGraphApiVersion(invalidVersion), '');
  }
  assert.equal(normalizeWhatsAppPhoneNumberId('123456789012345'), '123456789012345');
  assert.equal(normalizeWhatsAppPhoneNumberId('phone-number-id'), '');
  assert.equal(normalizeWhatsAppTemplateName('school_registration_test'), 'school_registration_test');
  assert.equal(normalizeWhatsAppTemplateName('School Registration'), '');
  assert.equal(normalizeWhatsAppTemplateLanguage('ar'), 'ar');
  assert.equal(normalizeWhatsAppTemplateLanguage('ar_SA'), 'ar_SA');
  assert.equal(normalizeWhatsAppTemplateLanguage('ar-SA'), '');

  assert.equal(
    buildWhatsAppMessagesEndpoint(META_TEST_ENV),
    'https://graph.facebook.com/v99.0/123456789012345/messages'
  );
  assert.equal(isWhatsappOtpConfigured(META_TEST_ENV), true);
  assert.equal(isPhoneVerificationFlowConfigured(META_TEST_ENV), false);
  assert.equal(isPhoneVerificationFlowConfigured({
    ...META_TEST_ENV,
    PHONE_VERIFICATION_SECRET
  }), true);
  for(const missingKey of [
    'WHATSAPP_ACCESS_TOKEN',
    'WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_OTP_TEMPLATE_NAME',
    'WHATSAPP_TEMPLATE_LANGUAGE',
    'WHATSAPP_GRAPH_API_VERSION'
  ]){
    const incompleteEnv = {
      ...META_TEST_ENV,
      PHONE_VERIFICATION_SECRET
    };
    delete incompleteEnv[missingKey];
    assert.equal(isPhoneVerificationFlowConfigured(incompleteEnv), false);
  }
  assert.equal(isWhatsappOtpConfigured({
    ...META_TEST_ENV,
    WHATSAPP_GRAPH_API_VERSION: 'latest'
  }), false);
  assert.deepEqual(
    buildWhatsAppOtpTemplatePayload(META_TEST_ENV, '+966500000000', '123456'),
    {
      messaging_product: 'whatsapp',
      to: '966500000000',
      type: 'template',
      template: {
        name: 'school_registration_test',
        language: { code: 'ar' },
        components: [{
          type: 'body',
          parameters: [{ type: 'text', text: '123456' }]
        }]
      }
    }
  );

  let capturedRequest;
  await sendWhatsAppOtp(META_TEST_ENV, '+966500000000', '123456', {
    fetchImpl: async (url, init) => {
      capturedRequest = { url, init };
      return new globalThis.Response('{"messages":[{"id":"test-message-id"}]}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });
  assert.equal(
    capturedRequest.url,
    'https://graph.facebook.com/v99.0/123456789012345/messages'
  );
  assert.equal(
    capturedRequest.init.headers.Authorization,
    `Bearer ${META_TEST_ENV.WHATSAPP_ACCESS_TOKEN}`
  );
  assert.deepEqual(
    JSON.parse(capturedRequest.init.body),
    buildWhatsAppOtpTemplatePayload(META_TEST_ENV, '+966500000000', '123456')
  );
});

test('fails Meta timeout, network, and HTTP errors without provider detail leakage', async () => {
  assert.ok(WHATSAPP_REQUEST_TIMEOUT_MS > 0 && WHATSAPP_REQUEST_TIMEOUT_MS <= 10000);

  const expectSafeProviderFailure = async (promise) => {
    await assert.rejects(promise, (error) => {
      assert.equal(error.code, 'whatsapp_send_failed');
      assert.equal(error.status, 502);
      const serialized = JSON.stringify({
        code: error.code,
        message: error.message
      });
      assert.doesNotMatch(serialized, /123456|test-only-meta-access-token|500000000/);
      return true;
    });
  };

  await expectSafeProviderFailure(sendWhatsAppOtp(
    META_TEST_ENV,
    '+966500000000',
    '123456',
    {
      timeoutMs: 5,
      fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('provider timeout detail')), {
          once: true
        });
      })
    }
  ));
  await expectSafeProviderFailure(sendWhatsAppOtp(
    META_TEST_ENV,
    '+966500000000',
    '123456',
    { fetchImpl: async () => { throw new Error('provider network detail'); } }
  ));
  await expectSafeProviderFailure(sendWhatsAppOtp(
    META_TEST_ENV,
    '+966500000000',
    '123456',
    {
      fetchImpl: async () => new globalThis.Response(
        'provider failure with test-only-meta-access-token',
        { status: 500 }
      )
    }
  ));
});

test('restricts test-mode WhatsApp sends to a server-side allowlist', async () => {
  let sends = 0;
  const testEnv = {
    WHATSAPP_TEST_MODE: 'true',
    WHATSAPP_OTP_SENDER: async () => { sends += 1; }
  };

  assert.equal(isWhatsAppTestRecipientAllowed(testEnv, '+966500000000'), false);
  await assert.rejects(
    sendWhatsAppOtp(testEnv, '+966500000000', '123456'),
    (error) => error.code === 'whatsapp_verification_unavailable'
  );
  assert.equal(sends, 0);

  testEnv.WHATSAPP_TEST_ALLOWED_PHONES = '0500000000';
  assert.equal(isWhatsAppTestRecipientAllowed(testEnv, '+966500000000'), true);
  await sendWhatsAppOtp(testEnv, '+966500000000', '123456');
  assert.equal(sends, 1);

  delete testEnv.WHATSAPP_TEST_MODE;
  delete testEnv.WHATSAPP_TEST_ALLOWED_PHONES;
  assert.equal(isWhatsAppTestRecipientAllowed(testEnv, '+966511111111'), true);
});

test('rejects invalid admin tokens before querying the schools database', async () => {
  const database = createDatabase();
  const response = await worker.fetch(new globalThis.Request(`${BASE_URL}/api/admin/schools`, {
    headers: {
      'X-Admin-Token': 'wrong-token',
      'CF-Connecting-IP': '198.51.100.31'
    }
  }), createEnv(database.binding));

  assert.equal(response.status, 403);
  assert.equal(database.statements.length, 0);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('fails closed when the admin rate limiter is not configured', async () => {
  const database = createDatabase();
  const env = createEnv(database.binding);
  delete env.ADMIN_AUTH_RATE_LIMITER;

  const response = await worker.fetch(new globalThis.Request(
    `${BASE_URL}/api/admin/schools`,
    {
      headers: {
        'X-Admin-Token': 'wrong-token',
        'CF-Connecting-IP': '198.51.100.32'
      }
    }
  ), env);
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.code, 'rate_limit_unavailable');
  assert.equal(database.statements.length, 0);
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
  assert.equal(body.items[0].registration_contact_name, 'مسؤول التسجيل الثاني');
  assert.equal(body.items[0].registration_contact_phone, '+966512345678');

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

test('protects audit logs and returns only compact allowlisted metadata', async () => {
  const unauthorizedDatabase = createDatabase();
  const unauthorizedResponse = await worker.fetch(new globalThis.Request(
    `${BASE_URL}/api/admin/audit-logs?limit=50`,
    {
      headers: {
        'X-Admin-Token': 'wrong-token',
        'CF-Connecting-IP': '198.51.100.33'
      }
    }
  ), createEnv(unauthorizedDatabase.binding));

  assert.equal(unauthorizedResponse.status, 403);
  assert.equal(unauthorizedDatabase.statements.length, 0);

  const database = createDatabase();
  const response = await worker.fetch(
    adminRequest('/api/admin/audit-logs?limit=999'),
    createEnv(database.binding)
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.limit, 50);
  assert.equal(body.items.length, 2);
  assert.deepEqual(body.items[0].metadata, {
    previous_status: 'pending',
    new_status: 'verified'
  });
  assert.deepEqual(body.items[1].metadata, {
    verification_status: 'suspended'
  });
  assert.doesNotMatch(JSON.stringify(body), /must-not-leak|ADMIN_API_TOKEN/i);
  const auditStatement = database.statements.find((item) => item.sql.includes('FROM audit_logs'));
  assert.ok(auditStatement);
  assert.match(auditStatement.sql, /ORDER BY id DESC LIMIT \?1/);
  assert.deepEqual(auditStatement.values, [50]);
});

test('rejects non-GET audit requests before reading audit data', async () => {
  const database = createDatabase();
  const response = await worker.fetch(adminRequest('/api/admin/audit-logs', {
    method: 'POST'
  }), createEnv(database.binding));

  assert.equal(response.status, 405);
  assert.equal(database.statements.length, 0);
});

test('defines school identity uniqueness and admin audit migrations safely', () => {
  assert.match(schoolIdentityMigration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_schools_identity_unique/);
  assert.match(schoolIdentityMigration, /lower\(trim\(school_name\)\)/);
  assert.match(schoolIdentityMigration, /lower\(trim\(education_department\)\)/);

  assert.match(auditMigration, /CREATE TABLE IF NOT EXISTS audit_logs/);
  assert.match(auditMigration, /trg_audit_school_status_update/);
  assert.match(auditMigration, /school_status_changed/);
  assert.match(auditMigration, /trg_audit_school_delete/);
  assert.match(auditMigration, /school_deleted/);
  assert.doesNotMatch(auditMigration, /ADMIN_API_TOKEN|edit_token|school_name/i);

  assert.match(registrationContactMigration, /ADD COLUMN registration_contact_name TEXT/);
  assert.match(registrationContactMigration, /ADD COLUMN registration_contact_phone TEXT/);

  assert.match(phoneVerificationMigration, /CREATE TABLE IF NOT EXISTS phone_verifications/);
  assert.match(phoneVerificationMigration, /code_hash TEXT NOT NULL/);
  assert.match(phoneVerificationMigration, /verification_token_hash TEXT/);
  assert.match(phoneVerificationMigration, /consumed_at TEXT/);
  assert.doesNotMatch(phoneVerificationMigration, /otp_code|plain_code/i);
});

test('protects the admin page from caching and indexing', async () => {
  const response = await worker.fetch(
    new globalThis.Request(`${BASE_URL}/admin-schools.html`),
    createEnv()
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
});

test('delegates unrelated requests to the existing worker', async () => {
  const response = await worker.fetch(new globalThis.Request(`${BASE_URL}/index.html`), createEnv());
  assert.equal(response.status, 202);
  assert.equal(await response.text(), 'delegated');
});

test('prevents only duplicate normalized school identities', async () => {
  const database = createRegistrationDatabase();
  const baseSchool = {
    schoolName: 'اختبار 2',
    schoolStage: 'متوسطة',
    educationDepartment: 'إدارة التعليم بمنطقة المدينة المنورة',
    registrationContactName: 'مسؤول التسجيل',
    registrationContactPhone: '0512345678',
    registrationContactConsent: true
  };

  const firstToken = await verifyRegistrationPhone(
    database,
    baseSchool.registrationContactPhone
  );
  const first = await registerSchool(database, baseSchool, firstToken);
  assert.equal(first.response.status, 201);
  assert.equal(first.body.ok, true);
  assert.equal(Object.hasOwn(first.body.school, 'registrationContactName'), false);
  assert.equal(Object.hasOwn(first.body.school, 'registrationContactPhone'), false);
  assert.equal(database.inserted, 1);
  assert.equal(database.rows[0].registration_contact_name, 'مسؤول التسجيل');
  assert.equal(database.rows[0].registration_contact_phone, '+966512345678');
  const identityQuery = database.statements.find((item) =>
    item.sql.startsWith('SELECT 1 AS found')
  );
  assert.ok(identityQuery);
  assert.match(identityQuery.sql, /LIMIT 1$/);
  assert.deepEqual(identityQuery.values, [
    baseSchool.schoolName,
    baseSchool.schoolStage,
    baseSchool.educationDepartment
  ]);

  const duplicate = await registerSchool(database, baseSchool);
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.code, 'duplicate_school');
  assert.equal(
    duplicate.body.error,
    'هذه المدرسة مسجلة مسبقًا بنفس المرحلة وإدارة التعليم.'
  );
  assert.equal(database.inserted, 1);

  const differentDepartment = await registerSchool(database, {
    ...baseSchool,
    educationDepartment: 'إدارة التعليم بمنطقة الحدود الشمالية'
  }, await verifyRegistrationPhone(database, baseSchool.registrationContactPhone));
  assert.equal(differentDepartment.response.status, 201);
  assert.equal(database.inserted, 2);

  const differentStage = await registerSchool(database, {
    ...baseSchool,
    stage: 'ابتدائية',
    schoolStage: undefined
  }, await verifyRegistrationPhone(database, baseSchool.registrationContactPhone));
  assert.equal(differentStage.response.status, 201);
  assert.equal(database.inserted, 3);

  const differentName = await registerSchool(database, {
    ...baseSchool,
    schoolName: 'اختبار 3'
  }, await verifyRegistrationPhone(database, baseSchool.registrationContactPhone));
  assert.equal(differentName.response.status, 201);
  assert.equal(database.inserted, 4);

  const spacedDuplicate = await registerSchool(database, {
    ...baseSchool,
    schoolName: '  اختبار   2  '
  });
  assert.equal(spacedDuplicate.response.status, 409);
  assert.equal(spacedDuplicate.body.code, 'duplicate_school');
  assert.equal(database.inserted, 4);
});

test('requires contact consent and a valid Saudi mobile number', async () => {
  const database = createRegistrationDatabase();
  const baseSchool = {
    schoolName: 'مدرسة التواصل',
    schoolStage: 'ابتدائية',
    educationDepartment: 'إدارة التعليم بمنطقة الرياض',
    registrationContactName: '',
    registrationContactConsent: true
  };

  const invalidPhone = await registerSchool(database, {
    ...baseSchool,
    registrationContactPhone: '12345'
  });
  assert.equal(invalidPhone.response.status, 400);
  assert.equal(invalidPhone.body.code, 'invalid_registration_contact_phone');

  const missingConsent = await registerSchool(database, {
    ...baseSchool,
    registrationContactPhone: '+966512345678',
    registrationContactConsent: false
  });
  assert.equal(missingConsent.response.status, 400);
  assert.equal(missingConsent.body.code, 'registration_contact_consent_required');
  assert.equal(database.inserted, 0);

  const unverifiedPhone = await registerSchool(database, {
    ...baseSchool,
    registrationContactPhone: '+966512345678'
  });
  assert.equal(unverifiedPhone.response.status, 403);
  assert.equal(unverifiedPhone.body.code, 'phone_verification_required');

  for(const [index, phone] of ['966512345678', '+966512345678'].entries()){
    const acceptedDatabase = createRegistrationDatabase();
    const verificationToken = await verifyRegistrationPhone(acceptedDatabase, phone);
    const accepted = await registerSchool(acceptedDatabase, {
      ...baseSchool,
      schoolName: `مدرسة التواصل ${index + 2}`,
      registrationContactPhone: phone
    }, verificationToken);
    assert.equal(accepted.response.status, 201);
    assert.equal(acceptedDatabase.rows[0].registration_contact_phone, '+966512345678');
  }
});

test('keeps phone verification disabled by default without querying its table', async () => {
  const baseSchool = {
    schoolName: 'مدرسة التسجيل دون واتساب',
    schoolStage: 'ابتدائية',
    educationDepartment: 'إدارة التعليم بمنطقة الرياض',
    registrationContactName: '',
    registrationContactPhone: '0500000000',
    registrationContactConsent: true
  };

  for(const flagValue of [undefined, 'false', '', 'TRUE']){
    const database = createRegistrationDatabase();
    const session = createRegistrationEnv(database, { phoneVerificationRequired: false });
    if(flagValue === undefined){
      delete session.env.PHONE_VERIFICATION_REQUIRED;
    }else{
      session.env.PHONE_VERIFICATION_REQUIRED = flagValue;
    }
    delete session.env.PHONE_VERIFICATION_SECRET;
    delete session.env.WHATSAPP_OTP_SENDER;

    const config = await registrationConfigRequest(session.env);
    assert.equal(config.response.status, 200);
    assert.equal(config.body.phoneVerificationRequired, false);

    const disabledOtp = await registrationRequest(
      session.env,
      '/api/register/send-whatsapp-code',
      { phone: baseSchool.registrationContactPhone }
    );
    assert.equal(disabledOtp.response.status, 409);
    assert.equal(disabledOtp.body.code, 'phone_verification_not_required');
    const disabledVerification = await registrationRequest(
      session.env,
      '/api/register/verify-whatsapp-code',
      { phone: baseSchool.registrationContactPhone, code: '123456' }
    );
    assert.equal(disabledVerification.response.status, 409);
    assert.equal(disabledVerification.body.code, 'phone_verification_not_required');

    const registered = await registrationRequest(
      session.env,
      '/api/schools/register',
      baseSchool
    );
    assert.equal(registered.response.status, 201);
    assert.equal(registered.body.ok, true);
    assert.equal(
      database.statements.some(({ sql }) => sql.includes('phone_verifications')),
      false
    );
  }
});

test('reports phone verification as enabled only for the exact true flag', async () => {
  const database = createRegistrationDatabase();
  const session = createRegistrationEnv(database);
  const config = await registrationConfigRequest(session.env);

  assert.equal(config.response.status, 200);
  assert.equal(config.body.phoneVerificationRequired, true);
  assert.equal(config.response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(Object.keys(config.body), ['phoneVerificationRequired']);
});

test('limits registration JSON bodies and rejects malformed JSON', async () => {
  const database = createRegistrationDatabase();
  const session = createRegistrationEnv(database);

  const malformed = await rawRegistrationRequest(
    session.env,
    '/api/register/send-whatsapp-code',
    '{"phone":'
  );
  assert.equal(malformed.response.status, 400);
  assert.equal(malformed.body.code, 'invalid_json');

  const allowed = await registrationRequest(
    session.env,
    '/api/register/send-whatsapp-code',
    { phone: '0500000000' }
  );
  assert.equal(allowed.response.status, 200);
  assert.equal(allowed.body.status, 'code_sent');

  const oversized = await rawRegistrationRequest(
    session.env,
    '/api/register/send-whatsapp-code',
    JSON.stringify({ phone: '0500000000', padding: 'x'.repeat(5000) })
  );
  assert.equal(oversized.response.status, 413);
  assert.equal(oversized.body.code, 'payload_too_large');

  const declaredOversized = await rawRegistrationRequest(
    session.env,
    '/api/register/send-whatsapp-code',
    '{}',
    { 'Content-Length': '5000' }
  );
  assert.equal(declaredOversized.response.status, 413);
  assert.equal(declaredOversized.body.code, 'payload_too_large');
});

test('invalidates a reserved OTP after provider failure without leaking secrets', async () => {
  const database = createRegistrationDatabase();
  const session = createRegistrationEnv(database);
  session.env.WHATSAPP_OTP_SENDER = async () => {
    throw new Error('provider detail with 123456 and test-only-access-token');
  };

  const failed = await registrationRequest(
    session.env,
    '/api/register/send-whatsapp-code',
    { phone: '0500000000' }
  );
  assert.equal(failed.response.status, 502);
  assert.equal(failed.body.code, 'whatsapp_send_failed');
  assert.equal(database.verifications[0].code_hash, '');
  assert.ok(Date.parse(database.verifications[0].expires_at) <= Date.now());
  assert.doesNotMatch(
    JSON.stringify(failed.body),
    /123456|code_hash|verificationToken|test-only-access-token|500000000/
  );
});

test('fails closed when test mode has no approved WhatsApp recipients', async () => {
  const database = createRegistrationDatabase();
  const session = createRegistrationEnv(database);
  session.env.WHATSAPP_TEST_MODE = 'true';

  const response = await registrationRequest(
    session.env,
    '/api/register/send-whatsapp-code',
    { phone: '0500000000' }
  );
  assert.equal(response.response.status, 503);
  assert.equal(response.body.code, 'whatsapp_verification_unavailable');
  assert.equal(database.verifications.length, 0);

  session.env.WHATSAPP_TEST_ALLOWED_PHONES = '0500000000';
  const disallowed = await registrationRequest(
    session.env,
    '/api/register/send-whatsapp-code',
    { phone: '0511111111' }
  );
  assert.equal(disallowed.response.status, 503);
  assert.equal(disallowed.body.code, 'whatsapp_verification_unavailable');
  assert.equal(database.verifications.length, 0);
});

test('secures the WhatsApp verification lifecycle without real provider secrets', async () => {
  const database = createRegistrationDatabase();
  const session = createRegistrationEnv(database);
  const phone = '0512345678';

  const notRequested = await registrationRequest(
    session.env,
    '/api/register/verify-whatsapp-code',
    { phone, code: '123456' }
  );
  assert.equal(notRequested.response.status, 400);
  assert.deepEqual(notRequested.body, PUBLIC_VERIFICATION_FAILURE);

  const malformedCode = await registrationRequest(
    session.env,
    '/api/register/verify-whatsapp-code',
    { phone, code: '123' }
  );
  assert.equal(malformedCode.response.status, 400);
  assert.deepEqual(malformedCode.body, PUBLIC_VERIFICATION_FAILURE);

  const invalidPhone = await registrationRequest(
    session.env,
    '/api/register/send-whatsapp-code',
    { phone: '12345' }
  );
  assert.equal(invalidPhone.response.status, 400);
  assert.equal(invalidPhone.body.code, 'invalid_registration_contact_phone');

  const unconfiguredEnv = createRegistrationEnv(database).env;
  delete unconfiguredEnv.WHATSAPP_OTP_SENDER;
  const unconfigured = await registrationRequest(
    unconfiguredEnv,
    '/api/register/send-whatsapp-code',
    { phone }
  );
  assert.equal(unconfigured.response.status, 503);
  assert.equal(unconfigured.body.code, 'whatsapp_verification_unavailable');

  const sent = await registrationRequest(
    session.env,
    '/api/register/send-whatsapp-code',
    { phone }
  );
  assert.equal(sent.response.status, 200);
  assert.equal(sent.body.status, 'code_sent');
  const code = session.sentCodes.at(-1).code;
  assert.match(code, /^\d{6}$/);
  assert.notEqual(database.verifications[0].code_hash, code);
  assert.match(database.verifications[0].code_hash, /^[a-f0-9]{64}$/);

  const cooldown = await registrationRequest(
    session.env,
    '/api/register/send-whatsapp-code',
    { phone }
  );
  assert.equal(cooldown.response.status, 429);
  assert.equal(cooldown.body.code, 'verification_code_cooldown');

  const wrongCode = code === '999999' ? '888888' : '999999';
  for(let attempt = 1; attempt <= 5; attempt += 1){
    const wrong = await registrationRequest(
      session.env,
      '/api/register/verify-whatsapp-code',
      { phone, code: wrongCode }
    );
    assert.equal(wrong.response.status, 400);
    assert.deepEqual(wrong.body, PUBLIC_VERIFICATION_FAILURE);
    assert.equal('attemptsRemaining' in wrong.body, false);
  }
  const locked = await registrationRequest(
    session.env,
    '/api/register/verify-whatsapp-code',
    { phone, code }
  );
  assert.equal(locked.response.status, 400);
  assert.deepEqual(locked.body, PUBLIC_VERIFICATION_FAILURE);

  database.verifications[0].last_sent_at = new Date(Date.now() - 61000).toISOString();
  await registrationRequest(session.env, '/api/register/send-whatsapp-code', { phone });
  let expiringCode = session.sentCodes.at(-1).code;
  while(expiringCode === code){
    database.verifications[0].last_sent_at = new Date(Date.now() - 61000).toISOString();
    await registrationRequest(session.env, '/api/register/send-whatsapp-code', { phone });
    expiringCode = session.sentCodes.at(-1).code;
  }
  const oldCode = await registrationRequest(
    session.env,
    '/api/register/verify-whatsapp-code',
    { phone, code }
  );
  assert.equal(oldCode.response.status, 400);
  assert.deepEqual(oldCode.body, PUBLIC_VERIFICATION_FAILURE);
  database.verifications[0].expires_at = new Date(Date.now() - 1000).toISOString();
  const expired = await registrationRequest(
    session.env,
    '/api/register/verify-whatsapp-code',
    { phone, code: expiringCode }
  );
  assert.equal(expired.response.status, 400);
  assert.deepEqual(expired.body, PUBLIC_VERIFICATION_FAILURE);

  database.verifications[0].last_sent_at = new Date(Date.now() - 61000).toISOString();
  await registrationRequest(session.env, '/api/register/send-whatsapp-code', { phone });
  const validCode = session.sentCodes.at(-1).code;
  const verified = await registrationRequest(
    session.env,
    '/api/register/verify-whatsapp-code',
    { phone, code: validCode }
  );
  assert.equal(verified.response.status, 200);
  assert.equal(verified.body.status, 'verified');
  assert.ok(verified.body.verificationToken);
  assert.equal(database.verifications[0].code_hash, '');
  assert.notEqual(
    database.verifications[0].verification_token_hash,
    verified.body.verificationToken
  );

  const reusedOtp = await registrationRequest(
    session.env,
    '/api/register/verify-whatsapp-code',
    { phone, code: validCode }
  );
  assert.equal(reusedOtp.response.status, 400);
  assert.deepEqual(reusedOtp.body, PUBLIC_VERIFICATION_FAILURE);

  const registrationPayload = {
    schoolName: 'مدرسة التحقق الأحادي',
    schoolStage: 'ابتدائية',
    educationDepartment: 'إدارة التعليم بمنطقة الرياض',
    registrationContactName: '',
    registrationContactPhone: phone,
    registrationContactConsent: true,
    phoneVerificationToken: verified.body.verificationToken
  };
  const registered = await registrationRequest(
    session.env,
    '/api/schools/register',
    registrationPayload
  );
  assert.equal(registered.response.status, 201);
  assert.ok(database.verifications[0].consumed_at);

  const reused = await registrationRequest(
    session.env,
    '/api/schools/register',
    { ...registrationPayload, schoolName: 'مدرسة إعادة استخدام الرمز' }
  );
  assert.equal(reused.response.status, 403);
  assert.equal(reused.body.code, 'phone_verification_required');
});
