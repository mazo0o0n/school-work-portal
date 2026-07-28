const ENCODER = new globalThis.TextEncoder();

export const PHONE_VERIFICATION_PURPOSE = 'school_registration';
export const PHONE_OTP_TTL_MS = 10 * 60 * 1000;
export const PHONE_OTP_COOLDOWN_MS = 60 * 1000;
export const PHONE_OTP_MAX_ATTEMPTS = 5;
export const PHONE_VERIFICATION_TOKEN_TTL_MS = 10 * 60 * 1000;

export function isPhoneVerificationRequired(env) {
  return String(env?.PHONE_VERIFICATION_REQUIRED || '').trim() === 'true';
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

export function isWhatsappOtpConfigured(env) {
  if (typeof env.WHATSAPP_OTP_SENDER === 'function') return true;
  return Boolean(
    env.WHATSAPP_ACCESS_TOKEN &&
    env.WHATSAPP_PHONE_NUMBER_ID &&
    env.WHATSAPP_OTP_TEMPLATE_NAME &&
    env.WHATSAPP_TEMPLATE_LANGUAGE
  );
}

export async function sendWhatsAppOtp(env, phone, code) {
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

  const endpoint = `https://graph.facebook.com/${encodeURIComponent(
    String(env.WHATSAPP_PHONE_NUMBER_ID)
  )}/messages`;
  const response = await globalThis.fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: String(env.WHATSAPP_OTP_TEMPLATE_NAME),
        language: { code: String(env.WHATSAPP_TEMPLATE_LANGUAGE) },
        components: [{
          type: 'body',
          parameters: [{ type: 'text', text: code }]
        }]
      }
    })
  });

  if (!response.ok) {
    throw new WhatsAppOtpError(
      'whatsapp_send_failed',
      502,
      'تعذر إرسال رمز التحقق حاليًا. حاول مرة أخرى لاحقًا.'
    );
  }
}
