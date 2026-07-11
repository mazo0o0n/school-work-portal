const FALLBACK_ANSWER = 'ما عندي معلومة مؤكدة عن هذا السؤال حاليًا، تقدر تعيد صياغته أو تراجع الجهة المختصة.';
const EMBEDDING_MODEL = '@cf/qwen/qwen3-embedding-0.6b';
const CHAT_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
const MIN_SCORE = 0.55;
const TOP_K = 4;

function jsonResponse(body, status = 200){
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function withDebug(env, body, debug){
  if(env.DEBUG_CHAT === 'true'){
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
  try{
    let payload;
    try{
      payload = await request.json();
    }catch(_){
      return jsonResponse(fallbackBody(), 400);
    }

    const question = String(payload?.message || payload?.question || '').trim();
    if(!question){
      return jsonResponse(fallbackBody(), 400);
    }

    if(isExternalPlatformDefinitionQuestion(question)){
      return jsonResponse(withDebug(env, fallbackBody(), {
        type: 'external_platform_definition_guard'
      }));
    }

    if(!env.AI || !env.VECTORIZE){
      return jsonResponse(
        withDebug(env, fallbackBody(), { type: 'missing_bindings' }),
        500
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
    const body = {
      answer,
      source: notFound ? 'قاعدة معرفة المنصة' : usableMatches[0].source,
      notFound
    };

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
    return jsonResponse(
      withDebug(env, fallbackBody(), {
        type: 'strict_rag_failed',
        message: String(error?.message || error).slice(0, 1000)
      }),
      502
    );
  }
}

export default {
  async fetch(request, env){
    const url = new URL(request.url);

    if(url.pathname === '/api/chat'){
      if(request.method !== 'POST'){
        return jsonResponse({ error: 'Method not allowed' }, 405);
      }

      return handleChat(request, env);
    }

    if(url.pathname.startsWith('/api/')){
      return jsonResponse({ error: 'Not found' }, 404);
    }

    return env.ASSETS.fetch(request);
  }
};
