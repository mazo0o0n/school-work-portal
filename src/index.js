import {
  CHAT_FALLBACK_ANSWER,
  CHAT_INVALID_REQUEST_ANSWER,
  CHAT_TEMPORARY_ERROR_ANSWER,
  ChatRequestError,
  isChatDebugEnabled,
  parseChatRequest,
  sanitizeQuestionForStorage
} from './chat-security.mjs';
import {
  PHONE_OTP_COOLDOWN_MS,
  PHONE_OTP_MAX_ATTEMPTS,
  PHONE_OTP_TTL_MS,
  PHONE_VERIFICATION_PURPOSE,
  PHONE_VERIFICATION_TOKEN_TTL_MS,
  WhatsAppOtpError,
  generateOtpCode,
  generateVerificationToken,
  hashOtpCode,
  hashVerificationToken,
  isOtpCode,
  isPhoneVerificationFlowConfigured,
  isPhoneVerificationRequired,
  isWhatsAppTestRecipientAllowed,
  normalizeSaudiMobile,
  sendWhatsAppOtp
} from './registration-verification.mjs';

const FALLBACK_ANSWER = CHAT_FALLBACK_ANSWER;
const EMBEDDING_MODEL = '@cf/qwen/qwen3-embedding-0.6b';
const CHAT_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
const MIN_SCORE = 0.55;
const TOP_K = 4;
const MAX_ASSISTANT_SEARCH_QUERIES = 5;
const UNANSWERED_STATUSES = new Set(['new', 'reviewed', 'added_to_knowledge', 'ignored']);
const UNANSWERED_DEFAULT_PAGE_SIZE = 50;
const UNANSWERED_MAX_PAGE_SIZE = 50;
const ADMIN_PATCH_MAX_REQUEST_BYTES = 4 * 1024;
const SECRET_TOKEN_ENCODER = new TextEncoder();
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_ALLOWED = 'allowed';
const RATE_LIMIT_DENIED = 'denied';
const RATE_LIMIT_UNAVAILABLE = 'unavailable';
const INTERNAL_PAGE_PATHS = new Set([
  '/admin-unanswered.html',
  '/assistant-status.html',
  '/knowledge-status.html',
  '/assistant-test.html'
]);

function jsonResponse(body, status = 200, extraHeaders = {}){
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      'Expires': '0',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  });
}

class AdminPatchRequestError extends Error{
  constructor(code, status, publicMessage){
    super(code);
    this.name = 'AdminPatchRequestError';
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

function isApplicationJsonRequest(request){
  const contentType = String(request.headers.get('content-type') || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  return contentType === 'application/json';
}

async function readAdminPatchBody(request){
  const contentLengthHeader = request.headers.get('content-length');
  if(contentLengthHeader !== null){
    const contentLength = Number(contentLengthHeader);
    if(Number.isFinite(contentLength) && contentLength > ADMIN_PATCH_MAX_REQUEST_BYTES){
      throw new AdminPatchRequestError('request_too_large', 413, 'Request too large');
    }
  }

  if(!request.body) return '';

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';

  while(true){
    const { done, value } = await reader.read();
    if(done) break;

    bytesRead += value.byteLength;
    if(bytesRead > ADMIN_PATCH_MAX_REQUEST_BYTES){
      await reader.cancel();
      throw new AdminPatchRequestError('request_too_large', 413, 'Request too large');
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

async function parseAdminPatchRequest(request){
  if(!isApplicationJsonRequest(request)){
    throw new AdminPatchRequestError(
      'unsupported_content_type',
      415,
      'Unsupported content type'
    );
  }

  const rawBody = await readAdminPatchBody(request);
  try{
    return JSON.parse(rawBody);
  }catch{
    throw new AdminPatchRequestError('invalid_json', 400, 'Invalid JSON');
  }
}

function rateLimitResponse(scope){
  const isChat = scope === 'chat';
  const message = isChat
    ? 'تم تجاوز الحد المسموح مؤقتًا. انتظر دقيقة ثم حاول مرة أخرى.'
    : 'تم تجاوز عدد محاولات الدخول. انتظر دقيقة ثم حاول مرة أخرى.';

  return jsonResponse(
    isChat
      ? {
          answer: message,
          source: 'مساعد المنصة',
          notFound: true,
          error: 'rate_limited'
        }
      : {
          error: message,
          code: 'rate_limited'
        },
    429,
    { 'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS) }
  );
}

function rateLimitUnavailableResponse(scope){
  const isChat = scope === 'chat';
  const message = 'خدمة الحماية غير متاحة مؤقتًا. حاول مرة أخرى لاحقًا.';

  return jsonResponse(
    isChat
      ? {
          answer: message,
          source: 'مساعد المنصة',
          notFound: true,
          error: 'rate_limit_unavailable'
        }
      : {
          error: message,
          code: 'rate_limit_unavailable'
        },
    503
  );
}

async function getRateLimitClientKey(request, env, scope){
  const clientAddress = String(request.headers.get('CF-Connecting-IP') || '').trim();
  const secretSalt = String(env.RATE_LIMIT_SALT || '').trim();
  if(!clientAddress || !secretSalt){
    return '';
  }

  const digest = await crypto.subtle.digest(
    'SHA-256',
    SECRET_TOKEN_ENCODER.encode(`${secretSalt}:${scope}:${clientAddress}`)
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function isRateLimitAllowed(request, env, scope, limiter){
  if(!limiter || typeof limiter.limit !== 'function'){
    console.error('Rate limiting configuration unavailable.');
    return RATE_LIMIT_UNAVAILABLE;
  }

  const key = await getRateLimitClientKey(request, env, scope);
  if(!key){
    console.error('Rate limiting configuration unavailable.');
    return RATE_LIMIT_UNAVAILABLE;
  }

  try{
    const result = await limiter.limit({ key });
    if(result?.success === true) return RATE_LIMIT_ALLOWED;
    if(result?.success === false) return RATE_LIMIT_DENIED;
    console.error('Rate limiting binding returned an invalid result.');
    return RATE_LIMIT_UNAVAILABLE;
  }catch{
    console.error('Rate limiting binding unavailable.');
    return RATE_LIMIT_UNAVAILABLE;
  }
}

async function fetchInternalAsset(request, env, pathname){
  const response = await env.ASSETS.fetch(request);
  if(!INTERNAL_PAGE_PATHS.has(pathname)){
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function withDebug(env, body, debug){
  if(isChatDebugEnabled(env)){
    return {
      ...body,
      debug
    };
  }

  return body;
}

function fallbackBody(source = 'قاعدة معرفة المنصة'){
  return {
    answer: FALLBACK_ANSWER,
    source,
    notFound: true
  };
}

function invalidRequestBody(error){
  return {
    answer: error.publicMessage || CHAT_INVALID_REQUEST_ANSWER,
    source: 'مساعد المنصة',
    notFound: true,
    error: error.code || 'invalid_request'
  };
}

function temporaryErrorBody(){
  return {
    answer: CHAT_TEMPORARY_ERROR_ANSWER,
    source: 'مساعد المنصة',
    notFound: true,
    error: 'temporary_error'
  };
}

function getPagePath(payload, request){
  const explicitPath = String(payload?.page_path || payload?.pagePath || payload?.path || '').trim();
  if(explicitPath){
    return explicitPath.slice(0, 300);
  }

  const referer = request.headers.get('referer');
  if(!referer){
    return '';
  }

  try{
    return new URL(referer).pathname.slice(0, 300);
  }catch(_){
    return '';
  }
}

async function saveUnansweredQuestion(env, details){
  if(!env.UNANSWERED_DB){
    return;
  }

  try{
    const question = sanitizeQuestionForStorage(details.question).trim().slice(0, 1000);
    if(!question){
      return;
    }

    const normalizedQuestion = normalizeArabicQuestion(question).slice(0, 1000);
    const reason = String(details.reason || 'unknown').trim().slice(0, 80);
    const pagePath = sanitizeQuestionForStorage(details.pagePath).trim().slice(0, 300);
    const now = new Date().toISOString();

    await env.UNANSWERED_DB.prepare(
      [
        'INSERT INTO unanswered_questions',
        '(question, normalized_question, reason, page_path, source, status, repeat_count, created_at, updated_at)',
        'VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)',
        'ON CONFLICT(normalized_question)',
        'WHERE normalized_question IS NOT NULL AND normalized_question != \'\'',
        'DO UPDATE SET',
        'repeat_count = unanswered_questions.repeat_count + 1,',
        'reason = excluded.reason,',
        'page_path = COALESCE(NULLIF(excluded.page_path, \'\'), unanswered_questions.page_path),',
        'updated_at = excluded.updated_at'
      ].join(' ')
    ).bind(
      question,
      normalizedQuestion,
      reason,
      pagePath,
      'unanswered_auto',
      'new',
      now
    ).run();
  }catch(error){
    console.error('Saving unanswered question failed:', error?.message || error);
  }
}

function extractEmbedding(payload){
  const data =
    payload?.data ??
    payload?.result?.data ??
    payload?.embeddings ??
    payload?.result?.embeddings;

  if(Array.isArray(data) && Array.isArray(data[0])){
    return data[0];
  }

  if(Array.isArray(data) && Array.isArray(data[0]?.embedding)){
    return data[0].embedding;
  }

  if(Array.isArray(payload?.embedding)){
    return payload.embedding;
  }

  throw new Error('Unable to extract embedding from Workers AI response.');
}

function extractGeneratedText(payload){
  return String(
    payload?.response ??
    payload?.result?.response ??
    payload?.text ??
    payload?.result?.text ??
    ''
  ).trim();
}

function getMatchesWithText(vectorizeResult, queryIndex = 0){
  return (vectorizeResult?.matches || [])
    .map((match) => ({
      id: match.id,
      score: Number(match.score || 0),
      queryIndex,
      text: String(match.metadata?.text || '').trim(),
      source: String(match.metadata?.source || 'قاعدة معرفة المنصة'),
      section: String(match.metadata?.section || 'قاعدة المعرفة')
    }))
    .filter((match) => match.text);
}

function buildContext(matches){
  return matches
    .map((match, index) => {
      return [
        `المقطع ${index + 1}`,
        `المصدر: ${match.source}`,
        `القسم: ${match.section}`,
        match.text
      ].join('\n');
    })
    .join('\n\n---\n\n');
}

function extractKnowledgeImages(matches){
  const imagePattern = /(?:^|\n)الصورة المرتبطة:\s*(\/assets\/knowledge-images\/[A-Za-z0-9._/-]+\.(?:jpg|jpeg|png|webp))(?=\s|$)/gi;
  const images = [];
  const seen = new Set();

  for(const match of matches){
    for(const imageMatch of String(match.text || '').matchAll(imagePattern)){
      const src = imageMatch[1];
      if(src.includes('..') || seen.has(src)) continue;
      seen.add(src);
      const label = String(match.section || 'صورة من معرفة المنصة').trim();
      images.push({
        src,
        alt: label,
        caption: label
      });
    }
  }

  return images;
}

function normalizeArabicQuestion(value){
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[إأآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/\b(وشو|ايش|وش)\b/g, 'ما هو')
    .replace(/\b(وين|فين)\b/g, 'اين')
    .replace(/\b(ابي|ابغى)\b/g, 'اريد')
    .replace(/\bمنصه\b/g, 'منصة')
    .replace(/\s+/g, ' ')
    .trim();
}

const ASSISTANT_QUERY_SYNONYMS = Object.freeze([
  {
    pattern: /(?:^|\s)(?:عقود|تعاقد)(?:\s|$)|بيحولون\s+المعلمين/,
    query: 'عقود المعلمين تحويل المعلمين إلى نظام التعاقد',
    clarification: 'تقصد عقود المعلمين، أو تحويل المعلمين إلى نظام التعاقد؟'
  },
  {
    pattern: /(?:^|\s)(?:اهلي|اهلية|الاهلي|الاهلية)(?:\s|$)/,
    query: 'المدارس الأهلية المؤسسات التعليمية الخاصة',
    clarification: 'تقصد تنظيم المدارس الأهلية، أو وضع العاملين فيها؟'
  },
  {
    pattern: /ذوي\s+الاعاقة|ذوو\s+الاعاقة|الطلاب\s+ذوو\s+الاعاقة|الطلبة\s+ذوو\s+الاعاقة/,
    query: 'الطلبة ذوو الإعاقة الطلاب ذوو الإعاقة',
    clarification: 'تقصد خدمات الطلبة ذوي الإعاقة، أو الأنظمة المرتبطة بهم؟'
  },
  {
    pattern: /(?:^|\s)(?:العقوبات|عقوبات|المخالفات|مخالفات|الجزاءات|جزاءات)(?:\s|$)/,
    query: 'مخالفات المدارس العقوبات والجزاءات',
    clarification: 'تقصد مخالفات المدارس، أو الجزاءات المترتبة عليها؟'
  },
  {
    pattern: /(?:^|\s)(?:المجلس|مجلس)(?:\s|$)/,
    query: 'مجلس شؤون التعليم العام اختصاصات المجلس',
    clarification: 'تقصد اختصاصات مجلس شؤون التعليم العام؟'
  },
  {
    pattern: /(?:^|\s)(?:النقل|نقل)(?:\s|$)/,
    query: 'النقل المدرسي',
    clarification: 'تقصد النقل المدرسي، أو حركة نقل المعلمين؟'
  },
  {
    pattern: /(?:^|\s)(?:التقويم|تقويم)(?:\s|$)/,
    query: 'التقويم الدراسي الخطة الزمنية للعام الدراسي',
    clarification: 'تقصد التقويم الدراسي، أو الخطة الزمنية للعام؟'
  },
  {
    pattern: /(?:^|\s)(?:المدير|مدير)(?:\s|$)|قائد\s+المدرسة/,
    query: 'مدير المدرسة قائد المدرسة',
    clarification: 'تقصد مهام مدير المدرسة، أو أحد إجراءاته الإدارية؟'
  },
  {
    pattern: /(?:^|\s)(?:الوكيل|وكيل)(?:\s|$)/,
    query: 'وكيل المدرسة',
    clarification: 'تقصد مهام وكيل المدرسة، أو أحد اختصاصاته؟'
  },
  {
    pattern: /(?:^|\s)(?:الترقية|ترقية|الترقيات|ترقيات)(?:\s|$)/,
    query: 'ترقيات المعلمين ترقية المعلمين',
    clarification: 'تقصد ترقيات المعلمين، أو متطلبات الترقية؟'
  }
]);

const ASSISTANT_QUERY_STOP_WORDS = new Set([
  'ما', 'هو', 'هي', 'هل', 'عن', 'في', 'على', 'الى', 'سالفة', 'وضعها',
  'يسوي', 'شيء', 'شي', 'لهم', 'لي', 'ابي', 'ابغى', 'اريد'
]);

function buildCondensedAssistantQuery(question){
  return normalizeArabicQuestion(question)
    .replace(/[؟?!،,.:;؛]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !ASSISTANT_QUERY_STOP_WORDS.has(word))
    .join(' ')
    .trim();
}

function getAssistantQueryConcepts(question){
  const normalized = normalizeArabicQuestion(question)
    .replace(/[؟?!،,.:;؛]/g, ' ')
    .trim();
  return ASSISTANT_QUERY_SYNONYMS.filter((entry) => entry.pattern.test(normalized));
}

function buildAssistantSearchQueries(question){
  const original = String(question || '').trim();
  const normalized = normalizeArabicQuestion(original);
  const condensed = buildCondensedAssistantQuery(original);
  const concepts = getAssistantQueryConcepts(original);
  const queries = [];

  const addQuery = (value) => {
    const query = String(value || '').trim().replace(/\s+/g, ' ');
    if(query && !queries.includes(query) && queries.length < MAX_ASSISTANT_SEARCH_QUERIES){
      queries.push(query);
    }
  };

  addQuery(original);
  addQuery(normalized);
  addQuery(condensed);
  if(normalized.includes('التطوير المهني التعليمي')){
    addQuery('استفسارات شائعة حول احتساب نقاط التطوير المهني للترقية');
  }
  concepts.forEach((concept) => addQuery(concept.query));
  if(concepts.length){
    addQuery(`${condensed || normalized} ${concepts.map((concept) => concept.query).join(' ')}`);
  }

  // Keep at least three deterministic retrieval angles without an extra LLM call.
  addQuery(`${condensed || normalized} معلومات تعليمية رسمية`);
  addQuery(`الأنظمة والخدمات التعليمية ${condensed || normalized}`);

  return queries.slice(0, MAX_ASSISTANT_SEARCH_QUERIES);
}

function getAssistantClarification(question){
  const concepts = getAssistantQueryConcepts(question);
  if(concepts.length){
    return concepts[0].clarification;
  }

  const normalized = normalizeArabicQuestion(question);
  const looksEducational = /مدرس|تعليم|معلم|طالب|نظام|لائحة|اختبار|منهج|وزارة/.test(normalized);
  return looksEducational
    ? 'تقصد نظام التعليم العام، أو التقويم الدراسي، أو الترقيات؟'
    : '';
}

const ACADEMIC_CALENDAR_IMAGE = Object.freeze({
  src: '/assets/knowledge-images/academic-calendar-1448-1449-2026-2027.jpg',
  alt: 'التقويم الدراسي 1448 / 1449 هـ - 2026 / 2027 م',
  caption: 'التقويم الدراسي 1448 / 1449 هـ - 2026 / 2027 م'
});

function isAcademicCalendarQuestion(question){
  const normalized = normalizeArabicQuestion(question)
    .replace(/[؟?]/g, '')
    .replace(/\s*\/\s*/g, '/')
    .trim();

  if(!normalized) return false;

  return (
    /(?:^|\s)(?:التقويم الدراسي|تقويم دراسي)(?:\s|$)/.test(normalized) ||
    normalized === 'التقويم' ||
    /(?:^|\s)تقويم\s+(?:1448|1449)(?:\s|$|\/)/.test(normalized) ||
    /(?:^|\s)2026\/2027(?:\s|$)/.test(normalized) ||
    normalized.includes('بداية الدراسة') ||
    normalized.includes('الاجازات الدراسية') ||
    normalized.includes('اجازة منتصف العام') ||
    normalized.includes('بداية اجازة نهاية العام')
  );
}

function isExternalPlatformDefinitionQuestion(question){
  const normalized = normalizeArabicQuestion(question);
  const original = String(question || '').trim();
  const combined = `${original} ${normalized}`;

  if(!combined.includes('منصة') || combined.includes('منصة التنظيم المدرسي')){
    return false;
  }

  if(/\b(رابط|اين|وين|فين|القى|ألقى|موجود|موجودة|ضمن|داخل|في الموقع)\b/.test(combined)){
    return false;
  }

  return /(^|\s)(وش|وشو|ايش|ما هو|ما هي)\s+منصة\s+\S+/.test(combined) ||
    /\b(عرفني على|اشرح)\s+منصة\s+\S+/.test(combined);
}

function getLexicalMatchRatio(question, match){
  const questionTokens = new Set(buildCondensedAssistantQuery(question).split(/\s+/).filter(Boolean));
  if(!questionTokens.size) return 0;

  const matchText = normalizeArabicQuestion(
    `${match.section || ''} ${match.source || ''} ${match.text || ''}`
  );
  let matched = 0;
  questionTokens.forEach((token) => {
    if(matchText.includes(token)) matched += 1;
  });
  return matched / questionTokens.size;
}

function mergeMatches(matchGroups, question){
  const byId = new Map();
  matchGroups.flat().forEach((match) => {
    const queryBonus = Math.max(0, 0.03 - (match.queryIndex * 0.0075));
    const lexicalBonus = getLexicalMatchRatio(question, match) * 0.025;
    const rankedMatch = {
      ...match,
      rankScore: match.score + queryBonus + lexicalBonus
    };
    const current = byId.get(match.id);
    if(!current || rankedMatch.rankScore > current.rankScore){
      byId.set(match.id, rankedMatch);
    }
  });
  return [...byId.values()]
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, TOP_K);
}

async function handleChat(request, env){
  let question = '';
  let pagePath = '';

  try{
    let payload;
    try{
      ({ payload, question } = await parseChatRequest(request));
    }catch(error){
      if(error instanceof ChatRequestError){
        return jsonResponse(invalidRequestBody(error), error.status);
      }
      throw error;
    }

    pagePath = getPagePath(payload, request);

    if(isExternalPlatformDefinitionQuestion(question)){
      await saveUnansweredQuestion(env, {
        question,
        pagePath,
        reason: 'external_guard'
      });
      return jsonResponse(withDebug(env, fallbackBody(), {
        type: 'external_platform_definition_guard'
      }));
    }

    if(!env.AI || !env.VECTORIZE){
      await saveUnansweredQuestion(env, {
        question,
        pagePath,
        reason: 'missing_bindings'
      });
      return jsonResponse(
        withDebug(env, temporaryErrorBody(), { type: 'missing_bindings' }),
        503
      );
    }

    const searchQueries = buildAssistantSearchQueries(question);
    const matchGroups = await Promise.all(searchQueries.map(async (query, queryIndex) => {
      const embeddingResult = await env.AI.run(EMBEDDING_MODEL, {
        text: query
      });
      const queryEmbedding = extractEmbedding(embeddingResult);

      const vectorizeResult = await env.VECTORIZE.query(queryEmbedding, {
        topK: TOP_K,
        returnMetadata: true
      });

      return getMatchesWithText(vectorizeResult, queryIndex);
    }));

    const matches = mergeMatches(matchGroups, question);
    const topScore = matches.reduce((highest, match) => Math.max(highest, match.score), 0);
    const usableMatches = matches.filter((match) => match.score >= MIN_SCORE);

    if(!usableMatches.length || topScore < MIN_SCORE){
      await saveUnansweredQuestion(env, {
        question,
        pagePath,
        reason: usableMatches.length ? 'low_score' : 'no_matches'
      });
      const clarification = getAssistantClarification(question);
      const responseBody = clarification
        ? {
            answer: clarification,
            source: 'مساعد المنصة',
            notFound: true,
            clarification: true
          }
        : fallbackBody();
      return jsonResponse(withDebug(env, responseBody, {
        type: 'no_retrieved_context',
        searchQueryCount: searchQueries.length,
        minScore: MIN_SCORE,
        topScore,
        matches: matches.map((match) => ({
          id: match.id,
          score: match.score,
          source: match.source,
          section: match.section,
          hasText: Boolean(match.text)
        }))
      }));
    }

    const context = buildContext(usableMatches);
    const generation = await env.AI.run(CHAT_MODEL, {
      messages: [
        {
          role: 'system',
          content: [
            'أنت مساعد منصة التنظيم المدرسي والموارد التعليمية.',
            'أجب فقط من السياق المرفق.',
            'لا تستخدم معرفة عامة.',
            'لا تخترع أي معلومة.',
            'لا تذكر أرقام المقاطع أو كلمة chunk أو عبارات مثل وفقًا للمقطع أو المقطع 1 أو المقطع 2.',
            'لا تقل للمستخدم القسم كذا أو المصدر كذا داخل نص الإجابة. اكتب إجابة طبيعية مباشرة فقط.',
            `إذا لم تكن الإجابة موجودة في السياق، أرجع هذا النص حرفيًا: "${FALLBACK_ANSWER}"`,
            'أجب بالعربية وباختصار.'
          ].join('\n')
        },
        {
          role: 'user',
          content: [
            'السياق المسترجع من مستندات المنصة:',
            context,
            '',
            'سؤال المستخدم:',
            question
          ].join('\n')
        }
      ]
    });

    const answer = extractGeneratedText(generation) || FALLBACK_ANSWER;
    const notFound = answer.trim() === FALLBACK_ANSWER;
    if(notFound){
      await saveUnansweredQuestion(env, {
        question,
        pagePath,
        reason: 'generated_fallback'
      });
    }

    const body = {
      answer,
      source: notFound ? 'قاعدة معرفة المنصة' : usableMatches[0].source,
      notFound
    };

    const images = notFound ? [] : extractKnowledgeImages(usableMatches);
    if(isAcademicCalendarQuestion(question) && !images.some((image) => image.src === ACADEMIC_CALENDAR_IMAGE.src)){
      images.unshift({ ...ACADEMIC_CALENDAR_IMAGE });
    }
    if(images.length) body.images = images;

    return jsonResponse(withDebug(env, body, {
      type: 'strict_rag_answer',
      model: CHAT_MODEL,
      embeddingModel: EMBEDDING_MODEL,
      searchQueryCount: searchQueries.length,
      minScore: MIN_SCORE,
      topScore,
      usedMatches: usableMatches.map((match) => ({
        id: match.id,
        score: match.score,
        source: match.source,
        section: match.section
      }))
    }));
  }catch(error){
    console.error('Strict RAG chat failed:', error?.message || error);
    await saveUnansweredQuestion(env, {
      question,
      pagePath,
      reason: 'strict_rag_failed'
    });
    return jsonResponse(
      withDebug(env, temporaryErrorBody(), {
        type: 'strict_rag_failed',
        message: String(error?.message || error).slice(0, 1000)
      }),
      502
    );
  }
}

async function getAdminUnansweredSummary(env){
  const statements = [
    env.UNANSWERED_DB.prepare(
      'SELECT status, COUNT(*) AS count FROM unanswered_questions GROUP BY status'
    ),
    env.UNANSWERED_DB.prepare(
      [
        'SELECT reason, COUNT(*) AS count',
        'FROM unanswered_questions',
        'GROUP BY reason',
        'ORDER BY count DESC, reason ASC'
      ].join(' ')
    ),
    env.UNANSWERED_DB.prepare(
      [
        'SELECT id, question, reason, status, repeat_count, updated_at',
        'FROM unanswered_questions',
        'ORDER BY repeat_count DESC, updated_at DESC, id DESC',
        'LIMIT 5'
      ].join(' ')
    )
  ];
  const results = typeof env.UNANSWERED_DB.batch === 'function'
    ? await env.UNANSWERED_DB.batch(statements)
    : await Promise.all(statements.map((statement) => statement.all()));
  const counts = {
    all: 0,
    new: 0,
    reviewed: 0,
    added_to_knowledge: 0,
    ignored: 0
  };

  for(const item of results[0]?.results || []){
    const status = String(item.status || '');
    const count = Number(item.count || 0);
    counts.all += count;
    if(Object.hasOwn(counts, status)){
      counts[status] = count;
    }
  }

  const reasonDistribution = (results[1]?.results || []).map((item) => ({
    reason: String(item.reason || 'unknown'),
    count: Number(item.count || 0)
  }));

  return {
    counts,
    top_reason: reasonDistribution[0] || null,
    reason_distribution: reasonDistribution,
    top_questions: results[2]?.results || []
  };
}

async function handleAdminUnanswered(request, env){
  const auth = await isAdminRequestAllowed(request, env);
  if(!auth.ok){
    return auth.response;
  }

  const url = new URL(request.url);
  if(url.searchParams.get('summary') === '1'){
    return jsonResponse(await getAdminUnansweredSummary(env));
  }

  let query;
  try{
    query = buildUnansweredListQuery(url);
  }catch(error){
    if(error?.message === 'INVALID_UNANSWERED_CURSOR'){
      return jsonResponse({ error: 'Invalid cursor' }, 400);
    }
    if(error?.message === 'INVALID_UNANSWERED_STATUS'){
      return jsonResponse({ error: 'Invalid status' }, 400);
    }
    throw error;
  }

  const totalResult = await env.UNANSWERED_DB.prepare(
    `SELECT COUNT(*) AS count FROM unanswered_questions WHERE ${query.countWhere}`
  ).bind(...query.countBindings).first();
  const itemsResult = await env.UNANSWERED_DB.prepare(
    [
      'SELECT id, question, reason, page_path, source, status, repeat_count, created_at, updated_at',
      'FROM unanswered_questions',
      `WHERE ${query.listWhere}`,
      `ORDER BY ${query.orderBy}`,
      `LIMIT ${query.limitBinding}`
    ].join(' ')
  ).bind(...query.listBindings).all();
  const fetchedItems = itemsResult?.results || [];
  const hasMore = fetchedItems.length > query.limit;
  const items = hasMore ? fetchedItems.slice(0, query.limit) : fetchedItems;
  const nextCursor = hasMore && items.length
    ? encodeUnansweredCursor(items[items.length - 1], query.sort)
    : null;
  const total = Number(totalResult?.count || 0);

  return jsonResponse({
    total_new: total,
    total,
    items,
    pagination: {
      limit: query.limit,
      has_more: hasMore,
      next_cursor: nextCursor
    }
  });
}

async function timingSafeTokenEqual(providedToken, expectedToken){
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest(
      'SHA-256',
      SECRET_TOKEN_ENCODER.encode(String(providedToken || ''))
    ),
    crypto.subtle.digest(
      'SHA-256',
      SECRET_TOKEN_ENCODER.encode(String(expectedToken || ''))
    )
  ]);
  const providedBytes = new Uint8Array(providedHash);
  const expectedBytes = new Uint8Array(expectedHash);

  if(typeof crypto.subtle.timingSafeEqual === 'function'){
    return crypto.subtle.timingSafeEqual(providedBytes, expectedBytes);
  }

  let mismatch = 0;
  for(let index = 0; index < providedBytes.length; index += 1){
    mismatch |= providedBytes[index] ^ expectedBytes[index];
  }
  return mismatch === 0;
}

function encodeUnansweredCursor(item, sort){
  const payload = {
    id: Number(item.id),
    updatedAt: String(item.updated_at || '')
  };

  if(sort === 'repeat'){
    payload.repeatCount = Number(item.repeat_count || 0);
  }

  return btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeUnansweredCursor(cursor, sort){
  if(!cursor){
    return null;
  }

  try{
    const normalized = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const parsed = JSON.parse(atob(padded));
    const id = Number(parsed?.id);
    const updatedAt = String(parsed?.updatedAt || '');
    const repeatCount = Number(parsed?.repeatCount);

    if(!Number.isInteger(id) || id < 1 || !updatedAt){
      throw new Error('Invalid cursor');
    }
    if(sort === 'repeat' && (!Number.isFinite(repeatCount) || repeatCount < 0)){
      throw new Error('Invalid repeat cursor');
    }

    return { id, updatedAt, repeatCount };
  }catch(error){
    throw new Error('INVALID_UNANSWERED_CURSOR', { cause: error });
  }
}

function buildUnansweredListQuery(url){
  const status = String(url.searchParams.get('status') || 'new').trim();
  if(!UNANSWERED_STATUSES.has(status)){
    throw new Error('INVALID_UNANSWERED_STATUS');
  }

  const requestedLimit = Number.parseInt(url.searchParams.get('limit') || '', 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), UNANSWERED_MAX_PAGE_SIZE)
    : UNANSWERED_DEFAULT_PAGE_SIZE;
  const requestedSort = url.searchParams.get('sort');
  const sort = ['newest', 'oldest', 'repeat'].includes(requestedSort) ? requestedSort : 'newest';
  const search = String(url.searchParams.get('q') || '').trim().slice(0, 120);
  const reason = String(url.searchParams.get('reason') || '').trim().slice(0, 80);
  const cursor = decodeUnansweredCursor(url.searchParams.get('cursor'), sort);
  const bindings = [status];
  const bind = (value) => {
    bindings.push(value);
    return `?${bindings.length}`;
  };
  const filters = ['status = ?1'];

  if(search){
    const searchBinding = bind(search);
    filters.push(`(
      instr(lower(COALESCE(question, '')), lower(${searchBinding})) > 0 OR
      instr(lower(COALESCE(reason, '')), lower(${searchBinding})) > 0 OR
      instr(lower(COALESCE(page_path, '')), lower(${searchBinding})) > 0 OR
      instr(lower(COALESCE(source, '')), lower(${searchBinding})) > 0
    )`);
  }

  if(reason){
    filters.push(`reason = ${bind(reason)}`);
  }

  const countBindings = [...bindings];
  const countWhere = filters.join(' AND ');
  let orderBy = 'updated_at DESC, id DESC';

  if(sort === 'oldest'){
    orderBy = 'updated_at ASC, id ASC';
  }else if(sort === 'repeat'){
    orderBy = 'repeat_count DESC, updated_at DESC, id DESC';
  }

  if(cursor){
    const idBinding = bind(cursor.id);
    const updatedBinding = bind(cursor.updatedAt);

    if(sort === 'oldest'){
      filters.push(`(
        updated_at > ${updatedBinding} OR
        (updated_at = ${updatedBinding} AND id > ${idBinding})
      )`);
    }else if(sort === 'repeat'){
      const repeatBinding = bind(cursor.repeatCount);
      filters.push(`(
        repeat_count < ${repeatBinding} OR
        (repeat_count = ${repeatBinding} AND (
          updated_at < ${updatedBinding} OR
          (updated_at = ${updatedBinding} AND id < ${idBinding})
        ))
      )`);
    }else{
      filters.push(`(
        updated_at < ${updatedBinding} OR
        (updated_at = ${updatedBinding} AND id < ${idBinding})
      )`);
    }
  }

  bindings.push(limit + 1);
  return {
    status,
    sort,
    limit,
    countWhere,
    countBindings,
    listWhere: filters.join(' AND '),
    listBindings: bindings,
    limitBinding: `?${bindings.length}`,
    orderBy
  };
}

function getAdminQuestionId(pathname){
  const match = pathname.match(/^\/api\/admin\/unanswered\/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

async function isAdminRequestAllowed(request, env){
  if(!env.ADMIN_API_TOKEN || !env.UNANSWERED_DB){
    return { ok: false, response: jsonResponse({ error: 'Not found' }, 404) };
  }

  const adminToken = request.headers.get('X-Admin-Token') || '';
  const tokenMatches = await timingSafeTokenEqual(adminToken, env.ADMIN_API_TOKEN);
  if(!tokenMatches){
    const rateLimitStatus = await isRateLimitAllowed(
      request,
      env,
      'admin-auth',
      env.ADMIN_AUTH_RATE_LIMITER
    );
    if(rateLimitStatus === RATE_LIMIT_UNAVAILABLE){
      return { ok: false, response: rateLimitUnavailableResponse('admin') };
    }
    if(rateLimitStatus === RATE_LIMIT_DENIED){
      return { ok: false, response: rateLimitResponse('admin') };
    }
    return { ok: false, response: jsonResponse({ error: 'Forbidden' }, 403) };
  }

  return { ok: true };
}

async function handleAdminUnansweredItem(request, env, id){
  const auth = await isAdminRequestAllowed(request, env);
  if(!auth.ok){
    return auth.response;
  }

  if(!id){
    return jsonResponse({ error: 'Invalid id' }, 400);
  }

  if(request.method === 'PATCH'){
    let payload;
    try{
      payload = await parseAdminPatchRequest(request);
    }catch(error){
      if(error instanceof AdminPatchRequestError){
        return jsonResponse({ error: error.publicMessage }, error.status);
      }
      throw error;
    }

    const status = String(payload?.status || '').trim();
    if(!UNANSWERED_STATUSES.has(status)){
      return jsonResponse({ error: 'Invalid status' }, 400);
    }

    const result = await env.UNANSWERED_DB.prepare(
      'UPDATE unanswered_questions SET status = ?1, updated_at = ?2 WHERE id = ?3'
    ).bind(status, new Date().toISOString(), id).run();

    return jsonResponse({
      ok: true,
      id,
      status,
      changed: Number(result?.meta?.changes || 0)
    });
  }

  if(request.method === 'DELETE'){
    const result = await env.UNANSWERED_DB.prepare(
      'DELETE FROM unanswered_questions WHERE id = ?1'
    ).bind(id).run();

    return jsonResponse({
      ok: true,
      id,
      deleted: Number(result?.meta?.changes || 0)
    });
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}


class SchoolRegistrationError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'SchoolRegistrationError';
    this.code = code;
    this.status = status;
  }
}

const SCHOOL_REGISTER_MAX_BYTES = 4096;
const DUPLICATE_SCHOOL_MESSAGE =
  'هذه المدرسة مسجلة مسبقًا بنفس المرحلة وإدارة التعليم.';

const SCHOOL_STAGES = new Set([
  '\u0627\u0628\u062A\u062F\u0627\u0626\u064A\u0629',
  '\u0645\u062A\u0648\u0633\u0637\u0629',
  '\u062B\u0627\u0646\u0648\u064A\u0629'
]);

function normalizeSchoolField(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function duplicateSchoolError() {
  return new SchoolRegistrationError(
    'duplicate_school',
    409,
    DUPLICATE_SCHOOL_MESSAGE
  );
}

async function schoolIdentityExists(
  database,
  schoolName,
  schoolStage,
  educationDepartment
) {
  const match = await database.prepare(
    'SELECT 1 AS found FROM schools ' +
    'WHERE lower(trim(school_name)) = lower(trim(?1)) ' +
    'AND school_stage = ?2 ' +
    'AND lower(trim(education_department)) = lower(trim(?3)) ' +
    'LIMIT 1'
  )
    .bind(schoolName, schoolStage, educationDepartment)
    .first();

  return Boolean(match);
}

function isSchoolIdentityConstraintError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('unique constraint failed') && (
    message.includes('idx_schools_identity_unique') ||
    message.includes('schools.school_name')
  );
}

function bytesToBase64Url(bytes) {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function hashSchoolEditToken(editToken) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    SECRET_TOKEN_ENCODER.encode(String(editToken))
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function readSchoolRegistrationBody(request) {
  const contentType = String(
    request.headers.get('Content-Type') || ''
  ).split(';', 1)[0].trim().toLowerCase();

  if (contentType !== 'application/json') {
    throw new SchoolRegistrationError(
      'unsupported_content_type',
      415,
      'Content-Type must be application/json.'
    );
  }

  const contentLengthHeader = request.headers.get('Content-Length');
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (
      Number.isFinite(contentLength) &&
      contentLength > SCHOOL_REGISTER_MAX_BYTES
    ) {
      throw new SchoolRegistrationError(
        'payload_too_large',
        413,
        'Request body is too large.'
      );
    }
  }

  if (!request.body) {
    throw new SchoolRegistrationError('invalid_json', 400, 'Invalid JSON.');
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bodySize = 0;
  let rawBody = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      bodySize += value.byteLength;
      if (bodySize > SCHOOL_REGISTER_MAX_BYTES) {
        await reader.cancel();
        throw new SchoolRegistrationError(
          'payload_too_large',
          413,
          'Request body is too large.'
        );
      }
      rawBody += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  rawBody += decoder.decode();

  try {
    const body = JSON.parse(rawBody);

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('Invalid object.');
    }

    return body;
  } catch {
    throw new SchoolRegistrationError(
      'invalid_json',
      400,
      'Invalid JSON.'
    );
  }
}

function phoneVerificationUnavailableResponse() {
  return jsonResponse({
    error: 'خدمة التحقق غير مفعلة حاليًا.',
    code: 'whatsapp_verification_unavailable'
  }, 503);
}

function phoneVerificationDisabledResponse() {
  return jsonResponse({
    error: 'التحقق من رقم الجوال عبر واتساب غير مفعّل حاليًا.',
    code: 'phone_verification_not_required'
  }, 409);
}

function phoneVerificationRejectedResponse() {
  return jsonResponse({
    error: 'تعذر التحقق من الرمز. اطلب رمزًا جديدًا ثم حاول مرة أخرى.',
    code: 'verification_code_invalid_or_expired'
  }, 400);
}

function phoneVerificationClaimRequiredError() {
  return new SchoolRegistrationError(
    'phone_verification_required',
    403,
    'تعذر استخدام التحقق الحالي. اطلب رمزًا جديدًا ثم حاول مرة أخرى.'
  );
}

function phoneVerificationConfigResponse(env) {
  return jsonResponse({
    phoneVerificationRequired: isPhoneVerificationRequired(env)
  }, 200, { 'Cache-Control': 'no-store' });
}

function getPhoneVerificationSecret(env) {
  return String(env.PHONE_VERIFICATION_SECRET || '').trim();
}

async function invalidateUnsentOtp(database, phone, codeHash) {
  const now = new Date().toISOString();
  const cooldownElapsed = new Date(Date.now() - PHONE_OTP_COOLDOWN_MS).toISOString();
  await database.prepare(
    'UPDATE phone_verifications ' +
    'SET code_hash = ?1, expires_at = ?2, last_sent_at = ?3, updated_at = ?2 ' +
    'WHERE phone = ?4 AND purpose = ?5 AND code_hash = ?6'
  ).bind('', now, cooldownElapsed, phone, PHONE_VERIFICATION_PURPOSE, codeHash).run();
}

async function handleSendWhatsAppCode(request, env) {
  if (!isPhoneVerificationRequired(env)) {
    return phoneVerificationDisabledResponse();
  }

  if (!env.PLATFORM_DB || typeof env.PLATFORM_DB.prepare !== 'function') {
    return jsonResponse({
      error: 'خدمة التحقق غير متاحة حاليًا.',
      code: 'verification_database_unavailable'
    }, 503);
  }

  const secret = getPhoneVerificationSecret(env);
  if (!isPhoneVerificationFlowConfigured(env)) {
    return phoneVerificationUnavailableResponse();
  }

  try {
    const body = await readSchoolRegistrationBody(request);
    const phone = normalizeSaudiMobile(body.phone);
    if (!phone) {
      throw new SchoolRegistrationError(
        'invalid_registration_contact_phone',
        400,
        'أدخل رقم جوال سعودي صحيحًا.'
      );
    }
    if (!isWhatsAppTestRecipientAllowed(env, phone)) {
      return phoneVerificationUnavailableResponse();
    }

    const code = generateOtpCode();
    const codeHash = await hashOtpCode(secret, phone, code);
    const now = new Date();
    const sentAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + PHONE_OTP_TTL_MS).toISOString();
    const cooldownElapsed = new Date(now.getTime() - PHONE_OTP_COOLDOWN_MS).toISOString();
    const reservation = await env.PLATFORM_DB.prepare(
      'INSERT INTO phone_verifications ' +
      '(phone, code_hash, purpose, expires_at, attempts, last_sent_at, verified_at, ' +
      'verification_token_hash, token_expires_at, consumed_at, created_at, updated_at) ' +
      'VALUES (?1, ?2, ?3, ?4, 0, ?5, NULL, NULL, NULL, NULL, ?5, ?5) ' +
      'ON CONFLICT(phone, purpose) DO UPDATE SET ' +
      'code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, ' +
      'last_sent_at = excluded.last_sent_at, verified_at = NULL, ' +
      'verification_token_hash = NULL, token_expires_at = NULL, consumed_at = NULL, ' +
      'updated_at = excluded.updated_at ' +
      'WHERE phone_verifications.last_sent_at <= ?6'
    ).bind(
      phone,
      codeHash,
      PHONE_VERIFICATION_PURPOSE,
      expiresAt,
      sentAt,
      cooldownElapsed
    ).run();

    if (Number(reservation?.meta?.changes || 0) !== 1) {
      return jsonResponse({
        error: 'انتظر 60 ثانية قبل طلب رمز جديد.',
        code: 'verification_code_cooldown'
      }, 429, { 'Retry-After': '60' });
    }

    try {
      await sendWhatsAppOtp(env, phone, code);
    } catch (error) {
      await invalidateUnsentOtp(env.PLATFORM_DB, phone, codeHash);
      if (error instanceof WhatsAppOtpError) {
        return jsonResponse({ error: error.message, code: error.code }, error.status);
      }
      return jsonResponse({
        error: 'تعذر إرسال رمز التحقق حاليًا. حاول مرة أخرى لاحقًا.',
        code: 'whatsapp_send_failed'
      }, 502);
    }

    return jsonResponse({
      ok: true,
      status: 'code_sent',
      expiresInSeconds: PHONE_OTP_TTL_MS / 1000,
      retryAfterSeconds: PHONE_OTP_COOLDOWN_MS / 1000
    });
  } catch (error) {
    if (error instanceof SchoolRegistrationError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status);
    }
    return jsonResponse({
      error: 'تعذر تجهيز رمز التحقق حاليًا.',
      code: 'verification_request_failed'
    }, 500);
  }
}

async function handleVerifyWhatsAppCode(request, env) {
  if (!isPhoneVerificationRequired(env)) {
    return phoneVerificationDisabledResponse();
  }

  if (!env.PLATFORM_DB || typeof env.PLATFORM_DB.prepare !== 'function') {
    return jsonResponse({
      error: 'خدمة التحقق غير متاحة حاليًا.',
      code: 'verification_database_unavailable'
    }, 503);
  }

  const secret = getPhoneVerificationSecret(env);
  if (!secret) return phoneVerificationUnavailableResponse();

  try {
    const body = await readSchoolRegistrationBody(request);
    const phone = normalizeSaudiMobile(body.phone);
    const code = String(body.code || '').trim();
    if (!phone) {
      throw new SchoolRegistrationError(
        'invalid_registration_contact_phone',
        400,
        'أدخل رقم جوال سعودي صحيحًا.'
      );
    }
    if (!isOtpCode(code)) {
      return phoneVerificationRejectedResponse();
    }

    const submittedHash = await hashOtpCode(secret, phone, code);
    const row = await env.PLATFORM_DB.prepare(
      'SELECT id, code_hash, expires_at, attempts FROM phone_verifications ' +
      'WHERE phone = ?1 AND purpose = ?2 LIMIT 1'
    ).bind(phone, PHONE_VERIFICATION_PURPOSE).first();

    if (!row) return phoneVerificationRejectedResponse();

    const attempts = Number(row.attempts || 0);
    if (attempts >= PHONE_OTP_MAX_ATTEMPTS) {
      return phoneVerificationRejectedResponse();
    }
    if (!row.expires_at || Date.parse(row.expires_at) <= Date.now()) {
      return phoneVerificationRejectedResponse();
    }

    const matches = await timingSafeTokenEqual(submittedHash, row.code_hash);
    if (!matches) {
      const attemptResult = await env.PLATFORM_DB.prepare(
        'UPDATE phone_verifications SET attempts = attempts + 1, updated_at = ?1 ' +
        'WHERE id = ?2 AND attempts < ?3 RETURNING attempts'
      ).bind(
        new Date().toISOString(),
        row.id,
        PHONE_OTP_MAX_ATTEMPTS
      ).first();
      if (attemptResult?.attempts === undefined) {
        return phoneVerificationRejectedResponse();
      }
      return phoneVerificationRejectedResponse();
    }

    const verificationToken = generateVerificationToken();
    const tokenHash = await hashVerificationToken(verificationToken);
    const verifiedAt = new Date();
    const tokenExpiresAt = new Date(
      verifiedAt.getTime() + PHONE_VERIFICATION_TOKEN_TTL_MS
    ).toISOString();
    const verificationResult = await env.PLATFORM_DB.prepare(
      'UPDATE phone_verifications SET verified_at = ?1, verification_token_hash = ?2, ' +
      "token_expires_at = ?3, consumed_at = NULL, code_hash = '', expires_at = ?1, " +
      'updated_at = ?1 WHERE id = ?4 AND code_hash = ?5'
    ).bind(
      verifiedAt.toISOString(),
      tokenHash,
      tokenExpiresAt,
      row.id,
      submittedHash
    ).run();
    if (Number(verificationResult?.meta?.changes || 0) !== 1) {
      return phoneVerificationRejectedResponse();
    }

    return jsonResponse({
      ok: true,
      status: 'verified',
      verificationToken,
      expiresInSeconds: PHONE_VERIFICATION_TOKEN_TTL_MS / 1000
    });
  } catch (error) {
    if (error instanceof SchoolRegistrationError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status);
    }
    return jsonResponse({
      error: 'تعذر التحقق من الرمز حاليًا.',
      code: 'verification_failed'
    }, 500);
  }
}

async function handleSchoolRegistration(request, env) {
  if (!env.PLATFORM_DB || typeof env.PLATFORM_DB.prepare !== 'function') {
    return jsonResponse({
      error: 'School database is unavailable.',
      code: 'school_database_unavailable'
    }, 503);
  }

  try {
    const body = await readSchoolRegistrationBody(request);

    const schoolName = normalizeSchoolField(body.schoolName);
    const schoolStage = normalizeSchoolField(
      body.schoolStage ?? body.stage
    );
    const educationDepartment =
      normalizeSchoolField(body.educationDepartment);
    const registrationContactName =
      normalizeSchoolField(body.registrationContactName);
    const registrationContactPhone =
      normalizeSaudiMobile(body.registrationContactPhone);
    const registrationContactConsent =
      body.registrationContactConsent === true;
    const phoneVerificationToken = String(body.phoneVerificationToken || '').trim();

    if (schoolName.length < 2 || schoolName.length > 120) {
      throw new SchoolRegistrationError(
        'invalid_school_name',
        400,
        'School name must be between 2 and 120 characters.'
      );
    }

    if (!SCHOOL_STAGES.has(schoolStage)) {
      throw new SchoolRegistrationError(
        'invalid_school_stage',
        400,
        'School stage is not supported.'
      );
    }

    if (
      educationDepartment.length < 3 ||
      educationDepartment.length > 160
    ) {
      throw new SchoolRegistrationError(
        'invalid_education_department',
        400,
        'Education department must be between 3 and 160 characters.'
      );
    }

    if (registrationContactName.length > 120) {
      throw new SchoolRegistrationError(
        'invalid_registration_contact_name',
        400,
        'Registration contact name must not exceed 120 characters.'
      );
    }

    if (!registrationContactPhone) {
      throw new SchoolRegistrationError(
        'invalid_registration_contact_phone',
        400,
        'A valid Saudi mobile number is required.'
      );
    }

    if (!registrationContactConsent) {
      throw new SchoolRegistrationError(
        'registration_contact_consent_required',
        400,
        'Registration contact consent is required.'
      );
    }

    if (await schoolIdentityExists(
      env.PLATFORM_DB,
      schoolName,
      schoolStage,
      educationDepartment
    )) {
      throw duplicateSchoolError();
    }

    const phoneVerificationRequired = isPhoneVerificationRequired(env);
    if (
      phoneVerificationRequired &&
      (!phoneVerificationToken || phoneVerificationToken.length > 200)
    ) {
      throw phoneVerificationClaimRequiredError();
    }

    const publicIdBytes = new Uint8Array(16);
    crypto.getRandomValues(publicIdBytes);
    const publicId = 'school_' + bytesToBase64Url(publicIdBytes);

    const editTokenBytes = new Uint8Array(32);
    crypto.getRandomValues(editTokenBytes);
    // Compatibility credential for a future claim/edit flow. The current
    // registration UI still requires and stores it, so issuance remains stable.
    const editToken = bytesToBase64Url(editTokenBytes);
    const editTokenHash = await hashSchoolEditToken(editToken);

    const verificationTokenHash = phoneVerificationRequired
      ? await hashVerificationToken(phoneVerificationToken)
      : '';
    const verificationClaimedAt = new Date().toISOString();
    const verificationCondition = phoneVerificationRequired
      ? 'AND EXISTS (' +
        'SELECT 1 FROM phone_verifications ' +
        'WHERE phone = ?8 AND purpose = ?9 AND verification_token_hash = ?10 ' +
        'AND verified_at IS NOT NULL AND token_expires_at > ?11 AND consumed_at IS NULL' +
        ') '
      : '';
    const insertSchoolStatement = env.PLATFORM_DB.prepare(
      'INSERT INTO schools ' +
      '(public_id, edit_token_hash, school_name, school_stage, education_department, ' +
      'registration_contact_name, registration_contact_phone) ' +
      'SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 ' +
      'WHERE NOT EXISTS (' +
      'SELECT 1 FROM schools ' +
      'WHERE lower(trim(school_name)) = lower(trim(?3)) ' +
      'AND school_stage = ?4 ' +
      'AND lower(trim(education_department)) = lower(trim(?5)) ' +
      'LIMIT 1' +
      ') ' +
      verificationCondition
    )
      .bind(
        publicId,
        editTokenHash,
        schoolName,
        schoolStage,
        educationDepartment,
        registrationContactName || null,
        registrationContactPhone,
        ...(phoneVerificationRequired ? [
          registrationContactPhone,
          PHONE_VERIFICATION_PURPOSE,
          verificationTokenHash,
          verificationClaimedAt
        ] : [])
      );

    let result;
    let claimResult = null;
    if (phoneVerificationRequired) {
      const consumeVerificationStatement = env.PLATFORM_DB.prepare(
        'UPDATE phone_verifications SET consumed_at = ?1, updated_at = ?1 ' +
        'WHERE phone = ?2 AND purpose = ?3 AND verification_token_hash = ?4 ' +
        'AND verified_at IS NOT NULL AND token_expires_at > ?1 AND consumed_at IS NULL ' +
        'AND EXISTS (SELECT 1 FROM schools WHERE public_id = ?5)'
      ).bind(
        verificationClaimedAt,
        registrationContactPhone,
        PHONE_VERIFICATION_PURPOSE,
        verificationTokenHash,
        publicId
      );
      [result, claimResult] = await env.PLATFORM_DB.batch([
        insertSchoolStatement,
        consumeVerificationStatement
      ]);
    } else {
      result = await insertSchoolStatement.run();
    }

    if (result?.success === false) {
      throw new Error('D1 insert failed.');
    }

    if (Number(result?.meta?.changes || 0) === 0) {
      if (phoneVerificationRequired && Number(claimResult?.meta?.changes || 0) === 0) {
        if (!await schoolIdentityExists(
          env.PLATFORM_DB,
          schoolName,
          schoolStage,
          educationDepartment
        )) {
          throw phoneVerificationClaimRequiredError();
        }
      }
      throw duplicateSchoolError();
    }

    if (
      phoneVerificationRequired &&
      Number(claimResult?.meta?.changes || 0) !== 1
    ) {
      throw new Error('Phone verification claim failed.');
    }

    return jsonResponse({
      ok: true,
      school: {
        publicId,
        schoolName,
        schoolStage,
        educationDepartment,
        verificationStatus: 'unverified'
      },
      editToken
    }, 201);
  } catch (error) {
    if (error instanceof SchoolRegistrationError) {
      return jsonResponse({
        error: error.message,
        code: error.code
      }, error.status);
    }

    if (isSchoolIdentityConstraintError(error)) {
      const duplicateError = duplicateSchoolError();
      return jsonResponse({
        error: duplicateError.message,
        code: duplicateError.code
      }, duplicateError.status);
    }

    console.error('School registration failed.', error);

    return jsonResponse({
      error: 'Unable to register school.',
      code: 'school_registration_failed'
    }, 500);
  }
}


export default {
  async fetch(request, env){
    const url = new URL(request.url);

    if(url.pathname.startsWith('/api/admin/unanswered/')){
      return handleAdminUnansweredItem(request, env, getAdminQuestionId(url.pathname));
    }

    if(url.pathname === '/api/admin/unanswered'){
      if(request.method !== 'GET'){
        return jsonResponse({ error: 'Method not allowed' }, 405);
      }

      return handleAdminUnanswered(request, env);
    }

    if(url.pathname === '/api/register/verification-config'){
      if(request.method !== 'GET'){
        return jsonResponse(
          { error: 'Method not allowed' },
          405,
          { 'Allow': 'GET' }
        );
      }

      return phoneVerificationConfigResponse(env);
    }


    if(
      url.pathname === '/api/register/send-whatsapp-code' ||
      url.pathname === '/api/register/verify-whatsapp-code'
    ){
      if(request.method !== 'POST'){
        return jsonResponse(
          { error: 'Method not allowed' },
          405,
          { 'Allow': 'POST' }
        );
      }

      if(!isPhoneVerificationRequired(env)){
        return phoneVerificationDisabledResponse();
      }

      const scope = url.pathname.endsWith('send-whatsapp-code')
        ? 'whatsapp-code-send'
        : 'whatsapp-code-verify';
      const rateLimitStatus = await isRateLimitAllowed(
        request,
        env,
        scope,
        env.CHAT_RATE_LIMITER
      );
      if(rateLimitStatus === RATE_LIMIT_UNAVAILABLE){
        return rateLimitUnavailableResponse(scope);
      }
      if(rateLimitStatus === RATE_LIMIT_DENIED){
        return jsonResponse({
          error: 'تم تجاوز الحد المسموح مؤقتًا. انتظر دقيقة ثم حاول مرة أخرى.',
          code: 'rate_limited'
        }, 429, { 'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS) });
      }

      return url.pathname.endsWith('send-whatsapp-code')
        ? handleSendWhatsAppCode(request, env)
        : handleVerifyWhatsAppCode(request, env);
    }

    if(url.pathname === '/api/schools/register'){
      if(request.method !== 'POST'){
        return jsonResponse(
          { error: 'Method not allowed' },
          405,
          { 'Allow': 'POST' }
        );
      }

      const rateLimitStatus = await isRateLimitAllowed(
        request,
        env,
        'school-register',
        env.CHAT_RATE_LIMITER
      );

      if(rateLimitStatus === RATE_LIMIT_UNAVAILABLE){
        return rateLimitUnavailableResponse('school-register');
      }
      if(rateLimitStatus === RATE_LIMIT_DENIED){
        return jsonResponse({
          error: 'Too many requests',
          code: 'rate_limited'
        }, 429, {
          'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS)
        });
      }

      return handleSchoolRegistration(request, env);
    }

    if(url.pathname === '/api/chat'){
      if(request.method !== 'POST'){
        return jsonResponse({ error: 'Method not allowed' }, 405);
      }

      const rateLimitStatus = await isRateLimitAllowed(
        request,
        env,
        'chat',
        env.CHAT_RATE_LIMITER
      );
      if(rateLimitStatus === RATE_LIMIT_UNAVAILABLE){
        return rateLimitUnavailableResponse('chat');
      }
      if(rateLimitStatus === RATE_LIMIT_DENIED){
        return rateLimitResponse('chat');
      }

      return handleChat(request, env);
    }

    if(url.pathname.startsWith('/api/')){
      return jsonResponse({ error: 'Not found' }, 404);
    }

    return fetchInternalAsset(request, env, url.pathname);
  }
};
