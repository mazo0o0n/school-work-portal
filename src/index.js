import {
  CHAT_FALLBACK_ANSWER,
  CHAT_INVALID_REQUEST_ANSWER,
  CHAT_TEMPORARY_ERROR_ANSWER,
  ChatRequestError,
  isChatDebugEnabled,
  parseChatRequest,
  sanitizeQuestionForStorage
} from './chat-security.mjs';

const FALLBACK_ANSWER = CHAT_FALLBACK_ANSWER;
const EMBEDDING_MODEL = '@cf/qwen/qwen3-embedding-0.6b';
const CHAT_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
const MIN_SCORE = 0.55;
const TOP_K = 4;
const UNANSWERED_STATUSES = new Set(['new', 'reviewed', 'added_to_knowledge', 'ignored']);
const UNANSWERED_DEFAULT_PAGE_SIZE = 50;
const UNANSWERED_MAX_PAGE_SIZE = 50;
const ADMIN_PATCH_MAX_REQUEST_BYTES = 4 * 1024;
const SECRET_TOKEN_ENCODER = new TextEncoder();
const RATE_LIMIT_WINDOW_SECONDS = 60;
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
    return true;
  }

  const key = await getRateLimitClientKey(request, env, scope);
  if(!key){
    return true;
  }

  try{
    const result = await limiter.limit({ key });
    return result?.success !== false;
  }catch{
    console.error('Rate limiting binding unavailable.');
    return true;
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

function getMatchesWithText(vectorizeResult){
  return (vectorizeResult?.matches || [])
    .map((match) => ({
      id: match.id,
      score: Number(match.score || 0),
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

function buildSearchQueries(question){
  const normalized = normalizeArabicQuestion(question);
  const queries = [question];

  if(normalized && normalized !== question){
    queries.push(normalized);
  }

  if(normalized.includes('التطوير المهني التعليمي')){
    queries.push('استفسارات شائعة حول احتساب نقاط التطوير المهني للترقية');
  }

  if(normalized && !/منصة التنظيم المدرسي/.test(normalized)){
    queries.push(`${normalized} في منصة التنظيم المدرسي`);
  }

  return [...new Set(queries)].slice(0, 2);
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

function mergeMatches(matchGroups){
  const byId = new Map();
  matchGroups.flat().forEach((match) => {
    const current = byId.get(match.id);
    if(!current || match.score > current.score){
      byId.set(match.id, match);
    }
  });
  return [...byId.values()].sort((a, b) => b.score - a.score).slice(0, TOP_K);
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

    const searchQueries = buildSearchQueries(question);
    const matchGroups = [];

    for(const query of searchQueries){
      const embeddingResult = await env.AI.run(EMBEDDING_MODEL, {
        text: query
      });
      const queryEmbedding = extractEmbedding(embeddingResult);

      const vectorizeResult = await env.VECTORIZE.query(queryEmbedding, {
        topK: TOP_K,
        returnMetadata: true
      });

      matchGroups.push(getMatchesWithText(vectorizeResult));
    }

    const matches = mergeMatches(matchGroups);
    const topScore = matches[0]?.score || 0;
    const usableMatches = matches.filter((match) => match.score >= MIN_SCORE);

    if(!usableMatches.length || topScore < MIN_SCORE){
      await saveUnansweredQuestion(env, {
        question,
        pagePath,
        reason: usableMatches.length ? 'low_score' : 'no_matches'
      });
      return jsonResponse(withDebug(env, fallbackBody(), {
        type: 'no_retrieved_context',
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
    const allowed = await isRateLimitAllowed(
      request,
      env,
      'admin-auth',
      env.ADMIN_AUTH_RATE_LIMITER
    );
    if(!allowed){
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

function hasMatchingSchoolIdentity(
  rows,
  schoolName,
  schoolStage,
  educationDepartment
) {
  return rows.some((row) => (
    normalizeSchoolField(row.school_name) === schoolName &&
    normalizeSchoolField(row.school_stage) === schoolStage &&
    normalizeSchoolField(row.education_department) === educationDepartment
  ));
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
  const result = await database.prepare(
    'SELECT school_name, school_stage, education_department ' +
    'FROM schools WHERE school_stage = ?1'
  )
    .bind(schoolStage)
    .all();

  return hasMatchingSchoolIdentity(
    Array.isArray(result?.results) ? result.results : [],
    schoolName,
    schoolStage,
    educationDepartment
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
  ).toLowerCase();

  if (!contentType.includes('application/json')) {
    throw new SchoolRegistrationError(
      'unsupported_content_type',
      415,
      'Content-Type must be application/json.'
    );
  }

  const rawBody = await request.text();
  const bodySize = SECRET_TOKEN_ENCODER.encode(rawBody).byteLength;

  if (bodySize > SCHOOL_REGISTER_MAX_BYTES) {
    throw new SchoolRegistrationError(
      'payload_too_large',
      413,
      'Request body is too large.'
    );
  }

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

    if (await schoolIdentityExists(
      env.PLATFORM_DB,
      schoolName,
      schoolStage,
      educationDepartment
    )) {
      throw duplicateSchoolError();
    }

    const publicIdBytes = new Uint8Array(16);
    crypto.getRandomValues(publicIdBytes);
    const publicId = 'school_' + bytesToBase64Url(publicIdBytes);

    const editTokenBytes = new Uint8Array(32);
    crypto.getRandomValues(editTokenBytes);
    const editToken = bytesToBase64Url(editTokenBytes);
    const editTokenHash = await hashSchoolEditToken(editToken);

    const result = await env.PLATFORM_DB.prepare(
      'INSERT INTO schools ' +
      '(public_id, edit_token_hash, school_name, school_stage, education_department) ' +
      'SELECT ?1, ?2, ?3, ?4, ?5 ' +
      'WHERE NOT EXISTS (' +
      'SELECT 1 FROM schools ' +
      'WHERE school_name = ?3 ' +
      'AND school_stage = ?4 ' +
      'AND education_department = ?5' +
      ')'
    )
      .bind(
        publicId,
        editTokenHash,
        schoolName,
        schoolStage,
        educationDepartment
      )
      .run();

    if (result?.success === false) {
      throw new Error('D1 insert failed.');
    }

    if (Number(result?.meta?.changes || 0) === 0) {
      throw duplicateSchoolError();
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


    if(url.pathname === '/api/schools/register'){
      if(request.method !== 'POST'){
        return jsonResponse(
          { error: 'Method not allowed' },
          405,
          { 'Allow': 'POST' }
        );
      }

      const allowed = await isRateLimitAllowed(
        request,
        env,
        'school-register',
        env.CHAT_RATE_LIMITER
      );

      if(!allowed){
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

      const allowed = await isRateLimitAllowed(
        request,
        env,
        'chat',
        env.CHAT_RATE_LIMITER
      );
      if(!allowed){
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
