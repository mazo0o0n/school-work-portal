import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import worker from '../src/worker.js';
import {
  ARCHIVED_UNANSWERED_RETENTION_DAYS,
  AUDIT_LOG_RETENTION_DAYS,
  DataRetentionCleanupError,
  OTP_RETENTION_DAYS,
  runDataRetentionCleanup
} from '../src/data-retention.mjs';

const NOW = new Date('2026-08-20T00:00:00.000Z');

class LocalD1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new LocalD1Statement(this.database, this.sql, values);
  }

  run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return {
      success: true,
      meta: { changes: Number(result.changes || 0) }
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
    this.database.exec('BEGIN');
    try {
      const results = statements.map((statement) => statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function createFixture() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE phone_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      token_expires_at TEXT,
      consumed_at TEXT
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE schools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_name TEXT NOT NULL
    );
    CREATE TABLE unanswered_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      archived_at TEXT
    );
  `);

  const insertPhone = database.prepare(
    'INSERT INTO phone_verifications (phone, expires_at, token_expires_at, consumed_at) ' +
    'VALUES (?, ?, ?, ?)'
  );
  insertPhone.run('+966500000001', '2026-08-12T23:59:59.999Z', null, null);
  insertPhone.run('+966500000002', '2026-08-13T00:00:00.000Z', null, null);
  insertPhone.run('+966500000003', '2026-08-19T00:00:00.000Z', null, null);
  insertPhone.run('+966500000004', '2026-08-21T00:00:00.000Z', null, null);
  insertPhone.run(
    '+966500000005',
    '2026-08-01T00:00:00.000Z',
    '2026-08-21T00:00:00.000Z',
    null
  );
  insertPhone.run(
    '+966500000006',
    '2026-08-01T00:00:00.000Z',
    '2026-08-12T23:59:59.999Z',
    null
  );
  insertPhone.run(
    '+966500000007',
    '2026-08-01T00:00:00.000Z',
    '2026-08-21T00:00:00.000Z',
    '2026-08-12T23:59:59.999Z'
  );
  insertPhone.run(
    '+966500000008',
    '2026-08-01T00:00:00.000Z',
    null,
    '2026-08-13T00:00:00.000Z'
  );

  const insertAudit = database.prepare(
    'INSERT INTO audit_logs (action, created_at) VALUES (?, ?)'
  );
  insertAudit.run('old', '2025-08-19 23:59:59');
  insertAudit.run('boundary', '2025-08-20 00:00:00');
  insertAudit.run('recent', '2026-08-19 00:00:00');

  database.prepare('INSERT INTO schools (school_name) VALUES (?)').run('مدرسة باقية');
  database.prepare(
    'INSERT INTO unanswered_questions (status, archived_at) VALUES (?, ?)'
  ).run('new', '2020-01-01T00:00:00.000Z');
  database.prepare(
    'INSERT INTO unanswered_questions (status, archived_at) VALUES (?, ?)'
  ).run('ignored', '2020-01-01T00:00:00.000Z');

  return {
    database,
    env: { PLATFORM_DB: new LocalD1Database(database) }
  };
}

function remainingPhones(database) {
  return database.prepare(
    'SELECT phone FROM phone_verifications ORDER BY phone'
  ).all().map((row) => row.phone);
}

test('defines technical retention defaults without exposing them to requests', () => {
  assert.equal(OTP_RETENTION_DAYS, 7);
  assert.equal(AUDIT_LOG_RETENTION_DAYS, 365);
  assert.equal(ARCHIVED_UNANSWERED_RETENTION_DAYS, 180);
});

test('deletes only terminal OTP rows older than seven days and keeps boundaries', async () => {
  const { database, env } = createFixture();
  const summary = await runDataRetentionCleanup(env, NOW);

  assert.deepEqual(remainingPhones(database), [
    '+966500000002',
    '+966500000003',
    '+966500000004',
    '+966500000005',
    '+966500000008'
  ]);
  assert.equal(summary.phoneVerificationsDeleted, 3);
});

test('deletes audit logs older than 365 days and keeps boundary and recent rows', async () => {
  const { database, env } = createFixture();
  const summary = await runDataRetentionCleanup(env, NOW);
  const actions = database.prepare(
    'SELECT action FROM audit_logs ORDER BY created_at'
  ).all().map((row) => row.action);

  assert.deepEqual(actions, ['boundary', 'recent']);
  assert.equal(summary.auditLogsDeleted, 1);
});

test('never deletes schools or unanswered rows and returns a PII-free summary', async () => {
  const { database, env } = createFixture();
  const summary = await runDataRetentionCleanup(env, NOW);

  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM schools').get().count, 1);
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM unanswered_questions').get().count,
    2
  );
  assert.deepEqual(summary, {
    phoneVerificationsDeleted: 3,
    auditLogsDeleted: 1,
    archivedUnansweredDeleted: 0
  });
  assert.doesNotMatch(JSON.stringify(summary), /\+966|مدرسة|question/i);
});

test('is idempotent', async () => {
  const { env } = createFixture();
  await runDataRetentionCleanup(env, NOW);
  const secondSummary = await runDataRetentionCleanup(env, NOW);

  assert.deepEqual(secondSummary, {
    phoneVerificationsDeleted: 0,
    auditLogsDeleted: 0,
    archivedUnansweredDeleted: 0
  });
});

test('uses one atomic platform batch and sanitizes failures', async () => {
  let batchCalls = 0;
  const env = {
    PLATFORM_DB: {
      prepare(sql) {
        assert.match(sql, /^DELETE FROM (phone_verifications|audit_logs)/);
        return { bind: () => ({ sql }) };
      },
      async batch() {
        batchCalls += 1;
        throw new Error('secret=private phone=+966500000000');
      }
    }
  };

  await assert.rejects(
    runDataRetentionCleanup(env, NOW),
    (error) => {
      assert.ok(error instanceof DataRetentionCleanupError);
      assert.equal(error.code, 'data_retention_cleanup_failed');
      assert.doesNotMatch(`${error.message} ${error.stack}`, /private|\+966|secret=/);
      return true;
    }
  );
  assert.equal(batchCalls, 1);
});

test('rolls back the platform batch when a later cleanup statement fails', async () => {
  const { database, env } = createFixture();
  database.exec('DROP TABLE audit_logs');

  await assert.rejects(
    runDataRetentionCleanup(env, NOW),
    DataRetentionCleanupError
  );
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM phone_verifications').get().count,
    8
  );
});

test('scheduled handler runs cleanup without changing fetch behavior', async () => {
  const { database, env } = createFixture();
  await worker.scheduled({ scheduledTime: NOW.getTime() }, env, {});

  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM audit_logs').get().count, 2);
  const response = await worker.fetch(
    new globalThis.Request('https://example.test/not-admin'),
    {
      ASSETS: { fetch: () => new globalThis.Response('asset', { status: 200 }) }
    },
    {}
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'asset');
});
