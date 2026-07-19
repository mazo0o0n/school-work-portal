export const MAX_CHAT_QUESTION_CHARS = 1000;
export const MAX_CHAT_REQUEST_BYTES = 16 * 1024;

export const CHAT_FALLBACK_ANSWER =
  'ما عندي معلومة مؤكدة عن هذا السؤال حاليًا، تقدر تعيد صياغته أو تراجع الجهة المختصة.';
export const CHAT_INVALID_REQUEST_ANSWER =
  'تعذر معالجة الطلب. تأكد من إرسال سؤال نصي صالح.';
export const CHAT_TEMPORARY_ERROR_ANSWER =
  'تعذر الوصول إلى مساعد المنصة مؤقتًا. حاول مرة أخرى لاحقًا.';

const NON_PRODUCTION_ENVIRONMENTS = new Set([
  'development',
  'dev',
  'local',
  'test'
]);

export class ChatRequestError extends Error {
  constructor(code, status, publicMessage = CHAT_INVALID_REQUEST_ANSWER) {
    super(code);
    this.name = 'ChatRequestError';
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

function isJsonContentType(request) {
  const contentType = String(request.headers.get('content-type') || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();

  return contentType === 'application/json' || /^application\/[\w.+-]+\+json$/.test(contentType);
}

async function readBodyWithLimit(request) {
  const contentLength = Number(request.headers.get('content-length'));
  if(Number.isFinite(contentLength) && contentLength > MAX_CHAT_REQUEST_BYTES) {
    throw new ChatRequestError('request_too_large', 413);
  }

  if(!request.body) return '';

  const reader = request.body.getReader();
  const decoder = new globalThis.TextDecoder();
  let bytesRead = 0;
  let text = '';

  while(true) {
    const { done, value } = await reader.read();
    if(done) break;

    bytesRead += value.byteLength;
    if(bytesRead > MAX_CHAT_REQUEST_BYTES) {
      await reader.cancel();
      throw new ChatRequestError('request_too_large', 413);
    }

    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

export async function parseChatRequest(request) {
  if(!isJsonContentType(request)) {
    throw new ChatRequestError('unsupported_content_type', 415);
  }

  const rawBody = await readBodyWithLimit(request);
  let payload;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new ChatRequestError('invalid_json', 400);
  }

  if(!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ChatRequestError('invalid_json', 400);
  }

  const rawQuestion = payload.message ?? payload.question;
  if(typeof rawQuestion !== 'string') {
    throw new ChatRequestError('invalid_question_type', 400);
  }

  const question = rawQuestion.trim();
  if(!question) {
    throw new ChatRequestError('empty_question', 400);
  }

  if(Array.from(question).length > MAX_CHAT_QUESTION_CHARS) {
    throw new ChatRequestError('question_too_long', 413);
  }

  return { payload, question };
}

export function isChatDebugEnabled(env = {}) {
  const environment = String(env.APP_ENV || env.ENVIRONMENT || '')
    .trim()
    .toLowerCase();

  return env.DEBUG_CHAT === 'true' && NON_PRODUCTION_ENVIRONMENTS.has(environment);
}

export function sanitizeQuestionForStorage(value) {
  return String(value || '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, '[SECRET_REDACTED]')
    .replace(/\b(?:api[_-]?key|secret|token|access[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{8,}["']?/gi, '[SECRET_REDACTED]')
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}\b/gi, '[SECRET_REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL_REDACTED]')
    .replace(/(?<!\d)(?:(?:\+|00)966[\s-]?|0)?5(?:[\s-]?\d){8}(?!\d)/g, '[PHONE_REDACTED]')
    .replace(/(?<!\d)(?:\d[\s-]?){10,18}(?!\d)/g, '[NUMBER_REDACTED]');
}
