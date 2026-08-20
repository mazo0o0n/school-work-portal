const DAY_MS = 24 * 60 * 60 * 1000;

export const OTP_RETENTION_DAYS = 7;
export const AUDIT_LOG_RETENTION_DAYS = 365;
export const ARCHIVED_UNANSWERED_RETENTION_DAYS = 180;

export class DataRetentionCleanupError extends Error {
  constructor() {
    super('Data retention cleanup failed.');
    this.name = 'DataRetentionCleanupError';
    this.code = 'data_retention_cleanup_failed';
  }
}

function getCleanupInstant(now) {
  const instant = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(instant.getTime())) {
    throw new TypeError('Cleanup time must be a valid date.');
  }
  return instant;
}

function getDeletedCount(result) {
  return Number(result?.meta?.changes || 0);
}

export async function runDataRetentionCleanup(env, now = new Date()) {
  const database = env?.PLATFORM_DB;
  if (
    !database ||
    typeof database.prepare !== 'function' ||
    typeof database.batch !== 'function'
  ) {
    throw new DataRetentionCleanupError();
  }

  const instant = getCleanupInstant(now);
  const nowIso = instant.toISOString();
  const otpCutoffIso = new Date(
    instant.getTime() - OTP_RETENTION_DAYS * DAY_MS
  ).toISOString();
  const auditCutoffIso = new Date(
    instant.getTime() - AUDIT_LOG_RETENTION_DAYS * DAY_MS
  ).toISOString();

  const phoneVerificationCleanup = database.prepare(
    'DELETE FROM phone_verifications ' +
    'WHERE expires_at < ?1 AND julianday(expires_at) < julianday(?1) AND (' +
      '(consumed_at IS NOT NULL ' +
        'AND consumed_at < ?2 ' +
        'AND julianday(consumed_at) < julianday(?2)) OR (' +
        'consumed_at IS NULL ' +
        'AND (token_expires_at IS NULL OR (' +
          'token_expires_at < ?1 ' +
          'AND julianday(token_expires_at) < julianday(?1)' +
        ')) ' +
        'AND max(' +
          'julianday(expires_at), ' +
          'julianday(COALESCE(token_expires_at, expires_at))' +
        ') < julianday(?2)' +
      ')' +
    ')'
  ).bind(nowIso, otpCutoffIso);
  const auditLogCleanup = database.prepare(
    'DELETE FROM audit_logs ' +
    'WHERE created_at < ?1 AND julianday(created_at) < julianday(?1)'
  ).bind(auditCutoffIso);

  try {
    const [phoneResult, auditResult] = await database.batch([
      phoneVerificationCleanup,
      auditLogCleanup
    ]);

    return Object.freeze({
      phoneVerificationsDeleted: getDeletedCount(phoneResult),
      auditLogsDeleted: getDeletedCount(auditResult),
      archivedUnansweredDeleted: 0
    });
  } catch {
    throw new DataRetentionCleanupError();
  }
}
