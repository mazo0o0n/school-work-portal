import baseWorker from './index.js';

const ADMIN_PAGE_PATHS = new Set(['/admin-schools', '/admin-schools.html']);
const SCHOOL_STATUSES = new Set(['unverified', 'pending', 'verified', 'suspended']);
const SCHOOL_STAGES = new Set(['ابتدائية', 'متوسطة', 'ثانوية']);
const SCHOOL_SORTS = new Set(['newest', 'oldest', 'name']);
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const MAX_ADMIN_BODY_BYTES = 4 * 1024;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const TOKEN_ENCODER = new TextEncoder();

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

function adminErrorResponse(message, status, code){
  return jsonResponse({ error: message, code }, status);
}

async function timingSafeTokenEqual(providedToken, expectedToken){
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', TOKEN_ENCODER.encode(String(providedToken || ''))),
    crypto.subtle.digest('SHA-256', TOKEN_ENCODER.encode(String(expectedToken || '')))
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

async function getRateLimitKey(request, env){
  const clientAddress = String(request.headers.get('CF-Connecting-IP') || '').trim();
  const secretSalt = String(env.RATE_LIMIT_SALT || '').trim();
  if(!clientAddress || !secretSalt) return '';

  const digest = await crypto.subtle.digest(
    'SHA-256',
    TOKEN_ENCODER.encode(`${secretSalt}:admin-schools:${clientAddress}`)
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function isInvalidAdminAttemptAllowed(request, env){
  const limiter = env.ADMIN_AUTH_RATE_LIMITER;
  if(!limiter || typeof limiter.limit !== 'function') return true;

  const key = await getRateLimitKey(request, env);
  if(!key) return true;

  try{
    const result = await limiter.limit({ key });
    return result?.success !== false;
  }catch{
    console.error('Admin schools rate limiting binding unavailable.');
    return true;
  }
}

async function authorizeAdmin(request, env){
  if(!env.ADMIN_API_TOKEN || !env.PLATFORM_DB || typeof env.PLATFORM_DB.prepare !== 'function'){
    return { ok: false, response: adminErrorResponse('Not found', 404, 'not_found') };
  }

  const providedToken = request.headers.get('X-Admin-Token') || '';
  if(await timingSafeTokenEqual(providedToken, env.ADMIN_API_TOKEN)){
    return { ok: true };
  }

  if(!await isInvalidAdminAttemptAllowed(request, env)){
    return {
      ok: false,
      response: jsonResponse({
        error: 'تم تجاوز عدد محاولات الدخول. انتظر دقيقة ثم حاول مرة أخرى.',
        code: 'rate_limited'
      }, 429, {
        'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS)
      })
    };
  }

  return { ok: false, response: adminErrorResponse('Forbidden', 403, 'forbidden') };
}

function parsePositiveInteger(value, fallback, maximum){
  const parsed = Number.parseInt(String(value || ''), 10);
  if(!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function buildSchoolFilters(url){
  const status = String(url.searchParams.get('status') || '').trim();
  const stage = String(url.searchParams.get('stage') || '').trim();
  const search = String(url.searchParams.get('q') || '').trim().slice(0, 120);
  const bindings = [];
  const filters = [];
  const bind = (value) => {
    bindings.push(value);
    return `?${bindings.length}`;
  };

  if(status){
    if(!SCHOOL_STATUSES.has(status)) throw new Error('INVALID_SCHOOL_STATUS');
    filters.push(`verification_status = ${bind(status)}`);
  }

  if(stage){
    if(!SCHOOL_STAGES.has(stage)) throw new Error('INVALID_SCHOOL_STAGE');
    filters.push(`school_stage = ${bind(stage)}`);
  }

  if(search){
    const searchBinding = bind(search);
    filters.push(`(
      instr(lower(COALESCE(school_name, '')), lower(${searchBinding})) > 0 OR
      instr(lower(COALESCE(education_department, '')), lower(${searchBinding})) > 0 OR
      instr(lower(COALESCE(public_id, '')), lower(${searchBinding})) > 0
    )`);
  }

  return {
    where: filters.length ? `WHERE ${filters.join(' AND ')}` : '',
    bindings
  };
}

function getSchoolOrder(sort){
  if(sort === 'oldest') return 'id ASC';
  if(sort === 'name') return 'school_name COLLATE NOCASE ASC, id ASC';
  return 'id DESC';
}

async function getSchoolSummary(env){
  const statements = [
    env.PLATFORM_DB.prepare(
      'SELECT verification_status AS status, COUNT(*) AS count FROM schools GROUP BY verification_status'
    ),
    env.PLATFORM_DB.prepare(
      'SELECT school_stage AS stage, COUNT(*) AS count FROM schools GROUP BY school_stage'
    )
  ];
  const results = typeof env.PLATFORM_DB.batch === 'function'
    ? await env.PLATFORM_DB.batch(statements)
    : await Promise.all(statements.map((statement) => statement.all()));

  const statusCounts = {
    all: 0,
    unverified: 0,
    pending: 0,
    verified: 0,
    suspended: 0
  };
  for(const item of results[0]?.results || []){
    const status = String(item.status || '');
    const count = Number(item.count || 0);
    statusCounts.all += count;
    if(Object.hasOwn(statusCounts, status)) statusCounts[status] = count;
  }

  const stageCounts = {
    ابتدائية: 0,
    متوسطة: 0,
    ثانوية: 0
  };
  for(const item of results[1]?.results || []){
    const stage = String(item.stage || '');
    if(Object.hasOwn(stageCounts, stage)) stageCounts[stage] = Number(item.count || 0);
  }

  return { status_counts: statusCounts, stage_counts: stageCounts };
}

async function handleSchoolList(request, env){
  const auth = await authorizeAdmin(request, env);
  if(!auth.ok) return auth.response;

  const url = new URL(request.url);
  if(url.searchParams.get('summary') === '1'){
    return jsonResponse(await getSchoolSummary(env));
  }

  let filters;
  try{
    filters = buildSchoolFilters(url);
  }catch(error){
    if(error?.message === 'INVALID_SCHOOL_STATUS'){
      return adminErrorResponse('Invalid status', 400, 'invalid_status');
    }
    if(error?.message === 'INVALID_SCHOOL_STAGE'){
      return adminErrorResponse('Invalid stage', 400, 'invalid_stage');
    }
    throw error;
  }

  const page = parsePositiveInteger(url.searchParams.get('page'), 1, 10000);
  const limit = parsePositiveInteger(url.searchParams.get('limit'), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const requestedSort = String(url.searchParams.get('sort') || 'newest').trim();
  const sort = SCHOOL_SORTS.has(requestedSort) ? requestedSort : 'newest';
  const offset = (page - 1) * limit;
  const countResult = await env.PLATFORM_DB.prepare(
    `SELECT COUNT(*) AS count FROM schools ${filters.where}`
  ).bind(...filters.bindings).first();

  const listBindings = [...filters.bindings, limit, offset];
  const limitPlaceholder = `?${filters.bindings.length + 1}`;
  const offsetPlaceholder = `?${filters.bindings.length + 2}`;
  const itemsResult = await env.PLATFORM_DB.prepare([
    'SELECT id, public_id, school_name, school_stage, education_department,',
    'verification_status, created_at, updated_at',
    'FROM schools',
    filters.where,
    `ORDER BY ${getSchoolOrder(sort)}`,
    `LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`
  ].filter(Boolean).join(' ')).bind(...listBindings).all();

  const total = Number(countResult?.count || 0);
  const pages = Math.max(1, Math.ceil(total / limit));

  return jsonResponse({
    total,
    items: itemsResult?.results || [],
    pagination: {
      page,
      limit,
      pages,
      has_previous: page > 1,
      has_next: page < pages
    }
  });
}

async function readAdminJsonBody(request){
  const contentType = String(request.headers.get('content-type') || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if(contentType !== 'application/json'){
    throw Object.assign(new Error('Unsupported content type'), { status: 415, code: 'unsupported_content_type' });
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if(Number.isFinite(contentLength) && contentLength > MAX_ADMIN_BODY_BYTES){
    throw Object.assign(new Error('Request too large'), { status: 413, code: 'request_too_large' });
  }

  const rawBody = await request.text();
  if(TOKEN_ENCODER.encode(rawBody).byteLength > MAX_ADMIN_BODY_BYTES){
    throw Object.assign(new Error('Request too large'), { status: 413, code: 'request_too_large' });
  }

  try{
    const payload = JSON.parse(rawBody);
    if(!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid object');
    return payload;
  }catch{
    throw Object.assign(new Error('Invalid JSON'), { status: 400, code: 'invalid_json' });
  }
}

function getSchoolId(pathname){
  const match = pathname.match(/^\/api\/admin\/schools\/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

async function handleSchoolItem(request, env, id){
  const auth = await authorizeAdmin(request, env);
  if(!auth.ok) return auth.response;
  if(!Number.isInteger(id) || id < 1){
    return adminErrorResponse('Invalid id', 400, 'invalid_id');
  }

  if(request.method === 'PATCH'){
    let payload;
    try{
      payload = await readAdminJsonBody(request);
    }catch(error){
      return adminErrorResponse(error.message, error.status || 400, error.code || 'invalid_request');
    }

    const status = String(payload.verificationStatus || payload.status || '').trim();
    if(!SCHOOL_STATUSES.has(status)){
      return adminErrorResponse('Invalid status', 400, 'invalid_status');
    }

    const result = await env.PLATFORM_DB.prepare(
      "UPDATE schools SET verification_status = ?1, updated_at = datetime('now') WHERE id = ?2"
    ).bind(status, id).run();

    return jsonResponse({
      ok: true,
      id,
      verification_status: status,
      changed: Number(result?.meta?.changes || 0)
    });
  }

  if(request.method === 'DELETE'){
    const result = await env.PLATFORM_DB.prepare(
      'DELETE FROM schools WHERE id = ?1'
    ).bind(id).run();

    return jsonResponse({
      ok: true,
      id,
      deleted: Number(result?.meta?.changes || 0)
    });
  }

  return adminErrorResponse('Method not allowed', 405, 'method_not_allowed');
}

async function fetchAdminPage(request, env){
  if(!env.ASSETS || typeof env.ASSETS.fetch !== 'function'){
    return new Response('Not found', { status: 404 });
  }

  const assetUrl = new URL(request.url);
  assetUrl.pathname = '/admin-schools.html';
  const response = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
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

export default {
  async fetch(request, env, ctx){
    const url = new URL(request.url);

    if(ADMIN_PAGE_PATHS.has(url.pathname)){
      if(request.method !== 'GET' && request.method !== 'HEAD'){
        return adminErrorResponse('Method not allowed', 405, 'method_not_allowed');
      }
      return fetchAdminPage(request, env);
    }

    if(url.pathname.startsWith('/api/admin/schools/')){
      return handleSchoolItem(request, env, getSchoolId(url.pathname));
    }

    if(url.pathname === '/api/admin/schools'){
      if(request.method !== 'GET'){
        return adminErrorResponse('Method not allowed', 405, 'method_not_allowed');
      }
      return handleSchoolList(request, env);
    }

    return baseWorker.fetch(request, env, ctx);
  }
};
