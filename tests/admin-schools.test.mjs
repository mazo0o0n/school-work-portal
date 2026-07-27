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
const loadableRegistrationSource = registrationSource.replace(
  "'./chat-security.mjs'",
  JSON.stringify(chatSecurityModuleUrl)
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
  const statements = [];
  let inserted = 0;

  const normalizeIdentityPart = (value) => String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

  return {
    rows,
    statements,
    get inserted(){
      return inserted;
    },
    binding: {
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

            if(sql.startsWith('INSERT INTO schools')){
              return {
                async run(){
                  const publicId = values[0];
                  const schoolName = values[2];
                  const schoolStage = values[3];
                  const educationDepartment = values[4];
                  const registrationContactName = values[5];
                  const registrationContactPhone = values[6];
                  const duplicate = rows.some((row) => (
                    normalizeIdentityPart(row.school_name) === normalizeIdentityPart(schoolName) &&
                    row.school_stage === schoolStage &&
                    normalizeIdentityPart(row.education_department) ===
                      normalizeIdentityPart(educationDepartment)
                  ));

                  if(duplicate){
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

async function registerSchool(database, payload){
  const response = await registrationWorker.fetch(new globalThis.Request(
    `${BASE_URL}/api/schools/register`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '198.51.100.30'
      },
      body: JSON.stringify(payload)
    }
  ), {
    PLATFORM_DB: database.binding,
    RATE_LIMIT_SALT: 'test-rate-limit-salt',
    CHAT_RATE_LIMITER: {
      async limit(){
        return { success: true };
      }
    }
  });

  return {
    response,
    body: await response.json()
  };
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

  const first = await registerSchool(database, baseSchool);
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
  });
  assert.equal(differentDepartment.response.status, 201);
  assert.equal(database.inserted, 2);

  const differentStage = await registerSchool(database, {
    ...baseSchool,
    stage: 'ابتدائية',
    schoolStage: undefined
  });
  assert.equal(differentStage.response.status, 201);
  assert.equal(database.inserted, 3);

  const differentName = await registerSchool(database, {
    ...baseSchool,
    schoolName: 'اختبار 3'
  });
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

  for(const [index, phone] of ['966512345678', '+966512345678'].entries()){
    const acceptedDatabase = createRegistrationDatabase();
    const accepted = await registerSchool(acceptedDatabase, {
      ...baseSchool,
      schoolName: `مدرسة التواصل ${index + 2}`,
      registrationContactPhone: phone
    });
    assert.equal(accepted.response.status, 201);
    assert.equal(acceptedDatabase.rows[0].registration_contact_phone, '+966512345678');
  }
});
