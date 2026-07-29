const ENCODER = new globalThis.TextEncoder();

export const PHONE_VERIFICATION_PURPOSE = 'school_registration';
export const PHONE_OTP_TTL_MS = 10 * 60 * 1000;
export const PHONE_OTP_COOLDOWN_MS = 60 * 1000;
export const PHONE_OTP_MAX_ATTEMPTS = 5;
export const PHONE_VERIFICATION_TOKEN_TTL_MS = 10 * 60 * 1000;
export const WHATSAPP_REQUEST_TIMEOUT_MS = 8 * 1000;

export function isPhoneVerificationRequired(env) {
  return String(env?.PHONE_VERIFICATION_REQUIRED || '').trim() === 'true';
}

export function isWhatsAppTestMode(env) {
  return String(env?.WHATSAPP_TEST_MODE || '').trim() === 'true';
}

export class WhatsAppOtpError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'WhatsAppOtpError';
    this.code = code;
    this.status = status;
  }
}

export function normalizeSaudiMobile(value) {
  const compact = String(value ?? '')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[\s().-]/g, '');

  if (/^05\d{8}$/.test(compact)) return `+966${compact.slice(1)}`;
  if (/^9665\d{8}$/.test(compact)) return `+${compact}`;
  return /^\+9665\d{8}$/.test(compact) ? compact : '';
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function generateOtpCode() {
  const values = new Uint32Array(1);
  const safeRange = Math.floor(0x100000000 / 1000000) * 1000000;
  do {
    globalThis.crypto.getRandomValues(values);
  } while (values[0] >= safeRange);
  return String(values[0] % 1000000).padStart(6, '0');
}

export function generateVerificationToken() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function hashOtpCode(secret, phone, code) {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    ENCODER.encode(String(secret || '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    ENCODER.encode(`${PHONE_VERIFICATION_PURPOSE}:${phone}:${code}`)
  );
  return bytesToHex(new Uint8Array(signature));
}

export async function hashVerificationToken(token) {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    ENCODER.encode(String(token || ''))
  );
  return bytesToHex(new Uint8Array(digest));
}

export function isOtpCode(value) {
  return /^\d{6}$/.test(String(value || '').trim());
}

export function normalizeWhatsAppGraphApiVersion(value) {
  const version = String(value || '').trim();
  return /^v[1-9]\d{0,2}\.\d{1,2}$/.test(version) ? version : '';
}

export function normalizeWhatsAppPhoneNumberId(value) {
  const phoneNumberId = String(value || '').trim();
  return /^\d{5,30}$/.test(phoneNumberId) ? phoneNumberId : '';
}

export function normalizeWhatsAppTemplateName(value) {
  const templateName = String(value || '').trim();
  return /^[a-z0-9_]{1,512}$/.test(templateName) ? templateName : '';
}

export function normalizeWhatsAppTemplateLanguage(value) {
  const language = String(value || '').trim();
  return /^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language) ? language : '';
}

function getWhatsAppTestAllowedPhones(env) {
  return String(env?.WHATSAPP_TEST_ALLOWED_PHONES || '')
    .split(/[\s,;]+/)
    .map(normalizeSaudiMobile)
    .filter(Boolean);
}

export function isWhatsAppTestRecipientAllowed(env, phone) {
  if (!isWhatsAppTestMode(env)) return true;
  const normalizedPhone = normalizeSaudiMobile(phone);
  return Boolean(
    normalizedPhone && getWhatsAppTestAllowedPhones(env).includes(normalizedPhone)
  );
}

export function buildWhatsAppMessagesEndpoint(env) {
  const version = normalizeWhatsAppGraphApiVersion(env?.WHATSAPP_GRAPH_API_VERSION);
  const phoneNumberId = normalizeWhatsAppPhoneNumberId(env?.WHATSAPP_PHONE_NUMBER_ID);
  if (!version || !phoneNumberId) return '';
  return `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
}

export function buildWhatsAppOtpTemplatePayload(env, phone, code) {
  return {
    messaging_product: 'whatsapp',
    to: phone.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: normalizeWhatsAppTemplateName(env.WHATSAPP_OTP_TEMPLATE_NAME),
      language: {
        code: normalizeWhatsAppTemplateLanguage(env.WHATSAPP_TEMPLATE_LANGUAGE)
      },
      // Must match the approved Meta template before any real send is attempted.
      components: [{
        type: 'body',
        parameters: [{ type: 'text', text: code }]
      }]
    }
  };
}

export function isWhatsappOtpConfigured(env) {
  if (
    isWhatsAppTestMode(env) &&
    getWhatsAppTestAllowedPhones(env).length === 0
  ) {
    return false;
  }
  if (typeof env.WHATSAPP_OTP_SENDER === 'function') return true;
  return Boolean(
    String(env.WHATSAPP_ACCESS_TOKEN || '').trim() &&
    normalizeWhatsAppPhoneNumberId(env.WHATSAPP_PHONE_NUMBER_ID) &&
    normalizeWhatsAppTemplateName(env.WHATSAPP_OTP_TEMPLATE_NAME) &&
    normalizeWhatsAppTemplateLanguage(env.WHATSAPP_TEMPLATE_LANGUAGE) &&
    normalizeWhatsAppGraphApiVersion(env.WHATSAPP_GRAPH_API_VERSION)
  );
}

export function isPhoneVerificationFlowConfigured(env) {
  return Boolean(
    String(env?.PHONE_VERIFICATION_SECRET || '').trim() &&
    isWhatsappOtpConfigured(env)
  );
}

function whatsappSendFailedError() {
  return new WhatsAppOtpError(
    'whatsapp_send_failed',
    502,
    'تعذر إرسال رمز التحقق حاليًا. حاول مرة أخرى لاحقًا.'
  );
}

export async function sendWhatsAppOtp(
  env,
  phone,
  code,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = WHATSAPP_REQUEST_TIMEOUT_MS
  } = {}
) {
  if (!isWhatsAppTestRecipientAllowed(env, phone)) {
    throw new WhatsAppOtpError(
      'whatsapp_verification_unavailable',
      503,
      'خدمة التحقق غير مفعلة حاليًا.'
    );
  }

  if (typeof env.WHATSAPP_OTP_SENDER === 'function') {
    await env.WHATSAPP_OTP_SENDER({ phone, code });
    return;
  }

  if (!isWhatsappOtpConfigured(env)) {
    throw new WhatsAppOtpError(
      'whatsapp_verification_unavailable',
      503,
      'خدمة التحقق غير مفعلة حاليًا.'
    );
  }

  const endpoint = buildWhatsAppMessagesEndpoint(env);
  const controller = new globalThis.AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  let response;

  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(buildWhatsAppOtpTemplatePayload(env, phone, code)),
      signal: controller.signal
    });
  } catch {
    throw whatsappSendFailedError();
  } finally {
    globalThis.clearTimeout(timeout);
  }

  if (!response.ok) {
    throw whatsappSendFailedError();
  }
}
